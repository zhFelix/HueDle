/**
 * 加徽章流水线的阶段编排、失败分类与退出码（docs/ADMIN.md §3.3 / §3.4）。
 *
 * 阶段顺序**不可变**，尤其是「干跑必须在写盘之前」：
 *
 *   0 干跑（零写盘）→ 1 快照 → 2 写盘 + 三自检 → 3 `tsc` → 4 `enumerate`（≥20 分钟）
 *   → 5 复跑比 md5（幂等）→ 6 `docs` → 7 `supersession` → 8 `test` → 收尾
 *
 * 失败分类（用户要求 + ADMIN.md §3.4）：
 *   - 可自动回滚的失败 → 回滚 + 明确报告，退出码 **2**；
 *   - **全局平衡类失败**（分位档位不自洽 / 底部原子消失）→ **保留现场、不自动回滚**，
 *     退出码 **3**。理由：自动回滚会**掩盖真实信号**，那是有信息量的失败；
 *   - 回滚本身失败 → 退出码 **4**，绝不静默。
 *
 * **批量模式**（`runBatchPipeline`）：一次提交 N 条 spec，是**一个事务**——
 * 要么全部落地并跑完流水线，要么整批回滚（不允许「3 条成功、2 条失败」留在仓库里）。
 * 性能目标是「**枚举只跑一次**」：`enumerate` 与后续 `docs` / `supersession` / `test`
 * 对整批只执行一次，不随 N 线性增长。单条路径（`runPipeline`）走同一个核心，
 * 行为与批量引入前逐字节一致。
 *
 * 这个模块是**纯编排**：所有外部动作（跑命令、干跑、读既有徽章）都从 `deps` 注入，
 * 因此可以在临时仓库里用假命令完整单测失败分支。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { ColorInfo } from '@huedle/shared';
import { compileSpec } from './compile';
import {
  loadExistingChecks,
  runBatchDryRun,
  runDryRun,
  type BatchDryRunOptions,
  type BatchDryRunResult,
  type DryRunOptions,
  type DryRunResult,
  type ExistingCheck,
} from './dryrun';
import {
  affectedPathsFor,
  findArrayAnchor,
  lastElementIndent,
  readFamilyFile,
  assertIdUnique,
  assertNameUniqueInFamily,
} from './families';
import { assertSelfCheck, planInsertion } from './insert';
import { captureSnapshot, dirtyPaths, dropSnapshot, restoreSnapshot, verifyRestored, type Snapshot } from './rollback';
import { SpecError, isHandwritten, type BadgeSpec } from './spec';
import {
  PHASES,
  addBadgePaths,
  makeStatus,
  type FailureAttribution,
  type Phase,
  type PipelineState,
  type PipelineStatus,
  type StatusSpec,
} from './state';

// ───────────────────────────── 退出码 ─────────────────────────────

export const EXIT_OK = 0;
/** 失败且**已自动回滚**（工作区回到开跑前）。 */
export const EXIT_ROLLED_BACK = 2;
/** 全局平衡类失败：**保留现场**，要求人工判断（绝不自动回滚）。 */
export const EXIT_GLOBAL_BALANCE = 3;
/** 回滚本身失败：工作区未完全还原，必须人工介入。 */
export const EXIT_ROLLBACK_FAILED = 4;
/** 已有管道在跑：拒绝提交（不排队、不并发）。 */
export const EXIT_LOCKED = 6;
/** 受影响路径有未提交改动：默认拒绝开跑（不覆盖别人的工作）。 */
export const EXIT_DIRTY_WORKTREE = 7;
/** 检出「有一个没跑完的管道」：先人工处理，再开跑。 */
export const EXIT_INTERRUPTED = 8;

// ───────────────────────────── 依赖注入 ─────────────────────────────

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PipelineCommands {
  typecheck: string;
  enumerate: string;
  docs: string;
  supersession: string;
  test: string;
}

export const DEFAULT_COMMANDS: PipelineCommands = {
  typecheck: 'pnpm -C packages/shared run typecheck',
  enumerate: 'pnpm -C packages/shared run enumerate',
  docs: 'pnpm -C packages/shared run docs',
  supersession: 'pnpm -C packages/shared run supersession',
  test: 'pnpm -C packages/shared test',
};

/** `enumerate` 的子进程超时：≥ 20 分钟（vitest 内部上限 15 分钟，比它短会在写盘中途被杀）。 */
export const ENUMERATE_TIMEOUT_MS = 20 * 60 * 1000;

