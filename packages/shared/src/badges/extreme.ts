// family: extreme — 代表色 #FF0000
/**
 * extreme（极端）家族 —— 全部围绕 0/255 这两条色域边界与总亮度的两个端点展开。
 *
 * 反冗余设计要点（详见 docs/badges/extreme.md 备注）：
 * - 纯黑/纯白是「三通道同时贴住同一边界」，与任何「至少/恰好」型边界条件不同；
 * - 贴地/贴顶两条都显式排除了纯黑/纯白（0 < sum、sum ≤ 764），故与 mythic/epic 两条不构成蕴含；
 * - 双极贯通与双峰满值、贴顶余晖之间只是少量颜色重叠，任一都不是另一的子集。
 */
import type { BadgeDef, ColorInfo } from '../types';
import { channelSum, maxChannel, minChannel } from './helpers';

// private：三通道中恰为 255 的通道个数，仅本文件内部使用
const fullChannelCount = (c: ColorInfo): number =>
  (c.r === 255 ? 1 : 0) + (c.g === 255 ? 1 : 0) + (c.b === 255 ? 1 : 0);

export const extremeBadges: BadgeDef[] = [
  {
    id: 'extreme-absolute-black',
    name: '绝对零度',
    description: 'R = G = B = 0',
    family: 'extreme',
    check: c => c.r === 0 && c.g === 0 && c.b === 0,
  },
  {
    id: 'extreme-absolute-white',
    name: '白垩尽头',
    description: 'R = G = B = 255',
    family: 'extreme',
    check: c => c.r === 255 && c.g === 255 && c.b === 255,
  },
  {
    id: 'extreme-full-span',
    name: '双极贯通',
    description: '三通道极差 = 255（一个通道为 0，另一个通道为 255）',
    family: 'extreme',
    check: c => maxChannel(c) - minChannel(c) === 255,
  },
  {
    id: 'extreme-dual-max',
    name: '双峰满值',
    description: 'R、G、B 中恰有两个等于 255',
    family: 'extreme',
    check: c => fullChannelCount(c) === 2,
  },
  {
    id: 'extreme-floor-glow',
    name: '贴地微光',
    description: '0 < R + G + B ≤ 15',
    family: 'extreme',
    check: c => channelSum(c) > 0 && channelSum(c) <= 15,
  },
  {
    id: 'extreme-ceiling-glow',
    name: '贴顶余晖',
    description: '750 ≤ R + G + B ≤ 764',
    family: 'extreme',
    check: c => channelSum(c) >= 750 && channelSum(c) <= 764,
  },
    {
    id: 'extreme-single-max',
    name: '单峰满值',
    description: 'R、G、B 中恰好一个等于 255，其余两个都小于 100',
    family: 'extreme',
    check: c => {
      const nums = [c.r, c.g, c.b];
      return (
        nums.filter(v => v === 255).length === 1 &&
        nums.filter(v => v < 100).length === 2
      );
    },
  },
  {
    id: 'extreme-near-span',
    name: '近域全跨',
    description: 'R、G、B 的极差在 240 到 254 之间（含），排除 255',
    family: 'extreme',
    check: c => {
      const span = maxChannel(c) - minChannel(c);
      return span >= 240 && span <= 254;
    },
  },
  {
    id: 'extreme-mid-extreme',
    name: '一低一高',
    description: 'R、G、B 中至少一个 ≤ 15，且至少一个 ≥ 240',
    family: 'extreme',
    check: c => {
      const nums = [c.r, c.g, c.b];
      return nums.some(v => v <= 15) && nums.some(v => v >= 240);
    },
  },
  {
    id: 'extreme-double-low',
    name: '双低同现',
    description: 'R、G、B 中恰好两个 ≤ 10',
    family: 'extreme',
    check: c => [c.r, c.g, c.b].filter(v => v <= 10).length === 2,
  },
];
