/**
 * 「我的」页（`Profile.vue`）集成测试。
 *
 * 这个文件是**集成**的守门人，不是组件测试的重复——成就（②）与时间线（③）
 * 各自有独立测试（`AchievementList.test.ts` / `ColorTimeline.test.ts`），
 * 但「组件写好了却没接进页面」和「接进去了却各拉一份历史」这两类错误，
 * 只有页面级测试能发现。因此这里钉四件事：
 *
 *  1. **两个区块真的渲染了**：成就卡片 + 时间线色块都出现在 `/me` 的 DOM 里，
 *     且各出现一次（防止插了两遍 / 复制粘贴式集成）；
 *  2. **页面只有一个历史数据源**：登录模式冷启动（缓存未命中）时，
 *     `GET /api/history` **恰好被调用一次**——如果两个子组件各自调
 *     `useHistory()`，这里会变成 2 次或更多，测试立刻变红；
 *  3. **「当前连续 / 最长连续」并列**：当前为 0 时，最长仍显示历史里真实的 3 天，
 *     否则玩家会看到「当前 0 天」而成就「三连」亮着，当成 bug（设计文档 §8 Q11）；
 *  4. **空历史不崩**：两个区块的空态都要渲染出来（而不是被 `v-if` 整体隐藏）。
 *
 * 断言的是**真实渲染出来的 DOM**（组件挂载 + 数据落地后的文本），不是源码文本。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { ACHIEVEMENTS } from '../lib/achievements';
import { saveTodayResult, type HistoryItem } from '../lib/storage';
import { installFetchMock } from '../test-utils/mock-fetch';
import { useSessionStore } from '../stores/session';
import Profile from './Profile.vue';

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

/** 一段遥远的固定连续 3 天：与「今天」无关，`当前连续` 必为 0、`最长连续` 必为 3。 */
const OLD_3_DAYS = [DAY('2020-01-01'), DAY('2020-01-02'), DAY('2020-01-03')];

/** 等一轮宏任务，让登录模式的 `GET /api/history` 落地。 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function mountProfile(beforeMount?: () => void): Promise<HTMLDivElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 登录态必须在页面 setup（`useHistory()` 首次 reload）之前落定。
  beforeMount?.();

  app = createApp(Profile);
  app.use(pinia);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/me', component: Profile },
      { path: '/login', component: { template: '<div />' } },
    ],
  });
  app.use(router);
  await router.isReady();

  host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);

  await nextTick();
  await flush();
  await nextTick();
  return host;
}

/** 某个统计项的文本，去掉模板缩进带来的空白。 */
function statText(root: HTMLElement, testId: string): string {
  return (root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').replace(/\s+/g, '');
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
  vi.unstubAllGlobals();
});

describe('Profile 集成：两个新区块真的接上了', () => {
  it('有历史：成就列表与颜色时间线都渲染，且各只渲染一次', async () => {
    for (const day of OLD_3_DAYS) saveTodayResult(day);

    const root = await mountProfile();

    // 成就区块：13 条卡片在，第一天 / 三连点亮。
    expect(root.querySelectorAll('[data-achievement-id]')).toHaveLength(ACHIEVEMENTS.length);
    expect(root.querySelectorAll('[data-achievement-id="days-first"]')).toHaveLength(1);
    expect(
      root.querySelector('[data-achievement-id="streak-3"]')?.getAttribute('data-unlocked'),
    ).toBe('true');

    // 时间线区块：3 天连续 → 3 个色块、0 个缺口。
    expect(root.querySelectorAll('[data-testid="timeline"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-testid="timeline-day"]')).toHaveLength(3);
    expect(root.querySelectorAll('[data-testid="timeline-gap"]')).toHaveLength(0);

    // 顺序：统计区 → 成就 → 时间线 → 颜色历史（自上而下）。
    const statsSection = root.querySelector('[data-testid="stats-section"]');
    const achievementsSection = root.querySelector('[data-achievement-id="days-first"]');
    const timelineSection = root.querySelector('[data-testid="timeline"]');
    const historySection = root.querySelector('[aria-label="颜色历史"]');
    expect(statsSection).not.toBeNull();
    expect(achievementsSection).not.toBeNull();
    expect(historySection).not.toBeNull();
    // compareDocumentPosition：右侧节点在左侧节点之后，返回 FOLLOWING(4)。
    expect(statsSection?.compareDocumentPosition(achievementsSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(achievementsSection?.compareDocumentPosition(timelineSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(timelineSection?.compareDocumentPosition(historySection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('当前连续与最长连续并列显示：当前为 0、最长为 3', async () => {
    for (const day of OLD_3_DAYS) saveTodayResult(day);

    const root = await mountProfile();

    expect(statText(root, 'streak-current')).toBe('当前连续0天');
    expect(statText(root, 'streak-longest')).toBe('最长连续3天');
  });

  it('空历史：两个新区块照常渲染，各自给出空态且不出现 NaN / undefined', async () => {
    const root = await mountProfile();

    // 页面空态本身在（截图与回归用）。
    expect(root.textContent).toContain('还没有任何记录，去抽一次今天的颜色吧。');

    // 成就：13 条全部未点亮 + 空态提示（不是被整体隐藏）。
    expect(root.querySelectorAll('[data-achievement-id]')).toHaveLength(ACHIEVEMENTS.length);
    expect(root.querySelectorAll('[data-unlocked="false"]')).toHaveLength(ACHIEVEMENTS.length);
    expect(root.textContent).toContain('抽到第一天的颜色，这里就会开始记录。');

    // 时间线：空态文案在，且不渲染空的滚动容器（避免一条灰横条）。
    expect(root.querySelector('[data-testid="timeline"]')).not.toBeNull();
    expect(statText(root, 'timeline-empty')).toBe('还没有颜色记录。');
    expect(root.querySelector('[data-testid="timeline-scroller"]')).toBeNull();

    expect(root.textContent).not.toContain('NaN');
    expect(root.textContent).not.toContain('undefined');
  });
});

describe('Profile 集成：单一历史数据源（登录模式）', () => {
  it('冷启动 mock /api/history：恰好请求一次，两个区块的数据都来自服务端历史', async () => {
    const serverItems = [
      DAY('2020-01-03', { hex: '#333333' }),
      DAY('2020-01-02', { hex: '#444444' }),
      DAY('2020-01-01', { hex: '#555555' }),
    ];
    const { countOf } = installFetchMock(() => ({ body: serverItems }));

    const root = await mountProfile(() => {
      const store = useSessionStore();
      store.setSession('tok-u1', { id: 'u1', name: 'Alice' });
    });

    // ★ 核心断言：两个新区块都只消费页面那一个 `useHistory()` 实例。
    // 若任一组件自己调一次 `useHistory()`，这里就会是 2 或 3。
    expect(countOf('/api/history')).toBe(1);

    // 两个区块的数据确实来自服务端历史（不是本地存储）。
    expect(
      root.querySelector('[data-achievement-id="streak-3"]')?.getAttribute('data-unlocked'),
    ).toBe('true');
    expect(root.querySelectorAll('[data-testid="timeline-day"]')).toHaveLength(3);
    expect(statText(root, 'streak-longest')).toBe('最长连续3天');
    // 显示的是服务端的 hex，而不是本地那份（本地为空）。
    expect(
      root.querySelector<HTMLElement>('[data-testid="timeline-day"]')?.getAttribute('title'),
    ).toBe('2020-01-01 · #555555');
  });
});
