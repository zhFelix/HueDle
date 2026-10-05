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

// ---------------------------------------------------------------------------
// ⑧ / ⑨ / ⑩ 本轮新增：相邻渐变、折行、以及「旧语义一个都不能少」
// ---------------------------------------------------------------------------

/** 带 `perRow` 的挂载（固定每行容量，不依赖容器实测宽度）。 */
async function mountWith(
  entries: HistoryItem[],
  today: string | undefined,
  perRow: number | undefined,
): Promise<HTMLDivElement> {
  const props: Record<string, unknown> = { entries };
  if (today !== undefined) props.today = today;
  if (perRow !== undefined) props.perRow = perRow;

  app = createApp(ColorTimeline, props);
  host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);

  await nextTick();
  return host;
}

/** 所有格子（含缺口），按 DOM 顺序。 */
function cells(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid="timeline-cell"]')];
}

/** 每一格左侧渐变元素的 data-from；`null` = 这一格左侧是硬边（不画）。 */
function linkFromPerCell(root: HTMLElement): (string | null)[] {
  return cells(root).map(
    cell =>
      cell.querySelector<HTMLElement>('[data-testid="timeline-day"][data-from]')?.getAttribute('data-from') ??
      null,
  );
}

/** 所有渐变段的 `from→to` 对，按 DOM 顺序（由 DOM 顺序上的渐变格子带出）。 */
function linkPairs(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll<HTMLElement>('[data-testid="timeline-day"][data-from]'),
  ].map(link => `${link.dataset.from}->${link.dataset.to}`);
}

/** 一格渲染出来的背景（渐变格是 backgroundImage，实心格是 backgroundColor）。 */
function backgroundOf(cell: HTMLElement): string {
  const block = cell.querySelector<HTMLElement>('[data-testid="timeline-day"]');
  if (block === null) return cell.querySelector<HTMLElement>('[data-testid="timeline-gap"]')?.style.cssText ?? '';
  return `${block.style.backgroundImage} ${block.style.backgroundColor}`.trim();
}

/** 一格是不是渐变（背景里真的含 `linear-gradient`）。 */
function isFading(cell: HTMLElement): boolean {
  return backgroundOf(cell).includes('linear-gradient');
}

/** 折行后的每一行（`<ol>`）。 */
function rowLists(root: HTMLElement): HTMLOListElement[] {
  return [...root.querySelectorAll<HTMLOListElement>('[data-testid="timeline-row"]')];
}

describe('⑧ 渐变：相邻有记录的两天之间有过渡', () => {
  it('相邻两天 → 后一格整格是 `#111111 → #222222` 的 linear-gradient，前一行首格实心', async () => {
    const root = await mountWith(
      [item('2026-03-01', { hex: '#111111' }), item('2026-03-02', { hex: '#222222' })],
      '2026-03-02',
      undefined,
    );

    // 行首（03-01）没有可过渡的对象 → 实心当天色。
    expect(cells(root)[0]?.querySelector<HTMLElement>('[data-testid="timeline-day"]')?.style.backgroundColor)
      .toBe('rgb(17, 17, 17)');
    expect(isFading(cells(root)[0]!)).toBe(false);

    // 03-02 带 link → 整格是 `#111111 → #222222` 的渐变。
    const links = [...root.querySelectorAll<HTMLElement>('[data-testid="timeline-day"][data-from]')];
    expect(links).toHaveLength(1);
    expect(links[0]?.dataset.from).toBe('#111111');
    expect(links[0]?.dataset.to).toBe('#222222');

    // 真正渲染出来的样式是渐变（起点 / 终点就是两天的颜色）。
    const bg = links[0]?.style.backgroundImage ?? '';
    expect(bg).toContain('linear-gradient');
    expect(bg).toContain('rgb(17, 17, 17)');
    expect(bg).toContain('rgb(34, 34, 34)');

    // 6px 填缝那种独立元素已经没有了：渐变就是格子本体。
    expect(root.querySelectorAll('[data-testid="timeline-link"]')).toHaveLength(0);
  });

  it('单天 → 没有任何渐变段', async () => {
    const root = await mountWith([item('2026-03-04', { hex: '#002fa7' })], '2026-03-04', undefined);

    expect(cells(root)).toHaveLength(1);
    expect(linkPairs(root)).toEqual([]);
  });
});

