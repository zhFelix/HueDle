import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEYS,
  clearIdentity,
  clearLocalData,
  clearLocalHistory,
  clearUserDaily,
  clearUserHistory,
  isRevealedToday,
  loadHistory,
  loadIdentity,
  loadRevealedMarker,
  loadTodayResult,
  loadUserDaily,
  loadUserHistory,
  saveIdentity,
  saveRevealedMarker,
  saveTodayResult,
  saveUserDaily,
  saveUserHistory,
  userDailyKey,
  userHistoryKey,
} from './storage';
import type { HistoryItem } from './storage';

const item: HistoryItem = {
  date: '2026-03-04',
  hex: '#002FA7',
  cp: 12345,
  rarity: 'rare',
  badgeIds: ['culture-klein-blue'],
};

function writeDaily(raw: string): void {
  localStorage.setItem(STORAGE_KEYS.daily, raw);
}

function writeHistory(raw: string): void {
  localStorage.setItem(STORAGE_KEYS.history, raw);
}

describe('loadTodayResult — 脏数据一律当作空值，绝不抛', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无缓存 → null', () => {
    expect(loadTodayResult('2026-03-04')).toBeNull();
  });

  it.each([
    ['非 JSON', 'not-json{{{'],
    ['字面量 null', 'null'],
    ['JSON 数组', '[1,2,3]'],
    ['空字符串', ''],
    ['字段缺失（没有 badgeIds）', '{"date":"2026-03-04","hex":"#002FA7","cp":10,"rarity":"rare"}'],
    ['cp 是字符串', '{"date":"2026-03-04","hex":"#002FA7","cp":"12345","rarity":"rare","badgeIds":[]}'],
    ['cp 是 NaN', '{"date":"2026-03-04","hex":"#002FA7","cp":null,"rarity":"rare","badgeIds":[]}'],
    ['rarity 不在 7 档内', '{"date":"2026-03-04","hex":"#002FA7","cp":10,"rarity":"legendary","badgeIds":[]}'],
    ['hex 格式不对', '{"date":"2026-03-04","hex":"blue","cp":10,"rarity":"rare","badgeIds":[]}'],
    ['date 格式不对', '{"date":"03/04/2026","hex":"#002FA7","cp":10,"rarity":"rare","badgeIds":[]}'],
    ['badgeIds 不是数组', '{"date":"2026-03-04","hex":"#002FA7","cp":10,"rarity":"rare","badgeIds":"x"}'],
    ['版本不符', '{"v":99,"date":"2026-03-04","hex":"#002FA7","cp":10,"rarity":"rare","badgeIds":[]}'],
  ])('%s → null', (_label, raw) => {
    writeDaily(raw);

    expect(() => loadTodayResult('2026-03-04')).not.toThrow();
    expect(loadTodayResult('2026-03-04')).toBeNull();
  });

  it('缓存日期不是今天（跨天）→ null', () => {
    saveTodayResult(item);

    expect(loadTodayResult('2026-03-05')).toBeNull();
    expect(loadTodayResult('2026-03-04')).toEqual(item);
  });

  it('合法缓存被去壳归一化（丢掉未知字段，hex 转大写）', () => {
    writeDaily(
      '{"v":1,"date":"2026-03-04","hex":"#002fa7","cp":10,"rarity":"trash","badgeIds":[],"junk":1}',
    );

    expect(loadTodayResult('2026-03-04')).toEqual({
      date: '2026-03-04',
      hex: '#002FA7',
      cp: 10,
      rarity: 'trash',
      badgeIds: [],
    });
  });
});

describe('saveTodayResult — 同一天幂等', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('连续保存同一天 N 次，history 里该日期只有 1 条', () => {
    for (let i = 0; i < 5; i += 1) {
      saveTodayResult({ ...item, cp: item.cp + i });
    }

    const history = loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.date).toBe('2026-03-04');
    expect(history[0]?.cp).toBe(item.cp + 4); // 后写覆盖先写
  });

  it('非法 item 被拒绝写入（历史与今日缓存都不变）', () => {
    saveTodayResult({ ...item, cp: Number.NaN });
    saveTodayResult({ ...item, rarity: 'legendary' as never });

    expect(loadTodayResult('2026-03-04')).toBeNull();
    expect(loadHistory()).toEqual([]);
  });
});

