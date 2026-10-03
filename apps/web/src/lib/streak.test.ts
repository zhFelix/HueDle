import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS, computeStreak, loadStreak, saveTodayResult } from './storage';
import type { HistoryItem } from './storage';

function item(date: string): HistoryItem {
  return { date, hex: '#002FA7', cp: 100, rarity: 'common', badgeIds: [] };
}

describe('computeStreak — 边界', () => {
  it('空历史 → 0', () => {
    expect(computeStreak([], '2026-03-04')).toBe(0);
  });

  it('只有今天 → 1', () => {
    expect(computeStreak([item('2026-03-04')], '2026-03-04')).toBe(1);
  });

  it('连续 3 天（含今天）→ 3', () => {
    const history = [item('2026-03-02'), item('2026-03-03'), item('2026-03-04')];

    expect(computeStreak(history, '2026-03-04')).toBe(3);
  });

  it('断档：只数到今天往回的第一段', () => {
    const history = [item('2026-02-28'), item('2026-03-03'), item('2026-03-04')];

    expect(computeStreak(history, '2026-03-04')).toBe(2);
  });

  it('今天不在历史里（链条断了）→ 0', () => {
    expect(computeStreak([item('2026-03-02'), item('2026-03-03')], '2026-03-04')).toBe(0);
  });

  it('跨月边界连续 → 3', () => {
    const history = [item('2026-02-28'), item('2026-03-01'), item('2026-03-02')];

    expect(computeStreak(history, '2026-03-02')).toBe(3);
  });
});

describe('loadStreak', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('脏数据（非数字）不抛，并退化为按历史重算', () => {
    localStorage.setItem(STORAGE_KEYS.streak, 'not-a-number');
    expect(() => loadStreak()).not.toThrow();
    expect(loadStreak()).toBe(0);
  });

  it('无历史但缓存合法 → 用缓存', () => {
    localStorage.setItem(STORAGE_KEYS.streak, '7');
    expect(loadStreak()).toBe(7);
  });

  it('有历史时以历史为准并修正缓存', () => {
    localStorage.setItem(STORAGE_KEYS.streak, '99');
    saveTodayResult(item('2026-03-04'));
    saveTodayResult(item('2026-03-05'));

    const today = new Date().toISOString().slice(0, 10);
    saveTodayResult(item(today));
    saveTodayResult(item(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)));

    expect(loadStreak()).toBe(2);
    expect(localStorage.getItem(STORAGE_KEYS.streak)).toBe('2');
  });
});
