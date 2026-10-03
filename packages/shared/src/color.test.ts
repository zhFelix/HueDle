import { describe, expect, it } from 'vitest';
import { rgbToHsl, toColorInfo } from './color';

describe('rgbToHsl', () => {
  it('黑色：h=0, s=0, l=0', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('白色：h=0, s=0, l=100', () => {
    const hsl = rgbToHsl({ r: 255, g: 255, b: 255 });
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBe(100);
  });

  it('r=g=b 的中间灰：h=0, s=0', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: expect.closeTo(50.196, 2) });
  });

  it('纯红：h=0, s=100, l=50', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('纯绿：h=120', () => {
    const hsl = rgbToHsl({ r: 0, g: 255, b: 0 });
    expect(hsl.h).toBe(120);
    expect(hsl.s).toBe(100);
    expect(hsl.l).toBe(50);
  });

  it('纯蓝：h=240', () => {
    const hsl = rgbToHsl({ r: 0, g: 0, b: 255 });
    expect(hsl.h).toBe(240);
    expect(hsl.s).toBe(100);
    expect(hsl.l).toBe(50);
  });

  it('青色 h=180 / 品红 h=300 / 黄色 h=60', () => {
    expect(rgbToHsl({ r: 0, g: 255, b: 255 }).h).toBe(180);
    expect(rgbToHsl({ r: 255, g: 0, b: 255 }).h).toBe(300);
    expect(rgbToHsl({ r: 255, g: 255, b: 0 }).h).toBe(60);
  });

  it('h 恒落在 [0,360)，s/l 恒落在 [0,100]', () => {
    for (let n = 0; n < 256; n += 17) {
      const hsl = rgbToHsl({ r: n, g: 255 - n, b: (n * 7) % 256 });
      expect(hsl.h).toBeGreaterThanOrEqual(0);
      expect(hsl.h).toBeLessThan(360);
      expect(hsl.s).toBeGreaterThanOrEqual(0);
      expect(hsl.s).toBeLessThanOrEqual(100);
      expect(hsl.l).toBeGreaterThanOrEqual(0);
      expect(hsl.l).toBeLessThanOrEqual(100);
    }
  });
});

describe('toColorInfo', () => {
  it('黑色 → #000000 且 hsl 全零', () => {
    expect(toColorInfo({ r: 0, g: 0, b: 0 })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      hex: '#000000',
      hsl: { h: 0, s: 0, l: 0 },
    });
  });

  it('白色 → #FFFFFF 且 l=100', () => {
    const info = toColorInfo({ r: 255, g: 255, b: 255 });
    expect(info.hex).toBe('#FFFFFF');
    expect(info.hsl.l).toBe(100);
    expect(info.hsl.s).toBe(0);
  });

  it('纯红 → #FF0000 且 h=0, s=100, l=50', () => {
    const info = toColorInfo({ r: 255, g: 0, b: 0 });
    expect(info.hex).toBe('#FF0000');
    expect(info.hsl).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('克莱因蓝 0x002FA7 → #002FA7，且保留原始通道', () => {
    const info = toColorInfo({ r: 0x00, g: 0x2f, b: 0xa7 });
    expect(info.hex).toBe('#002FA7');
    expect(info.r).toBe(0);
    expect(info.g).toBe(0x2f);
    expect(info.b).toBe(0xa7);
    expect(info.hex).toHaveLength(7);
  });

  it('hex 恒为 7 字符、大写、带 #，低位通道补零', () => {
    const info = toColorInfo({ r: 1, g: 2, b: 3 });
    expect(info.hex).toBe('#010203');
    expect(info.hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});
