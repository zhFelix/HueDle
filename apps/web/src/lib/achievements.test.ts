/**
 * 成就推导的语义测试（功能②，设计见 docs/NEW-FEATURES.md §2 / §6）。
 *
 * 覆盖七类：
 *  1. 13 条成就逐条判定语义；
 *  2. `longestStreak` 边界（空 / 单天 / 连续 7 / 中间断档取最长 / 闰日 / 重复日期）；
 *  3. 断签后「曾经连续 7 天」仍然解锁（闩锁，与 `computeStreak` 归零不同）；
 *  4. UTC 边界（跨午夜 / 跨月 / 跨年 / 闰年，全部注入日期，不依赖系统时钟）；
 *  5. 进度用真实历史算出（具体数字断言）；
 *  6. 空历史全部未点亮、不崩、不出现 NaN；
 *  7. 纯函数：不读 localStorage（组件层另测）。
 */
import { describe, expect, it } from 'vitest';
import { allBadges, utcDate, type Family } from '@huedle/shared';
import { computeStreak, type HistoryItem } from './storage';
import {
  ACHIEVEMENTS,
  collectBadgeIds,
  countCollectedBadges,
  countCompleteFamilies,
  countDistinctDays,
  deriveAchievements,
  formatProgress,
  longestStreak,
  progressPercent,
  type AchievementId,
  type AchievementState,
} from './achievements';

function item(date: string, over: Partial<HistoryItem> = {}): HistoryItem {
  return { date, hex: '#002FA7', cp: 100, rarity: 'common', badgeIds: [], ...over };
}

/** 从 `start` 起生成 `n` 天的连续 UTC 记录（日期算术走 `Date.UTC`，不踩本地时区）。 */
function consecutiveDays(start: string, n: number, over: Partial<HistoryItem> = {}): HistoryItem[] {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) =>
    item(utcDate(new Date(Date.UTC(y, m - 1, d + i))), over),
  );
}

function badgesOfFamily(family: Family): string[] {
  return allBadges.filter(badge => badge.family === family).map(badge => badge.id);
}

/** 取指定成就的推导结果；找不到说明成就表被改坏了，直接抛。 */
function stateOf(entries: readonly HistoryItem[], id: AchievementId): AchievementState {
  const found = deriveAchievements(entries).find(state => state.id === id);
  if (!found) throw new Error(`成就 ${id} 不在成就表里`);
  return found;
}

