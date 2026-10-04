/**
 * `components/ColorTimeline.vue` 的渲染测试。
 *
 * 组件是**纯展示**：只吃 `entries` / `today` 两个 prop，不调 `useHistory()`、
 * 不读存储、不发请求——所以这里直接用 `createApp` 挂载、传 props 造数据，
 * 不需要 router / pinia，也不需要 `saveTodayResult()` 铺垫。
 *
 * 断言的是**真实渲染出来的 DOM**（按钮数、顺序、title、class），不是源码文本。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import type { HistoryItem } from '../lib/storage';
import ColorTimeline from './ColorTimeline.vue';

let app: App | null = null;
let host: HTMLDivElement | null = null;

function item(date: string, over: Partial<HistoryItem> = {}): HistoryItem {
  return { date, hex: '#002fa7', cp: 100, rarity: 'common', badgeIds: [], ...over };
}

async function mount(entries: HistoryItem[], today?: string): Promise<HTMLDivElement> {
  app = today === undefined ? createApp(ColorTimeline, { entries }) : createApp(ColorTimeline, { entries, today });

  host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);

  await nextTick();
  return host;
}

/** 已渲染的色块（有记录的那天）。 */
function blocks(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-testid="timeline-day"]')];
}

/** 已渲染的缺口占位块。 */
function gaps(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid="timeline-gap"]')];
}

