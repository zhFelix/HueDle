/**
 * 视觉主题测试：把「后台 = 游戏同一套色阶」这件事变成**可执行的断言**。
 *
 * 五组（对应任务书的 5 类测试）：
 *   1. 哨兵指标的两种状态样式不同（正常绿 / 异常红，用真实分析路径产出数据）；
 *   2. 「样本不足 / 不给结论」是中性色——**反向断言**：它的类名与 CSS 里
 *      不含任何 warning/error/danger 的类名或色值；
 *   3. 页面底色是深色（取自 `apps/web/src/style.css` 的 `--color-ink-950`）；
 *   4. 无外链（含字体、CDN、图片）——断网可用；
 *   5. 无 `<script>`。
 *
 * 色值断言一律比对**变量名**（`--ink-950` / `--neutral-400` / `--red-300`…），
 * 而这些变量的定义又在本文件里逐字对齐主题原文，因此"抄的"与"用的"不会漂移。
 */
import { describe, expect, it } from 'vitest';
import { contextForDraws } from '../analyze';
import { analyzeMetric } from '../run';
import { METRICS } from '../stats';
import {
  CELL_STATE_CLASS,
  cellState,
  NEUTRAL_NOTE_CLASS,
  renderUiError,
  renderUiPage,
  UI_CSS,
} from '../ui/render';
import type { StatsReport } from '../report';
import { sampleReport } from './fixtures';

/** 去掉注释，否则选择器会带上 `/* … *\/` 前缀。 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 从内联样式里取某条**精确匹配**的选择器（逗号分隔的选择器算同一条）的规则体。 */
function cssRules(selector: string): string[] {
  const rules: string[] = [];
  for (const chunk of stripComments(UI_CSS).split('}')) {
    const parts = chunk.split('{');
    if (parts.length !== 2) continue;
    const selectors = parts[0]!.split(',').map(s => s.trim());
    if (selectors.includes(selector)) rules.push(parts[1]!.trim());
  }
  return rules;
}

function rule(selector: string): string {
  const rules = cssRules(selector);
  expect(rules, `CSS 里应有 ${selector} 规则`).not.toHaveLength(0);
  return rules.join(' ');
}

/** 把某个指标的真实分析结果渲染成整页。 */
function pageWith(id: string, rows: unknown[], extra: unknown[] = [], draws = 1000): string {
  const metric = METRICS.find(m => m.id === id)!;
  const section = analyzeMetric(metric, rows as never, extra as never, contextForDraws(draws, 200));
  return renderUiPage(sampleReport({ sections: [section] } as Partial<StatsReport>), { days: 30 });
}

describe('测试 1：哨兵指标的两种状态用不同的类与不同的颜色', () => {
  it('M1 唯一约束：OK 与「⚠ 约束被破坏」落进不同的 class', () => {
    const page = pageWith('M1', [
      { date: '2026-01-01', draws: 5, players: 5 },
      { date: '2026-01-02', draws: 5, players: 4 },
    ]);
    expect(page).toContain(`<td class="${CELL_STATE_CLASS.ok}">OK</td>`);
    expect(page).toContain(`<td class="${CELL_STATE_CLASS.bad}">⚠ 约束被破坏</td>`);
    expect(CELL_STATE_CLASS.ok).not.toBe(CELL_STATE_CLASS.bad);
  });

  it('M5 幽灵 id：没有幽灵 = 正常；有幽灵 = 异常', () => {
    const healthy = pageWith('M5', []);
    expect(healthy).toContain(`<td class="${CELL_STATE_CLASS.ok}">（无）</td>`);

    const broken = pageWith('M5', [{ badge_id: 'ghost-from-2024', n: 3, first_seen: '2024-01-01' }]);
    expect(broken).toContain(`<td class="${CELL_STATE_CLASS.bad}">ghost-from-2024</td>`);
  });

  it('M8 完整性：全部为 0 是正常；非 0 是异常', () => {
    const zeros = {
      bad_hex: 0,
      bad_date: 0,
      future_date: 0,
      bad_badge_ids: 0,
      bad_cp: 0,
      expired_sessions: 0,
    };
    const healthy = pageWith('M8', [zeros], [{ duplicates: 0 }]);
    expect(healthy.match(new RegExp(`<td class="${CELL_STATE_CLASS.ok}">0</td>`, 'g'))).toHaveLength(7);

    const broken = pageWith('M8', [{ ...zeros, bad_hex: 2 }], [{ duplicates: 0 }]);
    expect(broken).toContain(`<td class="${CELL_STATE_CLASS.bad}">2</td>`);
    // 同一个页面上「正常」的检查项仍然是绿色——颜色是逐格的表意，不是整卡装饰。
    expect(broken).toContain(`<td class="${CELL_STATE_CLASS.ok}">0</td>`);
  });

  it('两种状态的 CSS 不同：正常 = emerald-400，异常 = red-300', () => {
    const ok = rule(`td.${CELL_STATE_CLASS.ok}`);
    const bad = rule(`td.${CELL_STATE_CLASS.bad}`);
    expect(ok).not.toBe(bad);
    expect(ok).toContain('var(--emerald-400)');
    expect(bad).toContain('var(--red-300)');
    // 两个色值本身也必须不同（不是同一个绿/红写两遍）
    expect(rule(':root')).toContain('--emerald-400: oklch(76.5% 0.177 163.223)');
    expect(rule(':root')).toContain('--red-300: oklch(80.8% 0.114 19.571)');
  });

  it('非哨兵列一律不着色（颜色只用在真的有含义的格子上）', () => {
    expect(cellState('M1', 1, '5')).toBe('none');
    expect(cellState('M1', 2, '4')).toBe('none');
    expect(cellState('M4', 3, '2.4')).toBe('none');
    expect(cellState('M8', 0, 'bad_hex')).toBe('none');
    expect(cellState('M8', 1, '—')).toBe('none');
    expect(cellState('M5', 1, '3')).toBe('none');
    expect(cellState('M6', 0, '2025-12-29')).toBe('none');
  });
});

