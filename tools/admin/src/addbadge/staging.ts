/**
 * 暂存区：把「加一条徽章」拆成**只写文件**与**以后统一跑**两步。
 *
 * 为什么需要它：现有的 `/badge/submit` 是**立即**抢锁 + 拉起 detached 子进程，
 * 加几条就要跑几次约 10–15 分钟的批量管道。用户要的流程是：
 *
 *   ① 加一条 → **只保存**（零计算、零枚举、绝不碰 `packages/shared/src/badges/*`）
 *   ② 过一会再加一条 → 同样只保存；想加几条加几条，可删可改
 *   ③ 树形列表把「这一批待运行的草稿」显示成一个批次
 *   ④ 点「统一跑」→ 走**现有的批量管道**（`submitBadgeBatchJob`，一次事务）
 *
 * 关键性质（对应测试「保存不触发任何计算」）：
 *   - 保存路径**只做一次原子写**（临时文件 + rename，与 `state.ts` 的 status.json 同一手法）；
 *   - 不抢锁、不写作业文件、不拉子进程、不跑干跑、不做任何 spec 校验；
 *   - 草稿存的是**表单原始字符串**，连 `when` 的 JSON.parse 都推迟到统一跑那一步——
 *     所以「存进去」永远瞬间成功，反馈（哪条草稿不合法）推迟到点统一跑时。
 *
 * 落位：`tools/admin/out/addbadge/staging.json`（`out/.gitignore` 的内容是 `*`，不会入库）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ADD_BADGE_OUT_DIR, addBadgePaths, ensureOutDirs, readStatus } from './state';
import { SpecError, parseBadgeSpec, type BadgeSpec } from './spec';
import { makeBatchRunId, makeRunId, submitBadgeBatchJob, submitBadgeJob, type SpawnFn, type SubmitResult } from './submit';
import { recordBatchSubmitted } from './history';

/** 表单里的一条草稿：**原始字符串**，不做任何解析/校验。 */
export interface DraftFields {
  id: string;
  name: string;
  description: string;
  family: string;
  group: string;
  /** `when`（结构化）或 `handwritten`（手写）。 */
  mode: 'when' | 'handwritten';
  /** 结构化路径的 JSON 表达式原文（未解析）。 */
  when: string;
  /** 手写路径的单表达式原文。 */
  check: string;
  /** 手写路径的 evalHelpers JSON 原文（未解析）。 */
  evalHelpers: string;
}

export interface StagedDraft {
  /** 稳定身份（删除用）；与徽章 id 无关，允许同 id 草稿并存（统一跑时才校验唯一性）。 */
  draftId: string;
  addedAt: string;
  fields: DraftFields;
  /**
   * 这条草稿是从哪一批**恢复**回来的（`/badge/modify`「修改」或失败批次的「恢复草稿」）。
   *
   * 缺省 = 用户手动新增。UI 至少在 hover 里显示它，用户才能分清「这是我刚加的」
   * 还是「这是从 5 分钟前那个失败批次捞回来的」。
   */
  restoredFrom?: string;
}

export function stagingFile(adminRoot: string): string {
  return join(adminRoot, ADD_BADGE_OUT_DIR, 'staging.json');
}

/** 从表单组装草稿字段（**纯字符串搬运**，不解析、不校验）。 */
export function draftFieldsFromForm(fields: URLSearchParams): DraftFields {
  return {
    id: (fields.get('id') ?? '').trim(),
    name: (fields.get('name') ?? '').trim(),
    description: (fields.get('description') ?? '').trim(),
    family: (fields.get('family') ?? '').trim(),
    group: (fields.get('group') ?? '').trim(),
    mode: fields.get('mode') === 'handwritten' ? 'handwritten' : 'when',
    when: fields.get('when') ?? '',
    check: fields.get('check') ?? '',
    evalHelpers: fields.get('evalHelpers') ?? '',
  };
}

/** 读草稿列表（**绝不执行任何东西**；文件缺失/损坏一律当空列表）。 */
export function readStaging(adminRoot: string): StagedDraft[] {
  const path = stagingFile(adminRoot);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StagedDraft => {
      if (item === null || typeof item !== 'object') return false;
      const draft = item as Partial<StagedDraft>;
      return typeof draft.draftId === 'string' && typeof draft.addedAt === 'string'
        && draft.fields !== null && typeof draft.fields === 'object';
    });
  } catch {
    return [];
  }
}

