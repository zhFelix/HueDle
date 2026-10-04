/**
 * `add-badge` / `rollback` 两个子命令的编排（CLI 侧）。
 *
 * CLI 与 UI 走**同一条提交路径**（`submitBadgeJob`）：都只是抢锁 + 拉起 detached 子进程，
 * 然后**只读状态文件**观察进度。CLI 默认等着（`--no-wait` 可改成提交即返回）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddBadgeCommand, RollbackCommand } from '../argv';
import { UsageError } from '../argv';
import { EXIT_OK, EXIT_ROLLBACK_FAILED } from './pipeline';
import { restoreSnapshot, verifyRestored, type Snapshot } from './rollback';
import { SpecError, parseBadgeSpec, type BadgeSpec } from './spec';
import { addBadgePaths, ensureOutDirs, readStatus } from './state';
import { makeRunId, submitBadgeJob } from './submit';
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
export interface BuiltSpec {
  raw: unknown;
  spec: BadgeSpec;
}

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
    return { raw, spec: parseBadgeSpec(raw) };
  }
  if (args.ts) {
    const missing = (['id', 'name', 'description', 'family'] as const).filter(key => args[key] === undefined);
    if (missing.length > 0) {
      throw new UsageError(`--ts 需要同时给出：${missing.map(key => `--${key}`).join('、')}`);
    }
    const evalHelpers: Record<string, string> = {};
    for (const raw of args.helperEvals) {
      const index = raw.indexOf('=');
      if (index <= 0) throw new UsageError(`--helper-eval 的格式是 name=<js 源码>，收到：${raw}`);
      evalHelpers[raw.slice(0, index).trim()] = raw.slice(index + 1).trim();
    }
    const raw = {
      id: args.id,
      name: args.name,
      description: args.description,
      family: args.family,
      group: args.group ?? null,
      handwritten: {
        check: args.ts,
        ...(Object.keys(evalHelpers).length > 0 ? { evalHelpers } : {}),
      },
    };
    return { raw, spec: parseBadgeSpec(raw) };
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
    out(deps, `开始/更新  : ${status.startedAt} / ${status.updatedAt}`);
    if (status.hits !== undefined) out(deps, `干跑 hits  : ${status.hits}`);
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

  const { raw, spec } = built;
  const now = deps.now?.() ?? new Date();
  const runId = makeRunId(spec, now);
  const paths = ensureOutDirs(deps.adminRoot);
  const logPath = join(paths.logsDir, `${runId}.log`);

  const submitted = submitBadgeJob({
    rawSpec: raw,
    spec,
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

  out(deps, `已提交：runId=${submitted.runId}（子进程 pid ${submitted.pid ?? '?'}）`);
  out(deps, `日志：${submitted.logPath}`);
  out(deps, `状态：${addBadgePaths(deps.adminRoot).statusFile}`);
  out(deps, '管道跑在 detached 子进程里：这个终端断开也不会影响它。');

  if (!args.wait) return EXIT_OK;

  out(deps, '等待管道结束（约 10–15 分钟；--no-wait 可立即返回）…');
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
