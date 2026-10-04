/**
 * UI 渲染层（纯函数）的测试。
 *
 * 覆盖任务书里的 4 类要求：
 *   - 测试 5：默认（未开 `--include-names`）页面里**逐条**不出现 fixtures 用户名；
 *   - 测试 6：页面不引用任何外部资源（断网可用）；
 *   - 测试 7：draws < 200 时 M4 仍然只给原始计数（换个界面不许偷偷给结论）；
 *   - 交互：窗口切换链接、指标锚点、长表格默认截断 + `<details>` 展开。
 */
import { describe, expect, it } from 'vitest';
import { contextForDraws, M4_MIN_DRAWS } from '../analyze';
import { analyzeMetric } from '../run';
import { METRICS } from '../stats';
import { renderUiError, renderUiPage, UI_OVERVIEW_LABELS, UI_ROW_LIMIT, UI_WINDOWS } from '../ui/render';
import { escapeHtml } from '../render/html';
import type { Table } from '../analyze';
import { sampleReport, SECRET_USERNAME } from './fixtures';

/** 用**真实的**分析分派（`analyzeMetric`）造一份 8 条指标齐全的报告。 */
function buildFullReport(draws = 1000) {
  const ctx = contextForDraws(draws, 200);
  const rows: Record<string, unknown[]> = {
    M1: [{ date: '2026-01-01', draws: 5, players: 5 }],
    M2: [{ date: '2026-01-01', new_players: 1, returning_players: 4 }],
    M3: [{ bucket: '0', users: 1, one_day_users: 1 }],
    M4: [{ badge_id: 'casino-pair', hit_days: 3 }],
    M5: [{ badge_id: 'ghost-from-2024', n: 1, first_seen: '2024-01-01' }],
    M6: [{ wk: '2025-12-29', rarity: 'common', n: 1 }],
    M7: [{ date: '2026-01-01', min: 1, p50: 2, p99: 3, max: 4 }],
    M8: [
      {
        bad_hex: 0,
        bad_date: 0,
        future_date: 0,
        bad_badge_ids: 0,
        bad_cp: 0,
        expired_sessions: 0,
      },
    ],
  };
  const sections = METRICS.map(metric =>
    analyzeMetric(
      metric,
      rows[metric.id] as Parameters<typeof analyzeMetric>[1],
      metric.id === 'M8' ? ([{ duplicates: 0 }] as never) : [],
      ctx,
    ),
  );
  return sampleReport({ sections: [...sections], totals: { draws, players: draws } });
}

function tableReport(table: Table, id: 'M4' | 'M6' = 'M6') {
  return sampleReport({
    sections: [{ id, title: `${id} 测试表`, question: `${id} 回答什么问题`, table, notes: [] }],
  });
}

const longRows = (count: number, prefix: string): string[][] =>
  Array.from({ length: count }, (_, index) => [
    `${prefix}${String(index + 1).padStart(2, '0')}`,
    'common',
    '1',
    '100%',
  ]);

describe('测试 6：页面不引用任何外部资源（断网可用）', () => {
  const html = renderUiPage(buildFullReport(), { days: 30 });

  it('没有 <script>、没有外链、没有 <link>/@import/src=', () => {
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html.toLowerCase()).not.toContain('<link');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('href="//');
  });

  it('样式是内联 <style>，没有构建产物依赖', () => {
    expect(html).toContain('<style>');
  });

  it('错误页同样自包含（外链断言对每个响应都成立）', () => {
    const error = renderUiError(400, '示例错误');
    expect(error).not.toContain('http://');
    expect(error).not.toContain('https://');
    expect(error.toLowerCase()).not.toContain('<script');
    expect(error).toContain('示例错误');
  });
});

