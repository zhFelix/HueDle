/**
 * 提交一个加徽章作业：**抢锁 → 写作业文件 → 拉起 detached 子进程**。
 *
 * 这里是「管道必须跑在子进程里」这条架构决定的落点：
 *   - HTTP 处理器 / CLI 只负责**提交**，提交完立刻返回；
 *   - 真正跑管道的进程是 `detached` 的，与 HTTP 请求生命周期无关——
 *     浏览器刷新/关闭都不会杀死它；
 *   - 浏览器/终端只通过 `status.json` 观察进度（轮询），不持有任何连接状态。
 *
 * 锁的语义：**已有管道在跑就拒绝，不排队、不并发**（`O_EXCL` 是内核保证）。
 */
import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertIdUnique, assertNameUniqueInFamily } from './families';
import { compileSpec } from './compile';
import { SpecError, type BadgeSpec } from './spec';
import { EXIT_INTERRUPTED, EXIT_LOCKED } from './pipeline';
import {
  acquireLock,
  addBadgePaths,
  ensureOutDirs,
  makeStatus,
  readLock,
  readStatus,
  releaseLock,
  writeStatus,
  type LockInfo,
} from './state';

export interface SpawnedChild {
  pid?: number | undefined;
  unref: () => void;
  on: (event: 'error', listener: (err: Error) => void) => void;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; detached: boolean; stdio: Array<'ignore' | number> },
) => SpawnedChild;

export interface SubmitOptions {
  /**
   * **原始** spec JSON（未经 `parseBadgeSpec` 归一化）。
   *
   * 作业文件里存的是它，不是归一化后的 {@link BadgeSpec}：结构化 spec 归一化后
   * `when` 会变成 AST（`{kind,name,args}` 三个键），再喂回 `parseBadgeSpec` 会被判成
   * 「表达式对象必须恰好有一个键」而炸——实测踩到过。存原始 JSON 还顺带让子进程
   * 能**重新校验**一遍，是第二道门。
   */
  rawSpec: unknown;
  spec: BadgeSpec;
  root: string;
  adminRoot: string;
  logPath: string;
  runId: string;
  /** 检出 stale 锁（上一次没跑完）时，是否强制接管。默认 false → 拒绝并报告。 */
  force?: boolean;
  spawn?: SpawnFn;
}

export type SubmitResult =
  | { ok: true; runId: string; logPath: string; pid: number | undefined }
  | { ok: false; exitCode: number; reason: string };

/** 生成 runId：时间戳 + 徽章 id，便于在日志文件名里一眼认出是哪一次。 */
export function makeRunId(spec: BadgeSpec, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${spec.id}`.replace(/[^A-Za-z0-9TZ._-]/g, '_');
}

/**
 * 提交（同步返回）。失败一律是**明确的拒绝**，绝不半推半就。
 */
export function submitBadgeJob(options: SubmitOptions): SubmitResult {
  const { root, adminRoot, spec, runId, logPath } = options;
  ensureOutDirs(adminRoot);

  // ① 锁：已有管道在跑 → 拒绝（不排队、不并发）。
  const lockState = readLock(adminRoot);
  if (lockState.kind === 'active') {
    const lock = lockState.lock;
    return {
      ok: false,
      exitCode: EXIT_LOCKED,
      reason:
        `已有管道在跑：runId=${lock.runId}，pid=${lock.pid}（自 ${lock.startedAt}）。`
        + `本工具不排队、不并发——请等它结束后再提交。日志：${lock.logPath}`,
    };
  }
  if (lockState.kind === 'stale' && options.force !== true) {
    return {
      ok: false,
      exitCode: EXIT_INTERRUPTED,
      reason:
        `检出未跑完的管道：runId=${lockState.lock.runId}，pid=${lockState.lock.pid} 已不存在，`
        + '仓库可能停在半写状态。请先人工确认/还原（快照路径见 status.json 的 snapshotPath），'
        + '或确认无需还原后用 --force 接管锁重跑。',
    };
  }

  // ② 写盘前的静态校验：任何错误都在这里返回，工作区零改动、零子进程。
  try {
    assertIdUnique(root, spec.id);
    assertNameUniqueInFamily(root, spec.family, spec.name);
    compileSpec(spec, root);
  } catch (err) {
    const reason = err instanceof SpecError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: 2, reason: `spec 校验失败（未写任何文件）：${reason}` };
  }

  // ③ 写作业文件（子进程读它）。
  const paths = addBadgePaths(adminRoot);
  const jobPath = join(paths.jobsDir, `${runId}.json`);
  writeFileSync(
    jobPath,
    JSON.stringify({ runId, spec: options.rawSpec, logPath, startedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );

  // ④ 抢锁。stale + force 时先接管。
  if (lockState.kind === 'stale' && options.force === true) {
    releaseLock(adminRoot, lockState.lock.runId);
  }
  const lock: LockInfo = {
    // 先记提交者的 pid（它此刻一定活着），子进程起来后会立刻改写成自己的 pid。
    runId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    spec: { id: spec.id, name: spec.name, family: spec.family, group: spec.group ?? null },
    logPath,
  };
  const acquired = acquireLock(adminRoot, lock);
  if (!acquired.ok) {
    return { ok: false, exitCode: EXIT_LOCKED, reason: `${acquired.reason}（并发提交被拒，未排队）` };
  }

  // ⑤ 拉起 detached 子进程。stdout/stderr 直接进日志文件。
  const logFd = openSync(logPath, 'a');
  let child: SpawnedChild;
  try {
    const spawnFn: SpawnFn = options.spawn ?? (spawn as unknown as SpawnFn);
    const tsx = join(adminRoot, 'node_modules', '.bin', 'tsx');
    child = spawnFn(tsx, ['src/addbadge/child.ts', jobPath], {
      cwd: adminRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.on('error', () => {
      releaseLock(adminRoot, runId);
    });
    child.unref();
  } catch (err) {
    releaseLock(adminRoot, runId);
    return { ok: false, exitCode: 2, reason: `无法拉起管道子进程：${err instanceof Error ? err.message : String(err)}` };
  } finally {
    closeSync(logFd);
  }

  // ⑥ 立刻写一份「本次作业」的初始状态。
  //
  // 为什么必须做：状态文件里留着的可能是**上一次**作业的结论。若不覆盖，CLI 的
  // `--wait`（只读状态文件）会在提交后的第一毫秒读到上一条 succeeded 并立刻返回，
  // 把上次的结论当成这次的——实测踩到过。
  writeStatus(adminRoot, {
    ...makeStatus({
      runId,
      spec: { id: spec.id, name: spec.name, family: spec.family, group: spec.group ?? null },
      logPath,
      pid: child.pid ?? process.pid,
    }),
    conclusion: '已提交：等待子进程开始写进度…',
  });

  return { ok: true, runId, logPath, pid: child.pid };
}

/** 供 CLI/UI 复用：把「检出的未完成管道」转成一句人话。 */
export function describeInterruption(adminRoot: string): string | null {
  const view = readStatus(adminRoot);
  return view.interrupted ? view.interruption : null;
}
