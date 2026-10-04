/**
 * 徽章详情的**纯派生**数据层（功能①）。
 *
 * ── 它做什么 ────────────────────────────────────────────────────────────────
 *
 * 把「一条徽章 + 当前历史」换算成详情面板要展示的四件事：
 * `hits`（真实命中数）、`hitDays`（哪几天命中过）、`firstDay`（首次命中）、
 * `isCollected`（是否已获得）。
 *
 * ── 它**不**做什么（重要）─────────────────────────────────────────────────
 *
 * - 不发起任何请求、不读任何存储：历史一律走 `useHistory()`，已收集口径一律走
 *   `useBadges().isCollected`（= 全部历史 `badgeIds` 的并集，**不过滤取代**）。
 *   自己写一套 `restoreScore` 过滤会把被取代的徽章误判成未获得。
 * - 不重算概率：`hits` 直接读 `PRICING[badge.id].hits`（`@huedle/shared` 已导出，
 *   2²⁴ 全色域精确枚举值）。`Badge` 上没有 `hits`，也不给它加。
 *
 * ── 缺定价的分支 ────────────────────────────────────────────────────────────
 *
 * `PRICING[id]` 实际不可达（图鉴里的徽章都来自 `allBadges`，`compose()` 缺定价会抛错），
 * 但 `restoreScore` 会静默丢弃存档里已删除的 id。这里写成 `hits: number | null`，
 * UI 上**不渲染概率行**，而不是 fallback 成 0——「概率 0」会被读成「永远不可能」。
 */
import { PRICING, type BadgePricing } from '@huedle/shared';
import type { HistoryItem } from '../lib/storage';
import { useBadges } from './useBadges';
import { useHistory } from './useHistory';

/** 某一天命中过某条徽章：日期 + 当天抽到的颜色（详情里做小色块）。 */
export interface BadgeHitRecord {
  /** UTC `YYYY-MM-DD`。 */
  date: string;
  hex: string;
}

export interface BadgeDetail {
  /** `PRICING[id].hits`；缺定价 → `null`（UI 不渲染概率行）。 */
  hits: number | null;
  /** 命中日期，按日期降序（`entries` 已是降序）。 */
  hitDays: BadgeHitRecord[];
  /** 最早命中日（= 首次拿到）；从未命中 → `null`。 */
  firstDay: string | null;
  /** 是否已获得（口径见 `useBadges()`）。 */
  isCollected: boolean;
}

export interface UseBadgeDetail {
  /** 取一条徽章的详情；同一次历史内按 id 缓存。 */
  detailOf: (id: string) => BadgeDetail;
}

export function useBadgeDetail(): UseBadgeDetail {
  const { entries } = useHistory();
  const { isCollected } = useBadges();

  /**
   * 按 id 缓存的详情。
   *
   * 不加缓存的话，每次展开某条徽章都要扫一遍全部历史（一年 365 天 = 365 次
   * `badgeIds.includes`），128 条全展开就是 4.7 万次。缓存以**历史数组的引用**
   * 为失效条件：`reload()` 会换一个新数组，缓存随之整体作废，不会读到陈旧数据。
   */
  let cacheSource: HistoryItem[] | null = null;
  let cache = new Map<string, BadgeDetail>();

  function detailOf(id: string): BadgeDetail {
    if (cacheSource !== entries.value) {
      cacheSource = entries.value;
      cache = new Map();
    }

    const cached = cache.get(id);
    if (cached !== undefined) return cached;

    const hitDays: BadgeHitRecord[] = [];
    let firstDay: string | null = null;
    for (const entry of entries.value) {
      if (!entry.badgeIds.includes(id)) continue;
      hitDays.push({ date: entry.date, hex: entry.hex });
      // 不假设 entries 的顺序：最早的一天按 ISO 日期字典序取最小。
      if (firstDay === null || entry.date < firstDay) firstDay = entry.date;
    }

    const pricing: BadgePricing | undefined = PRICING[id];
    const detail: BadgeDetail = {
      hits: pricing === undefined ? null : pricing.hits,
      hitDays,
      firstDay,
      isCollected: isCollected(id),
    };
    cache.set(id, detail);
    return detail;
  }

  return { detailOf };
}
