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
import { EXIT_ROLLED_BACK, runBatchPipeline, runPipeline, shellExec, type PipelineDeps } from './pipeline';
import { recordBatchOutcome } from './history';
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
  /** 单条作业（旧格式）。 */
  spec?: unknown;
  /** 批量作业：原始 spec JSON 数组。 */
  specs?: unknown[];
  logPath: string;
  startedAt?: string;
  /** 「继续」带回来的、已接受的 spec 内容哈希（见 pipeline.ts 的两阶段确认）。 */
  acceptedSpecHash?: string;
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
  let specs;
  let isBatch = false;
  try {
    if (Array.isArray(job.specs)) {
      isBatch = true;
      specs = job.specs.map((raw, index) => parseBadgeSpec(raw, `specs[${index}]`));
      if (specs.length === 0) throw new Error('批量作业的 specs 是空数组');
    } else {
      specs = [parseBadgeSpec(job.spec)];
    }
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
    try {
      recordBatchOutcome(adminRoot, job.runId, {
        state: 'refused',
        finishedAt: new Date().toISOString(),
        failureClass: 'spec-reparse',
        conclusion: `作业文件里的 spec 无法解析：${message}（工作区零改动）`,
      });
    } catch {
      // 历史回填失败不影响退出码。
    }
    return EXIT_ROLLED_BACK;
  }

  const meta = specs.length === 1
    ? { id: specs[0]!.id, name: specs[0]!.name, family: specs[0]!.family, group: specs[0]!.group ?? null }
    : {
        id: `batch-${specs.length}`,
        name: `${specs.length} 条徽章`,
        family: [...new Set(specs.map(item => item.family))].join('+'),
        group: null,
      };

  // 改写锁：提交者把 pid 记成它自己（临时进程），真正跑管道的是本进程。
  // 直接覆盖而不是「先删再抢」——删了再抢会开出一个「无锁窗口」。
  const lock: LockInfo = {
    runId: job.runId,
    pid: process.pid,
    startedAt: job.startedAt ?? new Date().toISOString(),
    spec: meta,
    ...(isBatch ? { specCount: specs.length } : {}),
    logPath: job.logPath,
  };
  writeFileSync(paths.lockFile, JSON.stringify(lock, null, 2), 'utf8');

  try {
    const deps: PipelineDeps = {
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
    };
    const outcome = isBatch
      ? runBatchPipeline(
          {
            runId: job.runId,
            specs,
            logPath: job.logPath,
            ...(job.acceptedSpecHash !== undefined ? { acceptedSpecHash: job.acceptedSpecHash } : {}),
          },
          deps,
        )
      : runPipeline(
          {
            runId: job.runId,
            spec: specs[0]!,
            logPath: job.logPath,
            ...(job.acceptedSpecHash !== undefined ? { acceptedSpecHash: job.acceptedSpecHash } : {}),
          },
          deps,
        );
    // 回填批次历史（只有 UI 的统一跑写过记录；CLI 提交时这里是 no-op）。
    // 树形列表靠它显示历史批次的最终状态与「哪一条失败」。
    recordBatchOutcome(adminRoot, job.runId, {
      state: outcome.state,
      finishedAt: new Date().toISOString(),
      ...(outcome.failureClass ? { failureClass: outcome.failureClass } : {}),
      conclusion: outcome.conclusion,
      ...(outcome.failureAttribution ? { failureAttribution: outcome.failureAttribution } : {}),
      ...(outcome.warnings ? { warnings: outcome.warnings } : {}),
      ...(outcome.specHash ? { specHash: outcome.specHash } : {}),
    });
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
          spec: meta,
          logPath: job.logPath,
          pid: process.pid,
          ...(isBatch ? { specCount: specs.length } : {}),
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
    try {
      recordBatchOutcome(adminRoot, job.runId, {
        state: 'refused',
        finishedAt: new Date().toISOString(),
        failureClass: 'internal',
        conclusion: `子进程内部错误：${message}`,
      });
    } catch {
      // 历史回填失败不影响退出码。
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
