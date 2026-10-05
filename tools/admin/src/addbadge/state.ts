/**
 * 状态文件 + 锁文件（本阶段架构的核心落位）。
 *
 * ```
 * UI / CLI（只读状态文件）  ──提交──▶  子进程（detached，真正跑管道）
 *                                        │ 进度写
 *                                        ▼
 *                              out/addbadge/status.json  +  pipeline.lock
 * ```
 *
 * 为什么必须是子进程：枚举要 ~4.5 分钟，而浏览器随时可能刷新/关闭。若管道跑在
 * HTTP 请求处理器里，浏览器一断请求生命周期就结束，仓库会停在半写状态，
 * 且没有任何东西保证回滚被执行。
 *
 * 这里的所有写操作都是**原子**的（临时文件 + rename），读操作**绝不执行任何东西**。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 相对 `tools/admin` 的输出目录（`out/.gitignore` 内容是 `*`，所以不会入库）。 */
export const ADD_BADGE_OUT_DIR = 'out/addbadge';

/** 阶段顺序（与 docs/ADMIN.md §3.3 一致）。 */
export const PHASES = [
  'prepare',
  'dryrun',
  'snapshot',
  'write',
  'typecheck',
  'enumerate',
  'idempotency',
  'docs',
  'supersession',
  'test',
  'finish',
] as const;

export type Phase = (typeof PHASES)[number];

export type PipelineState =
  | 'running'
  | 'succeeded'
  | 'rolled_back'
  | 'needs_manual'
  | 'rollback_failed'
  | 'refused';

export interface StatusSpec {
  id: string;
  name: string;
  family: string;
  group: string | null;
}

/**
 * 失败归因：这次失败能不能**指名到某一条 spec**？
 *
 * 树形列表第 ⑦ 条（「失败时只在那一条加 ✕」）依赖它。归因来源见
 * `pipeline.ts` 的 `attributeBatchDryRun` / `attributeTypecheck` / `attributeEnumerate`：
 *   - `spec`：明确只有一条嫌疑（批量干跑里唯一自带 violations 的那条、tsc 只点名
 *     一个家族文件、enumerate 输出里只出现一个新 id、supersession 点名的 id）；
 *   - `batch`：整批共同引起（**分位平衡类失败的定义**）、或嫌疑超过一条（多条的
 *     干跑 violations、新 vs 新蕴含、tsc 点名多个家族）——此时条目上什么都不加；
 *   - `none`：写盘之前的前置拒绝（脏工作区等），谈不上某条 spec。
 */
export interface FailureAttribution {
  kind: 'spec' | 'batch' | 'none';
  /** `kind === 'spec'` 时的徽章 id。 */
  specId?: string;
  /** 面向人的原因（条目 ✕ 的 title / 批次失败原因）。 */
  reason: string;
}

/** `status.json` 的结构。UI 靠**轮询**它来显示进度（不用 SSE/WebSocket）。 */
export interface PipelineStatus {
  version: 1;
  runId: string;
  pid: number;
  state: PipelineState;
  phase: Phase | 'done';
  phaseIndex: number;
  phaseCount: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  exitCode?: number;
  /** 失败分类（见 docs/ADMIN.md §3.4 的 12 个分支）。 */
  failureClass?: string;
  /**
   * 失败归因：能不能指名到某一条 spec（树形列表的条目 ✕ 只认 `kind === 'spec'`）。
   * 成功时不存在。
   */
  failureAttribution?: FailureAttribution;
  /** 面向人的结论（成功 / 已回滚 / 需人工处理）。 */
  conclusion: string;
  /** 单条时是它自己；批量时是整批摘要（`batch-N`）。 */
  spec: StatusSpec;
  /** 批量模式：本批提交的徽章条数（单条时不写，保持旧状态的形状）。 */
  specCount?: number;
  /** 批量模式：每条徽章的元数据（用于 UI/CLI 展示整批）。 */
  specs?: StatusSpec[];
  hits?: number;
  /** 批量模式：每条新徽章的干跑 hits。 */
  hitsBySpec?: Array<{ id: string; hits: number }>;
  snapshotPath?: string;
  logPath: string;
  evidence: string[];
}

export interface AddBadgePaths {
  dir: string;
  statusFile: string;
  lockFile: string;
  logsDir: string;
  jobsDir: string;
  snapshotsDir: string;
}

export function addBadgePaths(adminRoot: string): AddBadgePaths {
  const dir = join(adminRoot, ADD_BADGE_OUT_DIR);
  return {
    dir,
    statusFile: join(dir, 'status.json'),
    lockFile: join(dir, 'pipeline.lock'),
    logsDir: join(dir, 'logs'),
    jobsDir: join(dir, 'jobs'),
    snapshotsDir: join(dir, 'snapshots'),
  };
}

