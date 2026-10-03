import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { calculateScore, getDailyColorInfo } from '@huedle/shared';
import { getLocalIdentity } from '../lib/identity';
import {
  STORAGE_KEYS,
  loadHistory,
  loadRevealedMarker,
  loadTodayResult,
  saveRevealedMarker,
  type HistoryItem,
} from '../lib/storage';
import { apiErrorReply, installFetchMock } from '../test-utils/mock-fetch';
import { useSessionStore } from '../stores/session';
import { useDailyColor } from './useDailyColor';

/** 注入日期，**不 mock 系统时钟**——跨天靠参数注入来伪造。 */
const DAY_1 = new Date('2026-03-04T09:00:00Z');
const DAY_1_LATE = new Date('2026-03-04T23:59:00Z'); // 同一天，不同时刻
const DAY_2 = new Date('2026-03-05T09:00:00Z');

function snapshot(play: ReturnType<typeof useDailyColor>) {
  expect(play.result.value).not.toBeNull();
  expect(play.historyItem.value).not.toBeNull();
  return {
    cp: play.result.value!.cp,
    hex: play.historyItem.value!.hex,
    rarity: play.result.value!.rarity,
    badgeIds: play.historyItem.value!.badgeIds,
  };
}

/** 纯函数对同一天的权威输出，用来证明动画 / UI 不可能改变结果。 */
function expectedFor(date: Date) {
  const color = getDailyColorInfo(getLocalIdentity(), date);
  const score = calculateScore(color);
  return {
    hex: color.hex,
    cp: score.cp,
    rarity: score.rarity,
    badgeIds: score.badges.map(badge => badge.id),
  };
}

