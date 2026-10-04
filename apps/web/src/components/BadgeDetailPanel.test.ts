/**
 * 徽章详情（功能①）渲染测试。
 *
 * 分两层：
 *  A. `BadgeDetailPanel` 直接 mount（纯 props）：四种输入形态——已获得有命中 /
 *     未获得 / 命中为空（防御性边界）/ 命中溢出 12 条 / 缺定价；
 *  B. `BadgeBook.vue` 集成：就地展开收起、多开、未获得展开后**不泄露**概率与判定条件。
 *
 * 未获得那条是**反向断言**（`not.toContain`），是防回归的关键：
 * 只要有人"顺手"把概率加回未获得分支，这里立刻变红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { PRICING, allBadges, type Badge } from '@huedle/shared';
import { saveTodayResult, type HistoryItem } from '../lib/storage';
import { formatCount, formatProbability } from '../lib/probability';
import type { BadgeDetail, BadgeHitRecord } from '../composables/useBadgeDetail';
import BadgeBook from '../pages/BadgeBook.vue';
import BadgeDetailPanel from './BadgeDetailPanel.vue';

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

function badgeOf(id: string): Badge {
  const badge = allBadges.find(entry => entry.id === id);
  if (!badge) throw new Error(`测试用徽章不存在：${id}`);
  return badge;
}

function detailOf(over: Partial<BadgeDetail> = {}): BadgeDetail {
  return { hits: 255, hitDays: [], firstDay: null, isCollected: false, ...over };
}

/** 生成 N 天降序命中记录（date 形如 2026-03-01 …）。 */
function hitDaysDescending(count: number): BadgeHitRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const day = String(count - index).padStart(2, '0');
    return { date: `2026-03-${day}`, hex: '#002FA7' };
  });
}

async function mountPanel(props: { badge: Badge; detail: BadgeDetail }): Promise<HTMLDivElement> {
  app = createApp(BadgeDetailPanel, props);
  host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  await nextTick();
  return host;
}

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

/** 取某条徽章卡片的外层 `li`。 */
function cardOf(root: HTMLElement, id: string): HTMLElement {
  const card = root.querySelector<HTMLElement>(`[data-badge-id="${id}"]`);
  if (!card) throw new Error(`找不到徽章卡片：${id}`);
  return card;
}

