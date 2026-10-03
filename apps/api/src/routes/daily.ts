/**
 * `GET /api/daily` —— 今日结果（抽出即定），**顺带返回连续天数 `streak`**。
 *
 * **服务端自行重算**（DESIGN 第 9.3 / 11.6 节）：
 *   - 颜色种子 = `{ mode:'user', userId: 服务端分配的 UUID }`，与 shared 完全同一份代码；
 *   - CP / 稀有度 / 命中集合由 `calculateScore` 现算，**不接受**客户端提交的任何值；
 *     handler 里没有一行读 `c.req.json()` / `c.req.query()` / `c.req.param()`；
 *   - 当天已有记录 → 原样返回，**不重算**（与本地模式同一套「冻结」语义）。
 *
 * 关于往返：原来先 `getDaily` 再（若缺）INSERT，之后前端为了一个 streak 还要再打一次
 * `/api/history`（+3 次往返）。现在改成**一次 `listDaily` 取回该用户全部存档**：
 * 既用来判断今天是否已有记录，又用来在 JS 里算 streak，不额外增加查询。
 */
import { calculateScore, getDailyColorInfo, utcDate } from '@huedle/shared';
import { Hono } from 'hono';
import type { DailyRow, Store } from '../db/store';
import { bearerAuth, type AppEnv } from '../lib/auth';
import { apiError } from '../lib/http';
import { toHistoryItem } from '../lib/serialize';
import { computeStreak } from '../lib/streak';

export interface DailyRoutesOptions {
  store: Store;
  /** 可注入时钟，测试用（决定「今天」是 UTC 的哪一天）。 */
  now?: () => Date;
}

/**
 * 从该用户的全部存档（`listDaily` 的结果）算 streak。
 *
 * `today` 一定在返回结果里（本接口保证当天有记录），所以即便 `rows` 是插入前取回的、
 * 里面还没有今天这一行，也要显式把它补进集合 —— 否则刚生成的新用户会被算成 0 天，
 * 与前端 `computeStreak` 的口径不符。
 */
function streakFromRows(rows: readonly DailyRow[], today: string): number {
  const days = new Set(rows.map(row => row.date));
  days.add(today);
  return computeStreak(days, today);
}

export function dailyRoutes(options: DailyRoutesOptions): Hono<AppEnv> {
  const { store, now = () => new Date() } = options;
  const router = new Hono<AppEnv>();

  router.get('/daily', bearerAuth(store, now), async c => {
    const user = c.get('user');
    const at = now();
    const date = utcDate(at);

    // 一次查询拿回该用户全部日期：既判断「今天是否已有记录」，又供 streak 使用。
    const rows = await store.listDaily(user.id);
    const existing = rows.find(row => row.date === date);

    if (existing) {
      return c.json({ ...toHistoryItem(existing), streak: streakFromRows(rows, date) });
    }

    const color = getDailyColorInfo({ mode: 'user', userId: user.id }, at);
    const score = calculateScore(color);

    // 原子「没有就生成」：单条 INSERT ... ON CONFLICT (user_id, date) DO NOTHING RETURNING *。
    // 并发的另一个请求若先插入，这里返回的是**它**写下的那一行（store 内部回读），
    // 绝不会插出第二行，也不会把本次本地算出的值当成权威值。
    const row = await store.insertDailyIfAbsent({
      userId: user.id,
      date,
      hex: color.hex,
      cp: score.cp,
      rarity: score.rarity,
      badgeIdsJson: JSON.stringify(score.badges.map(b => b.id)),
      createdAt: at.toISOString(),
    });

    if (!row) {
      return apiError(c, 500, 'INTERNAL', '无法生成今日结果');
    }
    // 字段顺序与已有记录分支保持一致（date, hex, cp, rarity, badgeIds, streak），
    // 并发用例要求逐字节一致的响应。
    return c.json({ ...toHistoryItem(row), streak: streakFromRows(rows, date) });
  });

  return router;
}
