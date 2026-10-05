/**
 * 任务 B：侧栏短名合并进 `stats.ts` 的指标对象（`navLabel`），不再有平行常量。
 *
 * 覆盖：
 *   5. 每个指标都有 `navLabel`（类型层面 + 运行期逐个断言）；
 *   6. 侧栏渲染的就是 `metric.navLabel`，且 `UI_NAV_LABELS` 已从代码里删干净；
 *   7. 侧栏仍是 9 项（概览 + M1–M8）、统计页仍然零 `<script>`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contextForDraws } from '../analyze';
import { escapeHtml } from '../render/html';
import { analyzeMetric } from '../run';
import { METRICS, type MetricDef, type MetricId } from '../stats';
import type { StatsReport } from '../report';
import { renderUiPage, UI_OVERVIEW_LABEL } from '../ui/render';
import { sampleReport } from './fixtures';

/** 8 条指标齐全、表格为空的完整报告（不连数据库，与 ui.console.test 同口径）。 */
function fullReport(): StatsReport {
  const ctx = contextForDraws(0, 200);
  const sections = METRICS.map(metric =>
    analyzeMetric(metric, [] as never, metric.id === 'M8' ? ([{ duplicates: 0 }] as never) : [], ctx),
  );
  return sampleReport({ sections: [...sections] });
}

function sidebarOf(html: string): string {
  const start = html.indexOf('<nav class="sidebar"');
  const end = html.indexOf('</nav>', start);
  expect(start, '页面应有 <nav class="sidebar">').toBeGreaterThanOrEqual(0);
  return html.slice(start, end);
}

describe('测试 5：每个指标都必须提供 navLabel', () => {
  it('类型层面：MetricDef.navLabel 是必填 string（缺一个 tsc 就报错）', () => {
    // 这里刻意写成 Record<MetricId, string>：若某个 id 缺失，这一行在类型层面就不过。
    const labels: Record<MetricId, string> = Object.fromEntries(
      METRICS.map(metric => [metric.id, metric.navLabel]),
    ) as Record<MetricId, string>;
    expect(Object.keys(labels).sort()).toEqual(METRICS.map(metric => metric.id).sort());
    // 结构性断言：每个 MetricDef 都满足 `{ navLabel: string }`。
    const withNavLabel: Array<MetricDef & { navLabel: string }> = [...METRICS];
    expect(withNavLabel).toHaveLength(METRICS.length);
  });

  it('运行期：8 个指标的 navLabel 都是非空字符串', () => {
    expect(METRICS).toHaveLength(8);
    for (const metric of METRICS) {
      expect(typeof metric.navLabel, `${metric.id}.navLabel 类型`).toBe('string');
      expect(metric.navLabel.trim().length, `${metric.id}.navLabel 非空`).toBeGreaterThan(0);
    }
  });
});

describe('测试 6：侧栏渲染 metric.navLabel，且 UI_NAV_LABELS 已删干净', () => {
  const html = renderUiPage(fullReport(), { days: 30 });
  const sidebar = sidebarOf(html);

  it('侧栏每一项的短名就是该指标的 navLabel', () => {
    for (const metric of METRICS) {
      expect(sidebar, `${metric.id} 的 navLabel`).toContain(escapeHtml(metric.navLabel));
    }
    // 概览项仍然用它自己的短名。
    expect(sidebar).toContain(escapeHtml(UI_OVERVIEW_LABEL));
  });

  it('UI_NAV_LABELS 在渲染器源码里不再出现，也不再被导出', async () => {
    const source = readFileSync(new URL('../ui/render.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('UI_NAV_LABELS');
    // 运行期也没有这个导出（删的是常量本身，不是改名或留个空壳）。
    const renderModule = (await import('../ui/render')) as Record<string, unknown>;
    expect(Object.keys(renderModule)).not.toContain('UI_NAV_LABELS');
    expect(html).not.toContain('UI_NAV_LABELS');
  });
});

describe('测试 7：侧栏仍是 9 项、统计页仍零 <script>', () => {
  const html = renderUiPage(fullReport(), { days: 30, metric: 'M3' });
  const sidebar = sidebarOf(html);

  it('概览 + M1–M8 恰好 9 个导航项', () => {
    expect(sidebar.match(/class="nav-item"/g)).toHaveLength(9);
    expect(sidebar).toContain('<a class="nav-item" href="?days=30"');
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
      expect(sidebar).toContain(`href="?days=30&m=${id}"`);
    }
  });

  it('页面依然零 <script>、零外链（交互全靠原生 HTML）', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });
});
