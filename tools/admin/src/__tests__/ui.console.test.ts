/**
 * 控制台式版面的测试（本次布局改动的验收）：顶栏 + 左导航 + 右详情。
 *
 * 六类要求逐条落在这里：
 *   1. 左栏导航存在，且是「概览 + M1–M8」共 9 项；
 *   2. 默认落在概览；`?m=M3` 时右栏渲染 M3、左栏 M3 有选中态（`aria-current="page"`）；
 *   3. 非法 `m`（不存在的 id、注入尝试）→ 静默回落概览，不崩、不报错、不回显输入；
 *   4. 右栏只渲染选中的那一项（其它指标的标题/问题一个字都不在页面上）；
 *   5. 统计页仍然零 `<script>`、零外链（断网可用）——交互全靠 `<a href>`；
 *   6. 窗口切换（7/30/90）与手动刷新在顶栏仍然可用，且换窗口时保留当前选中项。
 *
 * 同时真的起一次 HTTP 服务，验证 `?m=` 在路由层同样只是"选哪一项"，不新增写路径。
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextForDraws } from '../analyze';
import type { StatsReport } from '../report';
import { analyzeMetric } from '../run';
import { METRICS } from '../stats';
import {
  parseSelection,
  renderUiPage,
  UI_NAV_LABELS,
  UI_OVERVIEW_ID,
  UI_OVERVIEW_LABEL,
  UI_WINDOWS,
} from '../ui/render';
import { createUiServer, listenUiServer } from '../ui/server';
import { escapeHtml } from '../render/html';
import { sampleReport } from './fixtures';

/** 一份 8 条指标齐全、表格为空的完整报告（不依赖数据库）。 */
function fullReport(overrides: Partial<StatsReport> = {}): StatsReport {
  const ctx = contextForDraws(0, 200);
  const sections = METRICS.map(metric =>
    analyzeMetric(
      metric,
      [] as never,
      metric.id === 'M8' ? ([{ duplicates: 0 }] as never) : [],
      ctx,
    ),
  );
  return sampleReport({ sections: [...sections], ...overrides });
}

/** 从整页里剪出顶栏，避免"页面别处也有同样链接"造成的假阳性。 */
function topbarOf(html: string): string {
  const start = html.indexOf('<header class="topbar">');
  const end = html.indexOf('</header>');
  expect(start, '页面应有 <header class="topbar">').toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

/** 从整页里剪出左栏。 */
function sidebarOf(html: string): string {
  const start = html.indexOf('<nav class="sidebar"');
  const end = html.indexOf('</nav>', start);
  expect(start, '页面应有 <nav class="sidebar">').toBeGreaterThanOrEqual(0);
  return html.slice(start, end);
}

describe('测试 1：左栏导航 = 概览 + M1–M8 共 9 项', () => {
  const html = renderUiPage(fullReport(), { days: 30 });
  const sidebar = sidebarOf(html);

  it('9 个导航项，顺序是概览在前、M1…M8 在后', () => {
    expect(sidebar.match(/class="nav-item"/g)).toHaveLength(9);
    expect(sidebar.indexOf('概览')).toBeGreaterThanOrEqual(0);
    expect(sidebar.indexOf('概览')).toBeLessThan(sidebar.indexOf('M1'));
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
      expect(sidebar).toContain(`>${id}<`);
    }
  });

  it('每一项都是普通 <a href>（零 JS 换指标），并带一行短名', () => {
    expect(sidebar).toContain(`<a class="nav-item" href="?days=30"`);
    for (const metric of METRICS) {
      expect(sidebar).toContain(`href="?days=30&m=${metric.id}"`);
      expect(sidebar).toContain(escapeHtml(UI_NAV_LABELS[metric.id]));
    }
    expect(sidebar).toContain(escapeHtml(UI_OVERVIEW_LABEL));
  });
});