describe('⑨ 渐变**不跨缺口**：缺口两侧必须断开', () => {
  it('有记录 / 缺口 / 有记录 → 缺口两侧都没有渐变相连', async () => {
    const root = await mountWith(
      [
        item('2026-03-01', { hex: '#111111' }),
        item('2026-03-02', { hex: '#222222' }),
        item('2026-03-05', { hex: '#555555' }),
        item('2026-03-06', { hex: '#666666' }),
      ],
      '2026-03-06',
      undefined,
    );

    // 01 / 02 / 缺03 / 缺04 / 05 / 06
    expect(cells(root)).toHaveLength(6);
    expect(gaps(root)).toHaveLength(2);
    expect(linkFromPerCell(root)).toEqual([
      null,
      '#111111',
      null,
      null,
      null, // 缺口之后那天的左侧必须是硬边
      '#555555',
    ]);

    // 跨缺口的那一对（02 → 05）绝不能被连起来。
    expect(linkPairs(root)).toEqual(['#111111->#222222', '#555555->#666666']);
    expect(linkPairs(root)).not.toContain('#222222->#555555');
  });

  it('缺口本身不带任何内联样式（不伪造颜色，也不背渐变）', async () => {
    const root = await mountWith(
      [item('2026-03-04', { hex: '#111111' }), item('2026-03-06', { hex: '#666666' })],
      '2026-03-06',
      undefined,
    );

    for (const gap of gaps(root)) {
      expect(gap.getAttribute('style')).toBeNull();
    }
  });
});

describe('⑩ 折行：容量 → 行数正确，且**换行处不出现渐变**', () => {
  it('6 天 / 每行 3 → 2 行；第二行行首不带渐变（不跨行发散）', async () => {
    const root = await mountWith(
      [
        item('2026-03-01', { hex: '#000001' }),
        item('2026-03-02', { hex: '#000002' }),
        item('2026-03-03', { hex: '#000003' }),
        item('2026-03-04', { hex: '#000004' }),
        item('2026-03-05', { hex: '#000005' }),
        item('2026-03-06', { hex: '#000006' }),
      ],
      '2026-03-06',
      3,
    );

    const lists = rowLists(root);
    expect(lists).toHaveLength(2);
    expect(lists.map(list => list.querySelectorAll('[data-testid="timeline-cell"]').length)).toEqual([
      3, 3,
    ]);

    // 两条行内连接在位；两条跨行连接（03→04）不存在。
    expect(linkPairs(root)).toEqual([
      '#000001->#000002',
      '#000002->#000003',
      '#000004->#000005',
      '#000005->#000006',
    ]);

    // 行首那格：显式标了 row-start、link 为 null，于是是实心当天色——
    // 绝不继承上一行行尾的颜色（这就是「换行处不发散」）。
    const startOfSecondRow = lists[1]?.querySelector<HTMLElement>('[data-testid="timeline-cell"]');
    expect(startOfSecondRow?.dataset.rowStart).toBe('true');
    expect(
      startOfSecondRow?.querySelector<HTMLElement>('[data-testid="timeline-day"]')?.getAttribute('data-from'),
    ).toBeNull();
    expect(isFading(startOfSecondRow!)).toBe(false);
    expect(backgroundOf(startOfSecondRow!)).toContain('rgb(0, 0, 4)');
    expect(backgroundOf(startOfSecondRow!)).not.toContain('rgb(0, 0, 3)');

    // 行尾那格（第一行最后一个）的渐变收在当天色上，绝不指向下一行的第一天。
    const endOfFirstRow = [...(lists[0]?.querySelectorAll<HTMLElement>('[data-testid="timeline-cell"]') ?? [])].pop();
    expect(
      endOfFirstRow?.querySelector<HTMLElement>('[data-testid="timeline-day"]')?.getAttribute('data-to'),
    ).toBe('#000003');
    expect(backgroundOf(endOfFirstRow!)).not.toContain('rgb(0, 0, 4)');
  });

  it('换行数量随容量变化：7 天 / 每行 2 → 4 行（3 / 3 / ... 最后一行 1 格）', async () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      item(`2026-03-0${i + 1}`, { hex: `#00000${i}` }),
    );
    const root = await mountWith(entries, '2026-03-07', 2);

    expect(rowLists(root)).toHaveLength(4);
    expect(cells(root)).toHaveLength(7);
    expect(
      rowLists(root).map(list => list.querySelectorAll('[data-testid="timeline-cell"]').length),
    ).toEqual([2, 2, 2, 1]);
  });

  it('折行后 DOM 仍是全局升序（折行不改变时间方向）', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => item(`2026-03-0${i + 1}`));
    const root = await mountWith(entries, '2026-03-05', 2);

    const rendered = [...root.querySelectorAll<HTMLElement>('[data-date]')].map(
      node => node.dataset.date ?? '',
    );
    expect(rendered).toEqual([...rendered].sort((a, b) => a.localeCompare(b)));
  });
});

