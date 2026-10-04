/**
 * 观察者：**只读状态文件**，不做任何执行（用户要求的「UI 靠轮询读它，不要用 SSE/WebSocket」）。
 *
 * CLI 的 `--wait` 与 UI 的 `/badge/status.json` 都走这里，因此「进度口径」只有一份。
 */
import { readStatus, type StatusView } from './state';

export const TERMINAL_STATES = ['succeeded', 'rolled_back', 'needs_manual', 'rollback_failed', 'refused'] as const;

export function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export interface WaitOptions {
  /** 轮询间隔（毫秒）。 */
  intervalMs?: number;
  /** 阶段变化时的回调（CLI 用来打印进度）。 */
  onPhase?: (view: StatusView) => void;
  /** 显式上限，避免无限等待（默认 45 分钟；超时只影响观察者，子进程照跑）。 */
  timeoutMs?: number;
  /**
   * 子进程刚被拉起、还没来得及写第一份状态文件时的宽限期（默认 30 秒）。
   * 没有它，`--wait` 会在子进程启动前的几十毫秒里误判成「子进程没起来」。
   */
  startGraceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 阻塞到管道进入终态（或超时）。
 *
 * 注意：这是**观察者**的时间上界，不是管道的——子进程是 detached 的，
 * 观察者退出不会杀死它（这正是子进程架构的意义）。
 */
export async function waitForCompletion(
  adminRoot: string,
  runId: string,
  options: WaitOptions = {},
): Promise<StatusView> {
  const interval = options.intervalMs ?? 500;
  const timeout = options.timeoutMs ?? 45 * 60 * 1000;
  const grace = options.startGraceMs ?? 30 * 1000;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  const deadline = startedAt + timeout;
  let lastPhase = '';
  for (;;) {
    const view = readStatus(adminRoot);
    if (view.status) {
      // 别人的 run（例如上一次作业遗留的结论）：再等一小会儿，让本次子进程把
      // 状态覆盖掉；超过宽限期才放弃（避免 CLI 挂在一个不属于自己的作业上）。
      if (view.status.runId !== runId) {
        if (Date.now() - startedAt > grace) return view;
        await sleep(interval);
        continue;
      }
      if (isTerminal(view.status.state)) return view;
      if (view.status.phase !== lastPhase) {
        lastPhase = view.status.phase;
        options.onPhase?.(view);
      }
    } else if (view.lock.kind === 'stale' && Date.now() - startedAt > grace) {
      // 没有状态文件、锁也成了 stale：子进程根本没起来。
      return view;
    } else if (Date.now() - startedAt > grace + timeout) {
      return view;
    }
    if (Date.now() > deadline) return readStatus(adminRoot);
    await sleep(interval);
  }
}

/** 读取当前状态（供 HTTP 层直接序列化）。 */
export function currentView(adminRoot: string): StatusView {
  return readStatus(adminRoot);
}
