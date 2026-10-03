/**
 * 图鉴页面渲染测试（任务 ⑤/④）。
 *
 * 只钉两件事，且都断言**真实渲染结果**而不是源码：
 *
 *  1. **76 条全部出现**（未获得的也在占位），且未获得的卡片里
 *     **既没有判定条件、也没有 CP、也没有稀有度胶囊**——只留名称；
 *  2. 已获得的卡片反过来必须**完整**（名称 + 条件 + CP），被取代的徽章也算已获得。
 *
 * 用 `allBadges` 逐条取 description / cp 做断言（不手抄字符串），
 * 这样以后有人"顺手"把未获得的条件加回去，测试立刻变红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { allBadges } from '@huedle/shared';
import { saveTodayResult, type HistoryItem } from '../lib/storage';
import { formatCp } from '../lib/format';
import BadgeBook from './BadgeBook.vue';

let app: App | null = null;
let host: HTMLDivElement | null = null;
let router: Router | null = null;

const DAY = (date: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  date,
  hex: '#002FA7',
  cp: 100,
  rarity: 'common',
  badgeIds: [],
  ...over,
});

async function mountBadgeBook(): Promise<HTMLDivElement> {
  app = createApp(BadgeBook);
  app.use(createPinia());
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/badges', component: BadgeBook },
    ],
  });
  app.use(router);
  await router.isReady();

  host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);

  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
  return host;
}

/** 取某条徽章卡片的元素（`data-badge-id` 由页面模板写入）。 */
function cardOf(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-badge-id="${id}"]`);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  app?.unmount();
  app = null;
  router = null;
  host?.remove();
  host = null;
});

describe('BadgeBook 页面', () => {
  it('5. 未收集也出现：渲染 76 条，且未获得的卡片不含条件 / CP / 稀有度', async () => {
    const root = await mountBadgeBook();

    // 全部渲染（不是只渲染已收集的）；条数从 shared 取，不写死。
    const items = root.querySelectorAll('[data-testid="badge-item"]');
    expect(items).toHaveLength(allBadges.length);
    expect(root.querySelectorAll('[data-testid="family-section"]')).toHaveLength(10);
    // 空历史 → 全部未获得。
    expect(root.querySelectorAll('[data-collected="false"]')).toHaveLength(allBadges.length);

    // 逐条断言：名称在，条件 / CP / 稀有度标签不在。
    for (const badge of allBadges) {
      const card = cardOf(root, badge.id);
      expect(card, badge.id).not.toBeNull();
      const text = card?.textContent ?? '';

      expect(text, `${badge.id} 应显示名称`).toContain(badge.name);
      expect(text, `${badge.id} 不应泄露判定条件`).not.toContain(badge.description);
      expect(text, `${badge.id} 不应泄露 CP`).not.toContain(formatCp(badge.cp));
      expect(text, `${badge.id} 应标记未获得`).toContain('未获得');
      expect(card?.querySelector('[data-testid="badge-cp"]'), badge.id).toBeNull();
    }

    // 空状态：一句话 + 去今日页的入口；图鉴主体照常渲染。
    const empty = root.querySelector('[data-testid="empty-state"]');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe('/');
  });

  it('已获得：完整展示条件与 CP；被取代的徽章同样算已获得', async () => {
    // casino-pair 与 casino-six-kind 同组，前者被后者取代——但两枚都算已收集。
    saveTodayResult(
      DAY('2026-03-04', { badgeIds: ['casino-six-kind', 'casino-pair'], cp: 900, rarity: 'epic' }),
    );

    const root = await mountBadgeBook();

    // 条数不变（仍渲染全部徽章）。
    expect(root.querySelectorAll('[data-testid="badge-item"]')).toHaveLength(allBadges.length);
    expect(root.querySelectorAll('[data-collected="true"]')).toHaveLength(2);

    const sixKind = allBadges.find(badge => badge.id === 'casino-six-kind');
    const pair = allBadges.find(badge => badge.id === 'casino-pair');
    expect(sixKind).toBeDefined();
    expect(pair).toBeDefined();

    // 计分保留的那枚：名称 + 条件 + CP 齐全。
    const sixKindCard = cardOf(root, 'casino-six-kind');
    expect(sixKindCard?.textContent).toContain(sixKind?.name);
    expect(sixKindCard?.textContent).toContain(sixKind?.description);
    expect(sixKindCard?.textContent).toContain(formatCp(sixKind?.cp ?? 0));

    // 被取代的那枚：也算已获得，条件与 CP 照常展示（只是不计分，图鉴不区分）。
    const pairCard = cardOf(root, 'casino-pair');
    expect(pairCard?.getAttribute('data-collected')).toBe('true');
    expect(pairCard?.textContent).toContain(pair?.name);
    expect(pairCard?.textContent).toContain(pair?.description);
    expect(pairCard?.textContent).toContain(formatCp(pair?.cp ?? 0));

    // 对照：真正未收集的那枚依旧只留名称。
    const uncollected = allBadges.find(
      badge => badge.id !== 'casino-pair' && badge.id !== 'casino-six-kind',
    );
    const uncollectedCard = cardOf(root, uncollected?.id ?? '');
    expect(uncollectedCard?.getAttribute('data-collected')).toBe('false');
    expect(uncollectedCard?.textContent).not.toContain(uncollected?.description);
    expect(root.querySelector('[data-testid="empty-state"]')).toBeNull();
  });
});
