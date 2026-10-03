/**
 * 连续天数（streak）—— **与前端 `apps/web/src/lib/storage.ts` 的 `computeStreak` 逐行同口径**。
 *
 * 前端定义（`.claude` 之外唯一权威）：
 *   - 历史里所有 `date` 构成集合；
 *   - `today` **不在**集合里 → 0（今天没记录，链条从今天起就断了）；
 *   - 否则从 `today` 起按 **UTC 自然日**逐天往回数，直到断档，含今天。
 *
 * 前端用 `utcDate(new Date(Date.UTC(y, m-1, d) - 86_400_000))` 做「前一天」，
 * 这里用同一套 pure-UTC 算术（借 shared 的 `utcDate`），因此不受本地时区 / 夏令时影响，
 * 跨月、跨年边界与前端结果完全一致。
 *
 * 只吃日期字符串、不吃整行历史：`/api/daily` 用 `listDaily()` 一次取回该用户全部存档，
 * 顺手把日期挑出来即可，**不要为 streak 再加一次查询**。
 */
import { utcDate } from '@huedle/shared';

/** `YYYY-MM-DD` 往前推一天（纯 UTC 日期算术）。与前端 `previousUtcDay` 等价。 */
function previousUtcDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return utcDate(new Date(Date.UTC(y, m - 1, d) - 86_400_000));
}

/**
 * 以 `today` 为锚点往过去数连续天数。
 *
 * @param days  已有记录的 UTC 日期集合（`YYYY-MM-DD`）。
 * @param today 今天（UTC，`YYYY-MM-DD`）。
 */
export function computeStreak(days: ReadonlySet<string>, today: string): number {
  if (!days.has(today)) return 0;

  let streak = 0;
  let cursor = today;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousUtcDay(cursor);
  }
  return streak;
}
