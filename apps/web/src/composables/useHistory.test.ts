/**
 * `useHistory()` 逻辑层测试（jsdom，本地存储可用）。
 *
 * 覆盖 6 件事：空历史、统计、连续天数口径、**冻结**、清空不动身份、脏数据容错。
 * 日期通过 `useHistory({ date })` 注入，不 mock 系统时钟。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { allBadges, restoreScore, utcDate } from '@huedle/shared';
import {
  SCORE_RARITIES,
  STORAGE_KEYS,
  computeStreak,
  loadHistory,
  loadUserDaily,
  loadUserHistory,
  saveTodayResult,
  saveUserHistory,
  userHistoryKey,
  type HistoryItem,
} from '../lib/storage';
import { apiErrorReply, installFetchMock } from '../test-utils/mock-fetch';
import { useSessionStore } from '../stores/session';
import { useDailyColor } from './useDailyColor';
import { computeHistoryStats, useHistory } from './useHistory';

const DAY = (date: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  date,
  hex: '#002FA7',
  cp: 100,
  rarity: 'common',
  badgeIds: [],
  ...over,
});

/** 直接写 history key（可写脏数据）；对象走 JSON，字符串原样写入。 */
function writeHistory(raw: unknown): void {
  localStorage.setItem(STORAGE_KEYS.history, typeof raw === 'string' ? raw : JSON.stringify(raw));
}

