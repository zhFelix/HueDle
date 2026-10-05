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
import { hasRestorableSpecs, readStaging } from './staging';
import { readStatus, type FailureAttribution, type PipelineState, type StatusWarning } from './state';

/**
 * 批次左图标的状态（五态）：
 *   - `pending`   待运行（空圈）
 *   - `running`   正在运行（转圈）
 *   - `succeeded` 成功（绿底白勾）
 *   - `awaiting`  **待确认**：只有单向蕴含警告，**没有失败**（琥珀 ⚠）
 *   - `failed`    失败（红底白叉）
 */
export type BatchIconState = 'pending' | 'running' | 'succeeded' | 'awaiting' | 'failed';

export interface TreeItem {
  id: string;
  name: string;
  family: string;
  /** 只有「失败且归因到这条」时才为真——条目上唯一的例外。 */
  failed: boolean;
  failReason?: string;
  /** 待运行批次才有：草稿身份（删除用）。 */
  draftId?: string;
  /** 待运行批次才有：这条草稿是从哪一批恢复回来的（hover 里说明来源）。 */
  restoredFrom?: string;
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
  /** 待确认批次：单向蕴含警告清单（展开后逐条显示）。 */
  warnings?: StatusWarning[];
  /** 待确认批次：spec 内容哈希（「继续」会带回它）。 */
  specHash?: string;
  items: TreeItem[];
  /** 是否是「当前正在攒的这一批」。 */
  pending: boolean;
  /**
   * **失败批次**才可能为真：该批次的作业文件还在，可以把 spec 恢复回暂存区
   * （按钮文案「恢复草稿」）。成功批次**永远**没有这个入口。
   */
  canRestore?: boolean;
}

/** pipeline 状态 → 图标五态。 */
export function stateFromRaw(raw: PipelineState | undefined): BatchIconState {
  if (raw === undefined) return 'pending';
  if (raw === 'running') return 'running';
  if (raw === 'succeeded') return 'succeeded';
  if (raw === 'awaiting_confirmation') return 'awaiting';
  return 'failed';
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
        ...(draft.restoredFrom ? { restoredFrom: draft.restoredFrom } : {}),
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
    const warnings = fresh?.warnings ?? record.warnings;
    const specHash = fresh?.specHash ?? record.specHash;
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
      ...(state === 'awaiting' && warnings && warnings.length > 0
        ? { reason: `有 ${warnings.length} 条单向蕴含警告，等待确认（这不是失败）` }
        : {}),
      ...(warnings && warnings.length > 0 ? { warnings } : {}),
      ...(specHash ? { specHash } : {}),
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
      // 只有**失败**批次（不是成功批次）才给「恢复草稿」入口，且要求作业文件里
      // 确实还冻结着 spec（否则按钮点了也只能报「没有可恢复的」）。
      ...(state === 'failed' && hasRestorableSpecs(adminRoot, record.runId) ? { canRestore: true } : {}),
    });
  }
  return batches;
}
