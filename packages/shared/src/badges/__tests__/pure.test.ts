import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { pureBadges } from '../pure';

const badge = (id: string) => pureBadges.find(b => b.id === id)!;

describe('pure 家族', () => {
  it('唯赤：R>0 且 G=B=0 命中', () => {
    expect(badge('pure-only-red').check(toColorInfo({ r: 255, g: 0, b: 0 }))).toBe(true);
    expect(badge('pure-only-red').check(toColorInfo({ r: 1, g: 0, b: 0 }))).toBe(true);
  });

  it('唯赤：G 或 B 非零时不命中', () => {
    expect(badge('pure-only-red').check(toColorInfo({ r: 255, g: 1, b: 0 }))).toBe(false);
    expect(badge('pure-only-red').check(toColorInfo({ r: 0, g: 0, b: 0 }))).toBe(false);
  });

  it('唯绿：G>0 且 R=B=0 命中', () => {
    expect(badge('pure-only-green').check(toColorInfo({ r: 0, g: 128, b: 0 }))).toBe(true);
  });

  it('唯绿：B 非零时不命中', () => {
    expect(badge('pure-only-green').check(toColorInfo({ r: 0, g: 128, b: 1 }))).toBe(false);
  });

  it('唯蓝：B>0 且 R=G=0 命中', () => {
    expect(badge('pure-only-blue').check(toColorInfo({ r: 0, g: 0, b: 255 }))).toBe(true);
  });

  it('唯蓝：G 非零时不命中', () => {
    expect(badge('pure-only-blue').check(toColorInfo({ r: 0, g: 1, b: 255 }))).toBe(false);
  });

  it('鹅黄双峰：R=G>0 且 B=0 命中', () => {
    expect(badge('pure-yellow-twin').check(toColorInfo({ r: 200, g: 200, b: 0 }))).toBe(true);
  });

  it('鹅黄双峰：R≠G 时不命中', () => {
    expect(badge('pure-yellow-twin').check(toColorInfo({ r: 200, g: 100, b: 0 }))).toBe(false);
  });

  it('青碧双峰：G=B>0 且 R=0 命中', () => {
    expect(badge('pure-cyan-twin').check(toColorInfo({ r: 0, g: 90, b: 90 }))).toBe(true);
  });

  it('青碧双峰：B=0 时不命中', () => {
    expect(badge('pure-cyan-twin').check(toColorInfo({ r: 0, g: 90, b: 0 }))).toBe(false);
  });

  it('品红满值：R=255、G=0、B=255 命中', () => {
    expect(badge('pure-magenta-full').check(toColorInfo({ r: 255, g: 0, b: 255 }))).toBe(true);
  });

  it('品红满值：B 不足 255 时不命中', () => {
    expect(badge('pure-magenta-full').check(toColorInfo({ r: 255, g: 0, b: 254 }))).toBe(false);
  });
});
