/**
 * 概率的展示格式化（仅徽章详情用）。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────────────
 *
 * `lib/format.ts` 的 `formatCp` 是**另一个量纲**（稀有度分数 `ep`，可达 1.7×10⁹），
 * 它的展示方式在 `docs/PRICING-SPEC.md` §9 里还是未决项。概率（`hits / TOTAL_COLORS`）
 * 与它无关，因此**不往 `format.ts` 里加**，隔离在这里。
 * `formatCp` 的调用点一个都不动。
 *
 * ── 规则（docs/NEW-FEATURES.md §7.1）───────────────────────────────────────
 *
 * | 条件 | 主展示 | 辅助句 |
 * |---|---|---|
 * | 恒真（hits ≥ total） | `100%` | `每一种颜色都符合` |
 * | q < 0.01 且 hits ≤ 9999 | `1 / {total/hits}` | `约 {total/hits} 分之 1` |
 * | 其余（q ≥ 0.01，或 hits ≥ 10000） | `{pct}%`（**固定 3 位小数**） | `{total} 种颜色里有 {hits} 种` |
 *
 * 中文大数换算（§7.2）**不引 `Intl.NumberFormat(notation:'compact')`**：
 * 不同运行时的中文紧凑格式舍入不一致，而这里是会被测试断言的字符串，手写换算表是确定的。
 *
 * 边界：`hits === 0` 返回 `0%`（不可达，但绝不能输出 `1 / 0` 或 `Infinity`）；
 * `hits: null` 的分支由调用方处理（不渲染概率行），不在这里 fallback 成 0。
 */
import { TOTAL_COLORS } from '@huedle/shared';

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 大数的人话写法：16777216 → `1677.7 万`；999 → `999`。 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // **不缩略**：写实数（`16,777,216`），不用「1677 万」。
  // 缩略会丢掉读者判断量级所需的精度——「1677 万」既可能是 16,770,000
  // 也可能是 16,779,999，而这里要表达的恰恰是「正好多少种颜色」。
  return GROUPED.format(Math.round(n));
}

/**
 * 把 `formatCount(n)` 接上一个量词。
 *
 * `formatCount` 的大数写法自带单位（`1677.7 万`），再接 `种` 就是 `1677.7 万种`；
 * 而纯数字（`256`）需要空格：`256 种`。这正好是 §1.5 / §7.2 例子里
 * `1677 万种颜色里有 256 种` 的写法。
 */
function measure(count: number, unit: string): string {
  // formatCount 现在恒定返回带千位分隔的纯数字，所以一律加空格即可。
  return `${formatCount(count)} ${unit}`;
}

/**
 * `q * 100` 的 2 位有效数字。
 *
 * 直接用 `toPrecision(2)` 会在数值 ≥ 100（如 99.99 → `1.0e+2`）时切到科学计数法，
 * 那不是一个能给玩家看的百分比；这里对科学计数法兜底成整数。
 */
/**
 * 百分比，**固定 3 位小数**。
 *
 * 走百分比这条路的最小值是 `hits = 10000`（q ≈ 0.06%），所以 3 位小数不会退化成 `0.000%`；
 * 更小的命中数都走 `1 / N` 的分数形式。
 *
 * 用 `toFixed` 而非 `toPrecision(2)`：后者按**有效数字**舍入，读者没法直接比大小——
 * `13%` 和 `0.60%` 都是「2 位有效数字」，但一个看着像整数、一个看着像千分位。
 */
function formatPercent(q: number): string {
  return (q * 100).toFixed(3);
}

/** 概率的主展示：`1 / 255`、`13%`、`0.060%`、`100%`、`0%`。 */
export function formatProbability(hits: number, total: number = TOTAL_COLORS): string {
  if (!Number.isFinite(hits) || !Number.isFinite(total) || total <= 0 || hits <= 0) return '0%';
  if (hits >= total) return '100%';

  const q = hits / total;
  // 千分之一数是 `total / hits`，**不是** `hits`。
  // 原实现写 `1 / ${hits}`，把「命中多少种」当成了「多少分之一」——
  // 于是最稀有的那批徽章（精确单色，hits = 1）显示成 `1 / 1`，读起来是「必然抽中」，
  // 与真相（1677 万分之一）正好相反。hits = 4096 时 `1 / 4096` 碰巧正确
  // （因为 16777216 / 4096 = 4096），所以样例看起来没问题，错误被掩盖了。
  if (q < 0.01 && hits <= 9999) return `1 / ${GROUPED.format(Math.round(total / hits))}`;
  return `${formatPercent(q)}%`;
}

/** 概率的辅助句：`约 6.6 万分之 1`、`1677.7 万种颜色里有 256 种`。 */
export function formatProbabilityHint(hits: number, total: number = TOTAL_COLORS): string {
  if (!Number.isFinite(hits) || !Number.isFinite(total) || total <= 0 || hits <= 0) return '';
  if (hits >= total) return '每一种颜色都符合';

  const q = hits / total;
  if (q < 0.01) return `约 ${measure(total / hits, '分之 1')}`;
  return `${measure(total, '种')}颜色里有 ${measure(hits, '种')}`;
}