export interface PipelineDeps {
  /** 仓库根。 */
  root: string;
  /** `tools/admin` 根。 */
  adminRoot: string;
  now: () => Date;
  exec: (command: string, options?: { timeoutMs?: number }) => ExecResult;
  /** 干跑（单条；测试注入小色域）。 */
  dryRun?: (options: DryRunOptions) => DryRunResult;
  /** 批量干跑（一次扫描 N 条 + 新 vs 新检查；测试可注入）。 */
  dryRunBatch?: (options: BatchDryRunOptions) => BatchDryRunResult;
  /** 既有徽章（测试注入假集合）。 */
  existingChecks?: () => ExistingCheck[];
  /** 干跑色域大小，默认 2²⁴；测试用小值。 */
  domainSize?: number;
  commands?: PipelineCommands;
  /** 状态每次变化都会回调（子进程用它写 `status.json`）。 */
  onStatus?: (status: PipelineStatus) => void;
}

export interface PipelineJob {
  runId: string;
  /** 已解析的 spec（结构化或手写）。 */
  spec: BadgeSpec;
  logPath: string;
}

/** 批量作业：一次提交 N 条 spec，整批是一个事务。 */
export interface BatchPipelineJob {
  runId: string;
  /** ≥1 条；长度 1 时行为与 {@link PipelineJob} 完全一致。 */
  specs: BadgeSpec[];
  logPath: string;
}

export interface PipelineOutcome {
  exitCode: number;
  state: PipelineState;
  failureClass?: string;
  conclusion: string;
  evidence: string[];
  snapshotPath?: string;
  hits?: number;
  /** 批量模式：每条新徽章的干跑 hits。 */
  hitsBySpec?: Array<{ id: string; hits: number }>;
  /** 失败归因（树形列表靠它决定「条目上要不要加 ✕」）。 */
  failureAttribution?: FailureAttribution;
}

/** 内部：一个已分类的阶段失败。 */
class PhaseFailure extends Error {
  constructor(
    readonly failureClass: string,
    message: string,
    readonly exitCode: number,
    /** 已写盘才需要回滚；干跑阶段失败时工作区是干净的。 */
    readonly needsRollback: boolean,
    /** 能指名到某条 spec 时带上，否则留空（树形列表不加条目 ✕）。 */
    readonly attribution?: FailureAttribution,
  ) {
    super(message);
    this.name = 'PhaseFailure';
  }
}

// ───────────────────────────── 失败分类里的可测片段 ─────────────────────────────

/**
 * `enumerate` 失败属于哪一类？
 *
 * 判定顺序（从最明确到最模糊）：
 *   1. 被超时/信号杀掉 → `enumerate-timeout`（可能半写，先记录 md5 再回滚）；
 *   2. 输出里出现 `hits === 0 的徽章`（断言自带的显式消息）→ `enumerate-empty`；
 *   3. **异常行**（vitest 源码框里带 `^` 指出的那一行）是 `bucketsSelfConsistent`
 *      或 `minAtomCount` → `enumerate-global-balance`（保留现场）；
 *   4. 其余 → `enumerate`。
 *
 * 第 3 步刻意只看**带 caret 的那一行**：vitest 的源码框会连上下文一起打印，
 * 直接全文搜 `minAtomCount` 会在 `hits===0` 失败时误判（那一行就在它上面）。
 */
export function classifyEnumerateFailure(output: string, timedOut: boolean): string {
  if (timedOut) return 'enumerate-timeout';
  if (output.includes('hits === 0 的徽章')) return 'enumerate-empty';
  const lines = output.split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    if (/^\s*\|\s*\^+\s*$/.test(lines[i]!)) {
      const failingLine = lines[i - 1] ?? '';
      if (failingLine.includes('bucketsSelfConsistent') || failingLine.includes('minAtomCount')) {
        return 'enumerate-global-balance';
      }
    }
  }
  return 'enumerate';
}

/** 从 `pnpm test` 的输出里挑出失败的文件名（用于「只有 docs.test.ts 失败 → 重跑 docs」）。 */
export function failingTestFiles(output: string): string[] {
  const found = new Set<string>();
  for (const line of output.split('\n')) {
    const nonTty = /^\s*❯\s+(\S+\.test\.ts)/.exec(line);
    if (nonTty) found.add(nonTty[1]!);
    const fail = /^\s*FAIL\s+(\S+\.test\.ts)/.exec(line);
    if (fail) found.add(fail[1]!);
  }
  return [...found];
}