describe('测试 2：默认落在概览；?m=M3 渲染 M3 且 M3 选中', () => {
  it('省略 m → 概览项有选中态，右栏是概览（不是任何指标）', () => {
    const html = renderUiPage(fullReport(), { days: 30 });
    expect(html).toContain(`<a class="nav-item" href="?days=30" aria-current="page">`);
    expect(html).toContain(`<section class="card" id="${UI_OVERVIEW_ID}">`);
    expect(html).toContain('class="overview"');
    // 概览时标题区就是概览，M3 的卡片不存在
    expect(html).not.toContain('<section class="card" id="M3">');
  });

  it('m=overview 与省略 m 等价', () => {
    const html = renderUiPage(fullReport(), { days: 30, metric: UI_OVERVIEW_ID });
    expect(html).toContain(`<a class="nav-item" href="?days=30" aria-current="page">`);
    expect(html).toContain(`<section class="card" id="${UI_OVERVIEW_ID}">`);
  });

  it('m=M3 → 右栏是 M3 的卡片（含它回答什么问题），左栏 M3 选中', () => {
    const html = renderUiPage(fullReport(), { days: 30, metric: 'M3' });
    const m3 = METRICS.find(metric => metric.id === 'M3')!;
    expect(html).toContain('<section class="card" id="M3">');
    expect(html).toContain(escapeHtml(m3.title));
    expect(html).toContain(escapeHtml(m3.question));
    expect(html).toContain(`<a class="nav-item" href="?days=30&m=M3" aria-current="page">`);
    // 同一时刻只有一个选中项
    expect(html.match(/class="nav-item" href="[^"]*" aria-current="page"/g)).toHaveLength(1);
    // 选中指标时概览不再渲染
    expect(html).not.toContain(`<section class="card" id="${UI_OVERVIEW_ID}">`);
  });
});

describe('测试 3：非法 m 静默回落概览（不崩、不报错、不回显）', () => {
  const full = fullReport();

  it('parseSelection 只认白名单里的字面量', () => {
    const available = METRICS.map(metric => metric.id as string);
    expect(parseSelection(null, available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('', available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('M3', available)).toBe('M3');
    expect(parseSelection(UI_OVERVIEW_ID, available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('m3', available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('M9', available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('M1 M2', available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('__proto__', available)).toBe(UI_OVERVIEW_ID);
    expect(parseSelection('M1 UNION SELECT 1', available)).toBe(UI_OVERVIEW_ID);
  });

  it.each([
    ['M9'],
    ['m3'],
    [''],
    ['M3 '],
    [' M3'],
    ['<script>alert(1)</script>'],
    ['"><img src=x onerror=alert(1)>'],
    ['M3"; DROP TABLE daily_results;--'],
    ['__proto__'],
    ['overview2'],
  ])('?m=%s → 渲染概览，原始输入不回显、页面里没有 script', async raw => {
    const html = renderUiPage(full, { days: 30, metric: raw });
    expect(html).toContain(`<section class="card" id="${UI_OVERVIEW_ID}">`);
    expect(html).toContain(`<a class="nav-item" href="?days=30" aria-current="page">`);
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('DROP TABLE');
    // 上面每一个都不是合法 id（含前后空格的 ' M3' / 'M3 '），因此 M3 的卡片不该出现。
    expect(html).not.toContain('<section class="card" id="M3">');
  });
});

describe('测试 4：右栏只渲染选中的那一项', () => {
  it('选 M3 时，M3 之外的 7 条指标的标题都不在页面上', () => {
    const html = renderUiPage(fullReport(), { days: 30, metric: 'M3' });
    for (const metric of METRICS) {
      if (metric.id === 'M3') continue;
      expect(html, `${metric.id} 的标题不该出现`).not.toContain(escapeHtml(metric.title));
      expect(html, `${metric.id} 的问题不该出现`).not.toContain(escapeHtml(metric.question));
    }
    expect(html.match(/<section class="card"/g)).toHaveLength(1);
  });

  it('每一条指标单独被选中时都成立（8 条逐条验证）', () => {
    for (const metric of METRICS) {
      const html = renderUiPage(fullReport(), { days: 30, metric: metric.id });
      expect(html.match(/<section class="card"/g)).toHaveLength(1);
      expect(html).toContain(`<section class="card" id="${metric.id}">`);
      for (const other of METRICS) {
        if (other.id === metric.id) continue;
        expect(html).not.toContain(escapeHtml(other.title));
      }
    }
  });
});

describe('测试 5：统计页仍然零 <script>、零外链', () => {
  const pages = [
    renderUiPage(fullReport(), { days: 30 }),
    renderUiPage(fullReport(), { days: 7, metric: 'M5' }),
  ];

  it('没有 <script> / http(s):// / <link> / @import / @font-face / url() / src=', () => {
    for (const html of pages) {
      expect(html.toLowerCase()).not.toContain('<script');
      expect(html).not.toContain('http://');
      expect(html).not.toContain('https://');
      expect(html.toLowerCase()).not.toContain('<link');
      expect(html.toLowerCase()).not.toContain('@import');
      expect(html.toLowerCase()).not.toContain('@font-face');
      expect(html).not.toContain('url(');
      expect(html).not.toContain('src=');
      expect(html).toContain('<style>');
    }
  });

  it('换指标/换窗口/刷新全部是 GET <a href>，没有别的交互通道', () => {
    const html = renderUiPage(fullReport(), { days: 30, metric: 'M5' });
    expect(html).toContain('href="?days=30&m=M5"');
    expect(html).toContain('href="?days=7&m=M5"');
    expect(html).toContain('href="?days=30&m=M5&refresh=1"');
  });
});

describe('测试 6：顶栏的窗口切换与刷新仍然可用', () => {
  it('概览：三个窗口链接都在顶栏里，当前窗口高亮，刷新带 refresh=1', () => {
    const html = renderUiPage(fullReport(), { days: 30 });
    const topbar = topbarOf(html);
    for (const window of UI_WINDOWS) expect(topbar).toContain(`href="?days=${window}"`);
    expect(topbar).toContain('href="?days=30" aria-current="page"');
    expect(topbar).toContain('class="refresh"');
    expect(topbar).toContain('href="?days=30&refresh=1"');
    expect(topbar).toContain('连接：');
  });

  it('选中指标时换窗口/刷新会保留这个选中项', () => {
    const html = renderUiPage(fullReport(), { days: 90, metric: 'M7' });
    const topbar = topbarOf(html);
    expect(topbar).toContain('href="?days=7&m=M7"');
    expect(topbar).toContain('href="?days=30&m=M7"');
    expect(topbar).toContain('href="?days=90&m=M7" aria-current="page"');
    expect(topbar).toContain('href="?days=90&m=M7&refresh=1"');
  });
});

describe('HTTP 层：?m= 只是"选哪一项"，不新增任何写路径', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createUiServer({ initialDays: 30, loadReport: async () => fullReport() });
    const port = await listenUiServer(server, 0);
    // listenUiServer 返回内核分配的实际端口；再对一次 address() 确认它就是监听地址。
    expect((server.address() as AddressInfo).port).toBe(port);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('?m=M3 返回 200 且只渲染 M3', async () => {
    const html = await (await fetch(`${base}/?m=M3`)).text();
    expect(html).toContain('<section class="card" id="M3">');
    const m1 = METRICS.find(metric => metric.id === 'M1')!;
    expect(html).not.toContain(escapeHtml(m1.title));
  });

  it.each([['M9'], ['m3'], ['<script>alert(1)</script>'], ['"><img src=x>']])(
    '?m=%s → 200 + 概览（不 400、不 500）',
    async raw => {
      const res = await fetch(`${base}/?m=${encodeURIComponent(raw)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<section class="card" id="overview">');
      expect(html.toLowerCase()).not.toContain('<script');
    },
  );

  it('非法 m 之后服务仍然正常（没有崩、没有卡死）', async () => {
    await fetch(`${base}/?m=not-a-metric`);
    const res = await fetch(`${base}/?m=M1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<section class="card" id="M1">');
  });

  it('写方法仍然 405（?m= 没有打开任何写通道）', async () => {
    const res = await fetch(`${base}/?m=M3`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});

/**
 * 侧栏到「加徽章」的入口。
 *
 * 它**刻意不复用 `.nav-item`**：上面那条「侧栏恰好 9 个指标项」的断言，
 * 意义是「导航项 == 报告里实际存在的指标」。把另一个功能混进去会让它失去意义，
 * 所以这里同时断言两件事：入口在，且指标项仍是 9 个。
 */
describe('侧栏到「加徽章」的入口', () => {
  it('侧栏有一个指向 /badge 的入口', () => {
    const sidebar = sidebarOf(renderUiPage(fullReport(), { days: 30 }));
    expect(sidebar).toContain('<a class="nav-action" href="/badge">');
    expect(sidebar).toContain('添加徽章');
  });

  it('它不混进指标项：nav-item 仍然是 9 个', () => {
    const sidebar = sidebarOf(renderUiPage(fullReport(), { days: 30 }));
    expect(sidebar.match(/class="nav-item"/g)).toHaveLength(9);
    expect(sidebar.match(/class="nav-action"/g)).toHaveLength(1);
  });

  it('它是普通链接，不是按钮也不是 JS——统计页仍然零 <script>', () => {
    const html = renderUiPage(fullReport(), { days: 30 });
    expect(html).not.toContain('<script');
    // 选中态只属于指标项；入口不该被标成「当前页」
    expect(sidebarOf(html)).not.toContain('nav-action" href="/badge" aria-current');
  });

  it('换窗口时入口仍指向同一个地方（它是另一个页面，不带 ?days=）', () => {
    for (const days of UI_WINDOWS) {
      const sidebar = sidebarOf(renderUiPage(fullReport(), { days }));
      expect(sidebar).toContain('<a class="nav-action" href="/badge">');
    }
  });
});
