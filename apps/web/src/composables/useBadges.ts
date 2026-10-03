/**
 * 徽章图鉴的数据层：把 `useHistory()` 的存档换算成「已收集 / 未收集」。
 *
 * ── 设计判断：76 条全部出现，但未获得的只显示名称 ───────────────────────────
 *
 * 未获得的徽章只显示名称，保留「发现」的乐趣——玩家知道还有多少没集齐
 * （家族进度仍然展示），但不知道具体要满足什么条件，抽到的时候才有惊喜。
 * 已获得的则完整展示条件（名称 + 稀有度 + 判定条件 + CP），方便回看「我当时为什么拿到它」。
 *
 * 注意「只显示名称」**不等于整条不渲染**：未获得的条目仍然占位（含家族进度里的
 * 分母），否则「还有多少没集齐」这个驱动力本身就看不见了。
 *
 * ── 已收集集合的口径（最容易搞错的一点）─────────────────────────────────────
 *
 * `HistoryItem.badgeIds` 是**当天全部命中的徽章 id，含被「同类更强」（`group`）
 * 取代的那些**。被取代只意味着「不重复加分」，**不意味着没拿到**——玩家确实抽中了
 * 那枚徽章，图鉴必须把它算作已收集。所以这里的收集集合是
 * **所有历史条目的 `badgeIds` 取并集**，不做任何 group / 取代过滤。
 * 用 `restoreScore` 去重会把 `supersededBadges` 当成未获得，是错的（见测试）。
 *
 * 数据源**复用 `useHistory()`**（本地 / 登录双模式 + 缓存 + 401 回退都在那里），
 * 这里不重复实现任何历史获取逻辑。
 */
import { computed, type ComputedRef } from 'vue';
import { allBadges, type Badge, type Family } from '@huedle/shared';
import { FAMILY_ORDER } from '../lib/families';
import { useHistory } from './useHistory';

export interface FamilyProgress {
  family: Family;
  total: number;
  collected: number;
}

/** 徽章清单按固定家族顺序分组；模块级常量，不随组件实例重建。 */
const BADGES_BY_FAMILY: { family: Family; badges: Badge[] }[] = FAMILY_ORDER.map(family => ({
  family,
  badges: allBadges.filter(badge => badge.family === family),
}));

export interface UseBadges {
  /** 各家族进度，顺序即 {@link FAMILY_ORDER}（未收集的家族同样出现，`collected` 为 0）。 */
  families: ComputedRef<FamilyProgress[]>;
  /** 已收集徽章数（只数 `allBadges` 里真实存在的 id）。 */
  totalCollected: ComputedRef<number>;
  /** 图鉴总数（= `allBadges.length`）。 */
  totalCount: ComputedRef<number>;
  /** 某个徽章 id 是否已收集（口径 = 全部历史 `badgeIds` 的并集，含被取代的）。 */
  isCollected: (id: string) => boolean;
  /** 全部徽章，按固定家族顺序分组，未收集的也在。 */
  badgesByFamily: ComputedRef<{ family: Family; badges: Badge[] }[]>;
  /** 读取中（只有登录模式的网络请求会为 true）。 */
  isLoading: ComputedRef<boolean>;
  /** 重新读取历史（透传 `useHistory().reload`）。 */
  reload: () => Promise<void>;
}

export function useBadges(): UseBadges {
  const { entries, isLoading, reload } = useHistory();

  /**
   * 已收集 id 集合 = 历史里**所有条目**的 `badgeIds` 的并集（去重）。
   *
   * 刻意不做取代过滤：被 `group` 取代的徽章也在这份集合里（见文件头说明）。
   * 不认识的 id（旧存档 / 脏数据）也收进来，`isCollected` 会如实回答 true——
   * 但计数只走 `allBadges`，所以不可能超过 76。
   */
  const collectedIds = computed<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    for (const entry of entries.value) {
      for (const id of entry.badgeIds) ids.add(id);
    }
    return ids;
  });

  const families = computed<FamilyProgress[]>(() =>
    BADGES_BY_FAMILY.map(({ family, badges }) => ({
      family,
      total: badges.length,
      collected: badges.filter(badge => collectedIds.value.has(badge.id)).length,
    })),
  );

  return {
    families,
    totalCollected: computed(() =>
      families.value.reduce((sum, progress) => sum + progress.collected, 0),
    ),
    totalCount: computed(() => allBadges.length),
    isCollected: (id: string) => collectedIds.value.has(id),
    badgesByFamily: computed(() => BADGES_BY_FAMILY),
    isLoading: computed(() => isLoading.value),
    reload,
  };
}
