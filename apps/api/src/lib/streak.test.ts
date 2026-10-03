/**
 * `computeStreak` 的纯函数用例 —— **前端 `apps/web/src/lib/streak.test.ts` 的镜像**：
 * 日期与期望值逐条照抄，任何一条对不上就说明前后端口径已经漂移。
 */
import { describe, expect, it } from 'vitest';
import { computeStreak } from './streak';

const days = (...dates: string[]): Set<string> => new Set(dates);

describe('computeStreak — 与前端 storage.ts 的 computeStreak 同口径', () => {
  it('空历史 → 0', () => {
    expect(computeStreak(days(), '2026-03-04')).toBe(0);
  });

  it('今天有记录（只有今天）→ 1', () => {
    expect(computeStreak(days('2026-03-04'), '2026-03-04')).toBe(1);
  });

  it('连续 3 天（含今天）→ 3', () => {
    expect(computeStreak(days('2026-03-02', '2026-03-03', '2026-03-04'), '2026-03-04')).toBe(3);
  });

  it('中间断档：只数到今天往回的第一段 → 2', () => {
    expect(computeStreak(days('2026-02-28', '2026-03-03', '2026-03-04'), '2026-03-04')).toBe(2);
  });

  it('今天没记录（链条从今天起就断了）→ 0', () => {
    expect(computeStreak(days('2026-03-02', '2026-03-03'), '2026-03-04')).toBe(0);
  });

  it('跨月边界连续 → 3', () => {
    expect(computeStreak(days('2026-02-28', '2026-03-01', '2026-03-02'), '2026-03-02')).toBe(3);
  });
});
