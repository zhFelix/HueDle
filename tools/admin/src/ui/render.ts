/**
 * UI 页面渲染器：**纯函数**，服务端渲染，输出一份自包含的 HTML。
 *
 * 形态选择（为什么是服务端渲染、为什么一行 JS 都不写）：
 *   1. 硬约束③禁止引入依赖、禁止打包器。整个页面由本文件拼成字符串返回，
 *      **没有构建步骤**（`tsx` 直接跑），也就没有"前端产物"需要维护；
 *   2. 交互用浏览器原生能力实现，而不是 JS：
 *      - 换窗口 = `<a href="?days=7">` 重新请求（服务端重算，口径永远只有一份）；
 *      - 展开长表格 = `<details>/<summary>`；
 *      - 按指标跳转 = `#M1…M8` 锚点。
 *      于是页面里**没有任何 `<script>`、没有任何外部资源**，断网也能用（硬约束⑥/测试 6）；
 *   3. 每个数字都来自 {@link StatsReport}，本文件不碰数据库——只读通道因此只有一条。
 *
 * 版面（本次改动的全部范围，只动表现层）：
 *   - 顶部「概览区」：抽取数 / 玩家数 / 新用户 / 一次性用户占比，四个大数字；
 *   - M1–M8 每张指标一张**卡片**（标题 + 它回答什么问题 + 表格 + 注），卡片之间有间隔；
 *   - 长表格沿用 `<details>` 默认折叠（前 N 行可见，其余折起）。
 *   概览里的"新用户 / 一次性用户占比"不是新的查询口径，而是对已经查回来的
 *   M2 / M3 两张表的**展示层合计**（见 {@link sumColumn}）——避免为了好看在多处再写一遍 SQL。
 *
 * 用户名（PII）：只有当 `report.namesRequested` 为真（`--include-names`）才渲染，
 * 且只渲染在**这个页面**里；本服务不写任何文件，所以 PII 不会落盘。
 */
import type { StatsReport, SectionResult } from '../report';
import type { Table } from '../analyze';
import { fmtInt, fmtShare } from '../analyze';
import { escapeHtml } from '../render/html';

/** 可切换的时间窗口（至少 7 / 30 / 90）。 */
export const UI_WINDOWS: readonly number[] = [7, 30, 90];

/** 表格默认显示多少行；超出部分折进 `<details>`。 */
export const UI_ROW_LIMIT = 10;

/** 概览区四项的标题（测试与页面共用同一份字面量，避免两处漂移）。 */
export const UI_OVERVIEW_LABELS: readonly string[] = [
  '窗口内抽取数',
  '窗口内玩家数',
  '新用户',
  '一次性用户占比',
];

