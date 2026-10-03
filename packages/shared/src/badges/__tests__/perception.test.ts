import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { perceptionBadges } from '../perception';

const badge = (id: string) => perceptionBadges.find(b => b.id === id)!;
const hit = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b }))).toBe(true);
};
const miss = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b }))).toBe(false);
};

describe('perception 家族', () => {
  it('暗夜低语：l ≤ 12 且 s ≤ 25', () => {
    hit('perception-night-owl', 20, 15, 18);
    hit('perception-night-owl', 0, 0, 0);
    miss('perception-night-owl', 200, 20, 20);
  });

  it('炽白之昼：l ≥ 90', () => {
    hit('perception-daylight', 245, 240, 235);
    hit('perception-daylight', 255, 255, 255);
    miss('perception-daylight', 230, 180, 120);
  });

  it('青柠微光：75 ≤ h ≤ 105 且 s ≥ 30 且 l ≥ 20', () => {
    hit('perception-lime-glow', 170, 220, 80);
    miss('perception-lime-glow', 230, 120, 40);
  });

  it('青绿之息：160 ≤ h ≤ 200 且 s ≥ 30 且 l ≥ 20', () => {
    hit('perception-teal-breath', 0, 180, 160);
    miss('perception-teal-breath', 230, 120, 40);
  });

  it('雾面感：s ≤ 10 且 30 ≤ l ≤ 70', () => {
    hit('perception-misty', 140, 145, 150);
    miss('perception-misty', 60, 80, 100);
  });

  it('紫罗兰梦：265 ≤ h ≤ 295 且 s ≥ 30 且 l ≥ 15', () => {
    hit('perception-violet-dream', 150, 60, 220);
    miss('perception-violet-dream', 0, 180, 160);
  });

  it('霓虹警报：s ≥ 85 且 35 ≤ l ≤ 65', () => {
    hit('perception-neon-alarm', 255, 0, 200);
    miss('perception-neon-alarm', 255, 220, 200);
  });

  it('虚空悖论：l ≤ 12 且 s ≥ 95', () => {
    hit('perception-void-paradox', 40, 20, 1);
    miss('perception-void-paradox', 120, 0, 0);
    miss('perception-void-paradox', 40, 20, 20);
  });
});
