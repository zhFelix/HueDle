/**
 * 展示格式化。
 *
 * 总 CP 由概率定价导出（`ep = 100 / p`），**可达 1.79×10⁹**，
 * 不加千位分隔符根本读不出来，所以所有 CP 展示都要过这里。
 */

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 总 CP：四舍五入到整数并加千位分隔符，如 `1,790,000,000`。 */
export function formatCp(cp: number): string {
  if (!Number.isFinite(cp)) return '0';
  return GROUPED.format(Math.round(cp));
}

/** `#002FA7` → `rgb(0, 47, 167)`。 */
export function formatRgb(rgb: { r: number; g: number; b: number }): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

/** `hsl(221, 100%, 33%)`。 */
export function formatHsl(hsl: { h: number; s: number; l: number }): string {
  return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`;
}