describe('loadHistory — 降序 + 逐条容错', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('按日期降序返回', () => {
    saveTodayResult({ ...item, date: '2026-03-04' });
    saveTodayResult({ ...item, date: '2026-03-06' });
    saveTodayResult({ ...item, date: '2026-03-05' });

    expect(loadHistory().map(entry => entry.date)).toEqual([
      '2026-03-06',
      '2026-03-05',
      '2026-03-04',
    ]);
  });

  it.each([
    ['非 JSON', 'not-json'],
    ['对象而非数组', '{"version":1,"items":[]}'],
    ['字面量 null', 'null'],
  ])('%s → []', (_label, raw) => {
    writeHistory(raw);

    expect(() => loadHistory()).not.toThrow();
    expect(loadHistory()).toEqual([]);
  });

  it('坏记录只丢自己，同日重复只留一条', () => {
    writeHistory(
      JSON.stringify([
        { v: 1, date: '2026-03-04', hex: '#002FA7', cp: 1, rarity: 'trash', badgeIds: [] },
        { v: 1, date: '2026-03-04', hex: '#FFFFFF', cp: 2, rarity: 'common', badgeIds: [] },
        { v: 1, date: '2026-03-05', hex: '#FFFFFF', cp: '2', rarity: 'common', badgeIds: [] },
        { v: 3, date: '2026-03-06', hex: '#FFFFFF', cp: 2, rarity: 'common', badgeIds: [] },
        null,
        'oops',
      ]),
    );

    expect(loadHistory()).toEqual([
      { date: '2026-03-04', hex: '#002FA7', cp: 1, rarity: 'trash', badgeIds: [] },
    ]);
  });
});

