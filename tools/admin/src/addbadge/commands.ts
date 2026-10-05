/**
 * `add-badge` / `rollback` 两个子命令的编排（CLI 侧）。
 *
 * CLI 与 UI 走**同一条提交路径**（`submitBadgeJob` / `submitBadgeBatchJob`）：
 * 都只是抢锁 + 拉起 detached 子进程，然后**只读状态文件**观察进度。
 * CLI 默认等着（`--no-wait` 可改成提交即返回）。
 *
 * 批量：`--spec badges.json` 的内容是**数组**时就是批量提交（N 条 = 一个事务，
 * 整批只跑一次枚举）。单条仍是对象形态，旧的 spec 文件不改也能继续用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddBadgeCommand, RollbackCommand } from '../argv';
import { UsageError } from '../argv';
import { EXIT_OK, EXIT_ROLLBACK_FAILED } from './pipeline';
import { restoreSnapshot, verifyRestored, type Snapshot } from './rollback';
import { SpecError, parseBadgeSpec, type BadgeSpec } from './spec';
import { addBadgePaths, ensureOutDirs, readStatus } from './state';
import { makeBatchRunId, makeRunId, submitBadgeBatchJob, submitBadgeJob } from './submit';
import { waitForCompletion } from './watch';

export interface CommandDeps {
  adminRoot: string;
  root: string;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
  /** rollback 用：跑验证命令（默认真的跑 pnpm）。 */
  runTest?: () => number;
}

function out(deps: CommandDeps, line: string): void {
  (deps.log ?? console.log)(line);
}

function err(deps: CommandDeps, line: string): void {
  (deps.error ?? console.error)(line);
}

/** 原始 spec + 归一化结果（作业文件里存原始 JSON，见 `submit.ts` 的说明）。 */
export type BuiltSpec =
  | { kind: 'single'; raw: unknown; spec: BadgeSpec }
  | { kind: 'batch'; rawSpecs: unknown[]; specs: BadgeSpec[] };