describe('useHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── ① 空历史 ────────────────────────────────────────────────────────────
  it('空历史：isEmpty 为 true，统计全零，byRarity 含全部 7 个键', () => {
    const history = useHistory();

    expect(history.isEmpty.value).toBe(true);
    expect(history.entries.value).toEqual([]);

    const stats = history.stats.value;
    expect(stats.totalDays).toBe(0);
    expect(stats.streak).toBe(0);
    expect(stats.bestCp).toBe(0);
    expect(stats.bestEntry).toBeNull();
    // 7 档全有键，一个都不能少（含最低档 trash）
    expect(Object.keys(stats.byRarity).sort()).toEqual([...SCORE_RARITIES].sort());
    for (const rarity of SCORE_RARITIES) expect(stats.byRarity[rarity]).toBe(0);
  });

  // ── ② 统计 ──────────────────────────────────────────────────────────────
  it('有记录：totalDays / bestCp / bestEntry 与存档一致，且按稀有度计数', () => {
    saveTodayResult(DAY('2026-03-04', { cp: 120, rarity: 'trash' }));
    saveTodayResult(DAY('2026-03-05', { cp: 9_500, rarity: 'epic' }));
    saveTodayResult(DAY('2026-03-06', { cp: 33, rarity: 'trash' }));

    const { stats, isEmpty } = useHistory();

    expect(isEmpty.value).toBe(false);
    expect(stats.value.totalDays).toBe(3);
    expect(stats.value.bestCp).toBe(9_500);
    expect(stats.value.bestEntry?.date).toBe('2026-03-05');
    expect(stats.value.bestEntry?.cp).toBe(9_500);
    expect(stats.value.byRarity.trash).toBe(2);
    expect(stats.value.byRarity.epic).toBe(1);
    expect(stats.value.byRarity.mythic).toBe(0); // 缺档补 0，仍可读
  });

  it('reload()：外部写入后能重新读到（并保持降序）', () => {
    const history = useHistory();
    expect(history.isEmpty.value).toBe(true);

    saveTodayResult(DAY('2026-03-04'));
    saveTodayResult(DAY('2026-03-06'));
    history.reload();

    expect(history.entries.value.map(entry => entry.date)).toEqual(['2026-03-06', '2026-03-04']);
  });

  // ── ③ 连续天数口径 ──────────────────────────────────────────────────────
  it('streak 与 computeStreak(entries, utcDate()) 同口径，锚在今天', () => {
    const anchor = new Date('2026-03-06T12:00:00Z'); // 注入日期，不动系统时钟

    saveTodayResult(DAY('2026-03-04'));
    saveTodayResult(DAY('2026-03-05'));
    saveTodayResult(DAY('2026-03-06'));
    const three = useHistory({ date: anchor });
    expect(three.stats.value.streak).toBe(3);
    expect(three.stats.value.streak).toBe(computeStreak(loadHistory(), utcDate(anchor)));

    localStorage.clear();
    saveTodayResult(DAY('2026-03-04'));
    saveTodayResult(DAY('2026-03-06'));
    expect(useHistory({ date: anchor }).stats.value.streak).toBe(1); // 中间断档只数到今天

    localStorage.clear();
    saveTodayResult(DAY('2026-03-05'));
    expect(useHistory({ date: anchor }).stats.value.streak).toBe(0); // 今天没记录 → 0
  });

  // ── ④ 冻结：原样展示，不按当前徽章表重算 ────────────────────────────────
  it('冻结：存档里的 cp / rarity 即使与当前徽章表不符也原样读出', () => {
    const frozen: HistoryItem = {
      date: '2026-03-04',
      hex: '#AAAAAA',
      cp: 999_999,
      rarity: 'mythic',
      badgeIds: ['casino-six-kind'],
    };
    saveTodayResult(frozen);

    const { entries, stats } = useHistory();
    expect(entries.value[0]).toEqual(frozen);
    expect(entries.value[0]?.cp).toBe(999_999);
    expect(entries.value[0]?.rarity).toBe('mythic');
    expect(entries.value[0]?.badgeIds).toEqual(['casino-six-kind']);
    expect(stats.value.bestCp).toBe(999_999);

    // 反证：当前徽章表里 casino-six-kind 的 CP 远大于 999,999（104,857,600），
    // 一旦有谁"顺手重算"，上面的断言立刻失败。
    const badge = allBadges.find(entry => entry.id === 'casino-six-kind');
    expect(badge?.cp).toBeGreaterThan(999_999);
    // 展示路径（HistoryList / 今日页共用）也只透传存档值。
    expect(restoreScore(frozen.badgeIds, frozen.cp, frozen.rarity).cp).toBe(999_999);
  });

  // ── ⑤ clear() 不动身份 ──────────────────────────────────────────────────
  it('clear() 清掉记录，但保留 huedle:anonymousId（否则会换掉用户的颜色）', () => {
    localStorage.setItem(STORAGE_KEYS.anonymousId, 'anon-123');
    localStorage.setItem(STORAGE_KEYS.token, 'token-abc');
    saveTodayResult(DAY('2026-03-04', { cp: 777 }));

    const history = useHistory();
    expect(history.isEmpty.value).toBe(false);

    history.clear();

    expect(history.isEmpty.value).toBe(true);
    expect(history.entries.value).toEqual([]);
    expect(history.stats.value.totalDays).toBe(0);
    expect(history.stats.value.bestEntry).toBeNull();

    // 身份与登录态原封不动，记录类 key 清空
    expect(localStorage.getItem(STORAGE_KEYS.anonymousId)).toBe('anon-123');
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBe('token-abc');
    expect(localStorage.getItem(STORAGE_KEYS.history)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.daily)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.streak)).toBeNull();
  });

  // ── ⑥ 脏数据不让页面炸 ──────────────────────────────────────────────────
  it('脏数据：非 JSON 视为空，坏记录只丢自己，能用的部分照常返回', () => {
    writeHistory('not-json{{{');
    const broken = useHistory();
    expect(broken.isEmpty.value).toBe(true);
    expect(broken.stats.value.byRarity.trash).toBe(0);

    writeHistory([
      DAY('2026-03-04', { cp: 7, rarity: 'trash' }),
      { date: '2026-03-05' }, // 缺 hex / cp / rarity / badgeIds
      { v: 1, date: '2026-03-06', hex: '#FFFFFF', cp: '9', rarity: 'rare', badgeIds: [] }, // cp 类型错
      { v: 1, date: '2026-03-04', hex: '#00FF00', cp: 1, rarity: 'common', badgeIds: [] }, // 与首条同日 → 丢
      null,
      'oops',
      DAY('2026-03-07', { cp: 42, rarity: 'epic' }),
    ]);
    const dirty = useHistory();

    expect(dirty.entries.value.map(entry => entry.date)).toEqual(['2026-03-07', '2026-03-04']);
    expect(dirty.stats.value.totalDays).toBe(2);
    expect(dirty.stats.value.bestCp).toBe(42);
    expect(dirty.stats.value.bestEntry?.date).toBe('2026-03-07');
    expect(dirty.stats.value.byRarity.trash).toBe(1);
    expect(dirty.stats.value.byRarity.epic).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式（mock fetch，**不起后端**）
//
// 重点：数据源换成服务端，**统计口径不换**——两支共用 `computeHistoryStats`。
// 另外：登录模式没有本地记录可清，「清空」入口（`canClear`）必须是 false。
// ─────────────────────────────────────────────────────────────────────────────

describe('useHistory — 登录模式', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function loginAs(id = 'u1', name = 'Alice'): ReturnType<typeof useSessionStore> {
    const store = useSessionStore();
    store.setSession(`tok-${id}`, { id, name });
    return store;
  }

  it('读服务端 /api/history（已降序），注入 Authorization，canClear 为 false', async () => {
    const serverItems = [DAY('2026-03-06', { cp: 900 }), DAY('2026-03-04', { cp: 100 })];
    const { calls } = installFetchMock(() => ({ body: serverItems }));
    loginAs();

    const history = useHistory({ date: new Date('2026-03-06T12:00:00Z') });
    await history.reload();

    expect(history.entries.value).toEqual(serverItems);
    expect(history.isLoggedIn.value).toBe(true);
    expect(history.canClear.value).toBe(false); // 登录模式没有本地记录可清
    expect(history.stats.value.totalDays).toBe(2);
    expect(history.stats.value.bestCp).toBe(900);
    expect(history.stats.value.bestEntry?.date).toBe('2026-03-06');

    const call = calls.find(entry => entry.url.endsWith('/api/history'));
    expect(call?.headers.Authorization).toBe('Bearer tok-u1');
  });

  it('统计与本地模式是**同一套算法**：同数据 → 同 stats（= computeHistoryStats）', async () => {
    const anchor = new Date('2026-03-06T12:00:00Z');
    const items = [
      DAY('2026-03-06', { cp: 33, rarity: 'trash' }),
      DAY('2026-03-05', { cp: 9_500, rarity: 'epic' }),
      DAY('2026-03-04', { cp: 120, rarity: 'trash' }),
    ];
    for (const item of items) saveTodayResult(item);

    // ① 本地模式（未登录）
    const local = useHistory({ date: anchor });
    const localStats = local.stats.value;
    expect(local.canClear.value).toBe(true);
    expect(local.stats.value.streak).toBe(3);

    // ② 登录模式：同一批数据由服务端返回
    installFetchMock(() => ({ body: items }));
    loginAs();
    const remote = useHistory({ date: anchor });
    await remote.reload();

    expect(remote.entries.value).toEqual(local.entries.value);
    expect(remote.stats.value).toEqual(localStats);
    expect(remote.stats.value).toEqual(computeHistoryStats(items, anchor));
  });

  it('401 → 清 session、回退本地模式，并读回本地历史', async () => {
    saveTodayResult(DAY('2026-03-04', { cp: 7 }));
    installFetchMock(() => apiErrorReply(401, 'UNAUTHORIZED', '未授权'));

    const store = loginAs();
    const history = useHistory({ date: new Date('2026-03-04T12:00:00Z') });
    await history.reload();

    expect(store.isLoggedIn).toBe(false);
    expect(history.error.value).toBeNull();
    expect(history.entries.value.map(entry => entry.date)).toEqual(['2026-03-04']);
    expect(history.canClear.value).toBe(true); // 回到本地模式，清空入口恢复
  });

  it('网络失败 → 可重试的 error 态，不抛、不白屏', async () => {
    installFetchMock(() => {
      throw new TypeError('fetch failed');
    });
    loginAs();

    const history = useHistory();
    await expect(history.reload()).resolves.toBeUndefined();

    expect(history.error.value).toBeTruthy();
    expect(history.entries.value).toEqual([]);
    expect(history.isEmpty.value).toBe(true);
  });

  it('登录模式 clear() 是空操作：不动服务端数据，也不动本地记录', async () => {
    saveTodayResult(DAY('2026-03-05', { cp: 5 }));
    const serverItems = [DAY('2026-03-04', { cp: 11 })];
    installFetchMock(() => ({ body: serverItems }));
    loginAs();

    const history = useHistory();
    await history.reload();
    history.clear();

    expect(history.entries.value).toEqual(serverItems);
    expect(loadHistory().map(entry => entry.date)).toEqual(['2026-03-05']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式的历史缓存（任务 C）：`huedle:history:user:<userId>` = { day, items }
//
//   - 命中即 0 请求；
//   - 有效期 = `day === utcDate()`（跨天自动失效）；
//   - 按用户分键；
//   - **今日结果缓存一被写入就作废**（否则出现"我明明抽了今天的，历史页却没有"）。
// ─────────────────────────────────────────────────────────────────────────────

describe('useHistory — 登录模式历史缓存', () => {
  const ANCHOR = new Date('2026-03-06T12:00:00Z');
  const TODAY = '2026-03-06';

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function loginAs(id = 'u1', name = 'Alice'): ReturnType<typeof useSessionStore> {
    const store = useSessionStore();
    store.setSession(`tok-${id}`, { id, name });
    return store;
  }

  // ── ① 缓存命中 ──────────────────────────────────────────────────────────
  it('1. 缓存命中：预置有效缓存 → reload() 一个 fetch 都不发，页面数据来自缓存', async () => {
    loginAs();
    const cached = [DAY(TODAY, { cp: 900 }), DAY('2026-03-04', { cp: 100 })];
    saveUserHistory('u1', TODAY, cached);

    // 任何 fetch 都算失败：命中缓存时 reload() 不应该走网络。
    const { mock, calls } = installFetchMock(() => {
      throw new TypeError('缓存命中时不应发请求');
    });

    const history = useHistory({ date: ANCHOR }); // 构造时立刻 reload 一次
    await history.reload();

    expect(mock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(history.entries.value).toEqual(cached);
    expect(history.stats.value.totalDays).toBe(2);
    expect(history.stats.value.bestCp).toBe(900);
    expect(history.stats.value.bestEntry?.date).toBe(TODAY);
  });

  // ── ② 跨天失效 ──────────────────────────────────────────────────────────
  it('2. 跨天失效：缓存 day 是昨天 → 断言会请求服务器，并用新的一天覆盖缓存', async () => {
    loginAs();
    saveUserHistory('u1', '2026-03-05', [DAY('2026-03-05', { cp: 1 })]);
    const serverItems = [DAY(TODAY, { cp: 900 }), DAY('2026-03-05', { cp: 1 })];
    const { calls } = installFetchMock(() => ({ body: serverItems }));

    const history = useHistory({ date: ANCHOR });
    await history.reload();

    expect(calls.some(call => call.url.endsWith('/api/history'))).toBe(true);
    expect(history.entries.value).toEqual(serverItems);
    // 新的一份写回缓存，day 是"今天"
    expect(loadUserHistory('u1', TODAY)).toEqual(serverItems);
    expect(loadUserHistory('u1', '2026-03-05')).toBeNull(); // 被覆盖，旧 day 不再命中
  });

  // ── ③ 抽颜色让历史缓存失效（最重要的一条） ─────────────────────────────
  it('3. 抽颜色让历史失效：daily 缓存一写入 → 历史缓存被清，下次 reload 重新请求', async () => {
    loginAs();

    // 玩家上午先打开「我的」：服务端返回 1 条，缓存下来（0 请求）
    const morningHistory = [DAY('2026-03-05', { cp: 10 })];
    saveUserHistory('u1', TODAY, morningHistory);
    const history = useHistory({ date: ANCHOR });
    expect(history.entries.value).toEqual(morningHistory);
    expect(localStorage.getItem(userHistoryKey('u1'))).not.toBeNull();

    // 回到今日页抽今天的颜色：`huedle:daily:user:u1` 缓存未命中 → 走 /api/daily（会写缓存）
    const newToday = DAY(TODAY, { cp: 999, rarity: 'epic' });
    const freshHistory = [newToday, ...morningHistory];
    const { calls } = installFetchMock(call =>
      call.url.endsWith('/api/daily') ? { body: { ...newToday, streak: 2 } } : { body: freshHistory },
    );

    const play = useDailyColor({ date: ANCHOR });
    await play.load();

    expect(calls.filter(call => call.url.endsWith('/api/daily'))).toHaveLength(1);
    expect(loadUserDaily('u1', TODAY)).not.toBeNull(); // 今日缓存确实被写入

    // 关键：历史缓存已被连带清掉（否则会命中上午那份旧历史）
    expect(localStorage.getItem(userHistoryKey('u1'))).toBeNull();
    expect(loadUserHistory('u1', TODAY)).toBeNull();

    // 因此回到「我的」必须重新请求，并拿到"多出来的今天那条"
    await history.reload();
    expect(calls.filter(call => call.url.endsWith('/api/history'))).toHaveLength(1);
    expect(history.entries.value).toEqual(freshHistory);
    expect(history.entries.value.map(entry => entry.date)).toContain(TODAY);
  });

  // ── ④ 按用户分键 ────────────────────────────────────────────────────────
  it('4. 按用户分键：用户 A 的历史缓存不会被用户 B 命中', async () => {
    const cachedA = [DAY(TODAY, { cp: 900 })];
    saveUserHistory('u1', TODAY, cachedA);

    loginAs('u2', 'Bob');
    const serverItems = [DAY(TODAY, { cp: 7 })];
    const { calls } = installFetchMock(() => ({ body: serverItems }));

    const history = useHistory({ date: ANCHOR });
    await history.reload();

    // B 没命中 A 的缓存 → 走了服务端
    expect(calls.some(call => call.url.endsWith('/api/history'))).toBe(true);
    expect(history.entries.value).toEqual(serverItems);
    // A 的缓存原样还在，没有被 B 覆盖
    expect(loadUserHistory('u1', TODAY)).toEqual(cachedA);
  });
});