describe('交互：窗口切换 / 指标跳转 / 长表格展开', () => {
  const html = renderUiPage(buildFullReport(), { days: 90 });

  it('提供 7 / 30 / 90 天的切换链接，当前窗口被高亮', () => {
    expect([...UI_WINDOWS]).toEqual([7, 30, 90]);
    for (const window of UI_WINDOWS) expect(html).toContain(`href="?days=${window}"`);
    expect(html).toContain('href="?days=90" aria-current="page"');
    expect(html).not.toContain('href="?days=7" aria-current="page"');
  });

  it('提供 M1–M8 的锚点跳转，且 section 有对应 id', () => {
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('每个指标都带上它回答什么问题（直接复用 stats.ts 的 question）', () => {
    for (const metric of METRICS) expect(html).toContain(escapeHtml(metric.question));
  });

  it('长表格默认只显示前 N 行，其余折进 <details> 可展开', () => {
    expect(UI_ROW_LIMIT).toBe(10);
    const page = renderUiPage(tableReport({ columns: ['周', '稀有度', '数量', '占比'], rows: longRows(25, 'w') }), {
      days: 30,
    });
    const [visible, expanded] = page.split('<details class="more">');

    expect(visible).toBeDefined();
    expect(visible).toContain('w01');
    expect(visible).toContain('w10');
    expect(visible).not.toContain('w11');

    expect(expanded).toBeDefined();
    expect(expanded).toContain('展开其余 15 行（共 25 行）');
    expect(expanded).toContain('w11');
    expect(expanded).toContain('w25');
  });

  it('M4 这种长表格同样默认截断（用真实分析路径产出 40 条后渲染）', () => {
    const metric = METRICS.find(m => m.id === 'M4')!;
    const rows = Array.from({ length: 40 }, () => ({ badge_id: 'casino-pair', hit_days: 400 }));
    const section = analyzeMetric(metric, rows as never, [], contextForDraws(100_000, 200));
    const page = renderUiPage(sampleReport({ sections: [section] }), { days: 30 });
    const [visible, expanded] = page.split('<details class="more">');
    expect(visible).toContain('casino-pair');
    expect(expanded).toContain('展开其余 30 行（共 40 行）');
  });

  it('rowLimit 可调（服务端为同一份渲染逻辑提供了参数）', () => {
    const page = renderUiPage(tableReport({ columns: ['a'], rows: longRows(5, 'x') }), { days: 30, rowLimit: 2 });
    expect(page.split('<details class="more">')[0]).not.toContain('x03');
    expect(page).toContain('展开其余 3 行（共 5 行）');
  });
});

describe('测试 7：draws < 200 时 M4 仍然拒绝给结论', () => {
  const m4 = METRICS.find(metric => metric.id === 'M4')!;

  it(`门槛就是 ${M4_MIN_DRAWS}（199 不给结论，200 才给）`, () => {
    expect(M4_MIN_DRAWS).toBe(200);
    expect(contextForDraws(199).conclusive).toBe(false);
    expect(contextForDraws(200).conclusive).toBe(true);
    expect(contextForDraws(50).conclusive).toBe(false);
  });

  it('draws=150 的页面只有原始计数，没有 z / 期望命中 / 云端稀有度', () => {
    const section = analyzeMetric(
      m4,
      [{ badge_id: 'casino-pair', hit_days: 3 }] as never,
      [],
      contextForDraws(150, 200),
    );
    const page = renderUiPage(sampleReport({ sections: [section] }), { days: 30 });

    expect(page).toContain('不给结论');
    expect(page).toContain('casino-pair');
    expect(page).toContain('150');
    expect(page).not.toContain('偏差 z');
    expect(page).not.toContain('期望命中');
  });

  it('draws=199.9→199 与 200 的分界在页面上可见', () => {
    const at199 = analyzeMetric(m4, [] as never, [], contextForDraws(199, 200));
    const at200 = analyzeMetric(m4, [] as never, [], contextForDraws(200, 200));
    expect(at199.table.columns).toEqual(['徽章', '实际命中(天)']);
    expect(at200.table.columns).toContain('偏差 z');
  });
});

describe('测试 5：默认不含用户名（只有 --include-names 才渲染）', () => {
  const names = [
    { name: SECRET_USERNAME, days: 7, lastDate: '2026-01-01' },
    { name: 'bob-the-player', days: 2, lastDate: '2025-12-31' },
  ];

  it('namesRequested=false 时，即使 report.names 里带着用户名，页面也逐条不出现', () => {
    const page = renderUiPage(sampleReport({ namesRequested: false, names }), { days: 30 });
    for (const row of names) expect(page).not.toContain(row.name);
    expect(page).not.toContain('用户明细');
  });

  it('namesRequested=true（--include-names）时才在页面上显示', () => {
    const page = renderUiPage(sampleReport({ namesRequested: true, names }), { days: 30 });
    for (const row of names) expect(page).toContain(row.name);
    expect(page).toContain('用户明细');
  });
});

describe('转义与健壮性', () => {
  it('数据库文本一律 HTML 转义', () => {
    const page = renderUiPage(
      sampleReport({
        sections: [
          {
            id: 'M1',
            title: '<img src=x onerror=alert(1)>',
            question: 'q',
            table: { columns: ['a'], rows: [['<script>alert(1)</script>']] },
            notes: [],
          },
        ],
      }),
      { days: 30 },
    );
    expect(page).not.toContain('<img src=x');
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('&lt;script&gt;');
  });

  it('空表格渲染「（无数据）」而不是空 <tbody>', () => {
    const page = renderUiPage(tableReport({ columns: ['a'], rows: [] }), { days: 30 });
    expect(page).toContain('（无数据）');
  });

  it('warnings 会被显示出来', () => {
    const page = renderUiPage(sampleReport({ warnings: ['M8：bad_hex = 1（应为 0）。'] }), { days: 30 });
    expect(page).toContain('bad_hex = 1');
  });
});

/** 从概览区里取出某个大数字（figcaption 紧跟着 stat-value）。 */
function overviewValue(html: string, label: string): string | undefined {
  const match = html.match(
    new RegExp(`<figcaption>${label}</figcaption>\\s*<p class="stat-value">([^<]*)</p>`),
  );
  return match?.[1];
}

describe('概览区：四个大数字', () => {
  // 确定数据：totals 给 1000/8；M2「新增」= 1+2 = 3；M3 用户 4+5=9、只抽过一天 1+2=3 → 33.33%。
  const report = sampleReport({
    totals: { draws: 1000, players: 8 },
    sections: [
      {
        id: 'M2',
        title: '新增用户 vs 回访用户',
        question: '增长是从哪来的？',
        table: {
          columns: ['日期', '新增', '回访'],
          rows: [['2026-01-01', '1', '4'], ['2026-01-02', '2', '3']],
        },
        notes: [],
      },
      {
        id: 'M3',
        title: '沉默用户分桶 + 一次性用户占比',
        question: '召回值不值得做？',
        table: {
          columns: ['沉默天数', '用户数', '只抽过一天'],
          rows: [['0', '4', '1'], ['1-7', '5', '2']],
        },
        notes: [],
      },
    ],
  });
  const html = renderUiPage(report, { days: 30 });

  it('四项标题齐备，且出现在概览区（header 之后、指标锚点之前）', () => {
    expect(html).toContain('class="overview"');
    for (const label of UI_OVERVIEW_LABELS) expect(html).toContain(label);
    expect(html.indexOf('class="overview"')).toBeLessThan(html.indexOf('指标：'));
  });

  it('四个数字都正确（含由 M2/M3 列合计得出的两项）', () => {
    expect(overviewValue(html, '窗口内抽取数')).toBe('1000');
    expect(overviewValue(html, '窗口内玩家数')).toBe('8');
    expect(overviewValue(html, '新用户')).toBe('3');
    expect(overviewValue(html, '一次性用户占比')).toBe('33.33%');
  });

  it('数据缺失时降级成「—」，不崩、不出现 NaN', () => {
    const bare = renderUiPage(sampleReport({ totals: { draws: 0, players: 0 }, sections: [] }), { days: 30 });
    expect(overviewValue(bare, '新用户')).toBe('—');
    expect(overviewValue(bare, '一次性用户占比')).toBe('—');
    expect(bare).not.toContain('NaN');
  });
});

describe('卡片：每个指标一张卡 + 回答什么问题 + 长表格默认折叠', () => {
  const html = renderUiPage(buildFullReport(), { days: 30 });

  it('每个指标都是一张 card，且卡片里出现它回答什么问题（复用 stats.ts 的 question）', () => {
    for (const metric of METRICS) {
      expect(html).toContain(`<section class="card" id="${metric.id}">`);
      expect(html).toContain(escapeHtml(metric.question));
    }
    expect(html.match(/<section class="card"/g)).toHaveLength(METRICS.length);
  });

  it('长表格折进 <details>，默认不带 open（浏览器原生折叠）', () => {
    const page = renderUiPage(
      tableReport({ columns: ['周', '稀有度', '数量', '占比'], rows: longRows(25, 'w') }),
      { days: 30 },
    );
    expect(page).toContain('<details class="more">');
    expect(page).not.toContain('<details open');
    expect(page).not.toMatch(/<details[^>]*\sopen/);
  });

  it('卡片页依旧无 <script>、无外链（断网可用）', () => {
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html.toLowerCase()).not.toContain('<link');
  });
});
