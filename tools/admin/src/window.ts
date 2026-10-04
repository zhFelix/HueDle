/**
 * 时间窗口的数值契约：`stats` 与 `ui` 共用一份，避免两个子命令各写一个上限。
 *
 * UI 里能点的窗口是 {@link UI_WINDOWS}（至少 7/30/90，见 `ui/render.ts`），
 * 但 `?days=` 接受 1–{@link MAX_WINDOW_DAYS} 的任意整数——与 CLI 完全同口径。
 */

/** 不带参数时的默认窗口（天）。 */
export const DEFAULT_WINDOW_DAYS = 30;

/** 窗口下界（含）。 */
export const MIN_WINDOW_DAYS = 1;

/**
 * 窗口上界（含）。纯属防呆：窗口太大对生产库的扫描成本高，也不会有更多结论。
 */
export const MAX_WINDOW_DAYS = 3650;
