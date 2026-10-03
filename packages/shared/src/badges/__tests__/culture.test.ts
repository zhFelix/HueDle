import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { cultureBadges } from '../culture';

const check = (id: string, r: number, g: number, b: number) =>
  cultureBadges.find(b => b.id === id)!.check(toColorInfo({ r, g, b }));

describe('culture 家族', () => {
  it('克莱因蓝', () => {
    expect(check('culture-klein-blue', 0x00, 0x2f, 0xa7)).toBe(true);
    expect(check('culture-klein-blue', 0x00, 0x2f, 0xa6)).toBe(false);
  });

  it('蒂芙尼蓝', () => {
    expect(check('culture-tiffany-blue', 0x0a, 0xba, 0xb5)).toBe(true);
    expect(check('culture-tiffany-blue', 0x0a, 0xba, 0xb4)).toBe(false);
  });

  it('马尔斯绿', () => {
    expect(check('culture-marrs-green', 0x01, 0x85, 0x74)).toBe(true);
    expect(check('culture-marrs-green', 0x01, 0x85, 0x75)).toBe(false);
  });

  it('普鲁士蓝', () => {
    expect(check('culture-prussian-blue', 0x00, 0x31, 0x53)).toBe(true);
    expect(check('culture-prussian-blue', 0x00, 0x31, 0x54)).toBe(false);
  });

  it('提香红', () => {
    expect(check('culture-titian-red', 0xba, 0x3b, 0x40)).toBe(true);
    expect(check('culture-titian-red', 0xba, 0x3b, 0x41)).toBe(false);
  });

  it('梵高星空蓝', () => {
    expect(check('culture-van-gogh-blue', 0x1b, 0x3b, 0x6f)).toBe(true);
    expect(check('culture-van-gogh-blue', 0x1b, 0x3b, 0x70)).toBe(false);
  });

  it('竹青', () => {
    expect(check('culture-bamboo-green', 0x78, 0x92, 0x62)).toBe(true);
    expect(check('culture-bamboo-green', 0x78, 0x92, 0x63)).toBe(false);
  });

  it('胭脂', () => {
    expect(check('culture-rouge', 0x9d, 0x29, 0x33)).toBe(true);
    expect(check('culture-rouge', 0x9d, 0x29, 0x34)).toBe(false);
  });
});
