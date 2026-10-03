import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { extremeBadges } from '../extreme';

const extreme = (id: string) => extremeBadges.find(b => b.id === id)!;
const hit = (id: string, r: number, g: number, b: number) =>
  expect(extreme(id).check(toColorInfo({ r, g, b }))).toBe(true);
const miss = (id: string, r: number, g: number, b: number) =>
  expect(extreme(id).check(toColorInfo({ r, g, b }))).toBe(false);

describe('extreme 家族', () => {
  it('绝对零度：三通道均为 0 命中', () => {
    hit('extreme-absolute-black', 0, 0, 0);
  });

  it('绝对零度：存在非零通道不命中', () => {
    miss('extreme-absolute-black', 0, 0, 1);
    miss('extreme-absolute-black', 1, 0, 0);
  });

  it('白垩尽头：三通道均为 255 命中', () => {
    hit('extreme-absolute-white', 255, 255, 255);
  });

  it('白垩尽头：存在非 255 通道不命中', () => {
    miss('extreme-absolute-white', 255, 255, 254);
    miss('extreme-absolute-white', 0, 255, 255);
  });

  it('双极贯通：极差恰为 255 命中', () => {
    hit('extreme-full-span', 0, 128, 255);
    hit('extreme-full-span', 0, 0, 255);
  });

  it('双极贯通：极差不足 255 不命中', () => {
    miss('extreme-full-span', 1, 0, 254);
    miss('extreme-full-span', 0, 0, 0);
  });

  it('双峰满值：恰有两个通道为 255 命中', () => {
    hit('extreme-dual-max', 255, 255, 0);
    hit('extreme-dual-max', 255, 128, 255);
  });

  it('双峰满值：满值通道数为 1 或 3 不命中', () => {
    miss('extreme-dual-max', 255, 255, 255);
    miss('extreme-dual-max', 255, 0, 0);
  });

  it('贴地微光：总和为正且不超过 15 命中', () => {
    hit('extreme-floor-glow', 0, 0, 1);
    hit('extreme-floor-glow', 5, 5, 5);
  });

  it('贴地微光：总和为 0 或超过 15 不命中', () => {
    miss('extreme-floor-glow', 0, 0, 0);
    miss('extreme-floor-glow', 5, 5, 6);
  });

  it('贴顶余晖：总和落在 750–764 命中', () => {
    hit('extreme-ceiling-glow', 250, 250, 250);
    hit('extreme-ceiling-glow', 255, 255, 254);
  });

  it('贴顶余晖：总和不足 750 或达到 765 不命中', () => {
    miss('extreme-ceiling-glow', 250, 250, 249);
    miss('extreme-ceiling-glow', 255, 255, 255);
  });
});
