/**
 * 概率定价的**纯函数**部分（见 docs/PRICING-SPEC.md 第 2/3/4 节）。
 *
 * 本文件只含公式与阈值，**不含任何实测数据**——数据在自动生成的
 * `pricing.gen.ts` 里。这样公式可以被测试与复用，数据可以随时重算。
 *
 * 两个稀有度是**两套独立的东西**（PRICING-SPEC 第 4.2 节）：
 * - {@link badgeRarityFromEp} ：单条徽章，按 `ep` 的十进制数量级分档；
 * - {@link scoreRarityFromPercentile} ：一次抽取的总分，按**百分位**分档。
 * 不要混用。
 */
import type { BadgeRarity, ScoreRarity } from './types';

/** 全色域大小：24 位真彩色 = 2²⁴ = 16,777,216。 */
export const TOTAL_COLORS = 2 ** 24;

/**
 * 徽章 EP 的十进制分档阈值（PRICING-SPEC 第 3 节）。
 *
 * 语义为**上界（不含）**：`ep < common` → `common`，依此类推，`ep ≥ anomaly` → `mythic`。
 * 阈值本质是关于命中概率 `p` 的，与颜色空间大小无关。
 */
export const EP_TIER_THRESHOLDS = {
  common: 1e3,
  uncommon: 1e4,
  rare: 1e5,
  epic: 1e6,
  anomaly: 1e7,
} as const;

/**
 * 由徽章 EP 导出徽章稀有度。
 *
 * | `ep` 区间 | `BadgeRarity` |
 * |---|---|
 * | `< 10³` | `common` |
 * | `< 10⁴` | `uncommon` |
 * | `< 10⁵` | `rare` |
 * | `< 10⁶` | `epic` |
 * | `< 10⁷` | `anomaly` |
 * | `≥ 10⁷` | `mythic` |
 */
export function badgeRarityFromEp(ep: number): BadgeRarity {
  if (ep < EP_TIER_THRESHOLDS.common) return 'common';
  if (ep < EP_TIER_THRESHOLDS.uncommon) return 'uncommon';
  if (ep < EP_TIER_THRESHOLDS.rare) return 'rare';
  if (ep < EP_TIER_THRESHOLDS.epic) return 'epic';
  if (ep < EP_TIER_THRESHOLDS.anomaly) return 'anomaly';
  return 'mythic';
}

/**
 * 抽取稀有度的百分位阈值（PRICING-SPEC 第 4 节）。
 *
 * 语义为**上界（不含）**：`pct < 1` → `trash`，`pct < 50` → `common`，……，
 * `pct ≥ 99` → `mythic`。百分位以「分布中严格小于该分数的颜色占比（0–100）」计。
 */
export const SCORE_PERCENTILE_THRESHOLDS = {
  trash: 1,
  common: 50,
  uncommon: 75,
  rare: 90,
  epic: 95,
  anomaly: 99,
} as const;

/** 由总分百分位导出抽取稀有度。 */
export function scoreRarityFromPercentile(pct: number): ScoreRarity {
  if (pct < SCORE_PERCENTILE_THRESHOLDS.trash) return 'trash';
  if (pct < SCORE_PERCENTILE_THRESHOLDS.common) return 'common';
  if (pct < SCORE_PERCENTILE_THRESHOLDS.uncommon) return 'uncommon';
  if (pct < SCORE_PERCENTILE_THRESHOLDS.rare) return 'rare';
  if (pct < SCORE_PERCENTILE_THRESHOLDS.epic) return 'epic';
  if (pct < SCORE_PERCENTILE_THRESHOLDS.anomaly) return 'anomaly';
  return 'mythic';
}

/**
 * 命中数 → 期望点数：`ep = 100 / p = 100 * N / hits`（PRICING-SPEC 第 2 节）。
 *
 * `hits === 0` 时返回 `Infinity`：该徽章永不命中，`ep` 无意义。
 * 这是**必须报告的严重问题**（PRICING-SPEC 第 7 节第 3 条），由枚举脚本负责报告。
 */
export function epFromHits(hits: number): number {
  return (100 * TOTAL_COLORS) / hits;
}