describe('1. 13 条成就逐条判定语义', () => {
  it('days-first 第一天：无历史未点亮；有 1 天即点亮，解锁于该天', () => {
    expect(stateOf([], 'days-first')).toMatchObject({ unlocked: false, progress: 0, unlockedAt: null });
    expect(stateOf([item('2026-03-04')], 'days-first')).toMatchObject({
      unlocked: true,
      progress: 1,
      unlockedAt: '2026-03-04',
    });
  });

  it('days-10 十日：9 天未点亮（进度 9），第 10 天点亮于第 10 天', () => {
    expect(stateOf(consecutiveDays('2026-03-01', 9), 'days-10')).toMatchObject({
      unlocked: false,
      progress: 9,
    });
    expect(stateOf(consecutiveDays('2026-03-01', 10), 'days-10')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-10',
    });
  });

  it('days-50 五十日：49 天未点亮，50 天点亮', () => {
    expect(stateOf(consecutiveDays('2026-01-01', 49), 'days-50').unlocked).toBe(false);
    expect(stateOf(consecutiveDays('2026-01-01', 50), 'days-50')).toMatchObject({
      unlocked: true,
      unlockedAt: utcDate(new Date(Date.UTC(2026, 1, 19))),
    });
  });

  it('days-100 百日：不满 100 天未点亮，满 100 天点亮', () => {
    expect(stateOf(consecutiveDays('2026-01-01', 99), 'days-100').unlocked).toBe(false);
    expect(stateOf(consecutiveDays('2026-01-01', 100), 'days-100').unlocked).toBe(true);
  });

  it('streak-3 三连：连续 3 天点亮于第 3 天；仅 2 天未点亮', () => {
    expect(stateOf(consecutiveDays('2026-03-01', 2), 'streak-3')).toMatchObject({
      unlocked: false,
      progress: 2,
    });
    expect(stateOf(consecutiveDays('2026-03-01', 3), 'streak-3')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-03',
    });
  });

  it('streak-7 七日不辍：连续 7 天点亮于第 7 天（段的结束日，不是中间那天）', () => {
    expect(stateOf(consecutiveDays('2026-03-01', 6), 'streak-7').unlocked).toBe(false);
    expect(stateOf(consecutiveDays('2026-03-01', 7), 'streak-7')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-07',
    });
  });

  it('streak-30 三十日：连续 30 天点亮', () => {
    expect(stateOf(consecutiveDays('2026-01-01', 29), 'streak-30').unlocked).toBe(false);
    expect(stateOf(consecutiveDays('2026-01-01', 30), 'streak-30').unlocked).toBe(true);
  });

  it('family-one 圆满一家：集齐任一家族全部成员即点亮；差一枚未点亮', () => {
    const gray = badgesOfFamily('gray');
    const partial = gray.slice(0, -1);

    expect(stateOf([item('2026-03-04', { badgeIds: partial })], 'family-one')).toMatchObject({
      unlocked: false,
      progress: 0,
    });
    expect(stateOf([item('2026-03-04', { badgeIds: gray })], 'family-one')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-04',
    });
  });

  it('family-three 三族圆满：集齐 3 个家族点亮；2 个家族未点亮且进度为 2', () => {
    const two = [
      item('2026-03-04', { badgeIds: badgesOfFamily('gray') }),
      item('2026-03-05', { badgeIds: badgesOfFamily('extreme') }),
    ];
    const three = [...two, item('2026-03-06', { badgeIds: badgesOfFamily('lucky') })];

    expect(stateOf(two, 'family-three')).toMatchObject({ unlocked: false, progress: 2 });
    expect(stateOf(three, 'family-three')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-06',
    });
  });

  it('badges-10 十枚徽章：9 枚未点亮、10 枚点亮', () => {
    const nine = allBadges.slice(0, 9).map(badge => badge.id);
    const ten = allBadges.slice(0, 10).map(badge => badge.id);

    expect(stateOf([item('2026-03-04', { badgeIds: nine })], 'badges-10')).toMatchObject({
      unlocked: false,
      progress: 9,
    });
    expect(stateOf([item('2026-03-04', { badgeIds: ten })], 'badges-10').unlocked).toBe(true);
  });

  it('badges-50 五十枚徽章：49 枚未点亮、50 枚点亮', () => {
    const ids = allBadges.map(badge => badge.id);
    expect(stateOf([item('2026-03-04', { badgeIds: ids.slice(0, 49) })], 'badges-50').unlocked).toBe(
      false,
    );
    expect(stateOf([item('2026-03-04', { badgeIds: ids.slice(0, 50) })], 'badges-50').unlocked).toBe(
      true,
    );
  });

  it('rarity-anomaly-first 初见异常：只看抽取稀有度 entry.rarity', () => {
    expect(stateOf([item('2026-03-04', { rarity: 'trash' })], 'rarity-anomaly-first')).toMatchObject(
      { unlocked: false, progress: 0, unlockedAt: null },
    );
    expect(
      stateOf([item('2026-03-04', { rarity: 'anomaly' })], 'rarity-anomaly-first'),
    ).toMatchObject({ unlocked: true, unlockedAt: '2026-03-04' });
  });

  it('rarity-mythic-first 初见神话：抽取稀有度是 mythic 才解锁，徽章稀有度不算', () => {
    const mythicBadge = allBadges.find(badge => badge.rarity === 'mythic');
    expect(mythicBadge, '徽章表里应存在 mythic 档徽章').toBeDefined();

    // 抽到的是 common（徽章可能稀有），「初见神话」不应点亮。
    expect(
      stateOf([item('2026-03-04', { rarity: 'common', badgeIds: [mythicBadge!.id] })], 'rarity-mythic-first')
        .unlocked,
    ).toBe(false);
    expect(stateOf([item('2026-03-04', { rarity: 'mythic' })], 'rarity-mythic-first')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-04',
    });
  });

  it('成就表覆盖 13 条且 id 唯一、名称非空', () => {
    expect(ACHIEVEMENTS).toHaveLength(13);
    expect(new Set(ACHIEVEMENTS.map(def => def.id)).size).toBe(13);
    for (const def of ACHIEVEMENTS) expect(def.name.length, def.id).toBeGreaterThan(0);
  });
});

