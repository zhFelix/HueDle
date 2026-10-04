/**
 * `useBadgeDetail()` 数据层测试（jsdom，本地存储可用）。
 *
 * 它只做派生，所以这里钉的是**派生口径**：
 *  - 已获得：`hits` 来自 `PRICING`（不是 `cp`）、命中日降序、`firstDay` 是最早那天；
 *  - 未获得 / 从未命中：`hitDays` 为空、`firstDay` 为 null，不崩；
 *  - 无历史：概率照旧可读（概率不依赖历史）；
 *  - 被取代的徽章同样算已获得（与 `useBadges()` 同口径，不做 `restoreScore` 过滤）；
 *  - 双模式同源：登录模式（mock `/api/history`）下命中日期与本地模式一致；
 *  - 缺定价：`hits` 为 null，而不是 0。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PRICING } from '@huedle/shared';
import { saveTodayResult, type HistoryItem } from '../lib/storage';
import { installFetchMock } from '../test-utils/mock-fetch';
import { useSessionStore } from '../stores/session';
import { useBadgeDetail } from './useBadgeDetail';

const DAY = (date: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  date,
  hex: '#002FA7',
  cp: 100,
  rarity: 'common',
  badgeIds: [],
  ...over,
});

/** 让 `useHistory()` 内部的异步 `reload()`（登录模式）跑完。 */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBadgeDetail — 本地模式', () => {
  it('已获得：真实概率来自 PRICING，命中日降序，firstDay 是最早那天', () => {
    saveTodayResult(DAY('2026-03-02', { hex: '#111111', badgeIds: ['casino-pair'] }));
    saveTodayResult(
      DAY('2026-03-05', { hex: '#222222', badgeIds: ['casino-pair', 'casino-six-kind'] }),
    );

    const { detailOf } = useBadgeDetail();
    const pair = detailOf('casino-pair');

    expect(pair.isCollected).toBe(true);
    expect(pair.hits).toBe(PRICING['casino-pair'].hits);
    expect(pair.hits).toBe(11_011_456);
    // 与 cp（ep）不是同一个数——详情展示的是概率来源 hits，不是 cp。
    expect(pair.hits).not.toBe(PRICING['casino-pair'].ep);
    expect(pair.hitDays).toEqual([
      { date: '2026-03-05', hex: '#222222' },
      { date: '2026-03-02', hex: '#111111' },
    ]);
    expect(pair.firstDay).toBe('2026-03-02');

    // 同一天命中多条时各自独立。
    const sixKind = detailOf('casino-six-kind');
    expect(sixKind.hitDays).toEqual([{ date: '2026-03-05', hex: '#222222' }]);
    expect(sixKind.firstDay).toBe('2026-03-05');
  });

  it('未获得 / 从未命中：hitDays 为空、firstDay 为 null，但概率仍可读', () => {
    saveTodayResult(DAY('2026-03-02', { badgeIds: ['casino-pair'] }));

    const { detailOf } = useBadgeDetail();
    const other = detailOf('culture-klein-blue');

    expect(other.isCollected).toBe(false);
    expect(other.hitDays).toEqual([]);
    expect(other.firstDay).toBeNull();
    // 概率不依赖历史，未获得也要能读到（UI 是否展示是另一回事）。
    expect(other.hits).toBe(1);
  });

  it('被取代的徽章也算已获得（口径 = 全部 badgeIds 的并集，不过滤取代）', () => {
    // casino-pair 与 casino-six-kind 同组，后者更强；前者仍应算已获得。
    saveTodayResult(DAY('2026-03-04', { badgeIds: ['casino-six-kind', 'casino-pair'] }));

    const { detailOf } = useBadgeDetail();
    expect(detailOf('casino-pair').isCollected).toBe(true);
    expect(detailOf('casino-pair').hitDays).toHaveLength(1);
  });

  it('无历史：不崩，命中为空，概率照常从 PRICING 读到', () => {
    const { detailOf } = useBadgeDetail();
    const detail = detailOf('casino-six-kind');

    expect(detail.isCollected).toBe(false);
    expect(detail.hits).toBe(16);
    expect(detail.hitDays).toEqual([]);
    expect(detail.firstDay).toBeNull();
  });

  it('缺定价：hits 为 null，而不是 fallback 成 0', () => {
    const { detailOf } = useBadgeDetail();
    const detail = detailOf('badge-that-does-not-exist');

    expect(detail.hits).toBeNull();
    expect(detail.isCollected).toBe(false);
    expect(detail.hitDays).toEqual([]);
  });

  it('同一次历史内重复取同一条返回同一结果（缓存不改变口径）', () => {
    saveTodayResult(DAY('2026-03-02', { badgeIds: ['casino-pair'] }));

    const { detailOf } = useBadgeDetail();
    expect(detailOf('casino-pair')).toEqual(detailOf('casino-pair'));
  });
});

describe('useBadgeDetail — 登录模式（mock /api/history）', () => {
  it('命中日期与本地模式同源：登录后命中列表读的是服务端历史', async () => {
    const serverItems = [
      DAY('2026-03-06', { hex: '#333333', badgeIds: ['casino-pair'] }),
      DAY('2026-03-04', { hex: '#444444', badgeIds: ['casino-pair', 'casino-six-kind'] }),
    ];
    const { countOf } = installFetchMock(() => ({ body: serverItems }));

    const store = useSessionStore();
    store.setSession('tok-u1', { id: 'u1', name: 'Alice' });

    const { detailOf } = useBadgeDetail();
    await flush();

    // 确实走了服务端（不是本地记录）。注意：本 composable 按设计同时依赖
    // `useBadges()`（isCollected 口径）与 `useHistory()`（命中日），两者各自持有一个
    // history 实例，所以这里至少 1 次请求；不做「恰好 1 次」的断言。
    expect(countOf('/api/history')).toBeGreaterThanOrEqual(1);

    const pair = detailOf('casino-pair');
    expect(pair.isCollected).toBe(true);
    expect(pair.hitDays).toEqual([
      { date: '2026-03-06', hex: '#333333' },
      { date: '2026-03-04', hex: '#444444' },
    ]);
    expect(pair.firstDay).toBe('2026-03-04');
    expect(pair.hits).toBe(PRICING['casino-pair'].hits);

    // 另一条只命中一天，独立计算。
    expect(detailOf('casino-six-kind').hitDays).toEqual([
      { date: '2026-03-04', hex: '#444444' },
    ]);
  });

  it('登录模式无历史：不崩，命中为空', async () => {
    installFetchMock(() => ({ body: [] }));

    const store = useSessionStore();
    store.setSession('tok-u1', { id: 'u1', name: 'Alice' });

    const { detailOf } = useBadgeDetail();
    await flush();

    const detail = detailOf('casino-pair');
    expect(detail.isCollected).toBe(false);
    expect(detail.hitDays).toEqual([]);
    expect(detail.firstDay).toBeNull();
  });
});
