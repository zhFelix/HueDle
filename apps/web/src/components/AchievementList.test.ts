/**
 * 成就区块与卡片的渲染测试（功能②）。
 *
 * 钉三件事：
 *  1. 空历史：13 条全部渲染、全部未点亮、总览为 0、有空态文案、不出现 NaN；
 *  2. 不同 `entries` → 不同渲染（点亮条数、解锁日期、进度文案都跟着变）；
 *  3. **纯展示无副作用**：组件不读也不写 `localStorage`——即使存储里躺着
 *     一份足以点亮相当成就的历史，只传空 `entries` 时也必须全部未点亮。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { allBadges, utcDate } from '@huedle/shared';
import { ACHIEVEMENTS } from '../lib/achievements';
import { STORAGE_KEYS, type HistoryItem } from '../lib/storage';
import AchievementList from './AchievementList.vue';

let app: App | null = null;
let host: HTMLDivElement | null = null;

function item(date: string, over: Partial<HistoryItem> = {}): HistoryItem {
  return { date, hex: '#002FA7', cp: 100, rarity: 'common', badgeIds: [], ...over };
}

function consecutiveDays(start: string, n: number): HistoryItem[] {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) =>
    item(utcDate(new Date(Date.UTC(y, m - 1, d + i)))),
  );
}

async function mountAchievements(entries: HistoryItem[]): Promise<HTMLDivElement> {
  app = createApp(AchievementList, { entries });
  host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  await nextTick();
  return host;
}

function cardOf(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-achievement-id="${id}"]`);
}

afterEach(() => {
  app?.unmount();
  app = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AchievementList 渲染', () => {
  it('空历史：13 条全部未点亮、总览 0、有空态文案、不出现 NaN', async () => {
    const root = await mountAchievements([]);

    const cards = root.querySelectorAll('[data-achievement-id]');
    expect(cards).toHaveLength(ACHIEVEMENTS.length);
    expect(root.querySelectorAll('[data-unlocked="false"]')).toHaveLength(ACHIEVEMENTS.length);
    expect(root.querySelectorAll('[data-unlocked="true"]')).toHaveLength(0);
    expect(root.textContent).toContain(`已点亮 0 / ${ACHIEVEMENTS.length}`);
    expect(root.textContent).toContain('抽到第一天的颜色，这里就会开始记录。');
    expect(root.textContent).not.toContain('NaN');
  });

  it('不同 entries 渲染不同：3 天历史点亮 2 条，并显示真实进度与解锁日', async () => {
    const root = await mountAchievements(consecutiveDays('2026-03-01', 3));

    expect(root.querySelectorAll('[data-unlocked="true"]')).toHaveLength(2);
    expect(root.textContent).toContain(`已点亮 2 / ${ACHIEVEMENTS.length}`);
    expect(root.textContent).not.toContain('抽到第一天的颜色，这里就会开始记录。');

    // 第一条成就（第一天）解锁于 2026-03-01；三连解锁于 2026-03-03。
    const first = cardOf(root, 'days-first');
    expect(first?.getAttribute('data-unlocked')).toBe('true');
    expect(first?.textContent).toContain('解锁于 2026-03-01');

    const streak3 = cardOf(root, 'streak-3');
    expect(streak3?.getAttribute('data-unlocked')).toBe('true');
    expect(streak3?.textContent).toContain('解锁于 2026-03-03');

    // 未点亮的七日不辍：进度用真实历史算出。
    const streak7 = cardOf(root, 'streak-7');
    expect(streak7?.getAttribute('data-unlocked')).toBe('false');
    expect(streak7?.textContent).toContain('3 / 7 天');
    expect(streak7?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('43');
  });

  it('收录徽章后十枚徽章显示真实进度 10 / 10', async () => {
    const entries = [
      item('2026-03-04', { badgeIds: allBadges.slice(0, 10).map(badge => badge.id) }),
    ];
    const root = await mountAchievements(entries);

    const badges = cardOf(root, 'badges-10');
    expect(badges?.getAttribute('data-unlocked')).toBe('true');
    expect(badges?.textContent).toContain('解锁于 2026-03-04');

    const badges50 = cardOf(root, 'badges-50');
    expect(badges50?.getAttribute('data-unlocked')).toBe('false');
    expect(badges50?.textContent).toContain('10 / 50');
  });

  it('纯展示：不读也不写 localStorage（存储里的历史被完全忽略）', async () => {
    // 先往存储里塞一份「足以点亮 7 天连续」的历史……
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(consecutiveDays('2026-03-01', 7)));
    localStorage.setItem(STORAGE_KEYS.streak, '7');

    // ……再开始监听，确保只统计组件挂载期间发生的读写。
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    const root = await mountAchievements([]);

    // 只认 props：entries 为空 → 全部未点亮，存储里的 7 天连续不算数。
    expect(root.querySelectorAll('[data-unlocked="true"]')).toHaveLength(0);
    expect(root.textContent).toContain(`已点亮 0 / ${ACHIEVEMENTS.length}`);
    expect(cardOf(root, 'streak-7')?.textContent).toContain('0 / 7 天');

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