describe('2. longestStreak 边界', () => {
  it('空历史 → 0', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('单天 → 1', () => {
    expect(longestStreak([item('2026-03-04')])).toBe(1);
  });

  it('连续 7 天 → 7', () => {
    expect(longestStreak(consecutiveDays('2026-03-01', 7))).toBe(7);
  });

  it('中间断档 → 取最长的那一段（不是总和，也不是最后一次）', () => {
    // 第 1 段 4 天（03-01…03-04），第 2 段 2 天（03-10、03-11）：总和 6，最后一段 2。
    const entries = [
      ...consecutiveDays('2026-03-01', 4),
      ...consecutiveDays('2026-03-10', 2),
    ];
    expect(longestStreak(entries)).toBe(4);
  });

  it('跨月：2026-02-28 → 03-01 连续 2 天（2026 平年）', () => {
    expect(longestStreak([item('2026-02-28'), item('2026-03-01')])).toBe(2);
  });

  it('闰日：2028-02-28 → 02-29 → 03-01 连续 3 天', () => {
    expect(longestStreak([item('2028-02-28'), item('2028-02-29'), item('2028-03-01')])).toBe(3);
  });

  it('重复日期先去重 → 1', () => {
    expect(longestStreak([item('2026-03-04'), item('2026-03-04')])).toBe(1);
  });

  it('输入顺序无关（升序 / 降序 / 乱序结果一致）', () => {
    const ascending = consecutiveDays('2026-03-01', 5);
    const shuffled = [ascending[2]!, ascending[0]!, ascending[4]!, ascending[1]!, ascending[3]!];
    expect(longestStreak(shuffled)).toBe(5);
    expect(longestStreak([...ascending].reverse())).toBe(5);
  });
});

describe('3. 断签后曾经连续 7 天仍然算解锁（闩锁）', () => {
  const history = consecutiveDays('2026-03-01', 7);

  it('断签后 streak-7 仍然解锁，解锁日是段的结束日', () => {
    expect(stateOf(history, 'streak-7')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-03-07',
    });
    expect(longestStreak(history)).toBe(7);
  });

  it('同一份历史在「今天」已断签时 computeStreak 归零，但成就不会熄灭', () => {
    // 今天 = 2026-03-20，历史停在 03-07。
    expect(computeStreak(history, '2026-03-20')).toBe(0);
    expect(longestStreak(history)).toBe(7);
    expect(stateOf(history, 'streak-3').unlocked).toBe(true);
    expect(stateOf(history, 'streak-30').unlocked).toBe(false);
  });

  it('断签后又连续更久，解锁日仍是第一次满 7 天的那天', () => {
    const entries = [...history, ...consecutiveDays('2026-04-01', 9)];
    expect(stateOf(entries, 'streak-7').unlockedAt).toBe('2026-03-07');
    expect(stateOf(entries, 'streak-30').unlocked).toBe(false);
  });
});

describe('4. UTC 边界（注入日期，不依赖系统时钟）', () => {
  it('跨 UTC 午夜：相邻的两个日期被认作连续', () => {
    expect(longestStreak([item('2026-03-04'), item('2026-03-05')])).toBe(2);
  });

  it('跨月：2026-01-31 → 02-01 连续 2 天', () => {
    expect(longestStreak([item('2026-01-31'), item('2026-02-01')])).toBe(2);
  });

  it('跨年：2026-12-31 → 2027-01-01 连续 2 天，隔一天则断开', () => {
    expect(longestStreak([item('2026-12-31'), item('2027-01-01')])).toBe(2);
    expect(longestStreak([item('2026-12-31'), item('2027-01-02')])).toBe(1);
  });

  it('连续段跨年时 streak-7 的解锁日落在次年', () => {
    const entries = consecutiveDays('2026-12-29', 7);
    expect(entries.at(-1)?.date).toBe('2027-01-04');
    expect(stateOf(entries, 'streak-7')).toMatchObject({
      unlocked: true,
      unlockedAt: '2027-01-04',
    });
  });

  it('闰年 2028-02-29 不误判：02-28、02-29、03-01 是连续 3 天', () => {
    expect(longestStreak([item('2028-02-28'), item('2028-02-29'), item('2028-03-01')])).toBe(3);
  });

  it('平年不存在 02-29：2026-02-28 → 03-01 连续，03-01 不会与 02-28 之间多算一天', () => {
    const entries = [item('2026-02-28'), item('2026-03-01')];
    expect(longestStreak(entries)).toBe(2);
    expect(countDistinctDays(entries)).toBe(2);
  });
});

