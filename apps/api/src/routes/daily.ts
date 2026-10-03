/**
 * `GET /api/daily` —— 今日结果（抽出即定）。
 *
 * **服务端自行重算**（DESIGN 第 9.3 / 11.6 节）：
 *   - 颜色种子 = `{ mode:'user', userId: 服务端分配的 UUID }`，与 shared 完全同一份代码；
 *   - CP / 稀有度 / 命中集合由 `calculateScore` 现算，**不接受**客户端提交的任何值；
 *     handler 里没有一行读 `c.req.json()` / `c.req.query()` / `c.req.param()`；
 *   - 当天已有记录 → 原样返回，**不重算**（与本地模式同一套「冻结」语义）。
 */
import { calculateScore, getDailyColorInfo, utcDate } from '@huedle/shared';
import { Hono } from 'hono';
import type { Store } from '../db/store';
import { bearerAuth, type AppEnv } from '../lib/auth';
import { apiError } from '../lib/http';
import { toHistoryItem } from '../lib/serialize';

export interface DailyRoutesOptions {
  store: Store;
  /** 可注入时钟，测试用（决定「今天」是 UTC 的哪一天）。 */
  now?: () => Date;
}

export function dailyRoutes(options: DailyRoutesOptions): Hono<AppEnv> {
  const { store, now = () => new Date() } = options;
  const router = new Hono<AppEnv>();

  router.get('/daily', bearerAuth(store, now), async c => {
    const user = c.get('user');
    const at = now();
    const date = utcDate(at);

    const existing = await store.getDaily(user.id, date);
    if (existing) {
      return c.json(toHistoryItem(existing));
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
    return c.json(toHistoryItem(row));
  });

  return router;
}