function dateList(nodes: readonly HTMLElement[]): string[] {
  return nodes.map(node => node.dataset.date ?? '');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  app?.unmount();
  app = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe('① 排布：连续 5 天 → 5 个色块，顺序从左到右', () => {
  it('渲染 5 个色块，data-date 升序，没有缺口块', async () => {
    const root = await mount(
      [
        item('2026-03-05'),
        item('2026-03-01'),
        item('2026-03-03'),
        item('2026-03-02'),
        item('2026-03-04'),
      ],
      '2026-03-05',
    );

    expect(blocks(root)).toHaveLength(5);
    expect(gaps(root)).toHaveLength(0);
    expect(dateList(blocks(root))).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    expect(root.querySelector('[data-testid="timeline-empty"]')).toBeNull();
    expect(root.querySelector('[data-testid="timeline-scroller"]')).not.toBeNull();
  });

  it('色块背景色就是当天的 hex，尺寸是 12px 宽（w-3）、高占满 64px 条带（h-16 容器）', async () => {
    const root = await mount([item('2026-03-04', { hex: '#002fa7' })], '2026-03-04');
    const block = blocks(root)[0];

    expect(block?.style.backgroundColor).toBe('rgb(0, 47, 167)');
    expect(block?.className).toContain('w-3');
    expect(block?.className).toContain('h-full');
    expect(root.querySelector('ol')?.className).toContain('h-16');
    expect(root.querySelector('ol')?.className).toContain('min-w-min');
  });

  it('天数是**有记录的天数**（缺口不计入）', async () => {
    const root = await mount(
      [item('2026-03-01'), item('2026-03-02'), item('2026-03-05'), item('2026-03-06')],
      '2026-03-06',
    );

    expect(root.querySelector('[data-testid="timeline-count"]')?.textContent?.trim()).toBe('4 天');
  });
});

describe('② 缺口：中间断 2 天 → 虚线占位块，总数正确', () => {
  it('5 有记录 + 2 缺口 → 5 个色块、2 个缺口块，顺序与日期正确', async () => {
    const root = await mount(
      [
        item('2026-03-01'),
        item('2026-03-02'),
        item('2026-03-05'),
        item('2026-03-06'),
        item('2026-03-07'),
      ],
      '2026-03-07',
    );

    expect(blocks(root)).toHaveLength(5);
    expect(gaps(root)).toHaveLength(2);
    expect(dateList(gaps(root))).toEqual(['2026-03-03', '2026-03-04']);

    // 缺口是虚线灰块，且不是按钮（不可聚焦、不可点）。
    const gap = gaps(root)[0]!;
    expect(gap.className).toContain('border-dashed');
    expect(gap.tagName).toBe('SPAN');
    expect(gap.getAttribute('aria-hidden')).toBe('true');
    // 缺口不伪造颜色。
    expect(gap.getAttribute('style')).toBeNull();
  });

  it('缺口块也有悬停提示，说清「这天没有记录」', async () => {
    const root = await mount([item('2026-03-04'), item('2026-03-06')], '2026-03-06');

    expect(gaps(root)[0]?.getAttribute('title')).toBe('2026-03-05 · 没有记录');
  });
});

describe('③ 排序健壮：props 顺序打乱，DOM 仍按日期升序', () => {
  it('乱序 entries → 渲染顺序升序，且 DOM 顺序 === 日期顺序', async () => {
    const root = await mount(
      [
        item('2026-03-07'),
        item('2026-03-01'),
        item('2026-03-06'),
        item('2026-03-02'),
        item('2026-03-05'),
      ],
      '2026-03-07',
    );

    const rendered = [...root.querySelectorAll<HTMLElement>('[data-date]')];
    const renderedDates = dateList(rendered);

    expect(renderedDates).toEqual([...renderedDates].sort((a, b) => a.localeCompare(b)));
    expect(renderedDates[0]).toBe('2026-03-01');
    expect(renderedDates[renderedDates.length - 1]).toBe('2026-03-07');
  });
});

describe('④ 空历史 / 单天：不崩、不出现 NaN', () => {
  it('空历史 → 显示空态文案，且**不渲染滚动容器**（避免一条灰横条）', async () => {
    const root = await mount([], '2026-03-04');

    expect(root.querySelector('[data-testid="timeline-empty"]')?.textContent?.trim()).toBe(
      '还没有颜色记录。',
    );
    expect(root.querySelector('[data-testid="timeline-scroller"]')).toBeNull();
    expect(blocks(root)).toHaveLength(0);
    expect(root.querySelector('[data-testid="timeline-count"]')).toBeNull();
    expect(root.textContent).not.toContain('NaN');
  });

  it('单天 → 1 个色块，标题与标签正常，无 NaN', async () => {
    const root = await mount([item('2026-03-04')], '2026-03-04');
    const block = blocks(root)[0];

    expect(blocks(root)).toHaveLength(1);
    expect(block?.dataset.today).toBe('true');
    expect(block?.getAttribute('title')).toBe('2026-03-04 · #002FA7');
    expect(root.textContent).not.toContain('NaN');
    expect(root.textContent).toContain('1 天');
  });
});

describe('⑤ 跨月跨年 / 今天标记', () => {
  it('2026-12-31 + 2027-01-01 → 2 个色块 0 缺口，今天那格有琥珀 ring', async () => {
    const root = await mount([item('2026-12-31'), item('2027-01-01')], '2027-01-01');

    expect(dateList(blocks(root))).toEqual(['2026-12-31', '2027-01-01']);
    expect(gaps(root)).toHaveLength(0);

    const [older, today] = blocks(root);
    expect(older?.dataset.today).toBe('false');
    expect(older?.className).not.toContain('ring-amber-400');
    expect(today?.dataset.today).toBe('true');
    expect(today?.className).toContain('ring-2');
    expect(today?.className).toContain('ring-amber-400');
  });

  it('不传 today 时没有格子被标成今天（组件用真实 UTC 日期兜底，但不会崩）', async () => {
    const root = await mount([item('2026-12-31'), item('2027-01-01')]);

    expect(blocks(root)).toHaveLength(2);
    expect(blocks(root).filter(block => block.dataset.today === 'true')).toHaveLength(0);
  });
});

describe('⑥ tooltip 文本：格式正确，且不含内部术语', () => {
  const FORBIDDEN = [
    'localStorage',
    'sessionStorage',
    'HistoryItem',
    'badgeIds',
    'restoreScore',
    'useHistory',
    'useDailyColor',
    'getDaily',
    'UTC',
    '服务端',
    '保存在',
    '本地模式',
    '登录模式',
  ];

  it('色块 title = `{date} · {hex}`，aria-label = `{date} {hex}`', async () => {
    const root = await mount([item('2026-03-04', { hex: '#002fa7' })], '2026-03-04');
    const block = blocks(root)[0];

    expect(block?.getAttribute('title')).toBe('2026-03-04 · #002FA7');
    expect(block?.getAttribute('aria-label')).toBe('2026-03-04 #002FA7');
  });

  it('整条时间线（含缺口）的可读文本里没有任何内部术语', async () => {
    const root = await mount(
      [item('2026-03-01'), item('2026-03-04'), item('2026-03-05')],
      '2026-03-05',
    );

    const texts = [
      ...blocks(root).map(block => `${block.getAttribute('title')} ${block.getAttribute('aria-label')}`),
      ...gaps(root).map(gap => gap.getAttribute('title') ?? ''),
      root.textContent ?? '',
    ].join('\n');

    for (const word of FORBIDDEN) {
      expect(texts, `界面上不应出现「${word}」`).not.toContain(word);
    }
    expect(texts).not.toContain('NaN');
    expect(texts).not.toContain('undefined');
  });
});

describe('⑦ 纯展示 + 默认滚到最新', () => {
  it('不同 entries → 不同 DOM（不是渲染了一份写死的东西）', async () => {
    const five = await mount(
      [item('2026-03-01'), item('2026-03-02'), item('2026-03-03'), item('2026-03-04'), item('2026-03-05')],
      '2026-03-05',
    );
    expect(blocks(five)).toHaveLength(5);
    app?.unmount();
    host?.remove();

    const two = await mount(
      [item('2026-03-04', { hex: '#abcdef' }), item('2026-03-05', { hex: '#123456' })],
      '2026-03-05',
    );
    expect(blocks(two)).toHaveLength(2);
    expect(blocks(two)[0]?.style.backgroundColor).toBe('rgb(171, 205, 239)');
  });

  it('组件不读也不写 localStorage（数据全部来自 props）', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await mount([item('2026-03-04')], '2026-03-04');

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('挂载时滚到最右（scrollLeft = scrollWidth），即默认看到最新', async () => {
    // jsdom 不做真实布局：把 scrollWidth 打个桩，验证 onMounted 确实滚了。
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 4500;
      },
    });

    try {
      const root = await mount([item('2026-03-04'), item('2026-03-05')], '2026-03-05');
      const scroller = root.querySelector<HTMLElement>('[data-testid="timeline-scroller"]');

      expect(scroller?.scrollLeft).toBe(4500);
    } finally {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });
});