/** 原子写整个草稿列表（临时文件 + rename；与 status.json 同一手法）。 */
export function writeStaging(adminRoot: string, drafts: readonly StagedDraft[]): void {
  ensureOutDirs(adminRoot);
  const path = stagingFile(adminRoot);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(drafts, null, 2), 'utf8');
  renameSync(tmp, path);
}

/** 生成草稿 id（时间有序 + 随机后缀，避免同一毫秒内重复）。 */
export function newDraftId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

/** 加一条草稿：**唯一动作就是读列表 + 追加 + 原子写**。 */
export function addDraft(
  adminRoot: string,
  fields: DraftFields,
  options: { now?: () => Date; draftId?: string } = {},
): StagedDraft {
  const now = options.now?.() ?? new Date();
  const draft: StagedDraft = {
    draftId: options.draftId ?? newDraftId(now),
    addedAt: now.toISOString(),
    fields,
  };
  writeStaging(adminRoot, [...readStaging(adminRoot), draft]);
  return draft;
}

/**
 * **原地替换**一条草稿的字段（「编辑」提交时用）。
 *
 * 与「删掉再加一条」的区别：`draftId` 与 `addedAt` 都保留——同一条草稿换了内容，
 * 而不是多出来一条。列表长度因此不变（这是「编辑」而不是「追加」的定义）。
 *
 * 找不到 `draftId` 时**一个字节都不写**，返回 `null`（调用方决定回落成追加还是报错）。
 */
export function replaceDraft(adminRoot: string, draftId: string, fields: DraftFields): StagedDraft | null {
  const drafts = readStaging(adminRoot);
  const index = drafts.findIndex(draft => draft.draftId === draftId);
  if (index < 0) return null;
  const previous = drafts[index]!;
  const updated: StagedDraft = { ...previous, fields };
  const next = [...drafts];
  next[index] = updated;
  writeStaging(adminRoot, next);
  return updated;
}

/** 删一条草稿；返回是否真的删掉了。 */
export function removeDraft(adminRoot: string, draftId: string): boolean {
  const drafts = readStaging(adminRoot);
  const kept = drafts.filter(draft => draft.draftId !== draftId);
  if (kept.length === drafts.length) return false;
  writeStaging(adminRoot, kept);
  return true;
}

/** 清空暂存区（统一跑成功之后调用；失败/被拒时**保留**，草稿不丢）。 */
export function clearStaging(adminRoot: string): void {
  writeStaging(adminRoot, []);
}

// ───────────────────────── 恢复：把批次的 spec 放回暂存区 ─────────────────────────

/**
 * runId 必须是安全的文件名片段。
 *
 * runId 来自表单，会被拼进 `jobs/<runId>.json`——不做校验就等于开了一条
 * `../../` 读任意 `.json` 的路径。生成器（`makeRunId` / `makeBatchRunId`）只会
 * 产出这个字符集，所以拒绝其它输入不影响任何合法批次。
 */
export function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9TZ._-]+$/.test(runId);
}

/** 某个批次的作业文件路径（**只算路径，不读不建目录**）。 */
export function batchJobFile(adminRoot: string, runId: string): string {
  return join(addBadgePaths(adminRoot).jobsDir, `${runId}.json`);
}

interface ChildJobSpecs {
  spec?: unknown;
  specs?: unknown[];
}

/**
 * 读回作业文件里**冻结的原始 spec**（`out/addbadge/jobs/<runId>.json`）。
 *
 * 这是恢复的唯一数据源：批次历史（`batches.json`）只存 id/name/family 这类元数据，
 * spec 内容从来不在那里。作业文件在提交时写入、**从不删除**，因此待确认批次与
 * 失败批次的 spec 都还在。
 *
 * 返回 `null` 表示「读不到」（文件不存在/损坏/runId 非法），与「读到了但是空数组」区分。
 */
function readJobSpecs(adminRoot: string, runId: string): unknown[] | null {
  if (!isSafeRunId(runId)) return null;
  const path = batchJobFile(adminRoot, runId);
  if (!existsSync(path)) return null;
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as ChildJobSpecs;
    if (Array.isArray(payload.specs)) return payload.specs;
    if (payload.spec !== undefined) return [payload.spec];
    return [];
  } catch {
    return null;
  }
}

