/**
 * 计分与稀有度（见 docs/PRICING-SPEC.md）。
 *
 * 计分模型（概率定价）：
 *   1. 所有命中徽章都进入候选；
 *   2. 有 `group` 的徽章，同一 group 只保留 CP 最高的一条（取代 / supersession）；
 *   3. 总 CP = 保留徽章的 CP 之和（每条徽章的 CP 是它自己的 `ep = 100/p`）；
 *   4. 抽取稀有度 = 总分在**全色域分数分布**中的百分位。
 *
 * `family` 不参与计分，只用于图鉴分类。
 */
import type { Badge, ColorInfo, ScoreRarity } from './types';
import { allBadges } from './badges/index';
import { SCORE_QUANTILES } from './pricing.gen';

/** 一次评分的完整结果。 */
export interface ScoreResult {
  /** 全部命中的徽章（按 CP 降序），含被取代的。 */
  badges: Badge[];
  /** 计分保留的徽章（按 CP 降序）。 */
  scoringBadges: Badge[];
  /** 命中但被同 group 更高分取代的徽章。 */
  supersededBadges: Badge[];
  /** 总分。 */
  cp: number;
  /** 由总分的全色域百分位导出的抽取稀有度。 */
  rarity: ScoreRarity;
}

/**
 * 总分 → 抽取稀有度。
 *
 * 分档用的是枚举出的**全色域分位点**，不是拍脑袋的绝对阈值——
 * 这样「神话 = 前 1%」永远成立，徽章表怎么扩都不会失效。
 *
 * **边界归下档**：得分恰好等于某个分位点时，归入**较低**的那个档。
 * 这个约定不是随意的——分数分布底部是一个巨大的并列块
 * （176,788 个颜色都只命中 `casino-pair`，恰好占 1.05%），
 * 若边界归上档，`p1` 就等于最小值，`trash` 会永远为空。
 * 边界归下档让整个并列块整体落入 `trash`，既保住了「同分同档」，
 * 又让最低档真实可达。
 */
export function scoreRarityFromCp(cp: number): ScoreRarity {
  if (cp <= SCORE_QUANTILES.p1) return 'trash';
  if (cp <= SCORE_QUANTILES.p50) return 'common';
  if (cp <= SCORE_QUANTILES.p75) return 'uncommon';
  if (cp <= SCORE_QUANTILES.p90) return 'rare';
  if (cp <= SCORE_QUANTILES.p95) return 'epic';
  if (cp <= SCORE_QUANTILES.p99) return 'anomaly';
  return 'mythic';
}

const byCpDesc = (a: Badge, b: Badge) => b.cp - a.cp || a.id.localeCompare(b.id);

/**
 * 按当前计分规则，把一组命中徽章切成「计分保留」与「被同 group 更高分取代」两部分。
 *
 * 抽出来是因为它有**两个调用方**：实时计分（{@link calculateScore}）与
 * **冻结结果的还原**（{@link restoreScore}）。两者必须用同一份取代逻辑，
 * 否则冻结的存档在展示时会与当时的计分口径分叉。
 */
export function partitionByGroup(hits: Badge[]): {
  scoringBadges: Badge[];
  supersededBadges: Badge[];
} {
  const sorted = [...hits].sort(byCpDesc);
  const bestByGroup = new Map<string, Badge>();
  const scoringBadges: Badge[] = [];
  for (const badge of sorted) {
    if (!badge.group) {
      scoringBadges.push(badge);
      continue;
    }
    const current = bestByGroup.get(badge.group);
    if (!current || badge.cp > current.cp) {
      bestByGroup.set(badge.group, badge);
    }
  }
  scoringBadges.push(...bestByGroup.values());
  scoringBadges.sort(byCpDesc);

  const kept = new Set(scoringBadges);
  return { scoringBadges, supersededBadges: sorted.filter(b => !kept.has(b)) };
}

/**
 * 实时计分。纯函数：不读外部状态、不修改入参。
 *
 * @param color 目标颜色
 * @param badges 徽章表，默认全量；测试中可传入子集
 */
export function calculateScore(color: ColorInfo, badges: Badge[] = allBadges): ScoreResult {
  const hits = badges.filter(b => b.check(color));
  const { scoringBadges, supersededBadges } = partitionByGroup(hits);
  const cp = scoringBadges.reduce((sum, b) => sum + b.cp, 0);
  return {
    badges: [...hits].sort(byCpDesc),
    scoringBadges,
    supersededBadges,
    cp,
    rarity: scoreRarityFromCp(cp),
  };
}

/**
 * 从**冻结的存档**还原展示用的结果。
 *
 * 「抽出即定」的语义：`cp` / `rarity` / 命中集合在首次抽取时就写死了，
 * 之后无论徽章表怎么改（新增徽章、调整 `check`、重跑定价），这一天都不再变。
 *
 * 因此这里**只重建展示结构**，不重跑 `check`、不重算 `cp`：
 * - `cp` / `rarity` 直接用存档值；
 * - 徽章对象按 id 从当前徽章表解析（`name` / `description` 允许随版本更新）；
 * - 取代关系由存档的命中集合按 group 规则推出（与实时计分同一份逻辑）。
 *
 * 存档里已被删除或改名的 id 会被丢弃，但**不影响 `cp`** —— 总分以存档为准。
 */
export function restoreScore(
  hitIds: string[],
  cp: number,
  rarity: ScoreRarity,
  badges: Badge[] = allBadges,
): ScoreResult {
  const byId = new Map(badges.map(b => [b.id, b]));
  const hits = hitIds
    .map(id => byId.get(id))
    .filter((b): b is Badge => b !== undefined);
  const { scoringBadges, supersededBadges } = partitionByGroup(hits);
  return {
    badges: [...hits].sort(byCpDesc),
    scoringBadges,
    supersededBadges,
    cp,
    rarity,
  };
}

/** 按 group 归并徽章，便于审计与图鉴展示。 */
export function groupBadges(badges: Badge[] = allBadges): Map<string, Badge[]> {
  const groups = new Map<string, Badge[]>();
  for (const badge of badges) {
    if (!badge.group) continue;
    const list = groups.get(badge.group) ?? [];
    list.push(badge);
    groups.set(badge.group, list);
  }
  return groups;
}
