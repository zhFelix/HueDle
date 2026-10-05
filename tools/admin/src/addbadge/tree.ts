/**
 * 树形列表的**模型**：把「暂存区的待运行批次」+「历史批次 + 最近一次实时状态」
 * 合成为页面直接可渲染的结构。
 *
 * 状态模型（用户已明确，照做）：
 *
 * | 状态     | 批次左边        | 条目上                          |
 * |----------|-----------------|---------------------------------|
 * | 待运行   | 空圈            | 无                              |
 * | 正在运行 | 转圈（hover 秒数） | 无                           |
 * | 成功     | 绿底白勾        | 无                              |
 * | 失败     | 红底白叉        | **仅当能归因到单条**时那条加 ✕  |
 *
 * 页面渲染在 `ui/batch-tree.ts`；本文件只产出数据（纯读，绝不执行东西）。
 */
import { readBatches } from './history';
import { readStaging } from './staging';
import { readStatus, type FailureAttribution, type PipelineState } from './state';

/** 批次左图标的状态（四态，与任务的映射表一一对应）。 */
export type BatchIconState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface TreeItem {
  id: string;
  name: string;
  family: string;
  /** 只有「失败且归因到这条」时才为真——条目上唯一的例外。 */
  failed: boolean;
  failReason?: string;
  /** 待运行批次才有：草稿身份（删除用）。 */
  draftId?: string;
}

export interface TreeBatch {
  key: string;
  title: string;
  state: BatchIconState;
  /** 原始 pipeline 状态（`rolled_back` / `needs_manual` …），展示用。 */
  rawState?: string;
  startedAt?: string;
  finishedAt?: string;
  /** 已跑/用时秒数（待运行为 undefined）。 */
  seconds?: number;
  /** 批次失败原因（批次左边红叉的 hover）。 */
  reason?: string;
  items: TreeItem[];
  /** 是否是「当前正在攒的这一批」。 */
  pending: boolean;
}

/** pipeline 状态 → 图标四态。 */
export function stateFromRaw(raw: PipelineState | undefined): BatchIconState {
  if (raw === undefined) return 'pending';
  if (raw === 'running') return 'running';
  return raw === 'succeeded' ? 'succeeded' : 'failed';
}

/** 两个 ISO 时间之间的整秒数（任一缺失/非法返回 undefined）。 */
export function secondsBetween(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) return undefined;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  return Math.max(0, Math.round((to - from) / 1000));
}

/**
 * 只有「批次失败 **且** 归因到单条」才在那一条上加 ✕；
 * 分位平衡类（`kind === 'batch'`）与前置拒绝（`none`）都不加。
 */
export function itemFailure(attribution: FailureAttribution | undefined, id: string): { failed: boolean; reason?: string } {
  if (attribution && attribution.kind === 'spec' && attribution.specId === id) {
    return { failed: true, reason: attribution.reason };
  }
  return { failed: false };
}

function statusReason(conclusion: string | undefined, failureClass: string | undefined): string {
  const first = (conclusion ?? '').split('\n').map(line => line.trim()).filter(Boolean)[0];
  return first || failureClass || '运行失败';
}

/** 组装树：待运行批次在最上，历史批次按提交时间倒序。 */
export function buildBatchTree(adminRoot: string, now: Date = new Date()): TreeBatch[] {
  const batches: TreeBatch[] = [];
  const nowIso = now.toISOString();

  const drafts = readStaging(adminRoot);
  if (drafts.length > 0) {
    batches.push({
      key: 'pending',
      title: `待运行批次 · ${drafts.length} 条`,
      state: 'pending',
      items: drafts.map(draft => ({
        id: draft.fields.id || '（未填 id）',
        name: draft.fields.name || '（未填 name）',
        family: draft.fields.family || '（未选 family）',
        failed: false,
        draftId: draft.draftId,
      })),
      pending: true,
    });
  }

  const records = [...readBatches(adminRoot)].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  if (records.length === 0) return batches;

  // 最近一次作业的实时状态（只读；指向别的 runId 时不用于覆盖）。
  const view = readStatus(adminRoot);
  const live = view.status;

  for (const record of records) {
    const fresh = live && live.runId === record.runId ? live : undefined;
    const rawState: PipelineState = fresh?.state ?? record.state;
    const state = stateFromRaw(rawState);
    const startedAt = fresh?.startedAt ?? record.startedAt;
    const finishedAt = fresh?.finishedAt ?? record.finishedAt;
    const attribution = fresh?.failureAttribution ?? record.failureAttribution;
    const reason = fresh
      ? statusReason(fresh.conclusion, fresh.failureClass)
      : statusReason(record.conclusion, record.failureClass);

    batches.push({
      key: record.runId,
      title: `批次 ${record.runId}`,
      state,
      rawState,
      startedAt,
      finishedAt,
      seconds:
        state === 'running'
          ? secondsBetween(startedAt, nowIso)
          : secondsBetween(startedAt, finishedAt),
      ...(state === 'failed' ? { reason } : {}),
      items: record.specs.map(spec => {
        const failure = itemFailure(attribution, spec.id);
        return {
          id: spec.id,
          name: spec.name,
          family: spec.family,
          failed: failure.failed,
          ...(failure.reason ? { failReason: failure.reason } : {}),
        };
      }),
      pending: false,
    });
  }
  return batches;
}
