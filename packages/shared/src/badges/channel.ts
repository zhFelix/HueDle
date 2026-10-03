// family: channel — 代表色 #00FF00
import type { BadgeDef } from '../types';
import { maxChannel, minChannel } from './helpers';

/**
 * channel（通道）家族：玩通道之间的「序」与「值域」，而非颜色本身。
 *
 * 刻意避开 gray 家族的 R = G = B（本家族没有任何「三通道全同」条件）。
 * 家族内五条常规徽章分属四个互不包含的维度：
 *  - 严格递减序（R > G > B）与严格递增序（R < G < B）互斥；
 *  - 全局高值域（全部 ≥ 128）与全局低值域（全部 ≤ 127）互斥；
 *  - 双通道相等且第三通道严格更大的「双峰」条件（含相等，与全异序互斥）。
 * 维度之间可以部分重叠，但没有一条的命中集合是另一条的子集。
 */
export const channelBadges: BadgeDef[] = [
  {
    id: 'channel-descending',
    name: '递减序',
    description: 'R > G 且 G > B',
    family: 'channel',
    check: color => color.r > color.g && color.g > color.b,
  },
  {
    id: 'channel-ascending',
    name: '递增序',
    description: 'R < G 且 G < B',
    family: 'channel',
    check: color => color.r < color.g && color.g < color.b,
  },
  {
    id: 'channel-all-high',
    name: '高值通道',
    description: 'R ≥ 128 且 G ≥ 128 且 B ≥ 128',
    family: 'channel',
    check: color => color.r >= 128 && color.g >= 128 && color.b >= 128,
  },
  {
    id: 'channel-all-low',
    name: '低值通道',
    description: 'R ≤ 127 且 G ≤ 127 且 B ≤ 127',
    family: 'channel',
    check: color => color.r <= 127 && color.g <= 127 && color.b <= 127,
  },
  {
    id: 'channel-twin-high',
    name: '双峰突起',
    description:
      'R = G 且 R > 0 且 B > R，或 G = B 且 G > 0 且 R > G，或 R = B 且 R > 0 且 G > R',
    family: 'channel',
    check: color =>
      (color.r === color.g && color.r > 0 && color.b > color.r) ||
      (color.g === color.b && color.g > 0 && color.r > color.g) ||
      (color.r === color.b && color.r > 0 && color.g > color.r),
  },
  {
    id: 'channel-extreme-shift',
    name: '极值错位',
    description: 'R = 255 且 G = 0 且 B = 128',
    family: 'channel',
    check: color => color.r === 255 && color.g === 0 && color.b === 128,
  },
    {
    id: 'channel-tight-spread',
    name: '通道紧密',
    description: 'R、G、B 三数的最大值与最小值之差不超过 10',
    family: 'channel',
    check: c => maxChannel(c) - minChannel(c) <= 10,
  },
  {
    id: 'channel-wide-spread',
    name: '通道广域',
    description: 'R、G、B 三数的最大值与最小值之差至少为 240',
    family: 'channel',
    check: c => maxChannel(c) - minChannel(c) >= 240,
  },
  {
    id: 'channel-mid-only',
    name: '中间地带',
    description: 'R、G、B 三数全部落在 100 到 150 之间（含）',
    family: 'channel',
    check: c =>
      c.r >= 100 && c.r <= 150 &&
      c.g >= 100 && c.g <= 150 &&
      c.b >= 100 && c.b <= 150,
  },
  {
    id: 'channel-far-apart',
    name: '双峰远隔',
    description: 'R、G、B 中最大值与最小值之差至少为 200，且相邻排序差都小于 200',
    family: 'channel',
    check: c => {
      const nums = [c.r, c.g, c.b].sort((a, b) => a - b);
      return (
        nums[2] - nums[0] >= 200 &&
        nums[1] - nums[0] < 200 &&
        nums[2] - nums[1] < 200
      );
    },
  },
  {
    id: 'channel-three-peaks',
    name: '三峰齐高',
    description: 'R、G、B 三数全部大于 200',
    family: 'channel',
    check: c => c.r > 200 && c.g > 200 && c.b > 200,
  },
];
