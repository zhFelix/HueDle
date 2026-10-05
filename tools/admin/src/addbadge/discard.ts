/**
 * **放弃待确认批次**（加徽章页「待确认」区块的第三个按钮）。
 *
 * 「继续」= 接受警告接着跑；「修改」= 把 spec 放回暂存区接着改；两者都**留着**这一批。
 * 但有些批次用户就是不想要了（试错了、已经被别的批次取代、只是忘了清），
 * 而它每次刷新都占着状态卡下方那一块。这个模块负责把它**从列表里彻底移除**。
 *
 * ## 边界（每一条都对应一个测试）
 *
 *   - **仓库零改动**：只动 `out/addbadge/` 下的三处落点（批次历史、实时状态、
 *     冻结的作业文件），绝不碰 `packages/shared/src/badges/*`、不产生快照、不跑管道；
 *   - **只删【待确认】的批次**：`running` / `succeeded` / 已回滚等都拒绝。
 *     状态优先取 `status.json`（那次运行的最新结论），没有才回落到历史记录；
 *   - **进程还活着就不删**：锁按 runId 核对，`active` 且属于本批 → 拒绝。
 *     待确认的定义是「子进程已经正常退出」，所以这条只会在并发/异常时触发；
 *   - **runId 必须安全**：它会被拼进 `jobs/<runId>.json`，因此复用
 *     {@link isSafeRunId} 的字符集校验（与「修改」同一条防线）；
 *   - **删的是数据，所以必须说清楚**：`jobs/<runId>.json` 里冻结的 spec 一并删除
 *     （想留着就先用「修改」放回暂存区）。日志（`logs/<runId>.log`）**保留**：
 *     它是「这一批到底跑过什么」的唯一证据，删批次不该连带抹掉证据。
 *
 * 这里只做纯文件操作，不做任何校验之外的执行——HTTP 层只负责转发。
 */
import { existsSync, unlinkSync } from 'node:fs';
import { readBatches, removeBatchRecord } from './history';
import { batchJobFile, isSafeRunId } from './staging';
import { readLock, readStatus, removeStatusIf, type PipelineState } from './state';

export interface DiscardResult {
  ok: boolean;
  runId: string;
  /** 真正删掉的东西（面向人的短标签，用来写反馈文案）。 */
  removed: string[];
  reason?: string;
}

/** `state` 优先取实时状态（最新结论），没有才回落到历史记录。 */
function effectiveState(adminRoot: string, runId: string): PipelineState | undefined {
  const view = readStatus(adminRoot);
  const live = view.status && view.status.runId === runId ? view.status : undefined;
  if (live) return live.state;
  return readBatches(adminRoot).find(item => item.runId === runId)?.state;
}

/**
 * 放弃一个【待确认】批次：删批次历史 + 实时状态 + 冻结的作业文件。
 *
 * 任何一道守卫不过就**什么都不删**（返回 `ok: false` 与原因）；因此失败时
 * 工作区与 `out/` 都是原样。
 */
export function discardBatch(adminRoot: string, runId: string): DiscardResult {
  if (!isSafeRunId(runId)) {
    return { ok: false, runId, removed: [], reason: `批次号不合法：${JSON.stringify(runId)}` };
  }

  const state = effectiveState(adminRoot, runId);
  if (state === undefined) {
    return { ok: false, runId, removed: [], reason: `找不到批次 ${runId}（可能已经被放弃或被其它操作清掉了）。` };
  }
  if (state !== 'awaiting_confirmation') {
    return {
      ok: false,
      runId,
      removed: [],
      reason: `批次 ${runId} 当前状态是 "${state}"，只有【待确认】的批次可以放弃。`,
    };
  }

  const lock = readLock(adminRoot);
  if (lock.kind === 'active' && lock.lock.runId === runId) {
    return {
      ok: false,
      runId,
      removed: [],
      reason: `批次 ${runId} 的管道进程（pid ${lock.lock.pid}）仍在运行，拒绝放弃。`,
    };
  }

  const removed: string[] = [];
  if (removeBatchRecord(adminRoot, runId)) removed.push('批次历史');
  if (removeStatusIf(adminRoot, runId)) removed.push('实时状态');
  const jobPath = batchJobFile(adminRoot, runId);
  if (existsSync(jobPath)) {
    // 删不掉（权限等）不算致命：批次历史与状态已经移除，列表里不会再出现它。
    try {
      unlinkSync(jobPath);
      removed.push('冻结的 spec');
    } catch {
      // 忽略：作业文件留在 out/ 里不影响任何行为。
    }
  }
  return { ok: true, runId, removed };
}