/** 从 CLI 参数组装 spec（与 UI 表单走同一份 `parseBadgeSpec`，两条入口不会漂移）。 */
export function buildSpecFromArgs(args: AddBadgeCommand): BuiltSpec {
  if (args.specPath) {
    const path = args.specPath;
    if (!existsSync(path)) throw new UsageError(`--spec 指向的文件不存在：${path}`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (parseError) {
      throw new UsageError(`--spec 不是合法 JSON：${parseError instanceof Error ? parseError.message : parseError}`);
    }
    // 数组 = 批量（一个事务）；对象 = 单条（旧行为，逐字节不变）。
    if (Array.isArray(raw)) {
      if (raw.length === 0) throw new UsageError('--spec 的 JSON 数组是空的：批量至少要有一条徽章');
      const specs = raw.map((item, index) => parseBadgeSpec(item, `specs[${index}]`));
      return { kind: 'batch', rawSpecs: raw, specs };
    }
    return { kind: 'single', raw, spec: parseBadgeSpec(raw) };
  }
  if (args.ts) {
    const missing = (['id', 'name', 'description', 'family'] as const).filter(key => args[key] === undefined);
    if (missing.length > 0) {
      throw new UsageError(`--ts 需要同时给出：${missing.map(key => `--${key}`).join('、')}`);
    }
    // 依赖名字列表：干跑会自己 import 目标家族文件里的真品，作者不再提供实现。
    const evalHelpers = args.helpers.map(name => name.trim()).filter(Boolean);
    const raw = {
      id: args.id,
      name: args.name,
      description: args.description,
      family: args.family,
      group: args.group ?? null,
      handwritten: {
        check: args.ts,
        ...(evalHelpers.length > 0 ? { evalHelpers } : {}),
      },
    };
    return { kind: 'single', raw, spec: parseBadgeSpec(raw) };
  }
  throw new UsageError('add-badge 需要 --spec <file.json> 或 --ts <表达式>（--status 只看状态）');
}

function printStatus(deps: CommandDeps): number {
  const view = readStatus(deps.adminRoot);
  if (view.status) {
    const status = view.status;
    out(deps, `runId      : ${status.runId}`);
    out(deps, `状态       : ${status.state}（阶段 ${status.phase} ${status.phaseIndex + 1}/${status.phaseCount}）`);
    out(deps, `徽章       : ${status.spec.id}（${status.spec.family}）`);
    if (status.specCount !== undefined && status.specCount > 1 && status.specs) {
      out(deps, `批量       : ${status.specCount} 条`);
      for (const item of status.specs) out(deps, `  - ${item.id}（${item.family}）`);
    }
    out(deps, `开始/更新  : ${status.startedAt} / ${status.updatedAt}`);
    if (status.hits !== undefined) out(deps, `干跑 hits  : ${status.hits}`);
    if (status.hitsBySpec) {
      for (const item of status.hitsBySpec) out(deps, `  ${item.id}: ${item.hits}`);
    }
    if (status.warnings && status.warnings.length > 0) {
      out(
        deps,
        `单向蕴含   : ${status.warnings.length} 条⚠（警告，不是错误；${status.state === 'awaiting_confirmation' ? '等待确认' : '已接受'}）`,
      );
      if (status.state === 'awaiting_confirmation') {
        for (const warning of status.warnings) out(deps, `  - ${warning.message}`);
      }
    }
    if (status.failureClass) out(deps, `失败分类   : ${status.failureClass}`);
    if (status.snapshotPath) out(deps, `快照       : ${status.snapshotPath}`);
    out(deps, `日志       : ${status.logPath}`);
    out(deps, `结论       : ${status.conclusion}`);
  } else {
    out(deps, '没有状态文件：还没有提交过加徽章作业。');
  }
  if (view.interrupted) {
    err(deps, `⚠ ${view.interruption}`);
    return 8;
  }
  return EXIT_OK;
}

export async function runAddBadgeCommand(args: AddBadgeCommand, deps: CommandDeps): Promise<number> {
  if (args.help) {
    out(deps, '见 tsx src/cli.ts --help');
    return EXIT_OK;
  }
  if (args.statusOnly) return printStatus(deps);

  let built: BuiltSpec;
  try {
    built = buildSpecFromArgs(args);
  } catch (parseError) {
    err(deps, parseError instanceof Error ? parseError.message : String(parseError));
    return parseError instanceof SpecError ? 2 : 2;
  }

  const now = deps.now?.() ?? new Date();
  const paths = ensureOutDirs(deps.adminRoot);
  const isBatch = built.kind === 'batch';
  const batchCount = built.kind === 'batch' ? built.specs.length : 0;
  const runId = built.kind === 'batch' ? makeBatchRunId(built.specs, now) : makeRunId(built.spec, now);
  const logPath = join(paths.logsDir, `${runId}.log`);

  const submitted = built.kind === 'batch'
    ? submitBadgeBatchJob({
        rawSpecs: built.rawSpecs,
        specs: built.specs,
        root: deps.root,
        adminRoot: deps.adminRoot,
        runId,
        logPath,
        force: args.force,
      })
    : submitBadgeJob({
        rawSpec: built.raw,
        spec: built.spec,
        root: deps.root,
        adminRoot: deps.adminRoot,
        runId,
        logPath,
        force: args.force,
      });
  if (!submitted.ok) {
    err(deps, submitted.reason);
    return submitted.exitCode;
  }

  out(deps, `已提交${isBatch ? `（批量 ${batchCount} 条，整批一个事务）` : ''}：runId=${submitted.runId}（子进程 pid ${submitted.pid ?? '?'}）`);
  out(deps, `日志：${submitted.logPath}`);
  out(deps, `状态：${addBadgePaths(deps.adminRoot).statusFile}`);
  out(deps, '管道跑在 detached 子进程里：这个终端断开也不会影响它。');

  if (!args.wait) return EXIT_OK;

  out(deps, isBatch
    ? `等待管道结束（整批只跑一次枚举，约 10–15 分钟；--no-wait 可立即返回）…`
    : '等待管道结束（约 10–15 分钟；--no-wait 可立即返回）…');
  const view = await waitForCompletion(deps.adminRoot, submitted.runId, {
    onPhase: current => {
      if (current.status) out(deps, `  [${current.status.phaseIndex + 1}/${current.status.phaseCount}] ${current.status.phase}`);
    },
  });
  const status = view.status;
  if (!status) {
    err(deps, '管道没有留下状态文件（子进程可能根本没起来）。请查看日志：' + submitted.logPath);
    return 2;
  }
  out(deps, '');
  out(deps, `结论：${status.conclusion}`);
  if (status.snapshotPath && status.state !== 'succeeded') out(deps, `快照：${status.snapshotPath}`);
  return status.exitCode ?? 2;
}

export async function runRollbackCommand(args: RollbackCommand, deps: CommandDeps): Promise<number> {
  if (!args.snapshot) {
    err(deps, 'rollback 需要 --snapshot <dir>（路径见 status.json 的 snapshotPath）');
    return 2;
  }
  const manifest = join(args.snapshot, 'manifest.json');
  if (!existsSync(manifest)) {
    err(deps, `快照目录里没有 manifest.json：${args.snapshot}`);
    return 2;
  }
  const snapshot = JSON.parse(readFileSync(manifest, 'utf8')) as Snapshot;
  const { restored, failed } = restoreSnapshot(deps.root, snapshot);
  const mismatched = verifyRestored(deps.root, snapshot);
  if (failed.length > 0 || mismatched.length > 0) {
    err(deps, `回滚未完全成功：${failed.map(item => `${item.rel}: ${item.error}`).join('; ')}${mismatched.length ? `；未还原：${mismatched.join(', ')}` : ''}`);
    err(deps, '工作区未完全还原——请人工介入。');
    return EXIT_ROLLBACK_FAILED;
  }
  out(deps, `已还原 ${restored.length} 个文件，md5 与快照一致，git diff --exit-code 通过。`);
  const testCode = deps.runTest ? deps.runTest() : 0;
  if (testCode !== 0) {
    err(deps, '还原后 packages/shared test 未回到全绿——工作区未证明恢复，请人工介入。');
    return EXIT_ROLLBACK_FAILED;
  }
  out(deps, 'packages/shared test 全绿。回滚完成。');
  return EXIT_OK;
}
