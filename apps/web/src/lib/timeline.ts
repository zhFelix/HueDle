/**
 * 颜色时间线的**纯函数层**（设计见 docs/NEW-FEATURES.md 第 3 节）。
 *
 * 组件 `components/ColorTimeline.vue` 只负责渲染，排布 / 缺口 / 文案全部在这里，
 * 因此这一层可以脱离 DOM 单测，也能覆盖「无历史 / 单天 / 连续 100 天 /
 * 跨月跨年 / 中间大量断档」这些真实会遇到的形状。
 *
 * ── 三条口径 ───────────────────────────────────────────────────────────────
 *
 * 1. **不信任调用方**：输入顺序、重复日期、非法日期都不假设。函数内部先按日期
 *    升序排序（`Array.prototype.sort` 稳定），再同日去重（保留排序后先出现的那条，
 *    与 `loadHistory()` 的去重口径一致）。
 * 2. **日期算术只用 `previousUtcDay`**：`storage.ts` 已经导出它，这里 import 复用。
 *    时间线**绝不自己写 UTC 加减**——时区与跨月边界是最容易写出细微不一致的地方。
 * 3. **不读时钟**：`today` 由调用方注入；不注入时所有 `isToday` 都是 `false`。
 *    这样函数是确定性的，测试不需要 mock 系统时钟。
 *
 * ── 缺口怎么表示 ────────────────────────────────────────────────────────────
 *
 * 时间线是**日历轴**，不是「有记录的那几天排一排」：3 天连续与「3 天散在一个月里」
 * 必须能从横向间距看出来，否则这条带子就不叫时间线了。所以从**最早一天到最晚一天
 * 之间的每一天都占一个位置**：有记录的那天是 `kind: 'entry'`（有色块），
 * 没记录的那天是 `kind: 'gap'`（占位块，组件里画成虚线灰块）。
 *
 * `gap` 不伪造颜色、不伪造 cp / rarity——没有的东西就是没有。
 *
 * ── 折行与渐变：为什么在纯函数层算 ──────────────────────────────────────────
 *
 * 相邻两天之间要画一段 `from → to` 的渐变，但**渐变只允许出现在「相邻且都有记录」
 * 的两天之间**：
 *
 *   - 缺口两侧必须断开。渐变表达的是「这两天是连着的」，跨缺口画渐变等于把
 *     「断了两天」画成「连在一起」——那正好抹掉这条时间线存在的意义。
 *   - 换行处必须断开。折行之后「行尾」和「下一行行首」在空间上不相邻，那里画
 *     渐变同样是撒谎。
 *
 * 这两条规则都需要知道「两个格子是不是真正的左右邻居」。在 CSS 里做不了
 * （`:first-child` 管不了 flex 换行的行首），所以折行**由这里显式算出来**：
 * {@link layoutTimeline} 把日期切成固定容量的行，**渐变只连同一行内、相邻且都
 * 有记录的两个格子**；行首格子的 `link` 恒为 `null`。容量由组件按容器宽度实测
 * 后传入（见 `ColorTimeline.vue`），所以折行位置既能自适应，又完全可单测。
 */
import type { ScoreRarity } from '@huedle/shared';
import { previousUtcDay, type HistoryItem } from './storage';

/** `YYYY-MM-DD`。与 `storage.ts` 的 `DATE_RE` 同口径（这里不 import 它：它是私有的）。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 跨度上限（防御性，正常路径永远走不到）。
 *
 * 输入日期全部通过 `DATE_RE`，但 `2026-13-45` 这种「格式对、日历错」的串仍是
 * 可能的（类型层面挡不住手改的存档）。这种日期会让 `previousUtcDay` 走出非单调的
 * 结果，逐日回溯就可能不收敛——给一个上限，宁可截断也不允许卡死 UI。
 * 40000 天 ≈ 109 年，比任何真实历史都长。
 */
const MAX_SPAN_DAYS = 40_000;

