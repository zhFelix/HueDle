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

/**
 * 哨兵单元格的状态类名（**表意**，不是装饰）。
 *
 * - `ok`：哨兵通过（M1 `OK`、M5 `（无）`、M8 计数为 0）→ 游戏里的 emerald-400；
 * - `bad`：哨兵破了（M1 `⚠ 约束被破坏`、M5 有幽灵 id、M8 计数非 0）→ 游戏里的 red-300；
 * - `none`：这一格没有"正常/异常"含义，不上色。
 *
 * 三个类名由 {@link CELL_STATE_CLASS} 与测试共用同一份字面量，避免两处漂移。
 */
export type CellState = 'ok' | 'bad' | 'none';

export const CELL_STATE_CLASS: Readonly<Record<Exclude<CellState, 'none'>, string>> = {
  ok: 'state-ok',
  bad: 'state-bad',
};

/**
 * 「没有结论」专用类名。
 *
 * **语义：中性。** 「样本不足 / 不给结论」既不是正常也不是异常——它是"这次不判断"，
 * 所以它绝不能借用 warning/error/danger 的任何类名或色值（黄/红会让人以为数据坏了，
 * 从而做出错误反应）。反向断言见 `__tests__/ui.theme.test.ts`。
 */
export const NEUTRAL_NOTE_CLASS = 'neutral-note';

/** 出现这些措辞的注/表注 = 没有结论，一律走 {@link NEUTRAL_NOTE_CLASS}。 */
const NO_CONCLUSION_PATTERN = /不给结论|样本不足|未计入|无数据/;

/** 给文本套上「没有结论」的中性类（命中 {@link NO_CONCLUSION_PATTERN} 才加）。 */
function noteClass(text: string): string {
  return NO_CONCLUSION_PATTERN.test(text) ? NEUTRAL_NOTE_CLASS : '';
}

/**
 * 判断某一格是不是哨兵、以及它的状态。
 *
 * 这是**表现层**的判断，只读已经格式化的字符串（不改分析层）：
 *   - M1 第 4 列（唯一约束）：`OK` / `⚠ 约束被破坏`；
 *   - M5 第 1 列（幽灵 id）：`（无）` 才是健康；
 *   - M8 第 2 列（值）：全部应为 0，非 0 即异常。
 * 其余格子一律 `none`——颜色只用在真的有含义的格子上。
 */
export function cellState(sectionId: string, columnIndex: number, cell: string): CellState {
  if (sectionId === 'M1' && columnIndex === 3) {
    if (cell === 'OK') return 'ok';
    return cell.includes('⚠') ? 'bad' : 'none';
  }
  if (sectionId === 'M5' && columnIndex === 0) {
    return cell === '（无）' ? 'ok' : 'bad';
  }
  if (sectionId === 'M8' && columnIndex === 1) {
    const value = Number(cell);
    if (!Number.isFinite(value)) return 'none';
    return value === 0 ? 'ok' : 'bad';
  }
  return 'none';
}

/** 概览区四项的标题（测试与页面共用同一份字面量，避免两处漂移）。 */
export const UI_OVERVIEW_LABELS: readonly string[] = [
  '窗口内抽取数',
  '窗口内玩家数',
  '新用户',
  '一次性用户占比',
];

/**
 * 页内样式：内联字符串，**没有** `<link>`、没有外部字体/图标、没有 `@import`、没有 `url()`。
 *
 * 为什么手写而不是用 Tailwind：本工具是"一段 HTML 字符串 + 零构建步骤"（`tsx` 直接跑），
 * 用不了 `@tailwindcss/vite`。所以下面每一个色值都是**逐字抄**自主题定义：
 *   - `--ink-*`   ← `apps/web/src/style.css` 的 `@theme` 块；
 *   - 其余色阶    ← Tailwind v4 默认主题 `tailwindcss/theme.css`（v4 用 oklch 定义，
 *     这里原样保留 oklch，不做近似换算，避免"看着像"而不是"就是那个值"）。
 * 观感照 `apps/web/src/pages/Profile.vue` / `components/*.vue`：
 *   页面底色 ink-950 → 卡片 ink-900 + 1px ink-700 边框 + 1rem 圆角；
 *   正文 neutral-200，次要文字 neutral-400/500，强调与可点击元素 amber-300/400。
 */
