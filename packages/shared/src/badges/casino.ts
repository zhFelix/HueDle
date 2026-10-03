// family: casino — 代表色 #C8102E
import type { BadgeDef, ColorInfo } from '../types';

/**
 * casino（牌型）家族 —— 把 `ColorInfo.hex` 的 **6 个十六进制字符**当作 6 张牌，
 * 点数 `0–F`（16 种），按**字符出现次数**判扑克牌型。
 *
 * 维度：计数 / 组合（与 pattern 家族的「位置 / 相邻」维度正交）。
 *
 * 关键设计：牌型天然嵌套（六条 ⊂ 五条 ⊂ 四条 ⊂ 三条 ⊂ 至少一对），
 * 因此同一条链上的成员一律写成**「至少型」条件**并归入同一 `group`，
 * 由引擎取最高 CP 的一条计分，而**不**把条件掰成互斥的「恰好型」。
 * 详见 docs/badges/casino.md 的 group 一览表。
 */

/** 点数个数（0–F 共 16 种）。 */
const RANK_SPACE = 16;

/**
 * 解析 hex 的 6 个字符为点数数组。
 * 契约保证 `hex` 为大写、带 `#`、恒 7 字符；非法输入返回 `null`（不抛异常）。
 */
// private
const parseRanks = (color: ColorInfo): number[] | null => {
  const chars = color.hex.slice(1).toUpperCase();
  if (chars.length !== 6) return null;
  const ranks: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const value = parseInt(chars[i], 16);
    if (!Number.isInteger(value) || value < 0 || value >= RANK_SPACE) return null;
    ranks.push(value);
  }
  return ranks;
};

/** 各点数出现次数（长度 16 的计数表）；非法 hex 返回 `null`。 */
// private
const rankCounts = (color: ColorInfo): number[] | null => {
  const ranks = parseRanks(color);
  if (ranks === null) return null;
  const counts: number[] = new Array<number>(RANK_SPACE).fill(0);
  for (let i = 0; i < ranks.length; i += 1) counts[ranks[i]] += 1;
  return counts;
};

/** 以点数为参数的判定包装：非法 hex 一律不命中。 */
// private
const onRanks = (color: ColorInfo, test: (counts: number[]) => boolean): boolean => {
  const counts = rankCounts(color);
  return counts !== null && test(counts);
};

/** 出现次数 ≥ n 的点数种类数。 */
// private
const ranksAtLeast = (counts: number[], n: number): number => {
  let found = 0;
  for (let i = 0; i < counts.length; i += 1) if (counts[i] >= n) found += 1;
  return found;
};

/** 从 `start` 起连续 `length` 个点数是否全部至少出现一次。 */
// private
const hasRankRunAt = (counts: number[], start: number, length: number): boolean => {
  if (start < 0 || start + length > RANK_SPACE) return false;
  for (let offset = 0; offset < length; offset += 1) {
    if (counts[start + offset] === 0) return false;
  }
  return true;
};

/** 是否存在 `length` 个**连续点数额**（start…start+length−1）全部至少出现一次。 */
// private
const hasRankRun = (counts: number[], length: number): boolean => {
  for (let start = 0; start + length <= RANK_SPACE; start += 1) {
    if (hasRankRunAt(counts, start, length)) return true;
  }
  return false;
};

/** 落在「低半花色」0–7 的点数个数。 */
// private
const lowSuitCount = (counts: number[]): number => {
  let low = 0;
  for (let i = 0; i < 8; i += 1) low += counts[i];
  return low;
};

export const casinoBadges: BadgeDef[] = [
  // ───────────────────────── group: casino-rank-count ─────────────────────────
  // 链：六条 ⊂ 五条 ⊂ 四条 ⊂ 三条 ⊂ 至少一对；葫芦 ⊂ 三条 且 葫芦 ⊂ 两对；
  //     三对 ⊂ 两对 ⊂ 至少一对。全部为「至少型」，由引擎在同组内取最高 CP。
  {
    id: 'casino-pair',
    name: '起手对子',
    description: 'HEX 的 6 个字符中至少有一对相同',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 2) >= 1),
  },
  {
    id: 'casino-two-pair',
    name: '双对临门',
    description: 'HEX 的 6 个字符中至少有 2 种点数各出现至少 2 次',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 2) >= 2),
  },
  {
    id: 'casino-triple-pair',
    name: '三对连环',
    description: 'HEX 的 6 个字符中至少有 3 种点数各出现至少 2 次',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 2) >= 3),
  },
  {
    id: 'casino-three-kind',
    name: '三条鼎立',
    description: 'HEX 的 6 个字符中至少有一种点数出现至少 3 次',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 3) >= 1),
  },
  {
    id: 'casino-full-house',
    name: '葫芦满堂',
    description:
      'HEX 的 6 个字符中至少有一种点数出现至少 3 次，且另有至少一种点数出现至少 2 次',
    family: 'casino',
    group: 'casino-rank-count',
    check: color =>
      onRanks(color, counts => ranksAtLeast(counts, 3) >= 1 && ranksAtLeast(counts, 2) >= 2),
  },
  {
    id: 'casino-four-kind',
    name: '四条压阵',
    description: 'HEX 的 6 个字符中至少有一种点数出现至少 4 次',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 4) >= 1),
  },
  {
    id: 'casino-five-kind',
    name: '五条通天',
    description: 'HEX 的 6 个字符中至少有一种点数出现至少 5 次',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 5) >= 1),
  },
  {
    id: 'casino-six-kind',
    name: '六条同辉',
    description: 'HEX 的 6 个字符全部相同',
    family: 'casino',
    group: 'casino-rank-count',
    check: color => onRanks(color, counts => ranksAtLeast(counts, 6) >= 1),
  },

  // ───────────────────────── group: casino-sequence ─────────────────────────
  // 链：皇家同花顺 ⊂ 六连顺 ⊂ 五连顺。同样是「至少型」。
  {
    id: 'casino-straight',
    name: '五连顺',
    description: 'HEX 的 6 个字符中存在 5 个互不相同的点数，其点数恰为 5 个连续整数',
    family: 'casino',
    group: 'casino-sequence',
    check: color => onRanks(color, counts => hasRankRun(counts, 5)),
  },
  {
    id: 'casino-straight-six',
    name: '六连顺',
    description: 'HEX 的 6 个字符两两不同，且其点数恰为 6 个连续整数',
    family: 'casino',
    group: 'casino-sequence',
    check: color => onRanks(color, counts => hasRankRun(counts, 6)),
  },
  {
    id: 'casino-royal',
    name: '皇家同花顺',
    description: 'HEX 的 6 个字符恰为 A、B、C、D、E、F 各一次（点数 10–15 的六连顺）',
    family: 'casino',
    group: 'casino-sequence',
    check: color => onRanks(color, counts => hasRankRunAt(counts, 10, 6)),
  },

  // ───────────────────────── 无 group：花色维度 ─────────────────────────
  {
    id: 'casino-flush',
    name: '同花',
    description: 'HEX 的 6 个字符全部落在 0–7（低半花色），或全部落在 8–F（高半花色）',
    family: 'casino',
    check: color =>
      onRanks(color, counts => {
        const low = lowSuitCount(counts);
        return low === 6 || low === 0;
      }),
  },
];