/** 从 supersession 报告里判断「新徽章是否 100% 被取代」。 */
export function findDeadBadge(report: string, id: string): boolean {
  const start = report.indexOf('## 1. 结论');
  if (start < 0) return false;
  const end = report.indexOf('## 2.', start);
  const section = report.slice(start, end < 0 ? undefined : end);
  return section.includes(`\`${id}\``);
}

// ───────────────────────── 失败归因（哪一条 spec 的锅） ─────────────────────────
//
// 树形列表只在那条「自己引起失败」的条目上加 ✕，所以失败必须能**结构化地**
// 指名到一条 spec——不能只留在给人看的 conclusion 文本里。以下三个函数把
// 各阶段的失败输出翻译成 {@link FailureAttribution}：
//   - 唯一嫌疑 → `kind: 'spec'`（UI 在那个条目上加 ✕）；
//   - 整批共同引起 / 嫌疑不止一条 / 根本指不出来 → `kind: 'batch'`（UI 什么都不加）。

/** 批量干跑失败：只有**恰好一条**候选自带 violations 时才归因到它。 */
export function attributeBatchDryRun(
  specs: readonly BadgeSpec[],
  result: BatchDryRunResult,
): FailureAttribution {
  const failed = result.candidates.filter(candidate => candidate.violations.length > 0);
  if (failed.length === 1) {
    const only = failed[0]!;
    return { kind: 'spec', specId: only.id, reason: only.violations.join('；') };
  }
  // 0 条自带 violations：只剩「新 vs 新」的蕴含（点名两条，无法单选）；
  // >1 条：多条各自的锅。两者都只能当整批失败。
  return {
    kind: 'batch',
    reason: result.violations.join('；') || `批量干跑拒绝了 ${specs.length} 条候选`,
  };
}

/** 单条干跑失败：本就只可能是它自己。 */
export function attributeSingleDryRun(spec: BadgeSpec, violations: readonly string[]): FailureAttribution {
  return { kind: 'spec', specId: spec.id, reason: violations.join('；') };
}

/**
 * `tsc` 失败：从输出里认出被点名的家族文件（`badges/<family>.ts`），
 * 只落在**恰好一条** spec 上时才归因。
 */
export function attributeTypecheck(specs: readonly BadgeSpec[], output: string): FailureAttribution {
  const families = new Set<string>();
  for (const match of output.matchAll(/badges\/([a-z]+)\.ts/g)) families.add(match[1]!);
  const hit = specs.filter(spec => families.has(spec.family));
  const reason = `tsc --noEmit 失败：${tail(output, 3)}`;
  if (hit.length === 1) return { kind: 'spec', specId: hit[0]!.id, reason };
  return { kind: 'batch', reason };
}

/**
 * `enumerate` 失败：分位平衡类是**整批共同引起**的（定义如此，绝不归因到单条）；
 * 其余情况看输出里出现了哪个新 id——唯一一个才归因。
 */
export function attributeEnumerate(
  specs: readonly BadgeSpec[],
  output: string,
  failureClass: string,
): FailureAttribution {
  const reason = `${failureClass}：${tail(output, 3)}`;
  if (failureClass === 'enumerate-global-balance') {
    return { kind: 'batch', reason: `分位平衡类失败（整批共同引起，无法归因到单条）：${tail(output, 3)}` };
  }
  const mentioned = specs.filter(spec => output.includes(spec.id));
  if (mentioned.length === 1) return { kind: 'spec', specId: mentioned[0]!.id, reason };
  return { kind: 'batch', reason };
}