export const UI_CSS = `
  :root {
    color-scheme: dark;
    /* ↓↓↓ apps/web/src/style.css 的 @theme（原文照抄） ↓↓↓ */
    --ink-950: #08090c;
    --ink-900: #0e1015;
    --ink-800: #171a21;
    --ink-700: #23262f;
    /* ↓↓↓ Tailwind v4 默认主题 tailwindcss/theme.css（原文照抄） ↓↓↓ */
    --neutral-50: oklch(98.5% 0 none);
    --neutral-100: oklch(97% 0 none);
    --neutral-200: oklch(92.2% 0 none);
    --neutral-300: oklch(87% 0 none);
    --neutral-400: oklch(70.8% 0 none);
    --neutral-500: oklch(55.6% 0 none);
    --neutral-600: oklch(43.9% 0 none);
    --amber-200: oklch(92.4% 0.12 95.746);
    --amber-300: oklch(87.9% 0.169 91.605);
    --amber-400: oklch(82.8% 0.189 84.429);
    --emerald-400: oklch(76.5% 0.177 163.223);
    --red-300: oklch(80.8% 0.114 19.571);
    --red-900: oklch(39.6% 0.141 25.723);
    --red-950: oklch(25.8% 0.092 26.042);
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; max-width: 74rem; padding: 1.5rem 1rem 4rem; line-height: 1.55;
    background: var(--ink-950); color: var(--neutral-200);
    font-family: var(--font-sans); -webkit-font-smoothing: antialiased;
  }
  h1 { font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; letter-spacing: -.01em; color: var(--neutral-50); margin: 0 0 .35rem; }
  h2 { font-size: 1rem; font-weight: 600; color: var(--neutral-100); margin: 0 0 .25rem; }
  a { color: var(--amber-300); text-decoration: none; }
  a:hover { color: var(--amber-200); text-decoration: underline; text-underline-offset: 4px; }
  nav { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .7rem; padding: .7rem 0; border-bottom: 1px solid var(--ink-800); margin-bottom: 1rem; color: var(--neutral-500); font-size: .8rem; }
  /* 窗口切换：照 Profile.vue 的「登录 / 注册」胶囊（amber-400 边框 + amber-300 文字） */
  nav a { border: 1px solid oklch(82.8% 0.189 84.429 / .5); background: oklch(82.8% 0.189 84.429 / .15); color: var(--amber-300); border-radius: 9999px; padding: .15rem .7rem; font-size: .75rem; font-weight: 600; }
  nav a:hover { background: oklch(82.8% 0.189 84.429 / .25); color: var(--amber-200); text-decoration: none; }
  nav a[aria-current="page"] { background: var(--amber-400); border-color: var(--amber-400); color: var(--ink-950); }
  /* 指标锚点：低调的 ink 描边胶囊，不与窗口切换抢注意力 */
  .metrics { border-bottom: none; }
  .metrics a { border: 1px solid var(--ink-700); background: none; color: var(--neutral-300); border-radius: 9999px; padding: .1rem .6rem; font-family: var(--font-mono); font-weight: 500; }
  .metrics a:hover { background: var(--ink-800); border-color: var(--ink-700); color: var(--neutral-100); text-decoration: none; }
  section { margin-top: 1.5rem; scroll-margin-top: 1rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; font-size: .85rem; font-family: var(--font-mono); }
  th, td { border: 1px solid var(--ink-700); padding: .25rem .6rem; text-align: left; }
  th { background: var(--ink-800); color: var(--neutral-300); font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; }
  /* 正文不用最深的灰：深色底上 neutral-200 才够对比 */
  td { color: var(--neutral-200); }
  tbody tr:nth-child(even) { background: var(--ink-800); }
  /* 哨兵格：正常绿 / 异常红（与游戏 AchievementCard 的 emerald-400、错误态 red-300 同源） */
  td.state-ok { color: var(--emerald-400); font-weight: 600; }
  td.state-bad { color: var(--red-300); font-weight: 600; background: oklch(25.8% 0.092 26.042 / .5); border-color: oklch(39.6% 0.141 25.723 / .6); }
  details.more { margin: .35rem 0 .6rem; }
  details.more summary { cursor: pointer; color: var(--neutral-400); font-size: .8rem; }
  details.more summary:hover { color: var(--neutral-200); }
  .meta, .note, .caption { color: var(--neutral-400); font-size: .8rem; margin: .25rem 0; }
  /* 「没有结论」= 中性：只借用中性灰，绝不借 warning/error 的任何色值 */
  .${NEUTRAL_NOTE_CLASS} { color: var(--neutral-400); }
  .warning { color: var(--red-300); border: 1px solid oklch(39.6% 0.141 25.723 / .6); background: oklch(25.8% 0.092 26.042 / .4); border-radius: .75rem; padding: .45rem .75rem; font-size: .85rem; margin: .5rem 0; }
  .names { border-left: 3px solid oklch(82.8% 0.189 84.429 / .6); padding-left: .75rem; }

  /* 概览区：大数字 + 小标签 + 辅助说明（层级感取自 Profile.vue 的统计区）。 */
  .overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .75rem; margin: 1.25rem 0 1.75rem; }
  .stat { margin: 0; border: 1px solid var(--ink-700); border-radius: 1rem; padding: .9rem 1.05rem 1rem; background: var(--ink-900); }
  .stat figcaption { color: var(--neutral-500); font-size: .72rem; text-transform: uppercase; letter-spacing: .1em; }
  .stat-value { font-family: var(--font-mono); font-size: 2.25rem; font-weight: 700; line-height: 1.15; margin: .35rem 0 .2rem; color: var(--neutral-50); font-variant-numeric: tabular-nums; }
  .stat-note { color: var(--neutral-500); font-size: .72rem; margin: 0; }

  /* 指标卡片：圆角 + ink-700 边框 + ink-900 底，比页面底色 ink-950 高一层。 */
  main { margin-top: 1.5rem; }
  main section.card { margin: 0 0 1.25rem; border: 1px solid var(--ink-700); border-radius: 1rem; padding: 1rem 1.1rem 1.1rem; background: var(--ink-900); }
  .card h2 { border-bottom: 1px solid var(--ink-800); padding-bottom: .45rem; }
  .question { color: var(--neutral-400); font-size: .8rem; margin: .45rem 0 .5rem; }
`;

