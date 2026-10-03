import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { channelBadges } from '../channel';

const badge = (id: string) => channelBadges.find(b => b.id === id)!;

describe('channel 家族', () => {
  it('递减序：R>G>B 命中', () => {
    expect(badge('channel-descending').check(toColorInfo({ r: 200, g: 100, b: 50 }))).toBe(true);
    expect(badge('channel-descending').check(toColorInfo({ r: 255, g: 254, b: 0 }))).toBe(true);
  });

  it('递减序：非严格递减时不命中', () => {
    expect(badge('channel-descending').check(toColorInfo({ r: 200, g: 50, b: 100 }))).toBe(false);
    expect(badge('channel-descending').check(toColorInfo({ r: 100, g: 100, b: 0 }))).toBe(false);
  });

  it('递增序：R<G<B 命中', () => {
    expect(badge('channel-ascending').check(toColorInfo({ r: 50, g: 100, b: 200 }))).toBe(true);
  });

  it('递增序：非严格递增时不命中', () => {
    expect(badge('channel-ascending').check(toColorInfo({ r: 200, g: 100, b: 50 }))).toBe(false);
    expect(badge('channel-ascending').check(toColorInfo({ r: 100, g: 100, b: 200 }))).toBe(false);
  });

  it('高值通道：三通道均 ≥128 命中', () => {
    expect(badge('channel-all-high').check(toColorInfo({ r: 128, g: 200, b: 255 }))).toBe(true);
  });

  it('高值通道：任一通道 ≤127 时不命中', () => {
    expect(badge('channel-all-high').check(toColorInfo({ r: 127, g: 200, b: 255 }))).toBe(false);
  });

  it('低值通道：三通道均 ≤127 命中', () => {
    expect(badge('channel-all-low').check(toColorInfo({ r: 0, g: 100, b: 127 }))).toBe(true);
  });

  it('低值通道：任一通道 ≥128 时不命中', () => {
    expect(badge('channel-all-low').check(toColorInfo({ r: 0, g: 100, b: 128 }))).toBe(false);
  });

  it('双峰突起：两通道相等且第三通道更大命中', () => {
    expect(badge('channel-twin-high').check(toColorInfo({ r: 200, g: 200, b: 255 }))).toBe(true);
    expect(badge('channel-twin-high').check(toColorInfo({ r: 255, g: 100, b: 100 }))).toBe(true);
  });

  it('双峰突起：无相等通道时不命中', () => {
    expect(badge('channel-twin-high').check(toColorInfo({ r: 100, g: 150, b: 200 }))).toBe(false);
    expect(badge('channel-twin-high').check(toColorInfo({ r: 128, g: 128, b: 128 }))).toBe(false);
  });

  it('双峰突起：相等的一对为 0 时不命中（与 pure 单通道族不重叠）', () => {
    expect(badge('channel-twin-high').check(toColorInfo({ r: 255, g: 0, b: 0 }))).toBe(false);
    expect(badge('channel-twin-high').check(toColorInfo({ r: 0, g: 255, b: 0 }))).toBe(false);
    expect(badge('channel-twin-high').check(toColorInfo({ r: 0, g: 0, b: 255 }))).toBe(false);
  });

  it('极值错位：R=255、G=0、B=128 命中', () => {
    expect(badge('channel-extreme-shift').check(toColorInfo({ r: 255, g: 0, b: 128 }))).toBe(true);
  });

  it('极值错位：通道值不符时不命中', () => {
    expect(badge('channel-extreme-shift').check(toColorInfo({ r: 255, g: 0, b: 127 }))).toBe(false);
    expect(badge('channel-extreme-shift').check(toColorInfo({ r: 128, g: 0, b: 255 }))).toBe(false);
  });
});
