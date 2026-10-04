/**
 * 自包含 HTML 渲染器：**纯函数**，输出一个可以被 `file://` 直接打开的静态文件。
 *
 * 三条硬约束（`render.test.ts` 逐条断言）：
 *   1. 不生成任何 `<script>`——没有 JS，就没有可执行面；
 *   2. 不出现 `http://` / `https://` 外链——CSS 内联，无字体/图片/图标请求；
 *   3. **永不输出用户名明细**（`report.names`）。报告会被留存、转发，
 *      而终端输出不会，所以 PII 只留在终端。
 */
import type { StatsReport } from '../report';
import type { Table } from '../analyze';

/** HTML 转义：所有来自数据库的文本都必须过这里。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTable(table: Table): string {
  const head = table.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('');
  const body = table.rows.length
    ? table.rows
        .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('\n')
    : `<tr><td colspan="${table.columns.length}">（无数据）</td></tr>`;
  const caption = table.caption ? `<p class="caption">${escapeHtml(table.caption)}</p>` : '';
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>${caption}`;
}

export function renderHtml(report: StatsReport): string {
  const sections = report.sections
    .map(
      section => `<section>
<h2>${escapeHtml(section.id)} ${escapeHtml(section.title)}</h2>
<p class="question">问：${escapeHtml(section.question)}</p>
${renderTable(section.table)}
${section.notes.map(note => `<p class="note">注：${escapeHtml(note)}</p>`).join('\n')}
</section>`,
    )
    .join('\n');

  // 刻意只输出"有多少条"，不输出任何 name 字段。
  const namesNote = report.namesRequested
    ? `<p class="note">用户明细：本次获取 ${report.names.length} 条，<strong>仅在终端显示，本报告不含用户名</strong>。</p>`
    : '';

  const warnings = report.warnings
    .map(warning => `<p class="warning">⚠ ${escapeHtml(warning)}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HueDle 只读统计报告</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; font-size: .85rem; }
  th, td { border: 1px solid #8884; padding: .25rem .5rem; text-align: left; }
  th { background: #8882; }
  .question { color: #666; }
  .caption, .note { color: #666; font-size: .8rem; margin: .25rem 0; }
  .warning { color: #b00; }
</style>
</head>
<body>
<h1>HueDle 只读统计报告</h1>
<p>生成时间：${escapeHtml(report.generatedAt)}</p>
<p>窗口：最近 ${report.windowDays} 天（起始 ${escapeHtml(report.windowStart)}）；连接：${escapeHtml(report.connection)}</p>
<p>窗口总计：抽取 ${report.totals.draws} 次 / 玩家 ${report.totals.players} 人</p>
${namesNote}
${warnings}
${sections}
</body>
</html>
`;
}