/** 该批次是否还有可恢复的冻结 spec（树形列表据此决定要不要画「恢复草稿」入口）。 */
export function hasRestorableSpecs(adminRoot: string, runId: string): boolean {
  const specs = readJobSpecs(adminRoot, runId);
  return specs !== null && specs.length > 0;
}

/**
 * 把作业文件里冻结的原始 spec 反翻译回**表单草稿字段**。
 *
 * 与 {@link draftToRawSpec} 互为逆：`when` 走 `JSON.stringify`，`handwritten` 的
 * `evalHelpers` 同理。反翻译出来的字符串再喂给 {@link draftToRawSpec} 会得到等价的
 * 原始 spec（`group: null` ↔ `group: ''` 是唯一的规范化差异，两份都合法）。
 */
export function draftFieldsFromRawSpec(raw: unknown): DraftFields {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SpecError('作业文件里的 spec 不是对象，无法恢复成草稿', 'spec');
  }
  const spec = raw as Record<string, unknown>;
  const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
  const base = {
    id: text(spec.id),
    name: text(spec.name),
    description: text(spec.description),
    family: text(spec.family),
    group: spec.group === undefined || spec.group === null ? '' : String(spec.group),
  };
  const handwritten = spec.handwritten;
  if (handwritten !== null && typeof handwritten === 'object') {
    const h = handwritten as Record<string, unknown>;
    return {
      ...base,
      mode: 'handwritten',
      when: '',
      check: text(h.check),
      evalHelpers: h.evalHelpers === undefined ? '' : JSON.stringify(h.evalHelpers),
    };
  }
  if (spec.when === undefined) {
    throw new SpecError('作业文件里的 spec 既没有 when 也没有 handwritten，无法恢复成草稿', 'spec');
  }
  return { ...base, mode: 'when', when: JSON.stringify(spec.when), check: '', evalHelpers: '' };
}

export interface RestoreResult {
  ok: boolean;
  runId: string;
  /** 本次真正放回暂存区的条数。 */
  restored: number;
  /** 因为 id 已经在暂存区里而**跳过**（不覆盖已有草稿）的条数。 */
  skipped: number;
  reason?: string;
}

export interface RestoreOptions {
  now?: () => Date;
}

/**
 * **恢复**：把某个批次的 spec 从作业文件放回暂存区，可以接着编辑。
 *
 * 三条性质（对应任务要求）：
 *   - **不覆盖已有草稿**：按 id 去重——暂存区里已有同 id 的（不管是用户刚加的，
 *     还是上次恢复留下的）一律跳过，只追加缺的那几条；
 *   - **幂等**：没有新增时**一个字节都不写**，连点两次不会变成两份、也不会重排草稿；
 *   - **可追溯**：每条恢复的草稿带 `restoredFrom = runId`，UI 在 hover 里显示。
 *
 * 作业文件不存在/损坏时返回 `ok: true, restored: 0`（「没有可恢复的东西」不是
 * 一次失败的编辑操作，页面照常回到编辑状态）；只有 runId 非法或 spec 无法反翻译
 * 才是 `ok: false`。
 */