describe('测试 2（反向断言）：「样本不足 / 不给结论」必须是中性色，不是警告色', () => {
  // 窗口内 150 次抽取 < 200 → M4 明确「不给结论」。这个状态**没有结论，不等于坏消息**：
  // 它不是数据出了问题的信号，用黄/红会诱导读者去做错误的处置。
  const page = pageWith('M4', [{ badge_id: 'casino-pair', hit_days: 3 }], [], 150);
  const caption = page.match(/<p class="([^"]+)">([^<]*不给结论[^<]*)<\/p>/);

  /** 任何表示「警告 / 错误 / 危险 / 坏」的类名或色值都不许出现。 */
  const FORBIDDEN = /warn|danger|error|err|alert|critical|fail|bad|red|amber|yellow|orange/i;

  it('caption 里带着中性的类名，且不含任何 warning/error/danger 词根', () => {
    expect(caption, '页面上应有「不给结论」的表注').not.toBeNull();
    const classes = caption![1].split(/\s+/).filter(Boolean);
    expect(classes).toContain('caption');
    expect(classes).toContain(NEUTRAL_NOTE_CLASS);
    expect(classes.filter(c => FORBIDDEN.test(c))).toEqual([]);
    expect(caption![2]).toContain('不给结论');
  });

  it(`CSS 里 .${NEUTRAL_NOTE_CLASS} 只借中性灰，不借任何警告色`, () => {
    const body = rule(`.${NEUTRAL_NOTE_CLASS}`);
    expect(body).toContain('var(--neutral-400)');
    expect(body).not.toMatch(FORBIDDEN);
    // 中性色也不能偷偷用红/黄的原始 oklch 或十六进制写死
    expect(body).not.toMatch(/oklch\(/);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('该元素用到的每一条规则都不含警告色（逐类名回溯，而不是只看一个选择器）', () => {
    const classes = caption![1].split(/\s+/).filter(Boolean);
    for (const name of classes) {
      for (const body of cssRules(`.${name}`)) {
        expect(body, `.${name} 不应是警告色`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('哨兵色确实存在（证明上面的反向断言不是"整页都没有颜色"的假阳性）', () => {
    expect(UI_CSS).toMatch(FORBIDDEN); // red-300 / state-bad 在样式里
    expect(rule(`td.${CELL_STATE_CLASS.bad}`)).toContain('var(--red-300)');
  });

  it('「样本不足」出现在 M4 的另一种措辞里时同样走中性类', () => {
    // draws=1000 且 casino-pair 期望命中 ≈ 656 ≥ 5 → 这一页真的算出了 z，没有"样本不足"这句
    const enough = pageWith('M4', [{ badge_id: 'casino-pair', hit_days: 700 }], [], 1000);
    const note = sampleReport({
      sections: [
        {
          id: 'M4',
          title: 'M4 测试',
          question: 'q',
          table: { columns: ['徽章', '实际命中(天)'], rows: [['x', '1']], caption: '窗口样本不足以计算 z（期望命中 < 5）' },
          notes: ['窗口内 draws < 200 时不给结论，只给原始计数（小样本的 z 值无意义）。'],
        },
      ],
    });
    const pageHtml = renderUiPage(note, { days: 30 });
    expect(pageHtml).toContain(`class="caption ${NEUTRAL_NOTE_CLASS}"`);
    expect(pageHtml).toContain(`<p class="note ${NEUTRAL_NOTE_CLASS}">注：窗口内 draws &lt; 200`);
    expect(pageHtml).not.toContain('class="warning"');
    // 样本给足时 M4 的表注是正常的（那条"没有结论"的话一个字都不出现）
    expect(enough).not.toContain('样本不足');
    expect(enough).not.toContain('只列原始计数');
  });
});

describe('测试 3：页面底色是深色（与游戏 ink-950 同一个值）', () => {
  it('色值逐字抄自 apps/web/src/style.css 的 @theme', () => {
    const root = rule(':root');
    expect(root).toContain('--ink-950: #08090c');
    expect(root).toContain('--ink-900: #0e1015');
    expect(root).toContain('--ink-800: #171a21');
    expect(root).toContain('--ink-700: #23262f');
  });

  it('body 用 ink-950 做底色、neutral-200 做正文色', () => {
    const body = rule('body');
    expect(body).toContain('background: var(--ink-950)');
    expect(body).toContain('color: var(--neutral-200)');
    expect(rule(':root')).toContain('color-scheme: dark');
  });

  it('卡片背景 (ink-900) 比页面底色 (ink-950) 高一层：圆角 + ink-700 边框', () => {
    const card = rule('main section.card');
    expect(card).toContain('background: var(--ink-900)');
    expect(card).toContain('border: 1px solid var(--ink-700)');
    expect(card).toContain('border-radius: 1rem');
    // 概览卡片与指标卡片同一套层次
    expect(rule('.stat')).toContain('background: var(--ink-900)');
    expect(rule('.stat')).toContain('border-radius: 1rem');
  });

  it('渲染出来的页面里确实带着这个深色值（不是只写在测试里）', () => {
    expect(renderUiPage(sampleReport(), { days: 30 })).toContain('#08090c');
    expect(renderUiError(404, 'x')).toContain('#08090c');
  });

  it('表格文字用中性灰而不是最深的灰（深色底上要看得清）', () => {
    const td = rule('td');
    expect(td).toContain('var(--neutral-200)');
    expect(td).not.toContain('var(--neutral-600)');
    expect(td).not.toContain('var(--neutral-900)');
    expect(td).not.toContain('var(--neutral-950)');
    expect(rule('th')).toContain('var(--neutral-300)');
    // 表头底色 / 斑马纹都来自 ink 色阶
    expect(rule('th')).toContain('var(--ink-800)');
    expect(rule('tbody tr:nth-child(even)')).toContain('var(--ink-800)');
    expect(rule('th')).toContain('var(--ink-700)');
  });
});

describe('测试 4：无外链（含字体 / CDN / 图片）', () => {
  const pages = [renderUiPage(sampleReport(), { days: 30 }), renderUiError(500, 'x')];

  it('没有 http(s):// 、@import、@font-face、url()、<link>、src=', () => {
    for (const html of pages) {
      expect(html).not.toContain('http://');
      expect(html).not.toContain('https://');
      expect(html.toLowerCase()).not.toContain('@import');
      expect(html.toLowerCase()).not.toContain('@font-face');
      expect(html.toLowerCase()).not.toContain('fonts.googleapis');
      expect(html.toLowerCase()).not.toContain('//fonts');
      expect(html.toLowerCase()).not.toContain('cdn');
      expect(html).not.toContain('url(');
      expect(html.toLowerCase()).not.toContain('<link');
      expect(html).not.toContain('src=');
      expect(html).not.toContain('href="//');
    }
  });

  it('字体只用系统字体栈（无外部字体文件）', () => {
    const root = rule(':root');
    expect(root).toContain("--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI'");
    expect(root).toContain('--font-mono: ui-monospace, SFMono-Regular');
    expect(UI_CSS).not.toMatch(/\.(woff2?|ttf|otf|eot)/);
  });
});

describe('测试 5：没有 <script>（零前端 JS）', () => {
  it('整页与错误页都不含 <script>，交互只靠 a / details / 锚点', () => {
    const long = sampleReport({
      sections: [
        {
          id: 'M6',
          title: 'M6 测试',
          question: 'q',
          table: {
            columns: ['周', '稀有度'],
            rows: Array.from({ length: 25 }, (_, i) => [`w${i + 1}`, 'common']),
          },
          notes: [],
        },
      ],
    });
    const html = renderUiPage(long, { days: 30 });
    expect(html.toLowerCase()).not.toContain('<script');
    expect(renderUiError(405, 'x').toLowerCase()).not.toContain('<script');
    expect(html).toContain('<details class="more">');
    expect(html).toContain('href="?days=7"');
    expect(html).toContain('href="#M6"');
  });
});
