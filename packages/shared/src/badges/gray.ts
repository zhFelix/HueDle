// family: gray — 代表色 #808080
/**
 * gray（灰阶）家族 —— 围绕「三通道相等 / 接近相等」这条主轴，
 * 分别在极差维度与明度区间维度上取 6 条互不蕴含的徽章。
 *
 * 反冗余设计要点（详见 docs/badges/gray.md 备注）：
 * - 只有 gray-true-monochrome 以「严格相等」为条件；
 * - 区域类徽章（暗/中/亮）同时容纳严格灰与近灰，因此都不是它的子集；
 * - 近灰窄带要求极差 ≥ 1，因此不包含任何严格灰，不是 gray-true-monochrome 的子集。
 */
import type { BadgeDef, ColorInfo } from '../types';
import { maxChannel, minChannel } from './helpers';

// private：三通道极差（max − min），仅本文件内部使用
const spread = (c: ColorInfo): number => maxChannel(c) - minChannel(c);

export const grayBadges: BadgeDef[] = [
  {
    id: 'gray-true-monochrome',
    name: '灰阶行者',
    description: 'R = G = B',
    family: 'gray',
    check: c => c.r === c.g && c.g === c.b,
  },
  {
    id: 'gray-near-neutral',
    name: '近灰窄带',
    description: '三通道极差为正，且不超过 2',
    family: 'gray',
    check: c => spread(c) > 0 && spread(c) <= 2,
  },
  {
    id: 'gray-shadow-zone',
    name: '幽影灰域',
    description: '三通道极差 ≤ 4，且最大值 ≤ 24',
    family: 'gray',
    check: c => spread(c) <= 4 && maxChannel(c) <= 24,
  },
  {
    id: 'gray-frost-zone',
    name: '霜白灰域',
    description: '三通道极差 ≤ 4，且最小值 ≥ 231',
    family: 'gray',
    check: c => spread(c) <= 4 && minChannel(c) >= 231,
  },
  {
    id: 'gray-mid-zone',
    name: '中庸灰域',
    description: '三通道极差 ≤ 1，且三通道都落在 100–156',
    family: 'gray',
    check: c => spread(c) <= 1 && minChannel(c) >= 100 && maxChannel(c) <= 156,
  },
  {
    id: 'gray-core-echo',
    name: '灰核残响',
    description: '三通道极差 = 3，且最小值 = 128',
    family: 'gray',
    check: c => spread(c) === 3 && minChannel(c) === 128,
  },
];
