/**
 * ⚠️ **本文件由脚本自动生成，请勿手改。**
 *
 * 生成命令：`pnpm -C packages/shared run enumerate`
 * 契约：docs/PRICING-SPEC.md 第 2/3/5 节；快照报告：docs/research/PRICING-CURRENT.md。
 *
 * 每条徽章的 `hits` 是 2²⁴ 全色域精确枚举值，`ep = 100 * 2²⁴ / hits`（整数、四舍五入），
 * `rarity` 由 `ep` 按十进制分档导出。同 `hits` 必然同 `ep`。
 */
import type { BadgeRarity } from './types';

export interface BadgePricing {
  /** 全色域 2²⁴ = 16,777,216 个颜色中的精确命中数。 */
  hits: number;
  /** 期望点数 `ep = 100 * 2²⁴ / hits`（精确值，**不取整**：取整会让分位表与实际分布失配）。 */
  ep: number;
  /** 由 `ep` 导出的徽章稀有度（PRICING-SPEC 第 3 节）。 */
  rarity: BadgeRarity;
}

/** 徽章定价表，按 id 升序（确定性输出）。 */
export const PRICING: Record<string, BadgePricing> = {
  'casino-extreme-flush': { hits: 8192, ep: 204800, rarity: 'epic' },
  'casino-five-kind': { hits: 1456, ep: 1152281.3186813188, rarity: 'anomaly' },
  'casino-flush': { hits: 524288, ep: 3200, rarity: 'uncommon' },
  'casino-four-kind': { hits: 55456, ep: 30253.202538949798, rarity: 'rare' },
  'casino-four-two': { hits: 3600, ep: 466033.77777777775, rarity: 'epic' },
  'casino-full-house': { hits: 207600, ep: 8081.510597302505, rarity: 'uncommon' },
  'casino-pair': { hits: 11011456, ep: 152.36146791123716, rarity: 'common' },
  'casino-royal': { hits: 720, ep: 2330168.888888889, rarity: 'anomaly' },
  'casino-six-kind': { hits: 16, ep: 104857600, rarity: 'mythic' },
  'casino-straight': { hits: 108720, ep: 15431.58204562178, rarity: 'rare' },
  'casino-straight-pair': { hits: 21600, ep: 77672.29629629629, rarity: 'rare' },
  'casino-straight-six': { hits: 7920, ep: 211833.53535353535, rarity: 'epic' },
  'casino-three-kind': { hits: 1133056, ep: 1480.7049254405783, rarity: 'uncommon' },
  'casino-three-three': { hits: 2400, ep: 699050.6666666666, rarity: 'epic' },
  'casino-triple-pair': { hits: 50400, ep: 33288.12698412698, rarity: 'rare' },
  'casino-two-pair': { hits: 2223600, ep: 754.5069257060622, rarity: 'common' },
  'channel-all-high': { hits: 2097152, ep: 800, rarity: 'common' },
  'channel-all-low': { hits: 2097152, ep: 800, rarity: 'common' },
  'channel-ascending': { hits: 2763520, ep: 607.0958777211672, rarity: 'common' },
  'channel-descending': { hits: 2763520, ep: 607.0958777211672, rarity: 'common' },
  'channel-extreme-shift': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'channel-far-apart': { hits: 1730064, ep: 969.7453967020873, rarity: 'common' },
  'channel-mid-only': { hits: 132651, ep: 12647.636278656022, rarity: 'rare' },
  'channel-three-peaks': { hits: 166375, ep: 10083.976558978213, rarity: 'rare' },
  'channel-tight-spread': { hits: 82426, ep: 20354.276563220345, rarity: 'rare' },
  'channel-twin-high': { hits: 97155, ep: 17268.504966290977, rarity: 'rare' },
  'channel-wide-spread': { hits: 199920, ep: 8391.964785914366, rarity: 'uncommon' },
  'culture-bamboo-green': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-discord-blurple': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-facebook-blue': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-instagram-pink': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-klein-blue': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-marrs-green': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-prussian-blue': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-rouge': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-spotify-green': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-tiffany-blue': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-tiktok-pink': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-titian-red': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-van-gogh-blue': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-whatsapp-green': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'culture-youtube-red': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'extreme-absolute-black': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'extreme-absolute-white': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'extreme-ceiling-glow': { hits: 815, ep: 2058554.1104294478, rarity: 'anomaly' },
  'extreme-double-low': { hits: 88935, ep: 18864.58199808849, rarity: 'rare' },
  'extreme-dual-max': { hits: 765, ep: 2193100.1307189544, rarity: 'anomaly' },
  'extreme-floor-glow': { hits: 815, ep: 2058554.1104294478, rarity: 'anomaly' },
  'extreme-full-span': { hits: 1530, ep: 1096550.0653594772, rarity: 'anomaly' },
  'extreme-mid-extreme': { hits: 368640, ep: 4551.111111111111, rarity: 'uncommon' },
  'extreme-near-span': { hits: 198390, ep: 8456.684308684913, rarity: 'uncommon' },
  'extreme-single-max': { hits: 30000, ep: 55924.05333333334, rarity: 'rare' },
  'gray-binary-power': { hits: 8, ep: 209715200, rarity: 'mythic' },
  'gray-core-echo': { hits: 18, ep: 93206755.55555555, rarity: 'mythic' },
  'gray-frost-zone': { hits: 1345, ep: 1247376.654275093, rarity: 'anomaly' },
  'gray-mid-zone': { hits: 393, ep: 4269011.704834606, rarity: 'anomaly' },
  'gray-multiple-16': { hits: 16, ep: 104857600, rarity: 'mythic' },
  'gray-near-neutral': { hits: 4578, ep: 366474.7924858017, rarity: 'epic' },
  'gray-palindrome': { hits: 35, ep: 47934902.85714286, rarity: 'mythic' },
  'gray-prime': { hits: 54, ep: 31068918.51851852, rarity: 'mythic' },
  'gray-shadow-zone': { hits: 1345, ep: 1247376.654275093, rarity: 'anomaly' },
  'gray-true-monochrome': { hits: 256, ep: 6553600, rarity: 'anomaly' },
  'lucky-avoid-four': { hits: 634145, ep: 2645.6435042458743, rarity: 'uncommon' },
  'lucky-golden-tone': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'lucky-sum-520': { hits: 30381, ep: 55222.724729271584, rarity: 'rare' },
  'lucky-sum-555': { hits: 22366, ep: 75012.14343199499, rarity: 'rare' },
  'lucky-sum-666': { hits: 5050, ep: 332222.099009901, rarity: 'epic' },
  'lucky-tail-double-eight': { hits: 65536, ep: 25600, rarity: 'rare' },
  'lucky-triple-eight': { hits: 15616, ep: 107436.0655737705, rarity: 'epic' },
  'lucky-triple-nine': { hits: 15616, ep: 107436.0655737705, rarity: 'epic' },
  'lucky-triple-seven': { hits: 15616, ep: 107436.0655737705, rarity: 'epic' },
  'lucky-triple-six': { hits: 15616, ep: 107436.0655737705, rarity: 'epic' },
  'math-arithmetic-triad': { hits: 97536, ep: 17201.049868766404, rarity: 'rare' },
  'math-bitwise-or-255': { hits: 5764801, ep: 291.0285368046529, rarity: 'common' },
  'math-catalan-trinity': { hits: 216, ep: 7767229.62962963, rarity: 'anomaly' },
  'math-coprime-trinity': { hits: 13936093, ep: 120.38679707433066, rarity: 'common' },
  'math-digit-sum-equal': { hits: 92542, ep: 18129.29912904411, rarity: 'rare' },
  'math-doubling-ladder': { hits: 18, ep: 93206755.55555555, rarity: 'mythic' },
  'math-fibonacci-trinity': { hits: 2197, ep: 763642.0573509331, rarity: 'epic' },
  'math-palindrome-trinity': { hits: 42875, ep: 39130.53294460641, rarity: 'rare' },
  'math-power-trinity': { hits: 512, ep: 3276800, rarity: 'anomaly' },
  'math-prime-trinity': { hits: 157464, ep: 10654.635980287558, rarity: 'rare' },
  'math-pythagorean-triad': { hits: 1014, ep: 1654557.7909270218, rarity: 'anomaly' },
  'math-square-trinity': { hits: 4096, ep: 409600, rarity: 'epic' },
  'math-sum-255': { hits: 32896, ep: 51000.77821011673, rarity: 'rare' },
  'math-sum-fibonacci': { hits: 106213, ep: 15795.821603758486, rarity: 'rare' },
  'math-sum-perfect-square': { hits: 453595, ep: 3698.7215467542633, rarity: 'uncommon' },
  'math-sum-prime': { hits: 2760769, ep: 607.7008253859703, rarity: 'common' },
  'math-triangular-trinity': { hits: 12167, ep: 137891.1481877209, rarity: 'epic' },
  'pattern-all-distinct': { hits: 5765760, ep: 290.980130980131, rarity: 'common' },
  'pattern-alternating': { hits: 240, ep: 6990506.666666667, rarity: 'anomaly' },
  'pattern-digit-only': { hits: 1000000, ep: 1677.7216, rarity: 'uncommon' },
  'pattern-double-blocks': { hits: 4096, ep: 409600, rarity: 'epic' },
  'pattern-echo': { hits: 4627216, ep: 362.5768928876456, rarity: 'common' },
  'pattern-even-glyphs': { hits: 262144, ep: 6400, rarity: 'uncommon' },
  'pattern-falling-strict': { hits: 8008, ep: 209505.6943056943, rarity: 'epic' },
  'pattern-half-loop': { hits: 4096, ep: 409600, rarity: 'epic' },
  'pattern-mirror-bytes': { hits: 65536, ep: 25600, rarity: 'rare' },
  'pattern-no-triple': { hits: 15644160, ep: 107.24267713958436, rarity: 'common' },
  'pattern-odd-glyphs': { hits: 262144, ep: 6400, rarity: 'uncommon' },
  'pattern-palindrome-loop': { hits: 4096, ep: 409600, rarity: 'epic' },
  'pattern-rising-strict': { hits: 8008, ep: 209505.6943056943, rarity: 'epic' },
  'pattern-triple-blocks': { hits: 240, ep: 6990506.666666667, rarity: 'anomaly' },
  'pattern-twin-peaks': { hits: 195840, ep: 8566.797385620916, rarity: 'uncommon' },
  'perception-cool-tone': { hits: 4218071, ep: 397.74617354710244, rarity: 'common' },
  'perception-daylight': { hits: 70604, ep: 23762.415727154268, rarity: 'rare' },
  'perception-deep-jewel': { hits: 3264126, ep: 513.9880016886603, rarity: 'common' },
  'perception-lime-glow': { hits: 1237437, ep: 1355.8036489938477, rarity: 'uncommon' },
  'perception-misty': { hits: 130476, ep: 12858.468990465679, rarity: 'rare' },
  'perception-neon-alarm': { hits: 3123048, ep: 537.2064726510768, rarity: 'common' },
  'perception-night-owl': { hits: 7387, ep: 227118.1264383376, rarity: 'epic' },
  'perception-pastel': { hits: 213318, ep: 7864.88528863012, rarity: 'uncommon' },
  'perception-teal-breath': { hits: 1650637, ep: 1016.4085743867367, rarity: 'uncommon' },
  'perception-violet-dream': { hits: 1257769, ep: 1333.8869061011999, rarity: 'uncommon' },
  'perception-void-paradox': { hits: 17748, ep: 94530.17804823078, rarity: 'rare' },
  'perception-warm-tone': { hits: 5625216, ep: 298.25016497144287, rarity: 'common' },
  'pure-cyan-twin': { hits: 255, ep: 6579300.392156863, rarity: 'anomaly' },
  'pure-dim-blue': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'pure-dim-green': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'pure-dim-red': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'pure-dim-yellow': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'pure-magenta-full': { hits: 1, ep: 1677721600, rarity: 'mythic' },
  'pure-only-blue': { hits: 255, ep: 6579300.392156863, rarity: 'anomaly' },
  'pure-only-green': { hits: 255, ep: 6579300.392156863, rarity: 'anomaly' },
  'pure-only-red': { hits: 255, ep: 6579300.392156863, rarity: 'anomaly' },
  'pure-yellow-twin': { hits: 255, ep: 6579300.392156863, rarity: 'anomaly' },
};

/** 总分分布的分位点（最近秩法，P 分位 = 升序第 ⌈P/100 · N⌉ 个）。 */
export const SCORE_QUANTILES: {
  p1: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
} = {
  p1: 379.9909421251522,
  p50: 2323.451656462316,
  p75: 3834.761994154831,
  p90: 12526.940016757278,
  p95: 24922.294540213643,
  p99: 100529.00982819914,
};

/** 生成时的全色域大小，用于校验数据新鲜度。 */
export const GENERATED_AT_TOTAL_COLORS = 16777216;
