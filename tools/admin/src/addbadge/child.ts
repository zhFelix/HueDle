/**
 * 管道子进程的入口（`tsx src/addbadge/child.ts <job.json>`）。
 *
 * 它由 `submit.ts` 以 `detached: true` 拉起，**与 HTTP 请求 / 终端生命周期无关**：
 * 浏览器关了、终端 Ctrl+C 了，它照跑；跑完把结论写进 `status.json`。
 *
 * 自己负责：改写锁里的 pid（提交者是临时进程，不是它）、每个阶段写状态文件、
 * 结束时无论成功失败都释放锁。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_ROLLED_BACK, runPipeline, shellExec } from './pipeline';
import { parseBadgeSpec } from './spec';
import {
  addBadgePaths,
  makeStatus,
  releaseLock,
  writeStatus,
  type LockInfo,
} from './state';

/** `tools/admin` 根（从本文件往上两级）。 */
export const ADMIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** 仓库根（从 `tools/admin/src/addbadge/` 往上四级）。 */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export interface ChildJobFile {
  runId: string;
  spec: unknown;
  logPath: string;
  startedAt?: string;
}

export function runChild(jobPath: string, adminRoot: string, root: string): number {
  let job: ChildJobFile;
  try {
    job = JSON.parse(readFileSync(jobPath, 'utf8')) as ChildJobFile;
  } catch (err) {
    console.error(`[addbadge] 子进程无法读取作业文件 ${jobPath}：${err instanceof Error ? err.message : String(err)}`);
    return EXIT_ROLLED_BACK;
  }

  const paths = addBadgePaths(adminRoot);

  // spec 重新校验（提交时已经验过一遍，这里是第二道门）。
  // 它**必须在自己的 try 里**：作业文件坏了、或者将来有人手改作业文件时，
  // 子进程不能带着未捕获异常死掉——死了就不会写状态、也不会释放锁。
  let spec;
  try {
    spec = parseBadgeSpec(job.spec);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[addbadge] 作业文件里的 spec 无法解析：${message}`);
    try {
      writeStatus(adminRoot, {
        ...makeStatus({
          runId: job.runId,
          spec: { id: '(unparsable)', name: '(unparsable)', family: '(unparsable)', group: null },
          logPath: job.logPath ?? '',
          pid: process.pid,
        }),
        state: 'refused',
        phase: 'done',
        exitCode: EXIT_ROLLED_BACK,
        failureClass: 'spec-reparse',
        conclusion: `作业文件里的 spec 无法解析：${message}（工作区零改动）`,
        finishedAt: new Date().toISOString(),
      });
    } catch {
      // 连状态都写不了：只能靠 stderr + 下次启动的 stale 锁检测。
    }
    return EXIT_ROLLED_BACK;
  }

  // 改写锁：提交者把 pid 记成它自己（临时进程），真正跑管道的是本进程。
  // 直接覆盖而不是「先删再抢」——删了再抢会开出一个「无锁窗口」。
  const lock: LockInfo = {
    runId: job.runId,
    pid: process.pid,
    startedAt: job.startedAt ?? new Date().toISOString(),
    spec: { id: spec.id, name: spec.name, family: spec.family, group: spec.group ?? null },
    logPath: job.logPath,
  };
  writeFileSync(paths.lockFile, JSON.stringify(lock, null, 2), 'utf8');

  try {
    const outcome = runPipeline(
      { runId: job.runId, spec, logPath: job.logPath },
      {
        root,
        adminRoot,
        now: () => new Date(),
        exec: shellExec(root),
        onStatus: status => {
          try {
            writeStatus(adminRoot, status);
          } catch (err) {
            console.error(`[addbadge] 写状态文件失败：${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
    );
    console.log(`[addbadge] 结束：exitCode=${outcome.exitCode} state=${outcome.state}`);
    console.log(`[addbadge] ${outcome.conclusion}`);
    return outcome.exitCode;
  } catch (err) {
    // 兜底：即使流水线自己炸了，也要把「死了」这件事写进状态文件，而不是留下一个永远 running 的状态。
    const message = err instanceof Error ? err.message : String(err);
    try {
      writeStatus(adminRoot, {
        ...makeStatus({
          runId: job.runId,
          spec: { id: spec.id, name: spec.name, family: spec.family, group: spec.group ?? null },
          logPath: job.logPath,
          pid: process.pid,
        }),
        state: 'refused',
        phase: 'done',
        exitCode: EXIT_ROLLED_BACK,
        failureClass: 'internal',
        conclusion: `子进程内部错误：${message}（工作区状态未知，请检查 git status 与快照 ${paths.snapshotsDir}/${job.runId}）`,
        finishedAt: new Date().toISOString(),
      });
    } catch {
      // 状态文件也写不进去：只能靠 stderr + 下一次启动的 stale 锁检测。
    }
    console.error(`[addbadge] 子进程内部错误：${message}`);
    return EXIT_ROLLED_BACK;
  } finally {
    releaseLock(adminRoot, job.runId);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const jobPath = process.argv[2];
  if (!jobPath) {
    console.error('用法：tsx src/addbadge/child.ts <job.json>');
    process.exitCode = 2;
  } else {
    process.exitCode = runChild(jobPath, ADMIN_ROOT, REPO_ROOT);
  }
}