/** 有记录的一天。 */
export interface TimelineEntryDay {
  kind: 'entry';
  /** `YYYY-MM-DD`（UTC 口径）。 */
  date: string;
  /** 大写 `#RRGGBB`。 */
  hex: string;
  cp: number;
  rarity: ScoreRarity;
  /** 是否是注入的 `today` 那天（未注入 `today` 时恒为 `false`）。 */
  isToday: boolean;
}

/** 没有记录的一天（缺口占位）。**没有颜色**，所以没有 `hex`。 */
export interface TimelineGapDay {
  kind: 'gap';
  date: string;
  isToday: false;
}

export type TimelineDay = TimelineEntryDay | TimelineGapDay;

/** 缺口块的玩家可见文案（`title` / `aria-label` 的第二段）。 */
const GAP_LABEL = '没有记录';

/**
 * 排布整条时间线：**按日期升序**的每一天（含缺口），最早的在最左。
 *
 * 纯函数：不改 `entries`（排序的是新建的数组）、不读存储、不读时钟。
 *
 * @param entries 历史记录，顺序任意（内部会排序 + 去重）。
 * @param today   `YYYY-MM-DD`，用于标出「今天」；省略则不标。
 */
export function buildTimeline(entries: readonly HistoryItem[], today?: string): TimelineDay[] {
  const valid: HistoryItem[] = [];
  for (const item of entries) {
    if (!item || typeof item.date !== 'string' || !DATE_RE.test(item.date)) continue;
    valid.push(item);
  }

  // 不信任调用方的顺序：先升序（稳定排序），再同日去重保留先出现的那条。
  valid.sort((a, b) => a.date.localeCompare(b.date));

  const byDate = new Map<string, HistoryItem>();
  for (const item of valid) {
    if (!byDate.has(item.date)) byDate.set(item.date, item);
  }

  const dates = [...byDate.keys()];
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return [];

  // 从最新一天往回逐日走，直到最早一天；再翻转成升序。
  const span: string[] = [];
  let cursor = last;
  while (true) {
    span.push(cursor);
    if (cursor === first || span.length >= MAX_SPAN_DAYS) break;
    cursor = previousUtcDay(cursor);
  }
  span.reverse();

  return span.map<TimelineDay>(date => {
    const item = byDate.get(date);
    if (item === undefined) return { kind: 'gap', date, isToday: false };

    return {
      kind: 'entry',
      date,
      hex: typeof item.hex === 'string' ? item.hex.trim().toUpperCase() : '',
      cp: Number.isFinite(item.cp) ? item.cp : 0,
      rarity: item.rarity,
      isToday: today !== undefined && date === today,
    };
  });
}

// ---------------------------------------------------------------------------
// 折行 + 相邻渐变
// ---------------------------------------------------------------------------

/**
 * 默认每行容量（天）。
 *
 * 只在**容器宽度未知**时兜底（组件还没挂载、`clientWidth` 为 0 的 jsdom、
 * 或 `display:none` 的隐藏容器）。真实浏览器里组件会用实测宽度覆盖它。
 */
export const DEFAULT_DAYS_PER_ROW = 30;

/**
 * 相邻两天的颜色连接（渲染成**较晚那格**的整格 `from → to` 渐变）。
 *
 * `from` 是较早那天、`to` 是较晚那天——渐变方向恒为「时间前进的方向」。
 */
export interface TimelineLink {
  /** 较早那天的 `#RRGGBB`（渐变起点）。 */
  from: string;
  /** 较晚那天的 `#RRGGBB`（渐变终点）。 */
  to: string;
}

/** 一行里的一格：一天 + 它左侧有没有可以连上去的邻居。 */
export interface TimelineCell {
  day: TimelineDay;
  /**
   * 连着前一天的那段渐变（`from` = 前一天、`to` = 当天）。
   *
   * 渲染时它画在**这一格自己的背景**上（整格 `from → to`），所以 `null` 表示这一格
   * 是**实心的硬边**，只有两种可能，两种都是刻意的：
   *   - 它是一行的第一格（行首与上一行的行尾在空间上不相邻）；
   *   - 它的前一天没有记录（缺口）或是所有记录的第一天。
   */
  link: TimelineLink | null;
  /** 是否是所在行的第一格（行首：左侧没有邻居，永远不画渐变）。 */
  isRowStart: boolean;
}

