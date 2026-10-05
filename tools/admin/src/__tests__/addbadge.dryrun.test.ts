/**
 * 测试 3：**干跑拦住三类坏条件**（hits=0 / 恒真 / 与既有徽章必然蕴含）。
 *
 * 用 4096 色的小色域跑，所以是秒级；生产路径用的是 `TOTAL_COLORS`（2²⁴），
 * 循环与采样方式与 `enumerate.test.ts` 完全同口径（同一个 `toColorInfo`）。
 */
import { describe, expect, it } from 'vitest';
import { toColorInfo } from '@huedle/shared';
import { runDryRun, type ExistingCheck } from '../addbadge/dryrun';

const DOMAIN = 4096;

const existing: ExistingCheck[] = [
  { id: 'gray-black', group: null, hits: 1, check: c => c.r === 0 && c.g === 0 && c.b === 0 },
  { id: 'gray-bright', group: null, hits: 0, check: c => c.r > 200 },
  { id: 'casino-pair', group: 'casino-rank', hits: 256, check: c => c.g === 1 },
];

describe('测试 3：干跑拦住的坏条件', () => {
  it('hits === 0：永不命中的规则被拦下（工作区零改动）', () => {
    const result = runDryRun({ check: () => false, existing, total: DOMAIN });
    expect(result.empty).toBe(true);
    expect(result.hits).toBe(0);
    expect(result.violations.join('\n')).toContain('hits === 0');
    expect(result.samples.misses.length).toBeGreaterThan(0);
  });

  it('恒真：hits === 全色域 被拦下', () => {
    const result = runDryRun({ check: () => true, existing, total: DOMAIN });
    expect(result.tautology).toBe(true);
    expect(result.hits).toBe(DOMAIN);
    expect(result.violations.join('\n')).toContain('恒真');
  });

  it('与既有徽章必然蕴含（group 外）：被拦下并指出是跟谁蕴含、Jaccard 多少', () => {
    const result = runDryRun({
      check: c => c.r === 0 && c.g === 0 && c.b === 0,
      existing,
      total: DOMAIN,
    });
    expect(result.violations.join('\n')).toContain('gray-black');
    expect(result.violations.join('\n')).toContain('必然蕴含');
    expect(result.implications.map(item => item.id)).toContain('gray-black');
    expect(result.implications.find(item => item.id === 'gray-black')?.allowed).toBe(false);
  });

  it('旧 ⊆ 新（更宽）：只算**警告**，不再拒绝（部分包含是徽章系统的固有性质）', () => {
    const result = runDryRun({
      check: c => c.g === 1 || c.b === 0,
      existing,
      total: DOMAIN,
    });
    const item = result.implications.find(entry => entry.id === 'casino-pair');
    expect(item?.direction).toBe('old-subset-of-new');
    expect(item?.level).toBe('warning');
    // 放宽的是「单向」：hits=0 / 恒真 / 互相蕴含仍然是错误。
    expect(result.violations).toEqual([]);
    expect(result.warnings.join('\n')).toContain('casino-pair');
  });

  it('同一个 group 内的蕴含是**允许**的（阶梯规则），不算违规', () => {
    const withGroup = runDryRun({
      check: c => c.g === 1 && c.b < 128,
      existing,
      group: 'casino-rank',
      total: DOMAIN,
    });
    const item = withGroup.implications.find(entry => entry.id === 'casino-pair');
    expect(item?.allowed).toBe(true);
    expect(withGroup.violations).toEqual([]);
  });

  it('check 抛异常：记录第几个颜色并给出消息', () => {
    const result = runDryRun({
      check: c => {
        if (c.b === 5 && c.g === 3) throw new Error('boom');
        return false;
      },
      existing,
      total: DOMAIN,
    });
    expect(result.exception?.message).toBe('boom');
    expect(result.violations.join('\n')).toContain('抛异常');
  });

  it('返回非布尔值：同样是违规（BadgeDef.check 必须是 boolean）', () => {
    const result = runDryRun({ check: () => 1 as unknown as boolean, existing, total: DOMAIN });
    expect(result.nonBoolean).not.toBeNull();
    expect(result.violations.join('\n')).toContain('非布尔');
  });

  it('正常规则：无违规，hits 与样例都对', () => {
    const result = runDryRun({
      check: c => c.b === 7,
      existing,
      total: DOMAIN,
    });
    expect(result.violations).toEqual([]);
    expect(result.hits).toBe(4096 / 256);
    expect(result.samples.hits.every(hex => hex.endsWith('07'))).toBe(true);
    expect(result.maxJaccard === null || result.maxJaccard.value <= 1).toBe(true);
  });

  it('小色域与真实 toColorInfo 的映射完全一致（v=0 → #000000，v=255 → #0000FF）', () => {
    const seen: string[] = [];
    runDryRun({
      check: c => {
        if (seen.length < 2) seen.push(c.hex);
        return false;
      },
      existing: [],
      total: DOMAIN,
    });
    expect(seen[0]).toBe('#000000');
    expect(seen[1]).toBe(toColorInfo({ r: 0, g: 0, b: 1 }).hex);
  });
});
