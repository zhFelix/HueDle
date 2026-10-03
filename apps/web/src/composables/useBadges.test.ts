/**
 * `useBadges()` 逻辑层测试（jsdom，本地存储可用）。
 *
 * 覆盖 5 件事：并集去重、**被取代的徽章也算已收集**、空历史、家族分组与 shared 交叉断言、
 * 登录模式（mock fetch，不起后端）。页面渲染在 `pages/BadgeBook.test.ts` 里单独测。
 *
 * 日期通过 `saveTodayResult()` 直接写存档，不 mock 系统时钟。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { allBadges, restoreScore } from '@huedle/shared';
import { STORAGE_KEYS, saveTodayResult, type HistoryItem } from '../lib/storage';
import { FAMILY_ORDER } from '../lib/families';
import { apiErrorReply, installFetchMock } from '../test-utils/mock-fetch';
import { useSessionStore } from '../stores/session';
import { useBadges } from './useBadges';

const DAY = (date: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  date,
  hex: '#002FA7',
  cp: 100,
  rarity: 'common',
  badgeIds: [],
  ...over,
});

describe('useBadges', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── ① 并集去重 ──────────────────────────────────────────────────────────
  it('1. 并集去重：多天重复命中同一徽章只算 1 枚', () => {
    // 先钉住用到的 id 真实存在，避免拼错 id 让本用例"恰好"也过。
    for (const id of ['gray-true-monochrome', 'math-prime-trinity']) {
      expect(allBadges.some(badge => badge.id === id), id).toBe(true);
    }

    saveTodayResult(DAY('2026-03-04', { badgeIds: ['gray-true-monochrome', 'math-prime-trinity'] }));
    saveTodayResult(DAY('2026-03-05', { badgeIds: ['gray-true-monochrome'] }));
    saveTodayResult(DAY('2026-03-06', { badgeIds: ['gray-true-monochrome', 'math-prime-trinity'] }));

    const { totalCollected, isCollected } = useBadges();

    expect(totalCollected.value).toBe(2); // 不是 3，也不是 5
    expect(isCollected('gray-true-monochrome')).toBe(true);
    expect(isCollected('math-prime-trinity')).toBe(true);
  });

  // ── ② 被取代的徽章也算已收集（最重要的一条）────────────────────────────
  it('2. 被「同类更强」取代的徽章也算已收集', () => {
    // casino-six-kind 与 casino-pair 同属 group `casino-rank-count`，后者会被前者取代。
    const frozen = DAY('2026-03-04', { badgeIds: ['casino-six-kind', 'casino-pair'] });
    saveTodayResult(frozen);

    // 先钉住前提：casino-pair 确实是被取代的那一枚（否则本用例没有测到东西）。
    const score = restoreScore(frozen.badgeIds, frozen.cp, frozen.rarity);
    expect(score.scoringBadges.map(badge => badge.id)).toContain('casino-six-kind');
    expect(score.supersededBadges.map(badge => badge.id)).toEqual(['casino-pair']);

    const { isCollected, totalCollected } = useBadges();

    // 被取代 ≠ 未获得：两枚都算已收集。
    expect(isCollected('casino-six-kind')).toBe(true);
    expect(isCollected('casino-pair')).toBe(true);
    expect(totalCollected.value).toBe(2);
  });

  // ── ③ 空历史 ────────────────────────────────────────────────────────────
  it('3. 空历史：全 0，各家族 0/m，不抛异常', () => {
    const { families, totalCollected, totalCount } = useBadges();

    expect(totalCollected.value).toBe(0);
    // 交叉断言而非写死：徽章会持续增补，写死的数字只会让每次加徽章都来改测试。
    expect(totalCount.value).toBe(allBadges.length);
    expect(families.value).toHaveLength(10);
    for (const progress of families.value) {
      expect(progress.collected).toBe(0);
      expect(progress.total).toBeGreaterThan(0);
    }
  });

  // ── ④ 家族分组齐全（与 shared 交叉断言，不写死条数）──────────────────────
  it('4. 家族分组齐全：10 个家族全出现，顺序固定，每族 total = allBadges 真实条数', () => {
    const { families, badgesByFamily, totalCount } = useBadges();

    expect(families.value.map(progress => progress.family)).toEqual([...FAMILY_ORDER]);
    expect(badgesByFamily.value.map(group => group.family)).toEqual([...FAMILY_ORDER]);

    // 交叉断言：条数直接来自 shared，而不是测试里手抄的数字。
    for (const progress of families.value) {
      const expected = allBadges.filter(badge => badge.family === progress.family);
      expect(progress.total).toBe(expected.length);
    }

    // 每个家族都被覆盖，且总数 = allBadges.length（无遗漏、无重复）。
    const covered = families.value.reduce((sum, progress) => sum + progress.total, 0);
    expect(covered).toBe(allBadges.length);
    expect(totalCount.value).toBe(allBadges.length);
  });

  it('4b. 未收集的徽章也在分组里：badgesByFamily 覆盖 allBadges 全部 id', () => {
    const { badgesByFamily } = useBadges();
    const ids = badgesByFamily.value.flatMap(group => group.badges.map(badge => badge.id));
    expect(ids).toEqual(allBadges.map(badge => badge.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 登录模式（mock fetch，**不起后端**）：收集状态来自服务端历史
// ─────────────────────────────────────────────────────────────────────────────

describe('useBadges — 登录模式', () => {
  const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('6. 用服务端 /api/history 算收集状态（本地历史不参与）', async () => {
    // 本地先放一条"会误导"的记录：登录模式下它不该被算进去。
    saveTodayResult(DAY('2026-03-04', { badgeIds: ['gray-true-monochrome'] }));
    expect(localStorage.getItem(STORAGE_KEYS.history)).not.toBeNull();

    const serverItems = [
      DAY('2026-03-06', { cp: 900, badgeIds: ['casino-six-kind', 'casino-pair'] }),
      DAY('2026-03-04', { cp: 100, badgeIds: ['math-prime-trinity'] }),
    ];
    const { calls } = installFetchMock(() => ({ body: serverItems }));

    const store = useSessionStore();
    store.setSession('tok-u1', { id: 'u1', name: 'Alice' });

    const badges = useBadges();
    await flush(); // 构造时的自动 reload 落地（走服务端 + 写缓存）
    await badges.reload();

    const historyCall = calls.find(call => call.url.endsWith('/api/history'));
    expect(historyCall?.headers.Authorization).toBe('Bearer tok-u1');

    // 服务端历史里的三枚都算已收集，包含被取代的 casino-pair。
    expect(badges.isCollected('casino-six-kind')).toBe(true);
    expect(badges.isCollected('casino-pair')).toBe(true);
    expect(badges.isCollected('math-prime-trinity')).toBe(true);
    expect(badges.totalCollected.value).toBe(3);

    // 本地那条（gray-true-monochrome）不在服务端历史里 → 登录模式下不算已收集。
    const serverIds = new Set(serverItems.flatMap(item => item.badgeIds));
    expect(serverIds.has('gray-true-monochrome')).toBe(false);
    expect(badges.isCollected('gray-true-monochrome')).toBe(false);
  });

  it('6b. 401 回退本地模式后，收集状态改用本地历史（并集语义不变）', async () => {
    saveTodayResult(DAY('2026-03-04', { badgeIds: ['gray-true-monochrome', 'casino-pair'] }));
    installFetchMock(() => apiErrorReply(401, 'UNAUTHORIZED', '未授权'));

    const store = useSessionStore();
    store.setSession('tok-u1', { id: 'u1', name: 'Alice' });

    const badges = useBadges();
    await flush();
    await badges.reload();

    expect(store.isLoggedIn).toBe(false);
    expect(badges.totalCollected.value).toBe(2);
    expect(badges.isCollected('casino-pair')).toBe(true);
  });
});
