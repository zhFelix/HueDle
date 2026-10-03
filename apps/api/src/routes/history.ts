/**
 * `GET /api/history` —— 该用户的全部存档，按日期**降序**（与前端 `loadHistory()` 的排序一致）。
 */
import { Hono } from 'hono';
import type { Store } from '../db/store';
import { bearerAuth, type AppEnv } from '../lib/auth';
import { toHistoryItem } from '../lib/serialize';

export interface HistoryRoutesOptions {
  store: Store;
  /** 可注入时钟，测试用；认证中间件校验会话过期时用同一个时间源。 */
  now?: () => Date;
}

export function historyRoutes({ store, now = () => new Date() }: HistoryRoutesOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/history', bearerAuth(store, now), async c =>
    c.json((await store.listDaily(c.get('user').id)).map(toHistoryItem)),
  );

  return router;
}
