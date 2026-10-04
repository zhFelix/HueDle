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
