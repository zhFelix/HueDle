/**
 * 成就 / 里程碑的推导层（功能②，设计与语义见 docs/NEW-FEATURES.md §2 与 §6）。
 *
 * ── 三条不可动摇的约束 ──────────────────────────────────────────────────────
 *
 * 1. **纯函数**：输入历史，输出成就状态。本文件不读 localStorage、不读时钟。
 *    `today` 由调用方注入（理由见下），因此测试不需要 mock 系统时钟。
 * 2. **不引入任何存储**：成就完全从历史推导。历史是「抽出即定」的冻结数据，
 *    推导结果天然一致；两种模式（本地 / 登录）共用这一份逻辑，也没有
 *    「已有历史要不要回填」的冷启动问题。不要给成就加持久化键。
 * 3. **闩锁（latch）**：里程碑类成就必须「曾经达成过就永远点亮」。因此连续类
 *    用 {@link longestStreak}（历史里最长的那一段），**不是** `computeStreak`
 *    ——后者从今天往回数，今天没抽就返回 0，会让已点亮的成就熄灭。
 *
 * ── `today` 为什么在签名里、却没有任何一条成就在用它 ────────────────────────
 *
 * §6.3 裁决「当前连续不参与任何成就」（#5–7 全部用 `longestStreak`），
 * 所以 v1 的 13 条没有一条依赖「今天」。参数保留是为了将来加入「当前连续」类
 * 成就时不必破坏调用方签名；注入日期而不是读时钟，是 `computeStreak` /
 * `computeHistoryStats` 一脉相承的约定。
 */
import { allBadges, type ScoreRarity } from '@huedle/shared';
import { FAMILY_ORDER } from './families';
import { previousUtcDay, type HistoryItem } from './storage';

export type AchievementKind = 'days' | 'streak' | 'family' | 'badges' | 'rarity';

export type AchievementId =
  | 'days-first'
  | 'days-10'
  | 'days-50'
  | 'days-100'
  | 'streak-3'
  | 'streak-7'
  | 'streak-30'
  | 'family-one'
  | 'family-three'
  | 'badges-10'
  | 'badges-50'
  | 'rarity-anomaly-first'
  | 'rarity-mythic-first';

/** 成就定义：id / 名称 / 类别 / 进度分母。`kind` 决定 UI 的进度单位与文案（§2.6）。 */
export interface AchievementDef {
  id: AchievementId;
  /** 中文展示名（§2.4）。 */
  name: string;
  kind: AchievementKind;
  /** 进度分母（达到即点亮）。 */
  target: number;
  /** 仅 `rarity` 类使用：命中的**抽取**稀有度档位（`entry.rarity`，不是徽章稀有度）。 */
  rarity?: ScoreRarity;
}

/** 一条成就的推导结果。 */
export interface AchievementState extends AchievementDef {
  unlocked: boolean;
  /** 谓词第一次为真的历史日期；未点亮为 `null`（§6.3）。 */
  unlockedAt: string | null;
  /** 进度值，已封顶到 `target`（未点亮时必然 `< target`）。 */
  progress: number;
}

/**
 * v1 的 13 条成就（§2.4）。顺序即 UI 展示顺序（同日多条无法排序，见 A6）。
 *
 * 数量刻意封顶在 13 条：一个手机屏幕能看完的量级；再膨胀就从「回看我的轨迹」
 * 变成「又一个没做完的清单」。
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'days-first', name: '第一天', kind: 'days', target: 1 },
  { id: 'days-10', name: '十日', kind: 'days', target: 10 },
  { id: 'days-50', name: '五十日', kind: 'days', target: 50 },
  { id: 'days-100', name: '百日', kind: 'days', target: 100 },
  { id: 'streak-3', name: '三连', kind: 'streak', target: 3 },
  { id: 'streak-7', name: '七日不辍', kind: 'streak', target: 7 },
  { id: 'streak-30', name: '三十日', kind: 'streak', target: 30 },
  { id: 'family-one', name: '圆满一家', kind: 'family', target: 1 },
  { id: 'family-three', name: '三族圆满', kind: 'family', target: 3 },
  { id: 'badges-10', name: '十枚徽章', kind: 'badges', target: 10 },
  { id: 'badges-50', name: '五十枚徽章', kind: 'badges', target: 50 },
  { id: 'rarity-anomaly-first', name: '初见异常', kind: 'rarity', target: 1, rarity: 'anomaly' },
  { id: 'rarity-mythic-first', name: '初见神话', kind: 'rarity', target: 1, rarity: 'mythic' },
] as const;

/**
 * 各家族的**当前**成员 id（模块级常量，不随组件实例重建）。
 *
 * ⚠️ **已知且接受的行为：家族集齐的分母用「当前徽章表」。**
 * 如果明天给某个家族新增一条徽章，昨天点亮的「圆满一家 / 三族圆满」会回到未点亮。
 * 这不是 bug——冻结基线需要新增一份存储（与「成就完全从历史推导、不写新本地键」
 * 冲突），所以选择接受「扩表会熄灭」。**不要为了消掉它而给成就加持久化。**
 */
const FAMILY_MEMBER_IDS: readonly (readonly string[])[] = FAMILY_ORDER.map(family =>
  allBadges.filter(badge => badge.family === family).map(badge => badge.id),
);

/** 全部真实徽章 id（计数以它为准：存档里已删除的 id 不算数，与图鉴同口径）。 */
const ALL_BADGE_IDS: readonly string[] = allBadges.map(badge => badge.id);

/** 去重后的日期数（§6.1 的 `days`）。 */
export function countDistinctDays(entries: readonly HistoryItem[]): number {
  return new Set(entries.map(entry => entry.date)).size;
}