describe('useDailyColor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── 状态机：点了才写（新增行为） ─────────────────────────────────────────

  it('无存档：load() 后 revealed === false，且当天记录**没有**落盘', async () => {
    const play = useDailyColor({ date: DAY_1 });

    await play.load();

    expect(play.revealed.value).toBe(false);
    // 关键：load 不能写盘——用户还没点。
    expect(localStorage.getItem(STORAGE_KEYS.daily)).toBeNull();
    expect(loadTodayResult('2026-03-04')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.history)).toBeNull();
    expect(loadHistory()).toHaveLength(0);
    // 但结果已经在内存里算好了（动画的 target 需要它）
    expect(play.color.value).not.toBeNull();
    expect(play.result.value).not.toBeNull();
  });

  it('reveal()：revealed === true 且记录落盘，值等于纯函数结果', async () => {
    const expected = expectedFor(DAY_1);
    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    await play.reveal();

    expect(play.revealed.value).toBe(true);
    expect(loadTodayResult('2026-03-04')).toEqual({
      date: '2026-03-04',
      hex: expected.hex,
      cp: expected.cp,
      rarity: expected.rarity,
      badgeIds: expected.badgeIds,
    });
    expect(play.color.value!.hex).toBe(expected.hex);
    expect(play.result.value!.cp).toBe(expected.cp);
    expect(play.result.value!.rarity).toBe(expected.rarity);
  });

  it('reveal() 幂等：连续调用 3 次，历史里该日期仍只有 1 条', async () => {
    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    await play.reveal();
    await play.reveal();
    await play.reveal();

    expect(play.revealed.value).toBe(true);
    expect(loadHistory()).toHaveLength(1);
    expect(loadHistory().filter(entry => entry.date === '2026-03-04')).toHaveLength(1);
  });

  it('已有存档：load() 直接 revealed === true（刷新不再要求点击）', async () => {
    const first = useDailyColor({ date: DAY_1 });
    await first.load();
    await first.reveal();

    // 模拟刷新：全新实例、同一天的另一时刻。
    const second = useDailyColor({ date: DAY_1_LATE });
    await second.load();

    expect(second.revealed.value).toBe(true);
    expect(snapshot(second)).toEqual(snapshot(first));
  });

  it('滚动不改变结果：动画前后 / 落盘值都必须等于纯函数输出', async () => {
    // HexRoller 那些随机字符只是装饰——它没有任何回写 composable 的入口。
    // 这里用"reveal 前后取值完全一致 + 落盘等于纯函数"把这条约束钉死。
    const expected = expectedFor(DAY_1);
    const play = useDailyColor({ date: DAY_1 });

    await play.load();
    const before = snapshot(play);
    const colorBefore = play.color.value;

    await play.reveal();

    const after = snapshot(play);
    expect(after).toEqual(before);
    expect(play.color.value).toBe(colorBefore); // 连对象引用都没换过
    expect(after).toEqual(expected);
    expect(loadTodayResult('2026-03-04')).toEqual({ date: '2026-03-04', ...expected });
  });

  it('跨天：新的一天 revealed === false（需要重新点击）', async () => {
    const day1 = useDailyColor({ date: DAY_1 });
    await day1.load();
    await day1.reveal();
    expect(day1.revealed.value).toBe(true);

    const day2 = useDailyColor({ date: DAY_2 });
    await day2.load();

    expect(day2.revealed.value).toBe(false);
    expect(loadTodayResult('2026-03-05')).toBeNull();
    // 今天还没落盘，连续天数不把今天算进去
    expect(day2.streak.value).toBe(0);

    await day2.reveal();
    expect(day2.revealed.value).toBe(true);
    expect(day2.streak.value).toBe(2);
  });

  // ── 既有语义（冻结 / 每天一次 / 跨天换色） ───────────────────────────────

  it('刷新不变：同一天抽过之后连续 load 两次，cp / hex / rarity 完全一致', async () => {
    const first = useDailyColor({ date: DAY_1 });
    await first.load();
    await first.reveal();
    const before = snapshot(first);

    // 模拟"刷新页面"：全新的 composable 实例，同一天的另一时刻。
    const second = useDailyColor({ date: DAY_1_LATE });
    await second.load();
    const after = snapshot(second);

    expect(after.cp).toBe(before.cp);
    expect(after.hex).toBe(before.hex);
    expect(after.rarity).toBe(before.rarity);
    expect(after.badgeIds).toEqual(before.badgeIds);
    expect(before.cp).toBeGreaterThan(0);
  });

  it('刷新不变：清掉缓存后重算，结果依然相同（纯函数决定，不依赖缓存）', async () => {
    const first = useDailyColor({ date: DAY_1 });
    await first.load();
    await first.reveal();
    const before = snapshot(first);

    localStorage.removeItem(STORAGE_KEYS.daily);
    localStorage.removeItem(STORAGE_KEYS.history);

    const second = useDailyColor({ date: DAY_1 });
    await second.load();
    await second.reveal();

    expect(snapshot(second)).toEqual(before);
  });

  it('冻结：存档一旦写下就是权威，不会被重算覆盖', async () => {
    // 「抽出即定」——即使徽章表之后变了（新增徽章 / 修 check / 重跑定价），
    // 这一天的 cp 与命中集合也不允许变。
    const first = useDailyColor({ date: DAY_1 });
    await first.load();
    await first.reveal();
    const before = snapshot(first);

    // 篡改存档：换成完全不同的结果
    const doctored = {
      v: 1,
      date: '2026-03-04',
      hex: '#000000',
      cp: 999999,
      rarity: 'mythic',
      badgeIds: ['casino-six-kind'],
    };
    localStorage.setItem(STORAGE_KEYS.daily, JSON.stringify(doctored));

    const second = useDailyColor({ date: DAY_1 });
    await second.load();

    // 冻结语义下，页面必须显示存档值，而不是纯函数重算的结果
    expect(snapshot(second)).not.toEqual(before);
    expect(second.revealed.value).toBe(true); // 有存档 = 已揭示
    expect(second.result.value!.cp).toBe(999999);
    expect(second.result.value!.rarity).toBe('mythic');
    expect(second.color.value!.hex).toBe('#000000');
    // 取代关系由存档的命中集合推出（单条无 group，全部计分）
    expect(second.result.value!.scoringBadges.map(b => b.id)).toEqual(['casino-six-kind']);
    // 且存档不会被"修正"回纯函数值
    expect(loadTodayResult('2026-03-04')?.cp).toBe(999999);
  });

  it('冻结：存档非法（hex 解析不出来）时退回到首次抽取，不白屏', async () => {
    // 结构守卫会先挡掉大部分脏数据；这里直接塞一个能过守卫但解不出颜色的 hex，
    // 验证 composable 自身也有兜底。
    localStorage.setItem(
      STORAGE_KEYS.daily,
      JSON.stringify({ v: 1, date: '2026-03-04', hex: '#ZZZZZZ', cp: 1, rarity: 'trash', badgeIds: [] }),
    );

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expect(play.revealed.value).toBe(false); // 脏存档 = 还没抽过
    expect(play.color.value).not.toBeNull();
    expect(play.color.value!.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(play.result.value!.cp).toBeGreaterThan(0);
  });

  it('每天只有一次：load + reveal 多次后 history 里该日期只有 1 条', async () => {
    const play = useDailyColor({ date: DAY_1 });

    await play.load();
    await play.reveal();
    await play.load();
    await play.reveal();
    await play.load();

    const sameDay = loadHistory().filter(entry => entry.date === '2026-03-04');
    expect(sameDay).toHaveLength(1);
    expect(loadHistory()).toHaveLength(1);
  });

  it('跨天：不同日期得到不同颜色，且 history 里有两条', async () => {
    const day1 = useDailyColor({ date: DAY_1 });
    await day1.load();
    await day1.reveal();

    const day2 = useDailyColor({ date: DAY_2 });
    await day2.load();
    await day2.reveal();

    expect(day2.historyItem.value!.hex).not.toBe(day1.historyItem.value!.hex);
    expect(loadHistory().map(entry => entry.date)).toEqual(['2026-03-05', '2026-03-04']);
    expect(loadHistory()).toHaveLength(2);
  });

  it('连续天数随注入日期累计', async () => {
    const day1 = useDailyColor({ date: DAY_1 });
    await day1.load();
    await day1.reveal();
    expect(day1.streak.value).toBe(1);

    const day2 = useDailyColor({ date: DAY_2 });
    await day2.load();
    await day2.reveal();
    expect(day2.streak.value).toBe(2);
  });

  it('load 结束后 isLoading 复位，且颜色信息完整', async () => {
    const play = useDailyColor({ date: DAY_1 });
    expect(play.isLoading.value).toBe(false);

    await play.load();

    expect(play.isLoading.value).toBe(false);
    expect(play.color.value?.hex).toBe(play.historyItem.value?.hex);
    expect(play.color.value?.hsl.h).toBeGreaterThanOrEqual(0);
    expect(play.result.value?.scoringBadges.length).toBeGreaterThan(0);
  });

  it('reveal() 在未 load 时也能用（内部补一次读取），结果仍由纯函数决定', async () => {
    const expected = expectedFor(DAY_1);
    const play = useDailyColor({ date: DAY_1 });

    await play.reveal();

    expect(play.revealed.value).toBe(true);
    expect(loadTodayResult('2026-03-04')).toEqual({ date: '2026-03-04', ...expected });
    expect(loadHistory()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式（mock fetch，**不起后端**）
//
// 两条重点：
//   - 规则 1：登录模式一次都不能写 `huedle:daily` / `huedle:history` / `huedle:streak`；
//   - 401 → 清 session、回退本地模式、给出提示，而不是白屏或卡在登录态。
// ─────────────────────────────────────────────────────────────────────────────

/** 服务端下发的今日结果（徽章用真实 id，`restoreScore` 才还原得出来）。 */
const SERVER_ITEM: HistoryItem = {
  date: '2026-03-04',
  hex: '#002FA7',
  cp: 123.5,
  rarity: 'rare',
  badgeIds: ['culture-klein-blue'],
};

/** 本地模式专属的三个记录键——登录模式全程都必须是 null。 */
const LOCAL_KEYS = [STORAGE_KEYS.daily, STORAGE_KEYS.history, STORAGE_KEYS.streak] as const;

function expectNoLocalWrites(): void {
  for (const key of LOCAL_KEYS) expect(localStorage.getItem(key)).toBeNull();
  expect(loadHistory()).toHaveLength(0);
}

/** 建立登录态（token 落盘 + 内存 userId），返回 store 以便断言回退行为。 */
function loginAs(id = 'u1', name = 'Alice'): ReturnType<typeof useSessionStore> {
  setActivePinia(createPinia());
  const store = useSessionStore();
  store.setSession(`tok-${id}`, { id, name });
  return store;
}

/** 服务端替身：`/api/daily` 与 `/api/history` 都返回给定内容。 */
function mockServer(item: HistoryItem = SERVER_ITEM): ReturnType<typeof installFetchMock> {
  return installFetchMock(call =>
    call.url.endsWith('/api/history') ? { body: [item] } : { body: item },
  );
}

describe('useDailyColor — 登录模式', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() 读 /api/daily，按 restoreScore 还原，并注入 Authorization', async () => {
    loginAs();
    const { calls } = mockServer();

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expect(play.color.value?.hex).toBe('#002FA7');
    expect(play.result.value?.cp).toBe(123.5);
    expect(play.result.value?.rarity).toBe('rare');
    expect(play.result.value?.scoringBadges.map(b => b.id)).toEqual(['culture-klein-blue']);
    expect(play.historyItem.value).toEqual(SERVER_ITEM);
    expect(play.revealed.value).toBe(false);
    expect(play.error.value).toBeNull();

    const daily = calls.find(call => call.url.endsWith('/api/daily'));
    expect(daily?.headers.Authorization).toBe('Bearer tok-u1');
  });

  it('规则 1：load() 与 reveal() 一次都不写 huedle:daily / history / streak', async () => {
    loginAs();
    const { calls } = mockServer();

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expectNoLocalWrites();
    expect(loadTodayResult('2026-03-04')).toBeNull();

    const callsAfterLoad = calls.length;
    await play.reveal();
    expect(play.revealed.value).toBe(true);

    expectNoLocalWrites();
    expect(loadTodayResult('2026-03-04')).toBeNull();
    // 唯一被写的是登录模式专属的已揭晓标记
    expect(loadRevealedMarker()).toEqual({ userId: 'u1', date: '2026-03-04' });
    // reveal 用的是内存里的结果，不重新请求后端
    expect(calls.length).toBe(callsAfterLoad);
  });

  it('reveal() 幂等：连续 3 次，标记仍只有一条、本地键仍为空', async () => {
    loginAs();
    mockServer();

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    await play.reveal();
    await play.reveal();
    await play.reveal();

    expect(play.revealed.value).toBe(true);
    expect(loadRevealedMarker()).toEqual({ userId: 'u1', date: '2026-03-04' });
    expectNoLocalWrites();
  });

  it('已揭晓标记命中 → load() 直接 revealed = true（刷新不重播动画）', async () => {
    loginAs();
    saveRevealedMarker('u1', '2026-03-04');
    mockServer();

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expect(play.revealed.value).toBe(true);
    expectNoLocalWrites();
  });

  it('标记属于别的账户 / 别的日期 → revealed 仍为 false', async () => {
    loginAs();
    saveRevealedMarker('u2', '2026-03-04');
    mockServer();

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expect(play.revealed.value).toBe(false);
  });

  it('连续天数复用服务端历史（与本地模式同一份 computeStreak）', async () => {
    loginAs();
    installFetchMock(call =>
      call.url.endsWith('/api/history')
        ? {
            body: [
              { ...SERVER_ITEM, date: '2026-03-04' },
              { ...SERVER_ITEM, date: '2026-03-03' },
            ],
          }
        : { body: SERVER_ITEM },
    );

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expect(play.streak.value).toBe(2);
  });

  it('401 → 清 session、回退本地模式并给出提示（不卡在登录态）', async () => {
    const store = loginAs();
    installFetchMock(() => apiErrorReply(401, 'UNAUTHORIZED', '登录已过期'));
    const expected = expectedFor(DAY_1);

    const play = useDailyColor({ date: DAY_1 });
    await play.load();

    expect(store.isLoggedIn).toBe(false);
    expect(store.token).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();

    expect(play.notice.value).toContain('本地模式');
    expect(play.error.value).toBeNull();
    // 回退后拿到的是本地身份（匿名 ID）的今日颜色
    expect(play.color.value?.hex).toBe(expected.hex);
    expect(play.result.value?.cp).toBe(expected.cp);
    expect(play.revealed.value).toBe(false);
    expectNoLocalWrites();
  });

  it('网络失败 → 可重试的错误态，不白屏；重试后恢复', async () => {
    loginAs();
    installFetchMock(() => {
      throw new TypeError('fetch failed');
    });

    const play = useDailyColor({ date: DAY_1 });
    await expect(play.load()).resolves.toBeUndefined();

    expect(play.error.value).toBeTruthy();
    expect(play.color.value).toBeNull();
    expect(play.result.value).toBeNull();
    expect(play.revealed.value).toBe(false);
    expectNoLocalWrites();

    mockServer(); // 后端恢复
    await play.load();

    expect(play.error.value).toBeNull();
    expect(play.color.value?.hex).toBe('#002FA7');
  });

  it('服务端响应结构不合法 → 可重试错误态，不抛、不白屏', async () => {
    loginAs();
    installFetchMock(() => ({ body: { date: '2026-03-04', hex: '#002FA7' } })); // 缺 cp/rarity/badgeIds

    const play = useDailyColor({ date: DAY_1 });
    await expect(play.load()).resolves.toBeUndefined();

    expect(play.error.value).toBeTruthy();
    expect(play.color.value).toBeNull();
  });
});
