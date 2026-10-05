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
import { ADD_BADGE_OUT_DIR, ensureOutDirs } from './state';
import { SpecError, parseBadgeSpec, type BadgeSpec } from './spec';
import { makeBatchRunId, submitBadgeBatchJob, type SpawnFn, type SubmitResult } from './submit';
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
