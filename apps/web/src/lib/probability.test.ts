/**
 * `lib/probability.ts` 纯函数单测（功能① 徽章详情的概率格式化）。
 *
 * 覆盖要求（NEW-FEATURES §7，任务测试项 3）：
 *  - `hits = 1`（最稀有）、`hits = TOTAL_COLORS`（恒真）、以及中间值；
 *  - 输出里**不会**出现 `NaN` / `Infinity` / `0%`（有效命中数下）；
 *  - `hits === 0` 的退化输入（不可达）返回 `0%`，而不是 `1 / 0`。
 *
 * 断言里不手抄徽章名，只钉格式化规则本身。
 */
import { describe, expect, it } from 'vitest';
import { TOTAL_COLORS } from '@huedle/shared';
import { formatCount, formatProbability, formatProbabilityHint } from './probability';

/** 有代表性的命中数：从「只有 1 种颜色符合」到「全色域都符合」。 */
const SAMPLE_HITS = [
  1,
  16,
  255,
  720,
  4096,
  9999,
  10_000,
  100_000,
  2_097_152,
  11_011_456,
  TOTAL_COLORS,
] as const;

describe('formatCount — 中文大数', () => {
  it('按量级换算成人话（亿 / 万 / 千 / 原数字）', () => {
    expect(formatCount(16_777_216)).toBe('1677.7 万');
    expect(formatCount(2_097_152)).toBe('209.7 万');
    expect(formatCount(11_011_456)).toBe('1101.1 万');
    expect(formatCount(100_000_000)).toBe('1.0 亿');
    expect(formatCount(4096)).toBe('4.1 千');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(0)).toBe('0');
  });

  it('非有限数不产生 NaN / Infinity 文案', () => {
    expect(formatCount(Number.NaN)).not.toMatch(/NaN/);
    expect(formatCount(Number.POSITIVE_INFINITY)).not.toMatch(/Infinity/);
  });
});

describe('formatProbability — 主展示', () => {
  it('最稀有：hits = 1', () => {
    // 1677 万分之一——最稀有那一档。绝不能显示成 `1 / 1`（读作「必然」）。
    expect(formatProbability(1)).toBe('1 / 16,777,216');
  });

  it('恒真：hits = TOTAL_COLORS → 100%（不是 toPrecision 的科学计数法）', () => {
    expect(formatProbability(TOTAL_COLORS)).toBe('100%');
    expect(formatProbability(TOTAL_COLORS + 1)).toBe('100%');
  });

  it('中间值：少量命中走分数，大量命中走百分比', () => {
    // 千分之一数 = 16,777,216 ÷ hits（不是 hits 本身）
    expect(formatProbability(255)).toBe('1 / 65,793');
    expect(formatProbability(4096)).toBe('1 / 4,096');
    expect(formatProbability(9_999)).toBe('1 / 1,678');
    // 10_000 是「hits ≤ 9999 走分数」的边界外侧 → 百分比。
    expect(formatProbability(10_000)).toBe('0.060%');
    expect(formatProbability(100_000)).toBe('0.60%');
    expect(formatProbability(2_097_152)).toBe('13%');
    expect(formatProbability(11_011_456)).toBe('66%');
  });

  it('total 可注入：小数色域下同样是 2 位有效数字的百分比', () => {
    expect(formatProbability(128, 256)).toBe('50%');
    expect(formatProbability(100, 256)).toBe('39%');
    expect(formatProbability(256, 256)).toBe('100%');
  });

  it('有效命中数下不出现 NaN / Infinity / 0%', () => {
    for (const hits of SAMPLE_HITS) {
      const text = formatProbability(hits);
      expect(text, `hits=${hits}`).not.toMatch(/NaN|Infinity/);
      expect(text, `hits=${hits}`).not.toBe('0%');
      expect(text, `hits=${hits}`).not.toBe('');
    }
  });

  it('退化输入 hits = 0 → 0%，不是 1 / 0，也不是 Infinity', () => {
    expect(formatProbability(0)).toBe('0%');
    expect(formatProbability(0)).not.toContain('/');
    expect(formatProbability(-5)).toBe('0%');
    expect(formatProbability(Number.NaN)).toBe('0%');
    expect(formatProbability(100, 0)).toBe('0%');
  });
});

describe('formatProbabilityHint — 辅助句', () => {
  it('恒真：每一种颜色都符合', () => {
    expect(formatProbabilityHint(TOTAL_COLORS)).toBe('每一种颜色都符合');
  });

  it('少量命中：约 N 分之 1（N 是人话大数）', () => {
    expect(formatProbabilityHint(255)).toBe('约 6.6 万分之 1');
    expect(formatProbabilityHint(720)).toBe('约 2.3 万分之 1');
    expect(formatProbabilityHint(4096)).toBe('约 4.1 千分之 1');
    expect(formatProbabilityHint(16)).toBe('约 104.9 万分之 1');
  });

  it('大量命中：N 种颜色里有 M 种', () => {
    expect(formatProbabilityHint(256, 25_600)).toBe('2.6 万种颜色里有 256 种');
    expect(formatProbabilityHint(200_000)).toBe('1677.7 万种颜色里有 20.0 万种');
    expect(formatProbabilityHint(2_097_152)).toBe('1677.7 万种颜色里有 209.7 万种');
  });

  it('不出现 NaN / Infinity，且退化输入不抛', () => {
    for (const hits of SAMPLE_HITS) {
      expect(formatProbabilityHint(hits), `hits=${hits}`).not.toMatch(/NaN|Infinity/);
    }
    expect(formatProbabilityHint(0)).not.toMatch(/NaN|Infinity/);
    expect(formatProbabilityHint(Number.NaN)).not.toMatch(/NaN|Infinity/);
    expect(formatProbabilityHint(1, Number.POSITIVE_INFINITY)).not.toMatch(/NaN|Infinity/);
  });
});
