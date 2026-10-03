import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { luckyBadges } from '../lucky';

const check = (id: string, r: number, g: number, b: number) =>
  luckyBadges.find(b => b.id === id)!.check(toColorInfo({ r, g, b }));

describe('lucky 家族', () => {
  it('六六大顺', () => {
    expect(check('lucky-triple-six', 0x00, 0x66, 0x60)).toBe(true); // #006660
    expect(check('lucky-triple-six', 0x00, 0x66, 0x06)).toBe(false); // #006606
  });

  it('八方来财', () => {
    expect(check('lucky-triple-eight', 0x00, 0x88, 0x80)).toBe(true); // #008880
    expect(check('lucky-triple-eight', 0x00, 0x88, 0x08)).toBe(false); // #008808
  });

  it('双八压轴', () => {
    expect(check('lucky-tail-double-eight', 0x12, 0x34, 0x88)).toBe(true);
    expect(check('lucky-tail-double-eight', 0x12, 0x34, 0x87)).toBe(false);
  });

  it('五二零同心', () => {
    expect(check('lucky-sum-520', 100, 200, 220)).toBe(true);
    expect(check('lucky-sum-520', 100, 200, 221)).toBe(false);
  });

  it('避四纳八', () => {
    expect(check('lucky-avoid-four', 0x88, 0xaa, 0xbb)).toBe(true);
    expect(check('lucky-avoid-four', 0x44, 0x88, 0xbb)).toBe(false);
  });

  it('金玉满堂', () => {
    expect(check('lucky-golden-tone', 255, 215, 0)).toBe(true);
    expect(check('lucky-golden-tone', 255, 215, 1)).toBe(false);
  });
});