function renderTable(table: Table, limit: number, sectionId: string): string {
  const head = `<tr>${table.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;
  const rowsHtml = (rows: string[][]): string =>
    rows.length
      ? rows
          .map(
            row =>
              `<tr>${row
                .map((cell, columnIndex) => {
                  const state = cellState(sectionId, columnIndex, cell);
                  const className = state === 'none' ? '' : ` class="${CELL_STATE_CLASS[state]}"`;
                  return `<td${className}>${escapeHtml(cell)}</td>`;
                })
                .join('')}</tr>`,
          )
          .join('\n')
      : `<tr><td colspan="${table.columns.length}">（无数据）</td></tr>`;

  const visible = table.rows.slice(0, limit);
  const hidden = table.rows.slice(limit);
  const captionClass = `caption${noteClass(table.caption ?? '') ? ` ${NEUTRAL_NOTE_CLASS}` : ''}`;
  const caption = table.caption ? `<p class="${captionClass}">${escapeHtml(table.caption)}</p>` : '';

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
${renderTable(section.table, limit, section.id)}
${section.notes
  .map(note => {
    const cls = `note${noteClass(note) ? ` ${NEUTRAL_NOTE_CLASS}` : ''}`;
    return `<p class="${cls}">注：${escapeHtml(note)}</p>`;
  })
  .join('\n')}
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
