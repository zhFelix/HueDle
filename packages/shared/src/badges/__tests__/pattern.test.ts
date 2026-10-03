import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { patternBadges } from '../pattern';

const badge = (id: string) => patternBadges.find(b => b.id === id)!;
const hit = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b }))).toBe(true);
};
const miss = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b }))).toBe(false);
};

describe('pattern 家族', () => {
  it('重影：存在相邻且相同的字符', () => {
    hit('pattern-echo', 0x11, 0x23, 0x45);
    miss('pattern-echo', 0x12, 0x34, 0x56);
  });

  it('独步六符：六个字符两两不同', () => {
    hit('pattern-all-distinct', 0x12, 0x34, 0x56);
    miss('pattern-all-distinct', 0x11, 0x23, 0x45);
  });

  it('纯数字：六字符均为 0-9', () => {
    hit('pattern-digit-only', 0x12, 0x34, 0x56);
    miss('pattern-digit-only', 0x12, 0x34, 0x5a);
  });

  it('偶数符：六字符均取自 0/2/4/6/8/A/C/E', () => {
    hit('pattern-even-glyphs', 0x24, 0x68, 0xac);
    miss('pattern-even-glyphs', 0x24, 0x68, 0xab);
  });

  it('奇数符：六字符均取自 1/3/5/7/9/B/D/F', () => {
    hit('pattern-odd-glyphs', 0x13, 0x57, 0x9b);
    miss('pattern-odd-glyphs', 0x13, 0x57, 0x9a);
  });

  it('双子星：R、G、B 恰好两个相等', () => {
    hit('pattern-twin-peaks', 0x12, 0x12, 0x34);
    miss('pattern-twin-peaks', 0x12, 0x34, 0x56);
  });

  it('首尾呼应：R = B', () => {
    hit('pattern-mirror-bytes', 0x12, 0x34, 0x12);
    miss('pattern-mirror-bytes', 0x12, 0x34, 0x13);
  });

  it('半身回环：前三位字符与后三位完全相同', () => {
    hit('pattern-half-loop', 0xab, 0xca, 0xbc);
    miss('pattern-half-loop', 0xab, 0xca, 0xbd);
  });
});
