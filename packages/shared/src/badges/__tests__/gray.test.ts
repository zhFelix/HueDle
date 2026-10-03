import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { grayBadges } from '../gray';

const gray = (id: string) => grayBadges.find(b => b.id === id)!;
const hit = (id: string, r: number, g: number, b: number) =>
  expect(gray(id).check(toColorInfo({ r, g, b }))).toBe(true);
const miss = (id: string, r: number, g: number, b: number) =>
  expect(gray(id).check(toColorInfo({ r, g, b }))).toBe(false);

describe('gray 家族', () => {
  it('灰阶行者：R = G = B 命中', () => {
    hit('gray-true-monochrome', 0x12, 0x12, 0x12);
    hit('gray-true-monochrome', 255, 255, 255);
  });

  it('灰阶行者：R ≠ B 不命中', () => {
    miss('gray-true-monochrome', 128, 128, 129);
    miss('gray-true-monochrome', 0, 0, 1);
  });

  it('近灰窄带：极差为 1 或 2 命中', () => {
    hit('gray-near-neutral', 128, 128, 129);
    hit('gray-near-neutral', 10, 10, 12);
  });

  it('近灰窄带：极差为 0 或 3 不命中', () => {
    miss('gray-near-neutral', 0, 0, 0);
    miss('gray-near-neutral', 10, 10, 13);
  });

  it('幽影灰域：极差 ≤ 4 且最大值 ≤ 24 命中', () => {
    hit('gray-shadow-zone', 0, 0, 0);
    hit('gray-shadow-zone', 20, 22, 24);
  });

  it('幽影灰域：极差 > 4 或最大值 > 24 不命中', () => {
    miss('gray-shadow-zone', 25, 25, 25);
    miss('gray-shadow-zone', 20, 20, 25);
  });

  it('霜白灰域：极差 ≤ 4 且最小值 ≥ 231 命中', () => {
    hit('gray-frost-zone', 231, 231, 233);
    hit('gray-frost-zone', 251, 255, 255);
  });

  it('霜白灰域：最小值 < 231 或极差 > 4 不命中', () => {
    miss('gray-frost-zone', 230, 230, 232);
    miss('gray-frost-zone', 250, 255, 255);
  });

  it('中庸灰域：极差 ≤ 1 且三通道落在 100–156 命中', () => {
    hit('gray-mid-zone', 128, 128, 128);
    hit('gray-mid-zone', 100, 101, 101);
  });

  it('中庸灰域：越出亮度区间或极差 > 1 不命中', () => {
    miss('gray-mid-zone', 99, 100, 100);
    miss('gray-mid-zone', 128, 130, 130);
  });

  it('灰核残响：极差 = 3 且最小值 = 128 命中', () => {
    hit('gray-core-echo', 128, 128, 131);
    hit('gray-core-echo', 128, 130, 131);
  });

  it('灰核残响：极差 ≠ 3 或最小值 ≠ 128 不命中', () => {
    miss('gray-core-echo', 128, 128, 128);
    miss('gray-core-echo', 129, 129, 132);
  });
});
