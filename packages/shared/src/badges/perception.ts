// family: perception — 代表色 #FF6600
import type { BadgeDef } from '../types';

/**
 * 感知家族：人类视觉对颜色「观感」的维度（明暗、饱和、色相区间）。
 * 全部基于 ColorInfo.hsl（h∈[0,360)，s/l∈[0,100]），阈值即 description 中写死的常量。
 */
export const perceptionBadges: BadgeDef[] = [
  {
    id: 'perception-night-owl',
    name: '暗夜低语',
    description: '亮度 ≤ 12 且饱和度 ≤ 25',
    family: 'perception',
    check: color => color.hsl.l <= 12 && color.hsl.s <= 25,
  },
  {
    id: 'perception-daylight',
    name: '炽白之昼',
    description: '亮度 ≥ 90',
    family: 'perception',
    check: color => color.hsl.l >= 90,
  },
  {
    id: 'perception-lime-glow',
    name: '青柠微光',
    description: '色相 75°–105°，饱和度 ≥ 30，亮度 ≥ 20',
    family: 'perception',
    check: color => color.hsl.h >= 75 && color.hsl.h <= 105 && color.hsl.s >= 30 && color.hsl.l >= 20,
  },
  {
    id: 'perception-teal-breath',
    name: '青绿之息',
    description: '色相 160°–200°，饱和度 ≥ 30，亮度 ≥ 20',
    family: 'perception',
    check: color => color.hsl.h >= 160 && color.hsl.h <= 200 && color.hsl.s >= 30 && color.hsl.l >= 20,
  },
  {
    id: 'perception-misty',
    name: '雾面感',
    description: '饱和度 ≤ 10，亮度 30–70',
    family: 'perception',
    check: color => color.hsl.s <= 10 && color.hsl.l >= 30 && color.hsl.l <= 70,
  },
  {
    id: 'perception-violet-dream',
    name: '紫罗兰梦',
    description: '色相 265°–295°，饱和度 ≥ 30，亮度 ≥ 15',
    family: 'perception',
    check: color => color.hsl.h >= 265 && color.hsl.h <= 295 && color.hsl.s >= 30 && color.hsl.l >= 15,
  },
  {
    id: 'perception-neon-alarm',
    name: '霓虹警报',
    description: '饱和度 ≥ 85，亮度 35–65',
    family: 'perception',
    check: color => color.hsl.s >= 85 && color.hsl.l >= 35 && color.hsl.l <= 65,
  },
  {
    id: 'perception-void-paradox',
    name: '虚空悖论',
    description: '亮度 ≤ 12 且饱和度 ≥ 95——极暗，却近乎全饱和',
    family: 'perception',
    check: color => color.hsl.l <= 12 && color.hsl.s >= 95,
  },
];