/**
 * 已收集 id 集合 = 全部历史 `badgeIds` 的并集，**不过滤取代**。
 *
 * 与 `useBadges.ts` 第 68–74 行逐字同口径：被 `group` 取代的徽章也是「拿到了」。
 * 不认识的 id（旧存档 / 脏数据）同样收进来，但计数会走 `allBadges`，不会虚高。
 */
export function collectBadgeIds(entries: readonly HistoryItem[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const id of entry.badgeIds) ids.add(id);
  }
  return ids;
}

/** 已收集徽章数（只数 `allBadges` 里真实存在的 id）。 */
export function countCollectedBadges(collected: ReadonlySet<string>): number {
  let count = 0;
  for (const id of ALL_BADGE_IDS) {
    if (collected.has(id)) count += 1;
  }
  return count;
}

/** 已集齐的家族数（每个家族的成员 id 全部落在 `collected` 里才算一个）。 */
export function countCompleteFamilies(collected: ReadonlySet<string>): number {
  let count = 0;
  for (const memberIds of FAMILY_MEMBER_IDS) {
    if (memberIds.length > 0 && memberIds.every(id => collected.has(id))) count += 1;
  }
  return count;
}

/**
 * 历史里**最长**的连续 UTC 日期段长度（§6.2）。
 *
 * 与 `computeStreak(history, today)` 的区别：后者锚在「今天」上，今天没抽就是 0；
 * 本函数看的是整段历史的**曾经最长**，断签后不会回退。
 *
 * 日期算术复用 `storage.ts` 导出的 {@link previousUtcDay}（`Date.UTC ± 1 天`），
 * 不自己写 `new Date` 本地加减——那会踩夏令时，导致跨切换日时相邻两天被判成不连续。
 * 空历史 → 0；重复日期先去重（`loadHistory` 已保证唯一，但函数不假设）。
 */
export function longestStreak(entries: readonly HistoryItem[]): number {
  const days = [...new Set(entries.map(entry => entry.date))].sort();

  let best = 0;
  let run = 0;
  let previous: string | null = null;

  for (const day of days) {
    run = previous !== null && previousUtcDay(day) === previous ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }

  return best;
}

/** 按日期升序去重；同日多条取**先出现**的那条（与 `loadHistory` 同口径，§6.4 A4）。 */
function uniqueEntriesByDateAscending(entries: readonly HistoryItem[]): HistoryItem[] {
  const byDate = new Map<string, HistoryItem>();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 推导全部成就状态（§6.1 / §6.3）。
 *
 * `unlockedAt` = 按日期升序扫描时谓词第一次为真的那一天：
 * - 天数类：第 `target` 个不同日期的日期；
 * - 连续类：某个连续段的**结束日**，且该段长度首次达到 `target`（不是段中间那天）；
 * - 家族 / 徽章类：累计计数首次达到 `target` 的那一天；
 * - 稀有度类：第一条 `entry.rarity` 匹配的记录的日期。
 */
export function deriveAchievements(
  entries: readonly HistoryItem[],
  today?: string,
): AchievementState[] {
  // v1 没有任何一条成就依赖「今天」（连续类全部走 longestStreak 闩锁）。
  // 显式读一次，既说明这是有意的保留参数，也满足 noUnusedParameters。
  void today;

  const ordered = uniqueEntriesByDateAscending(entries);
  const collected = new Set<string>();
  const unlockedAt = new Map<AchievementId, string>();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;

  let dayCount = 0;

  for (const entry of ordered) {
    dayCount += 1;
    for (const id of entry.badgeIds) collected.add(id);

    run = previous !== null && previousUtcDay(entry.date) === previous ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = entry.date;

    const badgeCount = countCollectedBadges(collected);
    const familyCount = countCompleteFamilies(collected);

    for (const def of ACHIEVEMENTS) {
      if (unlockedAt.has(def.id)) continue;

      let value: number;
      switch (def.kind) {
        case 'days':
          value = dayCount;
          break;
        case 'streak':
          value = run;
          break;
        case 'family':
          value = familyCount;
          break;
        case 'badges':
          value = badgeCount;
          break;
        case 'rarity':
          value = entry.rarity === def.rarity ? 1 : 0;
          break;
      }

      if (value >= def.target) unlockedAt.set(def.id, entry.date);
    }
  }

  const finalValues: Record<AchievementKind, number> = {
    days: ordered.length,
    streak: longest,
    family: countCompleteFamilies(collected),
    badges: countCollectedBadges(collected),
    // 稀有度类没有「部分进度」：0 或 1，由 unlockedAt 决定。
    rarity: 0,
  };

  return ACHIEVEMENTS.map(def => {
    const at = unlockedAt.get(def.id) ?? null;
    const raw = def.kind === 'rarity' ? (at === null ? 0 : 1) : finalValues[def.kind];
    return {
      ...def,
      unlocked: at !== null,
      unlockedAt: at,
      progress: Math.min(raw, def.target),
    };
  });
}

/**
 * 未点亮成就的进度文案（§2.6）：
 * - 连续类 `N / target 天`；
 * - 天数 / 徽章 / 家族类 `N / target`；
 * - 布尔（稀有度）类 `还差一点`——「0 / 1」会读成还差一次操作，而它其实是纯运气。
 */
export function formatProgress(state: AchievementState): string {
  if (state.unlocked) return '';
  if (state.kind === 'rarity') return '还差一点';
  const unit = state.kind === 'streak' ? ' 天' : '';
  return `${state.progress} / ${state.target}${unit}`;
}

/** 进度条的百分比（0–100 整数；已点亮恒为 100）。 */
export function progressPercent(state: AchievementState): number {
  if (state.target <= 0) return 0;
  return Math.min(100, Math.round((state.progress / state.target) * 100));
}