export function restoreBatchDrafts(
  adminRoot: string,
  runId: string,
  options: RestoreOptions = {},
): RestoreResult {
  if (!isSafeRunId(runId)) {
    return { ok: false, runId, restored: 0, skipped: 0, reason: `批次号不合法：${JSON.stringify(runId)}` };
  }
  const rawSpecs = readJobSpecs(adminRoot, runId);
  if (rawSpecs === null) {
    return {
      ok: true,
      runId,
      restored: 0,
      skipped: 0,
      reason: `找不到批次 ${runId} 的作业文件（spec 已不可恢复）。`,
    };
  }
  if (rawSpecs.length === 0) {
    return { ok: true, runId, restored: 0, skipped: 0, reason: `批次 ${runId} 的作业文件里没有 spec。` };
  }

  const fieldsList: DraftFields[] = [];
  for (const [index, raw] of rawSpecs.entries()) {
    try {
      fieldsList.push(draftFieldsFromRawSpec(raw));
    } catch (err) {
      return {
        ok: false,
        runId,
        restored: 0,
        skipped: 0,
        reason: `批次 ${runId} 的第 ${index + 1} 条 spec 无法恢复为草稿：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const existing = readStaging(adminRoot);
  const takenIds = new Set(existing.map(draft => draft.fields.id).filter(id => id.length > 0));
  const now = options.now?.() ?? new Date();
  const added: StagedDraft[] = [];
  let skipped = 0;
  for (const fields of fieldsList) {
    if (fields.id.length > 0 && takenIds.has(fields.id)) {
      skipped += 1;
      continue;
    }
    if (fields.id.length > 0) takenIds.add(fields.id);
    added.push({
      draftId: newDraftId(now),
      addedAt: now.toISOString(),
      fields,
      restoredFrom: runId,
    });
  }

  // 幂等：没有新增就不写文件（连点两次不会变成两份，也不会重排已有草稿）。
  if (added.length > 0) writeStaging(adminRoot, [...existing, ...added]);
  return { ok: true, runId, restored: added.length, skipped };
}

/**
 * 把一条草稿翻译成 {@link parseBadgeSpec} 能吃的原始 spec 对象。
 *
 * 这是**唯一**会碰 JSON.parse 的地方，且只在统一跑时调用——保存时不碰。
 */
export function draftToRawSpec(draft: StagedDraft): unknown {
  const f = draft.fields;
  const base = {
    id: f.id,
    name: f.name,
    description: f.description,
    family: f.family,
    group: f.group.length > 0 ? f.group : null,
  };
  if (f.mode === 'handwritten') {
    const check = f.check.trim();
    let evalHelpers: unknown;
    if (f.evalHelpers.trim()) {
      try {
        evalHelpers = JSON.parse(f.evalHelpers);
      } catch (err) {
        throw new SpecError(`evalHelpers 不是合法 JSON：${err instanceof Error ? err.message : err}`, 'handwritten.evalHelpers');
      }
    }
    return { ...base, handwritten: { check, ...(evalHelpers ? { evalHelpers } : {}) } };
  }
  let when: unknown;
  try {
    when = JSON.parse(f.when);
  } catch (err) {
    throw new SpecError(`when 不是合法 JSON：${err instanceof Error ? err.message : err}`, 'when');
  }
  return { ...base, when };
}

export interface RunStagedOptions {
  adminRoot: string;
  root: string;
  /** 测试注入：不真的拉起 detached 子进程。 */
  spawn?: SpawnFn;
  now?: () => Date;
}

/**
 * 统一跑：把暂存区的全部草稿交给**现有的批量管道**（`submitBadgeBatchJob`）。
 *
 * 不新写一套管道：这里只做「草稿 → 原始 spec + 解析」和「成功后清空暂存区」，
 * 锁、detached 子进程、全有或全无、只跑一次枚举都由既有批量路径保证。
 *
 * 解析失败（某条草稿的 when/evalHelpers 不是 JSON，或缺字段）→ 明确拒绝并点出
 * 是哪条草稿，**暂存区原样保留**，反馈推迟到这里（这正是「先不跑」的代价）。
 */
export function runStagedBatch(options: RunStagedOptions): SubmitResult {
  const { adminRoot, root } = options;
  const drafts = readStaging(adminRoot);
  if (drafts.length === 0) {
    return { ok: false, exitCode: 2, reason: '暂存区为空：先「添加一条」再统一跑。' };
  }

  const rawSpecs: unknown[] = [];
  const specs: BadgeSpec[] = [];
  for (const draft of drafts) {
    const label = draft.fields.id || draft.draftId;
    let raw: unknown;
    let spec: BadgeSpec;
    try {
      raw = draftToRawSpec(draft);
      spec = parseBadgeSpec(raw, `草稿 ${label}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, exitCode: 2, reason: `草稿「${label}」无法运行：${message}` };
    }
    rawSpecs.push(raw);
    specs.push(spec);
  }

  const now = options.now?.() ?? new Date();
  const paths = ensureOutDirs(adminRoot);
  const runId = makeBatchRunId(specs, now);
  const logPath = join(paths.logsDir, `${runId}.log`);

  const result = submitBadgeBatchJob({
    rawSpecs,
    specs,
    root,
    adminRoot,
    runId,
    logPath,
    ...(options.spawn ? { spawn: options.spawn } : {}),
  });
  if (!result.ok) return result;

  // 作业已经交给既有批量管道 → 这一批成为「历史批次」，暂存区清空。
  recordBatchSubmitted(adminRoot, {
    runId,
    createdAt: now.toISOString(),
    startedAt: now.toISOString(),
    state: 'running',
    specs: specs.map(item => ({ id: item.id, name: item.name, family: item.family })),
  });
  clearStaging(adminRoot);
  return result;
}

