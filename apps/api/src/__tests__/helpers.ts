/**
 * 测试夹具：所有用例共享同一套「测试 schema + 连接池」，靠 `beforeEach` 清表隔离。
 *
 * 全程 `app.request(...)`，不开端口、不起进程。
 */
import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { createApp, type CreateAppOptions } from '../app';
import { Store } from '../db';
import type { AppEnv } from '../lib/auth';
import { getTestPool } from './testDb';

export const TEST_PASSWORD = 'correct-horse-battery';

/**
 * 测试里默认把限流阈值抬到极高：绝大多数用例关心的是别的东西，
 * 不该被「同一 IP 连打同一路径」误伤。限流本身由一个**专用低频阈值**的用例覆盖。
 */
export const TEST_RATE_LIMIT = { limit: 1000, windowMs: 60_000 };

export interface TestHarness {
  app: Hono<AppEnv>;
  store: Store;
  pool: Pool;
}

/**
 * 组装一套 app + store。数据库是**该测试文件共享的** Postgres 连接池
 * （独立 schema `huedle_test`，每个用例前 `TRUNCATE`），因此是异步的。
 */
export async function makeHarness(
  overrides: Omit<Partial<CreateAppOptions>, 'store'> = {},
): Promise<TestHarness> {
  const pool = getTestPool();
  const store = new Store(pool);
  const app = createApp({ store, rateLimit: TEST_RATE_LIMIT, ...overrides });
  return { app, store, pool };
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function postJson(
  app: Hono<AppEnv>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export interface RegisteredUser {
  res: Response;
  token: string;
  user: { id: string; name: string };
}

export async function registerUser(
  app: Hono<AppEnv>,
  name: string,
  password: string = TEST_PASSWORD,
): Promise<RegisteredUser> {
  const res = await postJson(app, '/api/auth/register', { name, password });
  const body = (await res.json()) as { token: string; user: { id: string; name: string } };
  return { res, token: body.token, user: body.user };
}

/** 便捷：注册并直接返回 Authorization 头。 */
export async function registerAndAuth(
  app: Hono<AppEnv>,
  name: string,
): Promise<{ token: string; user: { id: string; name: string } }> {
  const { token, user } = await registerUser(app, name);
  return { token, user };
}