export function ensureOutDirs(adminRoot: string): AddBadgePaths {
  const paths = addBadgePaths(adminRoot);
  for (const dir of [paths.dir, paths.logsDir, paths.jobsDir, paths.snapshotsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

// ───────────────────────────── 锁 ─────────────────────────────

export interface LockInfo {
  runId: string;
  pid: number;
  startedAt: string;
  spec: StatusSpec;
  /** 批量模式的条数（单条时不写）。 */
  specCount?: number;
  logPath: string;
  snapshotPath?: string;
}

export type LockState =
  | { kind: 'none' }
  | { kind: 'active'; lock: LockInfo }
  | { kind: 'stale'; lock: LockInfo };

/** `process.kill(pid, 0)`：EPERM 说明进程存在（只是没权限），ESRCH 才是不存在。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLock(adminRoot: string): LockState {
  const { lockFile } = addBadgePaths(adminRoot);
  if (!existsSync(lockFile)) return { kind: 'none' };
  let lock: LockInfo;
  try {
    lock = JSON.parse(readFileSync(lockFile, 'utf8')) as LockInfo;
  } catch {
    // 锁文件损坏：当成 stale（宁可拒绝，也不并发跑）。
    return {
      kind: 'stale',
      lock: { runId: '(unreadable)', pid: -1, startedAt: '', spec: { id: '', name: '', family: '', group: null }, logPath: '' },
    };
  }
  return isProcessAlive(lock.pid) ? { kind: 'active', lock } : { kind: 'stale', lock };
}

/** 原子抢锁：`O_EXCL` 是内核保证的「只有一个成功」。 */
export function acquireLock(adminRoot: string, lock: LockInfo): { ok: true } | { ok: false; reason: string } {
  ensureOutDirs(adminRoot);
  const { lockFile } = addBadgePaths(adminRoot);
  let fd: number;
  try {
    fd = openSync(lockFile, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const state = readLock(adminRoot);
      const who = state.kind === 'none' ? '未知进程' : `${state.lock.runId}（pid ${state.lock.pid}）`;
      return { ok: false, reason: `已有管道在跑：${who}` };
    }
    throw err;
  }
  try {
    writeFileSync(fd, JSON.stringify(lock, null, 2), 'utf8');
  } finally {
    closeSync(fd);
  }
  return { ok: true };
}

export function releaseLock(adminRoot: string, runId: string): void {
  const { lockFile } = addBadgePaths(adminRoot);
  if (!existsSync(lockFile)) return;
  try {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as LockInfo;
    // 只释放自己的锁：绝不删掉别人的。
    if (lock.runId !== runId) return;
  } catch {
    // 锁文件坏了：只有调用方明确要求时才删（这里保守地删掉，否则会永久卡住）。
  }
  try {
    unlinkSync(lockFile);
  } catch {
    // 已经被删掉了。
  }
}

// ───────────────────────────── 状态文件 ─────────────────────────────

export function writeStatus(adminRoot: string, status: PipelineStatus): void {
  const paths = ensureOutDirs(adminRoot);
  const tmp = `${paths.statusFile}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(status, null, 2), 'utf8');
  renameSync(tmp, paths.statusFile);
}

export interface StatusView {
  status: PipelineStatus | null;
  /**
   * 是否检出「有一个没跑完的管道」——进程不在了但状态还停在 running，
   * 或锁文件的 pid 已经消失。**绝不静默忽略**（见任务书）。
   */
  interrupted: boolean;
  interruption: string | null;
  lock: LockState;
}

export function readStatus(adminRoot: string): StatusView {
  const paths = addBadgePaths(adminRoot);
  const lock = readLock(adminRoot);
  let status: PipelineStatus | null = null;
  if (existsSync(paths.statusFile)) {
    try {
      status = JSON.parse(readFileSync(paths.statusFile, 'utf8')) as PipelineStatus;
    } catch {
      status = null;
    }
  }

  let interrupted = false;
  let interruption: string | null = null;
  if (status && status.state === 'running' && !isProcessAlive(status.pid)) {
    interrupted = true;
    interruption =
      `上一次管道（${status.runId}）停在阶段 "${status.phase}" 但进程 ${status.pid} 已不存在——`
      + '仓库可能处于半写状态。请先按状态里的 snapshotPath 人工确认/还原，再重跑。';
  } else if (lock.kind === 'stale' && (!status || status.state !== 'running')) {
    interrupted = true;
    interruption = `存在未释放的锁文件（runId=${lock.lock.runId}，pid ${lock.lock.pid} 已消失），但没有对应的运行中状态。`;
  }

  return { status, interrupted, interruption, lock };
}

/** 供测试构造状态。 */
export function makeStatus(partial: Partial<PipelineStatus> & { runId: string; spec: StatusSpec }): PipelineStatus {
  const now = new Date().toISOString();
  return {
    version: 1,
    pid: process.pid,
    state: 'running',
    phase: 'prepare',
    phaseIndex: 0,
    phaseCount: PHASES.length,
    startedAt: now,
    updatedAt: now,
    conclusion: '',
    logPath: '',
    evidence: [],
    ...partial,
  };
}