/** 折行后的一行（`index` 从 0 起，0 是最早的那一行）。 */
export interface TimelineRow {
  index: number;
  cells: TimelineCell[];
}

/**
 * 把日期切成多行，并算出每格左侧能不能连上邻居。
 *
 * 规则（与组件注释里的两条语义一一对应）：
 *
 *   1. **渐变只出现在同一行内、相邻且都有记录的两天之间**。
 *      因为每一天（含缺口）都占一格，「相邻」就是「日历上相邻」；缺口那格是
 *      `kind: 'gap'`，本身不产生 `link`，于是缺口两侧的链条**天然断开**。
 *   2. **行首没有 `link`**（`isRowStart`），因此行首那格是实心当天色；行尾的渐变
 *      也只收在当天颜色，不会向下一行发散。
 *
 * 纯函数：不改 `days`、不读时钟、不读 DOM。`perRow` 非法（≤ 0 / NaN / Infinity）
 * 时按 1 或 {@link DEFAULT_DAYS_PER_ROW} 兜底，绝不产出 `NaN`。
 *
 * @param days    {@link buildTimeline} 的输出（升序、含缺口）。
 * @param perRow  每行放几格（组件按容器宽度实测后传入）。
 */
export function layoutTimeline(
  days: readonly TimelineDay[],
  perRow: number = DEFAULT_DAYS_PER_ROW,
): TimelineRow[] {
  if (days.length === 0) return [];

  const raw = Number.isFinite(perRow) ? Math.floor(perRow) : DEFAULT_DAYS_PER_ROW;
  const capacity = Math.max(1, raw);

  const rows: TimelineRow[] = [];
  for (let start = 0; start < days.length; start += capacity) {
    const slice = days.slice(start, start + capacity);
    const cells = slice.map<TimelineCell>((day, i) => {
      const prev = i > 0 ? slice[i - 1] : undefined;
      // 「相邻且都有记录」——缺口的 kind 不是 entry，链条在这里断掉。
      const link =
        prev !== undefined && prev.kind === 'entry' && day.kind === 'entry'
          ? { from: prev.hex, to: day.hex }
          : null;

      return { day, link, isRowStart: i === 0 };
    });

    rows.push({ index: rows.length, cells });
  }

  return rows;
}

/**
 * 行内所有渐变的扁平列表（按 DOM 顺序），便于断言「哪些天之间被连起来了」。
 *
 * **不返回跨缺口 / 跨行的连接**——`layoutTimeline` 根本不会造出那种连接。
 */
export function timelineLinks(rows: readonly TimelineRow[]): TimelineLink[] {
  const links: TimelineLink[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.link !== null) links.push(cell.link);
    }
  }
  return links;
}

/**
 * 色块 / 占位块的悬停提示。
 *
 * 格式沿用 `HistoryList.vue` 的 `{hex} · {date}` 分隔风格（`·` + 空格），
 * 顺序对调成 `{date} · {hex}`——时间轴上日期是主语。
 */
export function timelineTitle(day: TimelineDay): string {
  return day.kind === 'entry' ? `${day.date} · ${day.hex}` : `${day.date} · ${GAP_LABEL}`;
}

/** 色块 / 占位块的屏幕阅读器标签（与 `timelineTitle` 同信息，只换分隔符）。 */
export function timelineAriaLabel(day: TimelineDay): string {
  return day.kind === 'entry' ? `${day.date} ${day.hex}` : `${day.date} ${GAP_LABEL}`;
}

/** 有记录的天数（缺口不计入）。 */
export function countRecordedDays(days: readonly TimelineDay[]): number {
  let count = 0;
  for (const day of days) {
    if (day.kind === 'entry') count += 1;
  }
  return count;
}

/** 缺口的天数（缺口占位块的数量）。 */
export function countGapDays(days: readonly TimelineDay[]): number {
  let count = 0;
  for (const day of days) {
    if (day.kind === 'gap') count += 1;
  }
  return count;
}
