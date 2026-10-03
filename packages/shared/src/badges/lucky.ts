// family: lucky — 代表色 #FFD700
import type { BadgeDef } from '../types';
import { channelSum } from './helpers';

/** HEX 的 6 位十六进制数字（去掉前导 `#`），契约保证为大写。 */
// private
const hexDigits = (hex: string): string => hex.slice(1);

/**
 * 判定 6 位十六进制数字中是否出现连续三个相同数字。
 * 用定长 3 字符的**精确全等**比较实现（非正则、非模糊匹配），
 * 覆盖全部 4 个长度为 3 的窗口，允许跨字节边界。
 */
// private
const hasTripleRun = (hex: string, digit: string): boolean => {
  const s = hexDigits(hex);
  const run = digit + digit + digit;
  return s.slice(0, 3) === run || s.slice(1, 4) === run ||
    s.slice(2, 5) === run || s.slice(3, 6) === run;
};

/** 统计某个十六进制数字在 6 位中出现的次数。 */
// private
const countDigit = (hex: string, digit: string): number => {
  const s = hexDigits(hex);
  let count = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === digit) count += 1;
  }
  return count;
};

export const luckyBadges: BadgeDef[] = [
  {
    id: 'lucky-triple-six',
    name: '六六大顺',
    description: 'HEX 的 6 位十六进制数字连写后含连续三个 6',
    family: 'lucky',
    check: color => hasTripleRun(color.hex, '6'),
  },
  {
    id: 'lucky-triple-eight',
    name: '八方来财',
    description: 'HEX 的 6 位十六进制数字连写后含连续三个 8',
    family: 'lucky',
    check: color => hasTripleRun(color.hex, '8'),
  },
  {
    id: 'lucky-tail-double-eight',
    name: '双八压轴',
    description: 'HEX 末两位为 88',
    family: 'lucky',
    check: color => color.b === 0x88,
  },
  {
    id: 'lucky-sum-520',
    name: '五二零同心',
    description: 'R + G + B = 520（「我爱你」的谐音）',
    family: 'lucky',
    check: color => channelSum(color) === 520,
  },
  {
    id: 'lucky-avoid-four',
    name: '避四纳八',
    description: 'HEX 的 6 位十六进制数字中不含 4，且 8 至少出现两次',
    family: 'lucky',
    check: color => countDigit(color.hex, '4') === 0 && countDigit(color.hex, '8') >= 2,
  },
  {
    id: 'lucky-golden-tone',
    name: '金玉满堂',
    description: 'R = 255 且 G = 215 且 B = 0（正金 #FFD700）',
    family: 'lucky',
    check: color => color.r === 255 && color.g === 215 && color.b === 0,
  },
    {
    id: 'lucky-triple-seven',
    name: '七连三',
    description: 'HEX 中包含连续子串 "777"',
    family: 'lucky',
    check: c => c.hex.includes('777'),
  },
  {
    id: 'lucky-triple-nine',
    name: '九九归一',
    description: 'HEX 中包含连续子串 "999"',
    family: 'lucky',
    check: c => c.hex.includes('999'),
  },
  {
    id: 'lucky-sum-555',
    name: '五五五同心',
    description: 'R + G + B = 555',
    family: 'lucky',
    check: c => channelSum(c) === 555,
  },
  {
    id: 'lucky-sum-666',
    name: '六六六同心',
    description: 'R + G + B = 666',
    family: 'lucky',
    check: c => channelSum(c) === 666,
  },
];