/** 页内样式：内联字符串，**没有** `<link>`、没有外部字体/图标。 */
const UI_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0 auto; max-width: 74rem; padding: 1.5rem 1rem 4rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  nav { display: flex; flex-wrap: wrap; gap: .5rem 1rem; padding: .5rem 0; border-bottom: 1px solid #8884; margin-bottom: 1rem; }
  nav a { text-decoration: none; border: 1px solid #8886; border-radius: .25rem; padding: .1rem .5rem; }
  nav a[aria-current="page"] { font-weight: 700; border-color: currentColor; }
  .metrics { border-bottom: none; }
  .metrics a { border: none; padding: 0 .25rem; }
  section { margin-top: 1.5rem; scroll-margin-top: 1rem; }
  table { border-collapse: collapse; width: 100%; margin: .4rem 0; font-size: .85rem; }
  th, td { border: 1px solid #8884; padding: .2rem .5rem; text-align: left; }
  th { background: #8882; }
  details.more { margin: .3rem 0 .6rem; }
  details.more summary { cursor: pointer; color: #666; font-size: .8rem; }
  .meta, .note, .caption { color: #666; font-size: .8rem; margin: .2rem 0; }
  .warning { color: #b00; }
  .names { border-left: 3px solid #b60; padding-left: .75rem; }

  /* 概览区：四五个大数字，一眼扫到。 */
  .overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .75rem; margin: 1.25rem 0 1.75rem; }
  .stat { margin: 0; border: 1px solid #8885; border-radius: .5rem; padding: .75rem 1rem .85rem; background: #8881; }
  .stat figcaption { color: #666; font-size: .8rem; }
  .stat-value { font-size: 2.1rem; font-weight: 700; line-height: 1.15; margin: .2rem 0 .1rem; font-variant-numeric: tabular-nums; }
  .stat-note { color: #666; font-size: .72rem; margin: 0; }

  /* 指标卡片：每个指标一块，卡片之间留出明显间隔。 */
  main { margin-top: 1.5rem; }
  main section.card { margin: 0 0 1.25rem; border: 1px solid #8885; border-radius: .5rem; padding: .9rem 1.1rem 1rem; background: #8881; }
  .card h2 { border-bottom: 1px solid #8884; padding-bottom: .35rem; }
  .question { color: #666; font-size: .8rem; margin: .35rem 0 .5rem; }
`;

function renderTable(table: Table, limit: number): string {
  const head = `<tr>${table.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;
  const rowsHtml = (rows: string[][]): string =>
    rows.length
      ? rows
          .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
          .join('\n')
      : `<tr><td colspan="${table.columns.length}">（无数据）</td></tr>`;

  const visible = table.rows.slice(0, limit);
  const hidden = table.rows.slice(limit);
  const caption = table.caption ? `<p class="caption">${escapeHtml(table.caption)}</p>` : '';

  const full = `<table><thead>${head}</thead><tbody>\n${rowsHtml(visible)}\n</tbody></table>`;
  const more = hidden.length
    ? `<details class="more"><summary>展开其余 ${hidden.length} 行（共 ${table.rows.length} 行）</summary>`
      + `<table><thead>${head}</thead><tbody>\n${rowsHtml(hidden)}\n</tbody></table></details>`
    : '';

  return `${full}${more}${caption}`;
}

export interface UiPageOptions {
  /** 本次请求实际生效的窗口天数（用于高亮当前窗口）。 */
  days: number;
  /** 表格默认显示行数；测试用来构造长表格，默认 {@link UI_ROW_LIMIT}。 */
  rowLimit?: number;
}

/** 窗口切换链接。 */
function renderWindows(days: number): string {
  return UI_WINDOWS.map(window => {
    const current = window === days ? ' aria-current="page"' : '';
    return `<a href="?days=${window}"${current}>${window} 天</a>`;
  }).join('');
}

/**
 * 手动刷新链接：服务端缓存最多存活 60 秒（见 `src/cache.ts`），
 * `?refresh=1` 立即绕过缓存重查。仍然是 GET、仍然只读——只是"不省这一次"。
 */
function renderRefresh(days: number): string {
  return `<a href="?days=${days}&refresh=1" title="忽略本机缓存，重新查询数据库（最多比平时多花几秒）">强制刷新</a>`;
}

function renderNames(report: StatsReport): string {
  if (!report.namesRequested) return '';
  const rows = report.names
    .map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${row.days}</td><td>${escapeHtml(row.lastDate)}</td></tr>`)
    .join('\n');
  const body = rows || '<tr><td colspan="3">（无数据）</td></tr>';
  return `<section id="names" class="names">
<h2>用户明细（--include-names）</h2>
<p class="note">用户名只在<strong>本页面</strong>显示；本服务不写任何文件，因此不会落盘。</p>
<table><thead><tr><th>用户名</th><th>抽取天数</th><th>最近一次</th></tr></thead><tbody>
${body}
</tbody></table>
</section>`;
}

/**
 * 把某一列的已格式化数字全部加起来；列不存在（或该指标缺失）时返回 `undefined`。
 *
 * 这是**展示层的合计**，不新增任何查询：M2 的「新增」列合计即窗口内新用户数，
 * M3 的「只抽过一天」/「用户数」合计即一次性用户占比。非有限值（`—`）跳过。
 */
function sumColumn(section: SectionResult | undefined, column: string): number | undefined {
  if (!section) return undefined;
  const index = section.table.columns.indexOf(column);
  if (index < 0) return undefined;
  let total = 0;
  for (const row of section.table.rows) {
    const value = Number(row[index]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * 顶部概览区：四个大数字（抽取数 / 玩家数 / 新用户 / 一次性用户占比）。
 *
 * 前两个直接来自 `report.totals`；后两个来自 M2/M3 表格列的展示层合计。
 */
function renderOverview(report: StatsReport): string {
  const m2 = report.sections.find(section => section.id === 'M2');
  const m3 = report.sections.find(section => section.id === 'M3');

  const newUsers = sumColumn(m2, '新增');
  const allUsers = sumColumn(m3, '用户数');
  const oneDayUsers = sumColumn(m3, '只抽过一天');
  const oneDayShare =
    oneDayUsers === undefined || allUsers === undefined ? '—' : fmtShare(oneDayUsers, allUsers);

  const [drawsLabel, playersLabel, newLabel, shareLabel] = UI_OVERVIEW_LABELS;
  const items: Array<[string, string, string]> = [
    [drawsLabel, fmtInt(report.totals.draws), `最近 ${report.windowDays} 天的 daily_results 行数`],
    [playersLabel, fmtInt(report.totals.players), `最近 ${report.windowDays} 天有过抽取的玩家数`],
    [
      newLabel,
      newUsers === undefined ? '—' : fmtInt(newUsers),
      '窗口内首次出现的玩家（M2「新增」列合计）',
    ],
    [
      shareLabel,
      oneDayShare,
      '只抽过一天的用户 / 全部用户（M3 合计；全量口径，非窗口口径）',
    ],
  ];

  const figures = items
    .map(
      ([label, value, note]) => `<figure class="stat">
<figcaption>${escapeHtml(label)}</figcaption>
<p class="stat-value">${escapeHtml(value)}</p>
<p class="stat-note">${escapeHtml(note)}</p>
</figure>`,
    )
    .join('\n');

  return `<section class="overview" id="overview" aria-label="窗口概览">
${figures}
</section>`;
}

/** 渲染整页。所有来自数据库的文本都过 {@link escapeHtml}。 */
export function renderUiPage(report: StatsReport, options: UiPageOptions): string {
  const limit = options.rowLimit ?? UI_ROW_LIMIT;

  const metricsNav = report.sections
    .map(section => `<a href="#${escapeHtml(section.id)}">${escapeHtml(section.id)}</a>`)
    .join('');

  const sections = report.sections
    .map(
      section => `<section class="card" id="${escapeHtml(section.id)}">
<h2>${escapeHtml(section.id)} ${escapeHtml(section.title)}</h2>
<p class="question">问：${escapeHtml(section.question)}</p>
${renderTable(section.table, limit)}
${section.notes.map(note => `<p class="note">注：${escapeHtml(note)}</p>`).join('\n')}
</section>`,
    )
    .join('\n');

  const warnings = report.warnings
    .map(warning => `<p class="warning">⚠ ${escapeHtml(warning)}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HueDle 只读统计 UI</title>
<style>${UI_CSS}</style>
</head>
<body>
<header>
<h1>HueDle 只读统计 UI</h1>
<p class="meta">窗口：最近 ${report.windowDays} 天（起始 ${escapeHtml(report.windowStart)}）；生成时间：${escapeHtml(report.generatedAt)}</p>
<p class="meta">连接：${escapeHtml(report.connection)}</p>
<p class="meta">本服务只监听 127.0.0.1，只有 GET 路由，无登录、无 CORS、不写任何文件；所有查询走只读事务。</p>
</header>
<nav aria-label="时间窗口">窗口：${renderWindows(options.days)} ${renderRefresh(options.days)}</nav>
${renderOverview(report)}
<nav class="metrics" aria-label="指标跳转">指标：${metricsNav}</nav>
${warnings}
<main>
${sections}
${renderNames(report)}
</main>
</body>
</html>
`;
}

/** 400/404/405/500 等错误页：同样自包含，且带一个回到首页的链接。 */
export function renderUiError(status: number, message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HueDle 只读统计 UI — ${status}</title>
<style>${UI_CSS}</style>
</head>
<body>
<h1>${status}</h1>
<p>${escapeHtml(message)}</p>
<p class="meta"><a href="/">← 回到统计页</a></p>
</body>
</html>
`;
}