export interface ContinueStagedOptions {
  adminRoot: string;
  root: string;
  /** 测试注入：不真的拉起 detached 子进程。 */
  spawn?: SpawnFn;
  now?: () => Date;
  /**
   * 浏览器带回来的**已确认内容哈希**（就是待确认状态里的 `specHash`）。
   * 缺省时用待确认状态里的值；显式传一个旧哈希可以模拟「确认后改了 spec」。
   */
  acceptedSpecHash?: string;
}

/**
 * **「继续」**：把停在【待确认】的那一批**重新提交**，带上已接受的内容哈希。
 *
 * 为什么是「新起一次运行」而不是「让子进程继续」：管道跑在 detached 子进程里，
 * 停在待确认等输入 = 留一个没人管的进程。所以阶段 1 跑完就写状态、正常退出；
 * 「继续」在这里读回**同一个作业文件**（spec 原样），以 `acceptedSpecHash` 再提交一次。
 *
 * 代价是重跑一次干跑（只几秒）。确认绑在内容哈希上：作业文件里的 spec 变了，
 * 重算的哈希就对不上，确认自动作废、重新给警告。
 */
export function continuePendingBatch(options: ContinueStagedOptions): SubmitResult {
  const { adminRoot, root } = options;
  const view = readStatus(adminRoot);
  const status = view.status;
  if (!status) {
    return { ok: false, exitCode: 2, reason: '没有可继续的作业：状态文件不存在。' };
  }
  if (status.state !== 'awaiting_confirmation') {
    return {
      ok: false,
      exitCode: 2,
      reason: `当前状态是 "${status.state}"，没有等待确认的批次；只有【待确认】的批次可以「继续」。`,
    };
  }
  const acceptedSpecHash = options.acceptedSpecHash ?? status.specHash;
  if (!acceptedSpecHash) {
    return { ok: false, exitCode: 2, reason: '待确认状态缺少 spec 内容哈希，拒绝继续（请重新统一跑）。' };
  }

  const paths = ensureOutDirs(adminRoot);
  const jobPath = join(paths.jobsDir, `${status.runId}.json`);
  if (!existsSync(jobPath)) {
    return { ok: false, exitCode: 2, reason: `找不到待确认批次的作业文件：${jobPath}（请重新统一跑）。` };
  }
  let payload: { spec?: unknown; specs?: unknown[] };
  try {
    payload = JSON.parse(readFileSync(jobPath, 'utf8')) as { spec?: unknown; specs?: unknown[] };
  } catch (err) {
    return { ok: false, exitCode: 2, reason: `待确认批次的作业文件损坏：${err instanceof Error ? err.message : String(err)}` };
  }

  const rawSpecs = Array.isArray(payload.specs) ? payload.specs : payload.spec !== undefined ? [payload.spec] : [];
  if (rawSpecs.length === 0) {
    return { ok: false, exitCode: 2, reason: '待确认批次的作业文件里没有 spec，无法继续。' };
  }
  const specs: BadgeSpec[] = [];
  for (const [index, raw] of rawSpecs.entries()) {
    try {
      specs.push(parseBadgeSpec(raw, `待确认作业 specs[${index}]`));
    } catch (err) {
      return { ok: false, exitCode: 2, reason: `待确认作业里的 spec 无法解析：${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const now = options.now?.() ?? new Date();
  const isBatch = specs.length > 1;
  const runId = isBatch ? makeBatchRunId(specs, now) : makeRunId(specs[0]!, now);
  const logPath = join(paths.logsDir, `${runId}.log`);
  const spawn = options.spawn ? { spawn: options.spawn } : {};
  const result = isBatch
    ? submitBadgeBatchJob({ rawSpecs, specs, root, adminRoot, runId, logPath, acceptedSpecHash, ...spawn })
    : submitBadgeJob({ rawSpec: rawSpecs[0], spec: specs[0]!, root, adminRoot, runId, logPath, acceptedSpecHash, ...spawn });
  if (!result.ok) return result;

  recordBatchSubmitted(adminRoot, {
    runId,
    createdAt: now.toISOString(),
    startedAt: now.toISOString(),
    state: 'running',
    specs: specs.map(item => ({ id: item.id, name: item.name, family: item.family })),
  });
  return result;
}
