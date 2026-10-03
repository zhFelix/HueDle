// family: pure — 代表色 #FF0000
import type { BadgeDef } from '../types';

/**
 * pure（纯色）家族：单通道点亮、其余通道归零的颜色。
 *
 * 家族内被刻意拆成两个互不包含的维度：
 *  - 单通道族：三个通道各自独占（恰好两个通道为 0）；
 *  - 双通道族：恰好一个通道为 0，另外两个非零且相等（二次色方向）。
 * 这两组的零通道个数不同，命中集合天然互斥，不存在蕴含对子。
 */
export const pureBadges: BadgeDef[] = [
  {
    id: 'pure-only-red',
    name: '唯赤',
    description: 'R > 0 且 G = 0 且 B = 0',
    family: 'pure',
    check: color => color.r > 0 && color.g === 0 && color.b === 0,
  },
  {
    id: 'pure-only-green',
    name: '唯绿',
    description: 'G > 0 且 R = 0 且 B = 0',
    family: 'pure',
    check: color => color.g > 0 && color.r === 0 && color.b === 0,
  },
  {
    id: 'pure-only-blue',
    name: '唯蓝',
    description: 'B > 0 且 R = 0 且 G = 0',
    family: 'pure',
    check: color => color.b > 0 && color.r === 0 && color.g === 0,
  },
  {
    id: 'pure-yellow-twin',
    name: '鹅黄双峰',
    description: 'R = G 且 R > 0 且 B = 0',
    family: 'pure',
    check: color => color.r === color.g && color.r > 0 && color.b === 0,
  },
  {
    id: 'pure-cyan-twin',
    name: '青碧双峰',
    description: 'G = B 且 G > 0 且 R = 0',
    family: 'pure',
    check: color => color.g === color.b && color.g > 0 && color.r === 0,
  },
  {
    id: 'pure-magenta-full',
    name: '品红满值',
    description: 'R = 255 且 G = 0 且 B = 255',
    family: 'pure',
    check: color => color.r === 255 && color.g === 0 && color.b === 255,
  },
];