describe('clearLocalData', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('清空 STORAGE_KEYS 里的全部 key', () => {
    localStorage.setItem(STORAGE_KEYS.anonymousId, 'a');
    localStorage.setItem(STORAGE_KEYS.token, 't');
    saveTodayResult(item);
    localStorage.setItem(STORAGE_KEYS.streak, '3');
    saveRevealedMarker('user-1', '2026-03-04');

    clearLocalData();

    for (const key of Object.values(STORAGE_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });
});

/**
 * `huedle:revealed` 是**登录模式唯一会写的记录类 key**（DESIGN 第 11 节）。
 * 它必须与本地模式的三个记录键完全隔离，且按 userId 区分。
 */
describe('已揭晓标记（huedle:revealed）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无标记 → null / false', () => {
    expect(loadRevealedMarker()).toBeNull();
    expect(isRevealedToday('user-1', '2026-03-04')).toBe(false);
  });

  it('写入后按 (userId, date) 命中，其它账户 / 其它日期不命中', () => {
    saveRevealedMarker('user-1', '2026-03-04');

    expect(loadRevealedMarker()).toEqual({ userId: 'user-1', date: '2026-03-04' });
    expect(isRevealedToday('user-1', '2026-03-04')).toBe(true);
    expect(isRevealedToday('user-2', '2026-03-04')).toBe(false);
    expect(isRevealedToday('user-1', '2026-03-05')).toBe(false);
  });

  it('写入标记**不会**顺带写本地模式的三个记录键', () => {
    saveRevealedMarker('user-1', '2026-03-04');

    expect(localStorage.getItem(STORAGE_KEYS.daily)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.history)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.streak)).toBeNull();
  });

  it.each([
    ['非 JSON', 'not-json'],
    ['数组', '[]'],
    ['缺 date', '{"userId":"user-1"}'],
    ['date 格式不对', '{"userId":"user-1","date":"03/04/2026"}'],
    ['userId 为空串', '{"userId":"","date":"2026-03-04"}'],
  ])('脏数据（%s）→ 视为无标记，绝不抛', (_label, raw) => {
    localStorage.setItem(STORAGE_KEYS.revealed, raw);

    expect(() => loadRevealedMarker()).not.toThrow();
    expect(loadRevealedMarker()).toBeNull();
    expect(isRevealedToday('user-1', '2026-03-04')).toBe(false);
  });

  it('clearLocalHistory 不清标记（它是登录态，不是本地记录）', () => {
    saveRevealedMarker('user-1', '2026-03-04');

    clearLocalHistory();

    expect(loadRevealedMarker()).toEqual({ userId: 'user-1', date: '2026-03-04' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式的今日结果缓存：`huedle:daily:user:<userId>`
// ─────────────────────────────────────────────────────────────────────────────

describe('用户今日结果缓存（huedle:daily:user:<userId>）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('key 是 huedle:daily:user:<userId>，与本地键 huedle:daily 不是同一个 key', () => {
    expect(userDailyKey('u1')).toBe('huedle:daily:user:u1');
    expect(userDailyKey('u1')).not.toBe(STORAGE_KEYS.daily);

    saveUserDaily('u1', item, 3);

    expect(localStorage.getItem('huedle:daily:user:u1')).not.toBeNull();
    // 本地模式专属的三个键一个都没被写
    expect(localStorage.getItem(STORAGE_KEYS.daily)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.history)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.streak)).toBeNull();
  });

  it('按 (userId, date) 命中；别的账户 / 别的日期不命中', () => {
    saveUserDaily('u1', item, 3);

    expect(loadUserDaily('u1', '2026-03-04')).toEqual({ ...item, streak: 3 });
    expect(loadUserDaily('u2', '2026-03-04')).toBeNull();
    expect(loadUserDaily('u1', '2026-03-05')).toBeNull();
  });

  it('缺 streak 字段 → 回落 0，其余字段照常可用', () => {
    localStorage.setItem(userDailyKey('u1'), JSON.stringify({ v: 1, ...item }));

    expect(loadUserDaily('u1', '2026-03-04')).toEqual({ ...item, streak: 0 });
  });

  it.each([
    ['非 JSON', 'not-json'],
    ['数组', '[]'],
    ['结构不合法的记录', '{"date":"2026-03-04"}'],
    ['版本不符', '{"v":99,"date":"2026-03-04","hex":"#002FA7","cp":1,"rarity":"rare","badgeIds":[]}'],
  ])('脏数据（%s）→ null，绝不抛', (_label, raw) => {
    localStorage.setItem(userDailyKey('u1'), raw);

    expect(() => loadUserDaily('u1', '2026-03-04')).not.toThrow();
    expect(loadUserDaily('u1', '2026-03-04')).toBeNull();
  });

  it('clearUserDaily 只删指定账户的缓存', () => {
    saveUserDaily('u1', item, 1);
    saveUserDaily('u2', item, 2);

    clearUserDaily('u1');

    expect(loadUserDaily('u1', '2026-03-04')).toBeNull();
    expect(loadUserDaily('u2', '2026-03-04')?.streak).toBe(2);
  });

  it('clearLocalData 会清掉所有账户的今日缓存（前缀扫描）', () => {
    saveUserDaily('u1', item, 1);
    saveUserDaily('u2', item, 2);

    clearLocalData();

    expect(loadUserDaily('u1', '2026-03-04')).toBeNull();
    expect(loadUserDaily('u2', '2026-03-04')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式的历史缓存：`huedle:history:user:<userId>` = { day, items }
//
//   有效期判定用 `day`（跨天自然失效）。它与本地模式的 `huedle:history`
//   是**不同的 key**，登录模式永远不会写本地那个裸数组。
// ─────────────────────────────────────────────────────────────────────────────

describe('用户历史缓存（huedle:history:user:<userId>）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const items: HistoryItem[] = [
    { ...item, date: '2026-03-04' },
    { ...item, date: '2026-03-06' },
  ];

  it('key 是 huedle:history:user:<userId>，写的是 { day, items }，不碰本地 huedle:history', () => {
    expect(userHistoryKey('u1')).toBe('huedle:history:user:u1');
    expect(userHistoryKey('u1')).not.toBe(STORAGE_KEYS.history);

    saveUserHistory('u1', '2026-03-06', items);

    const raw = JSON.parse(localStorage.getItem('huedle:history:user:u1')!) as {
      day: string;
      items: unknown[];
    };
    expect(raw.day).toBe('2026-03-06');
    expect(raw.items).toHaveLength(2);
    // 本地模式专属的三个键一个都没被写
    expect(localStorage.getItem(STORAGE_KEYS.daily)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.history)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.streak)).toBeNull();
  });

  it('按 (userId, day) 命中，且读出来是降序；别的账户 / 别的日期不命中', () => {
    saveUserHistory('u1', '2026-03-06', items);

    expect(loadUserHistory('u1', '2026-03-06')?.map(entry => entry.date)).toEqual([
      '2026-03-06',
      '2026-03-04',
    ]);
    expect(loadUserHistory('u2', '2026-03-06')).toBeNull();
    // 跨天 → null（调用方据此回服务端）
    expect(loadUserHistory('u1', '2026-03-07')).toBeNull();
  });

  it('缓存空历史也是有效缓存（[] ≠ null）', () => {
    saveUserHistory('u1', '2026-03-06', []);

    expect(loadUserHistory('u1', '2026-03-06')).toEqual([]);
  });

  it.each([
    ['非 JSON', 'not-json'],
    ['数组', '[]'],
    ['缺 day', '{"items":[]}'],
    ['day 格式不对', '{"day":"03/06/2026","items":[]}'],
    ['items 不是数组', '{"day":"2026-03-06","items":"x"}'],
    ['版本不符', '{"v":99,"day":"2026-03-06","items":[]}'],
  ])('脏数据（%s）→ null，绝不抛', (_label, raw) => {
    localStorage.setItem(userHistoryKey('u1'), raw);

    expect(() => loadUserHistory('u1', '2026-03-06')).not.toThrow();
    expect(loadUserHistory('u1', '2026-03-06')).toBeNull();
  });

  it('坏记录只丢自己', () => {
    localStorage.setItem(
      userHistoryKey('u1'),
      JSON.stringify({
        v: 1,
        day: '2026-03-06',
        items: [item, { date: '2026-03-05' }, null, 'oops'],
      }),
    );

    expect(loadUserHistory('u1', '2026-03-06')).toEqual([{ ...item, date: '2026-03-04' }]);
  });

  it('clearUserHistory 只删指定账户；clearLocalData 删掉所有账户的历史缓存', () => {
    saveUserHistory('u1', '2026-03-06', items);
    saveUserHistory('u2', '2026-03-06', items);

    clearUserHistory('u1');
    expect(loadUserHistory('u1', '2026-03-06')).toBeNull();
    expect(loadUserHistory('u2', '2026-03-06')).not.toBeNull();

    clearLocalData();
    expect(loadUserHistory('u2', '2026-03-06')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式的身份缓存 `huedle:identity`（只用于显示）
// ─────────────────────────────────────────────────────────────────────────────

describe('身份缓存（huedle:identity）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('写入后读回 { userId, userName }', () => {
    saveIdentity('u1', 'Alice');

    expect(loadIdentity()).toEqual({ userId: 'u1', userName: 'Alice' });
  });

  it('空 userId 被拒绝写入', () => {
    saveIdentity('', 'Alice');

    expect(loadIdentity()).toBeNull();
  });

  it.each([
    ['非 JSON', 'not-json'],
    ['数组', '[]'],
    ['缺 userName', '{"userId":"u1"}'],
    ['userId 为空串', '{"userId":"","userName":"Alice"}'],
    ['userName 不是字符串', '{"userId":"u1","userName":1}'],
  ])('脏数据（%s）→ null，绝不抛', (_label, raw) => {
    localStorage.setItem(STORAGE_KEYS.identity, raw);

    expect(() => loadIdentity()).not.toThrow();
    expect(loadIdentity()).toBeNull();
  });

  it('clearIdentity 只删身份缓存', () => {
    saveIdentity('u1', 'Alice');
    saveUserDaily('u1', item, 1);

    clearIdentity();

    expect(loadIdentity()).toBeNull();
    expect(loadUserDaily('u1', '2026-03-04')).not.toBeNull();
  });
});
