/**
 * @huedle/shared 公共入口：类型、颜色转换、判定辅助、全局徽章表。
 */
export type { Badge, BadgeDef, BadgeRarity, ColorInfo, Family, HSL, RGB, ScoreRarity } from './types';

export { colorInfoFromHex, parseHex, rgbToHsl, toColorInfo } from './color';

export {
  channelSum,
  distinctChannelCount,
  digitSum,
  gcd,
  hexBytes,
  isFibonacci,
  isGray,
  isPalindromeNumber,
  isPerfectSquare,
  isPowerOfTwo,
  isPrime,
  lcm,
  maxChannel,
  minChannel,
  toHexByte,
} from './badges/helpers';

export { allBadges } from './badges/index';

export type { Identity } from './seed';
export {
  COLOR_SPACE_SIZE,
  buildSeed,
  fnv1a,
  getDailyColor,
  getDailyColorInfo,
  utcDate,
} from './seed';
export {
  grayBadges,
  extremeBadges,
  pureBadges,
  channelBadges,
  mathBadges,
  perceptionBadges,
  patternBadges,
  cultureBadges,
  luckyBadges,
  casinoBadges,
} from './badges/index';

export type { ScoreResult } from './scoring';
export {
  calculateScore,
  groupBadges,
  partitionByGroup,
  restoreScore,
  scoreRarityFromCp,
} from './scoring';

export type { BadgePricing } from './pricing.gen';
export { GENERATED_AT_TOTAL_COLORS, PRICING, SCORE_QUANTILES } from './pricing.gen';
export {
  EP_TIER_THRESHOLDS,
  SCORE_PERCENTILE_THRESHOLDS,
  TOTAL_COLORS,
  badgeRarityFromEp,
  epFromHits,
  scoreRarityFromPercentile,
} from './pricing';
