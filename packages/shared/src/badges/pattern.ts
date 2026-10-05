// family: pattern — 代表色 #A5A5A5
import { hexBytes } from './helpers';
import type { BadgeDef, ColorInfo } from '../types';

// private
export const bytes = (color: ColorInfo): [string, string, string] => {
  const [a, b, c] = hexBytes(color.hex);
  return [a.toUpperCase(), b.toUpperCase(), c.toUpperCase()];
};

// private
export const hexChars = (color: ColorInfo): string => bytes(color).join('');

// private
export const allCharsIn = (color: ColorInfo, allowed: string): boolean => {
  const chars = hexChars(color);
  for (let i = 0; i < chars.length; i += 1) {
    if (!allowed.includes(chars[i])) return false;
  }
  return true;
};

// private：六个字符是否两两不同
export const allCharsDistinct = (color: ColorInfo): boolean => {
  const chars = hexChars(color);
  let seen = '';
  for (let i = 0; i < chars.length; i += 1) {
    if (seen.includes(chars[i])) return false;
    seen += chars[i];
  }
  return true;
};

/**
 * 模式家族：十六进制字符串的**结构**与字节模式。
 * 维度：相邻重影、字符去重、字符集、字节相等性、字节对称、半串回环。
 * 刻意避开 gray 家族的 R = G = B（双子星要求「恰好两个相等」，三字节全同不命中），
 * 也不使用 R/G/B 的大小序（channel 家族已占有 R > G > B 与 R < G < B）。
 */
export const patternBadges: BadgeDef[] = [
  {
    id: 'pattern-echo',
    name: '重影',
    description: 'HEX 的六个字符中至少存在一对相邻且相同的字符',
    family: 'pattern',
    check: color => {
      const chars = hexChars(color);
      for (let i = 0; i < chars.length - 1; i += 1) {
        if (chars[i] === chars[i + 1]) return true;
      }
      return false;
    },
  },
  {
    id: 'pattern-all-distinct',
    name: '独步六符',
    description: 'HEX 的六个字符两两不同',
    family: 'pattern',
    check: color => allCharsDistinct(color),
  },
  {
    id: 'pattern-digit-only',
    name: '纯数字',
    description: 'HEX 的六个字符全部是十进制数字 0–9',
    family: 'pattern',
    check: color => allCharsIn(color, '0123456789'),
  },
  {
    id: 'pattern-even-glyphs',
    name: '偶数符',
    description: 'HEX 的六个字符全部取自偶数位字符集 0 / 2 / 4 / 6 / 8 / A / C / E',
    family: 'pattern',
    check: color => allCharsIn(color, '02468ACE'),
  },
  {
    id: 'pattern-odd-glyphs',
    name: '奇数符',
    description: 'HEX 的六个字符全部取自奇数位字符集 1 / 3 / 5 / 7 / 9 / B / D / F',
    family: 'pattern',
    check: color => allCharsIn(color, '13579BDF'),
  },
  {
    id: 'pattern-twin-peaks',
    name: '双子星',
    description: 'R、G、B 中恰好有两个相等，第三个不同',
    family: 'pattern',
    check: color => {
      const equalPairs =
        (color.r === color.g ? 1 : 0) +
        (color.g === color.b ? 1 : 0) +
        (color.r === color.b ? 1 : 0);
      return equalPairs === 1;
    },
  },
  {
    id: 'pattern-mirror-bytes',
    name: '首尾呼应',
    description: 'R = B',
    family: 'pattern',
    check: color => color.r === color.b,
  },
  {
    id: 'pattern-half-loop',
    name: '半身回环',
    description: 'HEX 的前三位字符与后三位字符完全相同（如 #ABCABC）',
    family: 'pattern',
    check: color => {
      const chars = hexChars(color);
      return chars.slice(0, 3) === chars.slice(3);
    },
  },
    {
    id: 'pattern-alternating',
    name: '交错排列',
    description: 'HEX 六个字符按 ABABAB 模式交替出现，且两种字符不同',
    family: 'pattern',
    check: c => {
      const s = c.hex.slice(1);
      return (
        s[0] === s[2] && s[2] === s[4] &&
        s[1] === s[3] && s[3] === s[5] &&
        s[0] !== s[1]
      );
    },
  },
  {
    id: 'pattern-palindrome-loop',
    name: '六字回文',
    description: 'HEX 六个字符按 ABCCBA 模式镜像对称',
    family: 'pattern',
    check: c => {
      const s = c.hex.slice(1);
      return s[0] === s[5] && s[1] === s[4] && s[2] === s[3];
    },
  },
  {
    id: 'pattern-triple-blocks',
    name: '三三分块',
    description: 'HEX 前三位相同、后三位相同，两组不同（AAABBB）',
    family: 'pattern',
    check: c => {
      const s = c.hex.slice(1);
      return (
        s[0] === s[1] && s[1] === s[2] &&
        s[3] === s[4] && s[4] === s[5] &&
        s[0] !== s[3]
      );
    },
  },
  {
    id: 'pattern-double-blocks',
    name: '二二二分块',
    description: 'HEX 六个字符按 AABBCC 模式，每两位相同',
    family: 'pattern',
    check: c => {
      const s = c.hex.slice(1);
      return s[0] === s[1] && s[2] === s[3] && s[4] === s[5];
    },
  },
  {
    id: 'pattern-rising-strict',
    name: '六符递升',
    description: 'HEX 六个字符的十六进制值从左到右严格递增',
    family: 'pattern',
    check: c => {
      const s = c.hex.slice(1);
      for (let i = 1; i < s.length; i++) {
        if (parseInt(s[i], 16) <= parseInt(s[i - 1], 16)) return false;
      }
      return true;
    },
  },
  {
    id: 'pattern-falling-strict',
    name: '六符递降',
    description: 'HEX 六个字符的十六进制值从左到右严格递减',
    family: 'pattern',
    check: c => {
      const s = c.hex.slice(1);
      for (let i = 1; i < s.length; i++) {
        if (parseInt(s[i], 16) >= parseInt(s[i - 1], 16)) return false;
      }
      return true;
    },
  },
  {
    id: 'pattern-no-triple',
    name: '无三重',
    description: 'HEX 六个字符中没有任何一个字符出现三次及以上',
    family: 'pattern',
    check: c => {
      const counts = new Map<string, number>();
      for (const ch of c.hex.slice(1)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
      return [...counts.values()].every(v => v <= 2);
    },
  },
];