describe('5. 进度用真实历史算出', () => {
  it('3 天历史的 streak-7 进度是 3 / 7 天，进度条 43%', () => {
    const entries = consecutiveDays('2026-03-01', 3);
    const streak = stateOf(entries, 'streak-7');
    expect(streak.progress).toBe(3);
    expect(formatProgress(streak)).toBe('3 / 7 天');
    expect(progressPercent(streak)).toBe(43);
  });

  it('12 枚徽章的 badges-50 进度是 12 / 50', () => {
    const entries = [item('2026-03-04', { badgeIds: allBadges.slice(0, 12).map(badge => badge.id) })];
    const badges = stateOf(entries, 'badges-50');
    expect(badges.progress).toBe(12);
    expect(formatProgress(badges)).toBe('12 / 50');
  });

  it('集齐 2 个家族的 family-three 进度是 2 / 3', () => {
    const entries = [
      item('2026-03-04', { badgeIds: badgesOfFamily('gray') }),
      item('2026-03-05', { badgeIds: badgesOfFamily('extreme') }),
    ];
    const family = stateOf(entries, 'family-three');
    expect(family.progress).toBe(2);
    expect(formatProgress(family)).toBe('2 / 3');
  });

  it('4 天历史的 days-10 进度是 4 / 10', () => {
    const entries = consecutiveDays('2026-03-01', 4);
    const days = stateOf(entries, 'days-10');
    expect(days.progress).toBe(4);
    expect(formatProgress(days)).toBe('4 / 10');
  });

  it('稀有度类未点亮显示「还差一点」；点亮后进度条满且不显示进度文案', () => {
    const locked = stateOf([item('2026-03-04', { rarity: 'trash' })], 'rarity-mythic-first');
    expect(formatProgress(locked)).toBe('还差一点');
    expect(progressPercent(locked)).toBe(0);

    const unlocked = stateOf([item('2026-03-04', { rarity: 'mythic' })], 'rarity-mythic-first');
    expect(formatProgress(unlocked)).toBe('');
    expect(progressPercent(unlocked)).toBe(100);
  });

  it('连续 3 天的 streak-3 进度条是 100%', () => {
    const state = stateOf(consecutiveDays('2026-03-01', 3), 'streak-3');
    expect(progressPercent(state)).toBe(100);
  });

  it('进度封顶：连续 9 天的 streak-3 进度仍是 3 / 3', () => {
    const state = stateOf(consecutiveDays('2026-03-01', 9), 'streak-3');
    expect(state.progress).toBe(3);
    expect(progressPercent(state)).toBe(100);
  });
});

describe('6. 空历史', () => {
  it('全部未点亮、进度全 0、不出现 NaN', () => {
    const states = deriveAchievements([]);
    expect(states).toHaveLength(ACHIEVEMENTS.length);
    for (const state of states) {
      expect(state.unlocked, state.id).toBe(false);
      expect(state.unlockedAt, state.id).toBeNull();
      expect(state.progress, state.id).toBe(0);
      expect(Number.isNaN(state.progress), state.id).toBe(false);
      expect(Number.isNaN(progressPercent(state)), state.id).toBe(false);
      expect(progressPercent(state), state.id).toBe(0);
      expect(formatProgress(state), state.id).not.toContain('NaN');
    }
  });

  it('空历史的各类聚合量都是 0', () => {
    expect(countDistinctDays([])).toBe(0);
    expect(longestStreak([])).toBe(0);
    expect(collectBadgeIds([]).size).toBe(0);
    expect(countCollectedBadges(collectBadgeIds([]))).toBe(0);
    expect(countCompleteFamilies(collectBadgeIds([]))).toBe(0);
  });
});