export function md5OfFile(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

// ───────────────────────────── 批量辅助 ─────────────────────────────

/** 一个 spec → 状态文件里的元数据。 */
function specMeta(spec: BadgeSpec): StatusSpec {
  return { id: spec.id, name: spec.name, family: spec.family, group: spec.group ?? null };
}

/** 整批在锁/状态文件里的摘要（单条时就是它自己）。 */
export function summarizeSpecs(specs: readonly BadgeSpec[]): StatusSpec {
  if (specs.length === 1) return specMeta(specs[0]!);
  const families = [...new Set(specs.map(spec => spec.family))];
  return { id: `batch-${specs.length}`, name: `${specs.length} 条徽章`, family: families.join('+'), group: null };
}

/** 批量内部的 id / name 唯一性（既有文件之外，新徽章彼此也不能撞）。 */
export function assertBatchInternalUnique(specs: readonly BadgeSpec[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const spec of specs) {
    if (ids.has(spec.id)) throw new SpecError(`批量提交里 id "${spec.id}" 重复出现`, 'id');
    ids.add(spec.id);
    const key = `${spec.family}\u0000${spec.name}`;
    if (names.has(key)) {
      throw new SpecError(`批量提交里 family "${spec.family}" 的 name "${spec.name}" 重复出现`, 'name');
    }
    names.add(key);
  }
}

// ───────────────────────────── 主流程 ─────────────────────────────

/** 单条路径（既有行为，调用方与测试都只用它）。 */
export function runPipeline(job: PipelineJob, deps: PipelineDeps): PipelineOutcome {
  return runPipelineCore(job.runId, [job.spec], job.logPath, deps);
}

/**
 * 批量路径：一次提交 N 条 spec，**整批一个事务**（全有或全无）。
 *
 * 与单条共用同一个核心，因此阶段顺序、失败分类、退出码、锁、快照与回滚语义完全一致；
 * 差别只在：干跑一次扫描整批并做新 vs 新检查、按 spec 逐条写盘、`supersession`
 * 检查**任意一条**新徽章被 100% 取代 → 整批回滚。
 */
export function runBatchPipeline(job: BatchPipelineJob, deps: PipelineDeps): PipelineOutcome {
  if (job.specs.length === 0) {
    throw new SpecError('批量加徽章至少要有一条 spec', 'specs');
  }
  return runPipelineCore(job.runId, job.specs, job.logPath, deps);
}

function runPipelineCore(
  runId: string,
  specs: BadgeSpec[],
  logPath: string,
  deps: PipelineDeps,
): PipelineOutcome {
  const commands = deps.commands ?? DEFAULT_COMMANDS;
  const isBatch = specs.length > 1;
  const spec = specs[0]!;
  const families = [...new Set(specs.map(item => item.family))];
  const specMetas = specs.map(specMeta);
  const status = makeStatus({ runId, spec: summarizeSpecs(specs), logPath, pid: process.pid });
  if (isBatch) {
    status.specCount = specs.length;
    status.specs = specMetas;
  }
  const evidence: string[] = [];
  const publish = (): void => {
    status.updatedAt = deps.now().toISOString();
    status.evidence = [...evidence];
    deps.onStatus?.({ ...status });
  };
  const setPhase = (phase: Phase): void => {
    status.phase = phase;
    status.phaseIndex = PHASES.indexOf(phase);
    console.log(`[addbadge] 阶段 ${PHASES.indexOf(phase) + 1}/${PHASES.length}：${phase}`);
    publish();
  };
  publish();

  const paths = affectedPathsFor(families);
  const snapshotsDir = addBadgePaths(deps.adminRoot).snapshotsDir;
  let snapshot: Snapshot | null = null;
  let wrote = false;

  const finish = (
    state: PipelineState,
    exitCode: number,
    conclusion: string,
    failureClass?: string,
    extra?: { snapshotPath?: string; attribution?: FailureAttribution },
  ): PipelineOutcome => {
    status.state = state;
    status.phase = 'done';
    status.exitCode = exitCode;
    status.failureClass = failureClass;
    status.conclusion = conclusion;
    status.finishedAt = deps.now().toISOString();
    if (extra?.snapshotPath) status.snapshotPath = extra.snapshotPath;
    if (extra?.attribution) status.failureAttribution = extra.attribution;
    publish();
    return {
      exitCode,
      state,
      ...(failureClass ? { failureClass } : {}),
      conclusion,
      evidence,
      ...(extra?.snapshotPath ? { snapshotPath: extra.snapshotPath } : {}),
      ...(status.failureAttribution ? { failureAttribution: status.failureAttribution } : {}),
      ...(status.hits !== undefined ? { hits: status.hits } : {}),
      ...(status.hitsBySpec ? { hitsBySpec: status.hitsBySpec } : {}),
    };
  };

  /** 共用回滚：还原 → 证明还原 → 证明回到绿（§3.5）。 */
  const rollback = (failure: PhaseFailure): PipelineOutcome => {
    if (!snapshot) {
      return finish(
        'refused',
        failure.exitCode,
        `${failure.message}（写盘之前被拦下，工作区零改动。分类：${failure.failureClass}）`,
        failure.failureClass,
        failure.attribution ? { attribution: failure.attribution } : undefined,
      );
    }
    setPhase('finish');
    console.log(`[addbadge] 开始回滚：${failure.message}`);
    const { restored, failed } = restoreSnapshot(deps.root, snapshot);
    const mismatched = verifyRestored(deps.root, snapshot);
    if (failed.length > 0 || mismatched.length > 0) {
      const detail = [
        failed.map(item => `${item.rel}: ${item.error}`).join('; '),
        mismatched.length ? `未还原：${mismatched.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('；');
      return finish(
        'rollback_failed',
        EXIT_ROLLBACK_FAILED,
        `回滚未完全成功：${detail}。工作区未完全还原，请人工介入。快照：${snapshot.dir}`,
        'rollback-failed',
        { snapshotPath: snapshot.dir, ...(failure.attribution ? { attribution: failure.attribution } : {}) },
      );
    }
    const green = deps.exec(commands.test, { timeoutMs: 10 * 60 * 1000 });
    if (green.code !== 0) {
      return finish(
        'rollback_failed',
        EXIT_ROLLBACK_FAILED,
        `文件已还原（${restored.length} 个），但 pnpm -C packages/shared test 未回到全绿——`
        + `工作区未证明恢复，请人工介入。快照：${snapshot.dir}`,
        'rollback-failed',
        { snapshotPath: snapshot.dir, ...(failure.attribution ? { attribution: failure.attribution } : {}) },
      );
    }
    evidence.push(`回滚：还原 ${restored.length} 个文件，md5 与快照一致，packages/shared test 全绿。`);
    return finish(
      'rolled_back',
      failure.exitCode,
      `${failure.message} → 已自动回滚并验证回到全绿（分类：${failure.failureClass}）。`,
      failure.failureClass,
      { snapshotPath: snapshot.dir, ...(failure.attribution ? { attribution: failure.attribution } : {}) },
    );
  };

  try {
    // ── 阶段 0：准备 + 前置拒绝 ────────────────────────────────────
    setPhase('prepare');
    for (const item of specs) {
      assertIdUnique(deps.root, item.id);
      assertNameUniqueInFamily(deps.root, item.family, item.name);
    }
    // 受影响路径（跨家族取并集）有未提交改动 → 拒绝开跑，不覆盖别人的工作。
    const dirty = dirtyPaths(deps.root, paths);
    if (dirty.length > 0) {
      throw new PhaseFailure(
        'precondition-dirty',
        `受影响路径存在未提交改动，拒绝开跑（不覆盖别人的工作）：${dirty.join(', ')}。`
        + '请先 commit 或 stash；确实要用快照模式请显式加 --snapshot。',
        EXIT_DIRTY_WORKTREE,
        false,
      );
    }
    assertBatchInternalUnique(specs);
    const compiled = specs.map(item => compileSpec(item, deps.root));
    for (const [index, item] of specs.entries()) {
      const source = compiled[index]!.source.replace(/\n/g, ' \\n ');
      evidence.push(isBatch ? `check 源码（${item.id}）：${source}` : `check 源码：${source}`);
      const compiledItem = compiled[index]!;
      if (isHandwritten(item) && compiledItem.evalHelperNames.length > 0) {
        const names = compiledItem.evalHelperNames.join(', ');
        evidence.push(
          isBatch
            ? `注意（${item.id}）：干跑使用作者提供的 evalHelpers（${names}）求值；`
              + '它们不写进仓库，本工具**无法证明**其与文件里 private helper 的实现逐字等价。'
            : `注意：干跑使用作者提供的 evalHelpers（${names}）求值；`
              + '它们不写进仓库，本工具**无法证明**其与文件里 private helper 的实现逐字等价。',
        );
      }
    }
    publish();

    // ── 阶段 0（续）：全色域干跑，零写盘 ───────────────────────────
    setPhase('dryrun');
    const existing = (deps.existingChecks ?? loadExistingChecks)();
    const started = Date.now();
    if (isBatch) {
      const dryRunBatch = deps.dryRunBatch ?? runBatchDryRun;
      const result = dryRunBatch({
        candidates: specs.map((item, index) => ({
          id: item.id,
          group: item.group ?? null,
          check: compiled[index]!.predicate as (color: ColorInfo) => unknown,
        })),
        existing,
        ...(deps.domainSize !== undefined ? { total: deps.domainSize } : {}),
      });
      const sum = result.candidates.reduce((total, item) => total + item.hits, 0);
      status.hits = sum;
      status.hitsBySpec = result.candidates.map(item => ({ id: item.id, hits: item.hits }));
      console.log(
        `[addbadge] 批量干跑（一次扫描 ${result.total} 色）：${specs.length} 条，hits 合计=${sum}，`
        + `耗时 ${((Date.now() - started) / 1000).toFixed(1)}s，新 vs 新蕴含 ${result.pairwise.length} 处`,
      );
      evidence.push(
        `批量干跑：一次扫描 ${result.total} 色，${result.candidates.length} 条候选，hits 合计=${sum}；`
        + `新 vs 新必然蕴含 ${result.pairwise.length} 处（同组豁免 ${result.pairwise.filter(item => item.allowed).length} 处），`
        + `与既有徽章的蕴含 ${result.candidates.reduce((total, item) => total + item.implications.length, 0)} 处。`,
      );
      for (const item of result.candidates) {
        evidence.push(
          `  干跑 ${item.id}：hits=${item.hits}，Jaccard 最大=`
          + `${item.maxJaccard ? `${item.maxJaccard.value.toFixed(4)}（${item.maxJaccard.id}）` : '无'}`,
        );
      }
      if (result.violations.length > 0) {
        const detail = result.violations.join('\n  - ');
        const samples = result.candidates
          .map(item => `${item.id}：命中 ${item.samples.hits.join(', ') || '（无）'} / 未命中 ${item.samples.misses.join(', ') || '（无）'}`)
          .join('\n    ');
        throw new PhaseFailure(
          'dryrun',
          `批量干跑拒绝写入（工作区零改动，整批回滚）：\n  - ${detail}\n  命中样例：\n    ${samples}`,
          EXIT_ROLLED_BACK,
          false,
          attributeBatchDryRun(specs, result),
        );
      }
    } else {
      const dryRun = deps.dryRun ?? runDryRun;
      const result = dryRun({
        check: compiled[0]!.predicate as (color: ColorInfo) => unknown,
        existing,
        group: spec.group ?? null,
        ...(deps.domainSize !== undefined ? { total: deps.domainSize } : {}),
      });
      status.hits = result.hits;
      console.log(
        `[addbadge] 干跑：hits=${result.hits}/${result.total}（${((100 * result.hits) / result.total).toFixed(6)}%），`
        + `耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      evidence.push(
        `干跑：hits=${result.hits}/${result.total}，Jaccard 最大=${result.maxJaccard ? `${result.maxJaccard.value.toFixed(4)}（${result.maxJaccard.id}）` : '无'}，`
        + `必含关系 ${result.implications.length} 处。`,
      );
      if (result.violations.length > 0) {
        const detail = result.violations.join('\n  - ');
        evidence.push(`命中样例：${result.samples.hits.join(', ') || '（无）'}；未命中样例：${result.samples.misses.join(', ') || '（无）'}`);
        throw new PhaseFailure(
          'dryrun',
          `干跑拒绝写入（工作区零改动）：\n  - ${detail}\n  命中样例：${result.samples.hits.join(', ') || '（无）'}；`
          + `未命中样例：${result.samples.misses.join(', ') || '（无）'}`,
          EXIT_ROLLED_BACK,
          false,
          attributeSingleDryRun(spec, result.violations),
        );
      }
    }

    // ── 阶段 1：快照 + 写入 ────────────────────────────────────────
    setPhase('snapshot');
    snapshot = captureSnapshot(deps.root, snapshotsDir, paths, runId);
    status.snapshotPath = snapshot.dir;
    evidence.push(`快照：${snapshot.dir}（${snapshot.files.length} 个文件，HEAD=${snapshot.head || '(非 git)'}）`);
    publish();

    setPhase('write');
    for (const [index, item] of specs.entries()) {
      const target = readFamilyFile(deps.root, item.family);
      const anchor = findArrayAnchor(target.content);
      const indent = lastElementIndent(target.content, anchor);
      const plan = planInsertion({
        original: target.content,
        anchor,
        indent,
        spec: item,
        checkSource: compiled[index]!.source,
      });
      writeFileSync(target.path, plan.content, 'utf8');
      wrote = true;
      // 写盘后的三自检：对**磁盘上的字节**再验一遍。
      assertSelfCheck(target.content, readFileSync(target.path, 'utf8'), plan.block, plan.insertAt, item.id);
      evidence.push(
        `写盘：${item.family}.ts（${item.id}，缩进模板 ${JSON.stringify(indent)}，插入点 ${plan.insertAt}）`,
      );
      publish();
    }

    // ── 阶段：tsc --noEmit ────────────────────────────────────────
    setPhase('typecheck');
    const typecheck = deps.exec(commands.typecheck, { timeoutMs: 5 * 60 * 1000 });
    if (typecheck.code !== 0) {
      throw new PhaseFailure(
        'typecheck',
        `写盘后 tsc --noEmit 失败：\n${tail(typecheck.stdout + typecheck.stderr, 40)}`,
        EXIT_ROLLED_BACK,
        true,
        attributeTypecheck(specs, typecheck.stdout + typecheck.stderr),
      );
    }

    // ── 阶段：enumerate（≥20 分钟超时，**整批只跑一次**）──────────
    setPhase('enumerate');
    const enumerate = deps.exec(commands.enumerate, { timeoutMs: ENUMERATE_TIMEOUT_MS });
    if (enumerate.code !== 0) {
      const output = enumerate.stdout + enumerate.stderr;
      const failureClass = classifyEnumerateFailure(output, enumerate.timedOut);
      if (failureClass === 'enumerate-global-balance') {
        // 全局平衡类失败：**保留现场**，退出码 3。自动回滚会掩盖真实信号。
        evidence.push(`enumerate 保留现场（分类 ${failureClass}）。`);
        return finish(
          'needs_manual',
          EXIT_GLOBAL_BALANCE,
          'enumerate 在**全局平衡**类断言上失败（分位档位不自洽 / 底部原子消失）。'
          + '按设计**不自动回滚**：现场已保留供你复核，请先判断是不是要重新校准分位表，而不是当没发生。\n'
          + tail(output, 30),
          failureClass,
          {
            ...(snapshot ? { snapshotPath: snapshot.dir } : {}),
            attribution: attributeEnumerate(specs, output, failureClass),
          },
        );
      }
      throw new PhaseFailure(
        failureClass,
        `enumerate 失败（分类 ${failureClass}）：\n${tail(output, 30)}`,
        EXIT_ROLLED_BACK,
        true,
        attributeEnumerate(specs, output, failureClass),
      );
    }
    evidence.push('enumerate 成功。');
    publish();

    // ── 阶段：幂等（md5 复跑一致）─────────────────────────────────
    setPhase('idempotency');
    const pricingPath = `${deps.root}/packages/shared/src/pricing.gen.ts`;
    const firstMd5 = md5OfFile(pricingPath);
    const second = deps.exec(commands.enumerate, { timeoutMs: ENUMERATE_TIMEOUT_MS });
    if (second.code !== 0) {
      throw new PhaseFailure(
        'idempotency-rerun',
        `幂等复跑 enumerate 失败：\n${tail(second.stdout + second.stderr, 20)}`,
        EXIT_ROLLED_BACK,
        true,
      );
    }
    const secondMd5 = md5OfFile(pricingPath);
    if (firstMd5 !== secondMd5) {
      throw new PhaseFailure(
        'idempotency',
        `幂等性检查失败：两次 enumerate 的 pricing.gen.ts md5 不同（${firstMd5} vs ${secondMd5}）——`
        + '说明输出里混进了时间/随机等非确定性来源。',
        EXIT_ROLLED_BACK,
        true,
      );
    }
    evidence.push(`幂等：两次 enumerate 的 pricing.gen.ts md5 相同（${firstMd5}）。`);
    publish();

    // ── 阶段：docs ────────────────────────────────────────────────
    setPhase('docs');
    let docs = deps.exec(commands.docs, { timeoutMs: 5 * 60 * 1000 });
    if (docs.code !== 0) {
      console.log('[addbadge] docs 第一次失败，按 §3.3 S3.3 重跑一次');
      docs = deps.exec(commands.docs, { timeoutMs: 5 * 60 * 1000 });
    }
    if (docs.code !== 0) {
      throw new PhaseFailure(
        'docs',
        `docs 生成失败（已重试一次）：\n${tail(docs.stdout + docs.stderr, 20)}`,
        EXIT_ROLLED_BACK,
        true,
      );
    }
    evidence.push('docs/BADGES.md 已重生成。');
    publish();

    // ── 阶段：supersession（整批一次；任意一条被取代 → 整批回滚）──
    setPhase('supersession');
    const supersession = deps.exec(commands.supersession, { timeoutMs: ENUMERATE_TIMEOUT_MS });
    if (supersession.code !== 0) {
      throw new PhaseFailure(
        'supersession',
        `supersession 失败：\n${tail(supersession.stdout + supersession.stderr, 20)}`,
        EXIT_ROLLED_BACK,
        true,
      );
    }
    const auditPath = `${deps.root}/docs/research/SUPERSESSION-AUDIT.md`;
    const audit = readFileSync(auditPath, 'utf8');
    for (const item of specs) {
      if (findDeadBadge(audit, item.id)) {
        throw new PhaseFailure(
          'supersession-dead',
          `新徽章 "${item.id}" 被 100% 取代（永远拿不到分）——必须改判定条件或调整 group。`
          + (isBatch ? `批量是**一个事务**：整批 ${specs.length} 条一起回滚。` : ''),
          EXIT_ROLLED_BACK,
          true,
          { kind: 'spec', specId: item.id, reason: `新徽章 "${item.id}" 被 100% 取代（永远拿不到分）` },
        );
      }
    }
    evidence.push(
      isBatch
        ? `supersession：${specs.length} 条新徽章均未被 100% 取代。`
        : 'supersession：新徽章未被 100% 取代。',
    );
    publish();

    // ── 阶段：test（docs 失败可归因时重跑一次）────────────────────
    setPhase('test');
    let test = deps.exec(commands.test, { timeoutMs: 15 * 60 * 1000 });
    if (test.code !== 0) {
      const output = test.stdout + test.stderr;
      const failing = failingTestFiles(output);
      if (failing.length > 0 && failing.every(file => file.endsWith('docs.test.ts'))) {
        console.log('[addbadge] 只有 docs.test.ts 失败：重跑 docs 后再判');
        deps.exec(commands.docs, { timeoutMs: 5 * 60 * 1000 });
        test = deps.exec(commands.test, { timeoutMs: 15 * 60 * 1000 });
      }
      if (test.code !== 0) {
        throw new PhaseFailure(
          'test',
          `packages/shared test 失败：\n${tail(test.stdout + test.stderr, 30)}`,
          EXIT_ROLLED_BACK,
          true,
        );
      }
    }
    evidence.push('packages/shared test 全绿。');

    // ── 收尾 ─────────────────────────────────────────────────────
    setPhase('finish');
    if (snapshot) dropSnapshot(snapshot);
    const hits = status.hits ?? 0;
    const conclusion = isBatch
      ? `批量加徽章成功：${specs.length} 条（${specs.map(item => item.id).join('、')}），hits 合计=${hits}。`
        + '流水线不自动 commit：请 review `git diff` 后自行提交。'
        + '另外若这些家族有 docs/badges/*.md 备注文件，请人工同步。'
      : `加徽章成功：${spec.id}（${spec.family}，hits=${hits}）。`
        + '流水线不自动 commit：请 review `git diff` 后自行提交。'
        + '另外若本家族有 docs/badges/*.md 备注文件，请人工同步。';
    return finish('succeeded', EXIT_OK, conclusion);
  } catch (err) {
    if (err instanceof PhaseFailure) {
      if (err.needsRollback || wrote) return rollback(err);
      return finish(
        'refused',
        err.exitCode,
        `${err.message}（工作区零改动）`,
        err.failureClass,
        err.attribution ? { attribution: err.attribution } : undefined,
      );
    }
    const message = err instanceof SpecError ? err.message : err instanceof Error ? err.message : String(err);
    const failure = new PhaseFailure('internal', `流水线内部错误：${message}`, EXIT_ROLLED_BACK, wrote);
    return wrote
      ? rollback(failure)
      : finish('refused', failure.exitCode, `${failure.message}（工作区零改动）`, failure.failureClass);
  }
}

function tail(text: string, lines: number): string {
  const all = text.trim().split('\n');
  const slice = all.slice(-lines).join('\n');
  return all.length > lines ? `…（仅显示最后 ${lines} 行）\n${slice}` : slice;
}

// ───────────────────────────── 子进程里的真实 exec ─────────────────────────────

export function shellExec(cwd: string): PipelineDeps['exec'] {
  return (command, options) => {
    const result = spawnSync('sh', ['-c', command], {
      cwd,
      encoding: 'utf8',
      timeout: options?.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      code: result.status ?? (result.error ? 1 : 0),
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? (result.error ? String(result.error.message) : ''),
      timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
    };
  };
}