/** 展开 / 收起某条徽章，并等一帧。 */
async function toggleCard(root: HTMLElement, id: string): Promise<void> {
  cardOf(root, id).querySelector<HTMLButtonElement>('button')?.click();
  await nextTick();
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

// ─────────────────────────────────────────────────────────────────────────────
// A. 面板纯展示
// ─────────────────────────────────────────────────────────────────────────────

describe('BadgeDetailPanel — 已获得', () => {
  it('1. 显示真实概率、判定条件、命中日期列表与首次命中日', async () => {
    const badge = badgeOf('casino-pair');
    const root = await mountPanel({
      badge,
      detail: detailOf({
        hits: PRICING['casino-pair'].hits,
        isCollected: true,
        hitDays: [
          { date: '2026-03-05', hex: '#222222' },
          { date: '2026-03-02', hex: '#111111' },
        ],
        firstDay: '2026-03-02',
      }),
    });

    const text = root.textContent ?? '';

    // 真实概率：hits 派生的占比，不是 CP（ep）。
    expect(text).toContain('真实概率');
    expect(text).toContain(formatProbability(PRICING['casino-pair'].hits)); // '66%'
    expect(text).not.toContain('CP');
    // 判定条件
    expect(text).toContain('判定条件');
    expect(text).toContain(badge.description);
    // 命中日期列表 + 首次命中日
    expect(text).toContain('你的命中');
    expect(text).toContain('2 天');
    expect(text).toContain('首次 2026-03-02');
    expect(text).toContain('2026-03-05');
    expect(text).toContain('2026-03-02');
    expect(text).not.toContain('另有');
    // 平台 id（kebab-case，给反馈 bug 用）
    expect(root.querySelector('[data-testid="badge-platform-id"]')?.textContent?.trim()).toBe(
      'casino-pair',
    );
  });

  it('5b. hits 为 null（缺定价）时整块概率行不渲染，条件与命中照常', async () => {
    const badge = badgeOf('casino-pair');
    const root = await mountPanel({
      badge,
      detail: detailOf({ hits: null, isCollected: true, hitDays: [], firstDay: null }),
    });

    expect(root.querySelector('[data-testid="badge-probability"]')).toBeNull();
    expect(root.textContent ?? '').not.toContain('真实概率');
    expect(root.textContent ?? '').toContain(badge.description);
  });
});

describe('BadgeDetailPanel — 未获得（反向断言）', () => {
  it('2. 详情不含概率、不含判定条件，只有名称与「未获得」', async () => {
    const badge = badgeOf('pure-only-red');
    const root = await mountPanel({ badge, detail: detailOf({ hits: 255, isCollected: false }) });
    const text = root.textContent ?? '';

    // 只有名称与「未获得」
    expect(text).toContain(badge.name);
    expect(text).toContain('未获得');

    // 反向断言：概率（主展示 / 辅助句 / 大数）、判定条件、命中区、平台 id 一律不出现
    expect(text).not.toContain('真实概率');
    expect(text).not.toContain('判定条件');
    expect(text).not.toContain('你的命中');
    expect(text).not.toContain(badge.description);
    expect(text).not.toContain(formatProbability(255)); // '1 / 255'
    expect(text).not.toContain(formatCount(255));
    expect(text).not.toContain('%');
    expect(text).not.toContain('分之');
    expect(text).not.toContain(badge.id);

    // 结构性断言：三个区块的 testid 都不存在
    expect(root.querySelector('[data-testid="badge-probability"]')).toBeNull();
    expect(root.querySelector('[data-testid="badge-condition"]')).toBeNull();
    expect(root.querySelector('[data-testid="badge-hits"]')).toBeNull();
    expect(root.querySelector('[data-testid="badge-platform-id"]')).toBeNull();
    expect(root.querySelector('[data-testid="badge-undiscovered"]')).not.toBeNull();
  });
});

describe('BadgeDetailPanel — 边界', () => {
  it('4. 命中列表为空：不崩，给出「还没有命中过」', async () => {
    const badge = badgeOf('casino-six-kind');
    const root = await mountPanel({
      badge,
      detail: detailOf({ hits: 16, isCollected: true, hitDays: [], firstDay: null }),
    });
    const text = root.textContent ?? '';

    expect(text).toContain('你的命中');
    expect(text).toContain('0 天');
    expect(text).toContain('还没有命中过');
    expect(text).not.toContain('首次');
    expect(text).not.toContain('另有');
    expect(root.querySelector('[data-testid="badge-hits-empty"]')).not.toBeNull();
  });

  it('命中超过 12 天：只渲染 12 个日期，多出的折叠成「另有 N 天」', async () => {
    const badge = badgeOf('casino-pair');
    const root = await mountPanel({
      badge,
      detail: detailOf({
        hits: PRICING['casino-pair'].hits,
        isCollected: true,
        hitDays: hitDaysDescending(20),
        firstDay: '2026-03-01',
      }),
    });
    const text = root.textContent ?? '';

    expect(text).toContain('20 天');
    expect(root.querySelectorAll('[data-testid="badge-hits"] li')).toHaveLength(12);
    expect(text).toContain('另有 8 天');
    expect(text).toContain('首次 2026-03-01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. BadgeBook 页面集成
// ─────────────────────────────────────────────────────────────────────────────

describe('BadgeBook 集成 — 就地展开', () => {
  it('6. 点击展开 / 再点收起；可以多条同时展开；无历史空态不崩', async () => {
    const root = await mountBadgeBook();

    const first = cardOf(root, 'pure-only-red');
    const second = cardOf(root, 'casino-pair');

    expect(first.querySelector('[data-testid="badge-detail"]')).toBeNull();
    expect(first.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');

    await toggleCard(root, 'pure-only-red');
    expect(first.querySelector('[data-testid="badge-detail"]')).not.toBeNull();
    expect(first.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');

    // 多开：第二条也能同时展开（不是手风琴）
    await toggleCard(root, 'casino-pair');
    expect(first.querySelector('[data-testid="badge-detail"]')).not.toBeNull();
    expect(second.querySelector('[data-testid="badge-detail"]')).not.toBeNull();

    // 收起第一条，第二条不受影响
    await toggleCard(root, 'pure-only-red');
    expect(first.querySelector('[data-testid="badge-detail"]')).toBeNull();
    expect(second.querySelector('[data-testid="badge-detail"]')).not.toBeNull();
    expect(second.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('7. 未获得展开后不泄露概率与判定条件（页面级反向断言）', async () => {
    const root = await mountBadgeBook();
    await toggleCard(root, 'pure-only-red');

    const badge = badgeOf('pure-only-red');
    const panel = cardOf(root, 'pure-only-red').querySelector('[data-testid="badge-detail"]');
    const text = panel?.textContent ?? '';

    expect(text).toContain(badge.name);
    expect(text).toContain('未获得');
    expect(text).not.toContain('真实概率');
    expect(text).not.toContain('判定条件');
    expect(text).not.toContain(badge.description);
    expect(text).not.toContain(formatProbability(PRICING['pure-only-red'].hits));
    expect(text).not.toContain('%');
  });

  it('8. 已获得展开后显示真实概率、判定条件与命中日期', async () => {
    saveTodayResult(DAY('2026-03-04', { hex: '#ABCDEF', badgeIds: ['casino-pair'], cp: 900 }));

    const root = await mountBadgeBook();
    await toggleCard(root, 'casino-pair');

    const badge = badgeOf('casino-pair');
    const panel = cardOf(root, 'casino-pair').querySelector('[data-testid="badge-detail"]');
    const text = panel?.textContent ?? '';

    expect(text).toContain('真实概率');
    expect(text).toContain(formatProbability(PRICING['casino-pair'].hits));
    expect(text).toContain('判定条件');
    expect(text).toContain(badge.description);
    expect(text).toContain('你的命中');
    expect(text).toContain('1 天');
    expect(text).toContain('2026-03-04');
    expect(text).toContain('首次 2026-03-04');
  });

  it('8b. 被取代的徽章展开后同样完整（与已收集口径一致）', async () => {
    saveTodayResult(
      DAY('2026-03-04', { badgeIds: ['casino-six-kind', 'casino-pair'], cp: 900, rarity: 'epic' }),
    );

    const root = await mountBadgeBook();
    await toggleCard(root, 'casino-pair');

    const panel = cardOf(root, 'casino-pair').querySelector('[data-testid="badge-detail"]');
    expect(panel?.getAttribute('data-detail-collected')).toBe('true');
    expect(panel?.textContent ?? '').toContain(badgeOf('casino-pair').description);
  });
});