describe('⑪ 旧语义一个都不能少：今天 ring / tooltip / 缺口可见 / 键盘可聚焦', () => {
  it('今天那格仍是琥珀 ring，其余不是', async () => {
    const root = await mountWith(
      [item('2026-03-01', { hex: '#111111' }), item('2026-03-02', { hex: '#222222' })],
      '2026-03-02',
      3,
    );

    const [older, todayBlock] = blocks(root);
    expect(older?.className).not.toContain('ring-amber-400');
    expect(todayBlock?.dataset.today).toBe('true');
    expect(todayBlock?.className).toContain('ring-2');
    expect(todayBlock?.className).toContain('ring-amber-400');
  });

  it('tooltip 仍是 `日期 · HEX`，缺口仍是 `日期 · 没有记录`', async () => {
    const root = await mountWith(
      [item('2026-03-04', { hex: '#002fa7' }), item('2026-03-06', { hex: '#66ccff' })],
      '2026-03-06',
      3,
    );

    expect(blocks(root)[0]?.getAttribute('title')).toBe('2026-03-04 · #002FA7');
    expect(blocks(root)[0]?.getAttribute('aria-label')).toBe('2026-03-04 #002FA7');
    expect(gaps(root)[0]?.getAttribute('title')).toBe('2026-03-05 · 没有记录');
  });

  it('缺口仍然可见（虚线灰块），且不伪造颜色', async () => {
    const root = await mountWith(
      [item('2026-03-04'), item('2026-03-06')],
      '2026-03-06',
      3,
    );
    const gap = gaps(root)[0]!;

    expect(gap.className).toContain('border-dashed');
    expect(gap.getAttribute('aria-hidden')).toBe('true');
    expect(gap.getAttribute('style')).toBeNull();
  });

  it('色块是 <button> 且真的能聚焦（键盘可达），缺口不可聚焦', async () => {
    const root = await mountWith(
      [item('2026-03-04', { hex: '#111111' }), item('2026-03-06', { hex: '#666666' })],
      '2026-03-06',
      3,
    );

    const block = blocks(root)[0]!;
    expect(block.tagName).toBe('BUTTON');
    block.focus();
    expect(document.activeElement).toBe(block);

    for (const gap of gaps(root)) {
      expect(gap.tagName).toBe('SPAN');
      expect(gap.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('默认定位到最新那端：挂载时同时滚到最右与最下', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 4500,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 900,
    });

    try {
      const root = await mountWith([item('2026-03-04'), item('2026-03-05')], '2026-03-05', 1);
      const scroller = root.querySelector<HTMLElement>('[data-testid="timeline-scroller"]');

      expect(scroller?.scrollLeft).toBe(4500);
      expect(scroller?.scrollTop).toBe(900);
    } finally {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });
});

describe('⑫ 边界：空历史 / 单天 / 大量断档 不崩、不出现 NaN', () => {
  it('空历史 → 空态、不渲染滚动容器、无 NaN', async () => {
    const root = await mountWith([], '2026-03-04', 3);

    expect(root.querySelector('[data-testid="timeline-empty"]')?.textContent?.trim()).toBe(
      '还没有颜色记录。',
    );
    expect(root.querySelector('[data-testid="timeline-scroller"]')).toBeNull();
    expect(rowLists(root)).toHaveLength(0);
    expect(root.textContent).not.toContain('NaN');
  });

  it('单天 + 每行 1 → 1 行 1 格，无渐变、无 NaN', async () => {
    const root = await mountWith([item('2026-03-04', { hex: '#002fa7' })], '2026-03-04', 1);

    expect(rowLists(root)).toHaveLength(1);
    expect(cells(root)).toHaveLength(1);
    expect(linkPairs(root)).toEqual([]);
    expect(root.textContent).not.toContain('NaN');
    expect(root.textContent).not.toContain('undefined');
  });

  it('大量断档（2016 → 2026）+ 折行 → 不崩，缺口两侧仍然没有渐变', async () => {
    const root = await mountWith(
      [item('2016-03-04', { hex: '#aaaaaa' }), item('2026-03-04', { hex: '#bbbbbb' })],
      '2026-03-04',
      30,
    );

    expect(rowLists(root)).toHaveLength(Math.ceil(3653 / 30));
    expect(blocks(root)).toHaveLength(2);
    expect(gaps(root)).toHaveLength(3651);
    expect(linkPairs(root)).toEqual([]);
    expect(root.textContent).not.toContain('NaN');
  });

  it('非法 perRow（0 / NaN）不崩，也不产出 NaN', async () => {
    for (const bad of [0, Number.NaN]) {
      const root = await mountWith([item('2026-03-04'), item('2026-03-05')], '2026-03-05', bad);
      expect(blocks(root)).toHaveLength(2);
      expect(cells(root).length).toBeGreaterThan(0);
      expect(root.textContent).not.toContain('NaN');
    }
  });
});

// ---------------------------------------------------------------------------
// ⑬ 本轮：渐变是格子本体（不再是 6px 填缝），两条语义一条都不能丢
// ---------------------------------------------------------------------------

describe('⑬ 每格自己就是渐变：有 link 的格子是渐变，没 link 的格子是实心', () => {
  /**
   * 01 / 02 / 缺 03 / 缺 04 / 05 / 06，颜色按位次递增便于断言端点。
   * 期望（`link` 属于**较晚**那格）：
   *   01 行首、无 link → 实心 #111111
   *   02 有 link(#111111→#222222) → 整格渐变
   *   03/04 缺口 → 虚线灰块，不带任何内联样式
   *   05 缺口之后、无 link → 实心 #555555（硬边，缺口没有被渐变跨过）
   *   06 有 link(#555555→#666666) → 整格渐变
   */
  async function withGap(): Promise<HTMLDivElement> {
    return mountWith(
      [
        item('2026-03-01', { hex: '#111111' }),
        item('2026-03-02', { hex: '#222222' }),
        item('2026-03-05', { hex: '#555555' }),
        item('2026-03-06', { hex: '#666666' }),
      ],
      '2026-03-06',
      30,
    );
  }

  it('① 有 link 的格子背景是渐变：含 linear-gradient，两端就是 link.from / link.to', async () => {
    const root = await withGap();
    const [d01, d02, g03, g04, d05, d06] = cells(root);

    for (const cell of [d02!, d06!]) {
      expect(isFading(cell)).toBe(true);
      expect(backgroundOf(cell)).toContain('linear-gradient');
    }

    // 端点色就是两天的颜色（顺序 = 时间前进方向）。
    expect(backgroundOf(d02!)).toContain('linear-gradient(to right, rgb(17, 17, 17), rgb(34, 34, 34))');
    expect(backgroundOf(d06!)).toContain('linear-gradient(to right, rgb(85, 85, 85), rgb(102, 102, 102))');
    expect(d02?.querySelector('[data-testid="timeline-day"]')?.getAttribute('data-to')).toBe('#222222');

    // 行首 / 缺口之后那格没有可过渡的对象 → 实心。
    for (const cell of [d01!, d05!]) {
      expect(isFading(cell)).toBe(false);
    }
    expect(backgroundOf(d01!)).toContain('rgb(17, 17, 17)');
    expect(backgroundOf(d05!)).toContain('rgb(85, 85, 85)');
    expect(g03?.querySelector<HTMLElement>('[data-testid="timeline-gap"]')).not.toBeNull();
    expect(g04?.querySelector<HTMLElement>('[data-testid="timeline-gap"]')).not.toBeNull();
  });

  it('② 无 link 的格子是实心（背景里不含 linear-gradient）——行首、单天、缺口', async () => {
    // 行首：每行 2 格 → 第二行第一格（03-03）是新行的行首。
    const rowBreak = await mountWith(
      [
        item('2026-03-01', { hex: '#111111' }),
        item('2026-03-02', { hex: '#222222' }),
        item('2026-03-03', { hex: '#333333' }),
        item('2026-03-04', { hex: '#444444' }),
      ],
      '2026-03-04',
      2,
    );
    const rowStartCells = rowLists(rowBreak).map(list => cells(list)[0]!);
    expect(rowStartCells).toHaveLength(2);

    for (const cell of rowStartCells) {
      expect(cell.dataset.rowStart).toBe('true');
      // 没有 link（行首）→ 实心，背景里没有渐变。
      expect(isFading(cell)).toBe(false);
      expect(cell.querySelector('[data-testid="timeline-day"][data-from]')).toBeNull();
    }
    expect(backgroundOf(rowStartCells[1]!)).toContain('rgb(51, 51, 51)');

    // 缺口：两端都没有 link，缺口本身也不上色（没有内联样式，自然也没有渐变）。
    app?.unmount();
    host?.remove();
    const gapped = await mountWith(
      [item('2026-03-04', { hex: '#111111' }), item('2026-03-06', { hex: '#666666' })],
      '2026-03-06',
      30,
    );
    expect(gaps(gapped)).toHaveLength(1);
    expect(backgroundOf(cells(gapped)[1]!)).toBe(''); // 缺口：没有内联样式
    for (const cell of cells(gapped)) {
      expect(isFading(cell)).toBe(false);
    }

    // 单天：唯一那格也没有可过渡的对象。
    app?.unmount();
    host?.remove();
    const single = await mountWith([item('2026-03-04', { hex: '#002fa7' })], '2026-03-04', 30);
    expect(cells(single)).toHaveLength(1);
    expect(isFading(cells(single)[0]!)).toBe(false);
    expect(backgroundOf(cells(single)[0]!)).toContain('rgb(0, 47, 167)');
  });

  it('③ 缺口两侧仍然断开：没有任何渐变的端点跨过缺口（02 → 05 不存在）', async () => {
    const root = await withGap();

    // 跨缺口的那一对绝不能被连起来：既没有 `#222222 → #555555` 的渐变，
    // 也没有任何一格的渐变里同时出现缺口的另一端颜色。
    expect(linkPairs(root)).toEqual(['#111111->#222222', '#555555->#666666']);
    expect(linkPairs(root)).not.toContain('#222222->#555555');
    for (const cell of cells(root)) {
      const bg = backgroundOf(cell);
      expect(bg.includes('rgb(34, 34, 34)') && bg.includes('rgb(85, 85, 85)')).toBe(false);
    }

    // 缺口那两格不带任何内联样式（不伪造颜色，也不背渐变）。
    for (const gap of gaps(root)) {
      expect(gap.getAttribute('style')).toBeNull();
    }
  });

  it('④ 填缝没有了：格子相邻（li 不再带 ml-1.5 填缝，也没有独立的 timeline-link 元素）', async () => {
    const root = await withGap();

    expect(root.querySelectorAll('[data-testid="timeline-link"]')).toHaveLength(0);
    for (const cell of cells(root)) {
      expect(cell.className).not.toContain('ml-1.5');
    }
  });

  it('⑤ 折行处不发散：行尾的渐变收在当天色，行首绝不出现上一行行尾的颜色', async () => {
    const root = await mountWith(
      [
        item('2026-03-01', { hex: '#000001' }),
        item('2026-03-02', { hex: '#000002' }),
        item('2026-03-03', { hex: '#000003' }),
        item('2026-03-04', { hex: '#000004' }),
      ],
      '2026-03-04',
      2,
    );
    const [row1, row2] = rowLists(root).map(list => cells(list));

    // 行尾（03-02）的渐变右端是它自己，不含下一行第一天（#000003）的颜色。
    expect(backgroundOf(row1![1]!)).not.toContain('rgb(0, 0, 3)');
    // 行首（03-03）实心自己，不含上一行行尾（#000002）的颜色。
    expect(isFading(row2![0]!)).toBe(false);
    expect(backgroundOf(row2![0]!)).not.toContain('rgb(0, 0, 2)');
    expect(backgroundOf(row2![0]!)).toContain('rgb(0, 0, 3)');
  });
});
