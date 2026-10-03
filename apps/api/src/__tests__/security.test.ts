/**
 * 安全用例（任务书 E 节与 F 节 12–13）：
 * 限流、SQL 注入、CORS、请求体上限、错误不泄漏内部信息、数据库约束。
 *
 * 迁移到 Postgres 后，原来两条「数据库约束」用例的等价写法：
 *   - 外键不再需要 `PRAGMA foreign_keys = ON`（PG 默认强制），改为验证真的插不进孤儿行；
 *   - `sqlite_master` 换成 `pg_tables`，并显式限定在测试 schema `huedle_test` 内。
 */
import { describe, expect, it, vi } from 'vitest';
import { allowedOriginsFromEnv, createApp } from '../app';
import { Store } from '../db';
import { SlidingWindowRateLimiter } from '../lib/rateLimit';
import { makeHarness, postJson, registerUser, TEST_PASSWORD, TEST_RATE_LIMIT } from './helpers';
import { getTestPool, registerTestDatabase, TEST_SCHEMA } from './testDb';

registerTestDatabase();

const INJECTION = "'; DROP TABLE users; --";

describe('限流（/api/auth/*，按 IP + 路径）', () => {
  it('超过阈值 → 429，且响应是结构化 JSON', async () => {
    const { app } = await makeHarness({ rateLimit: { limit: 3, windowMs: 60_000 } });
    const credentials = { name: 'alice', password: 'wrong-password' };

    for (let i = 0; i < 3; i += 1) {
      expect((await postJson(app, '/api/auth/login', credentials)).status).toBe(401);
    }

    const limited = await postJson(app, '/api/auth/login', credentials);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
    });
  });

  it('分桶维度是 IP + 路径：换路径、换 IP 都不受影响（trustProxy 打开时）', async () => {
    const { app } = await makeHarness({ rateLimit: { limit: 2, windowMs: 60_000 }, trustProxy: true });
    const credentials = { name: 'alice', password: 'wrong-password' };

    await postJson(app, '/api/auth/login', credentials);
    await postJson(app, '/api/auth/login', credentials);
    expect((await postJson(app, '/api/auth/login', credentials)).status).toBe(429);

    // 同 IP 但不同路径：自己的桶
    expect((await app.request('/api/auth/me')).status).toBe(401);
    // 同路径但不同 IP：自己的桶
    expect(
      (await postJson(app, '/api/auth/login', credentials, { 'x-forwarded-for': '10.0.0.9' }))
        .status,
    ).toBe(401);
    // 非 auth 路由不受限流影响
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('默认不信任 X-Forwarded-For：直连部署下伪造该头无法绕过限流', async () => {
    const { app } = await makeHarness({ rateLimit: { limit: 1, windowMs: 60_000 } });
    const credentials = { name: 'alice', password: 'wrong-password' };

    expect((await postJson(app, '/api/auth/login', credentials)).status).toBe(401);
    // 换一个伪造 IP：仍然落在同一个「真实来源」桶里 → 429
    expect(
      (await postJson(app, '/api/auth/login', credentials, { 'x-forwarded-for': '10.0.0.9' }))
        .status,
    ).toBe(429);
  });

  it('滑动窗口到期后重新放行（纯函数级）', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.hit('k', 0)).toBe(true);
    expect(limiter.hit('k', 10)).toBe(true);
    expect(limiter.hit('k', 20)).toBe(false);
    // 窗口滑过最初两次请求后，桶重新空出来
    expect(limiter.hit('k', 1001)).toBe(true);
  });
});

describe('SQL 注入尝试', () => {
  it('恶意用户名既不能注册、也不能登录，users 表安然无恙', async () => {
    const { app, store, pool } = await makeHarness();
    await registerUser(app, 'alice');

    // 1) 注册：被字符白名单挡在 SQL 之前
    const reg = await postJson(app, '/api/auth/register', {
      name: INJECTION,
      password: TEST_PASSWORD,
    });
    expect(reg.status).toBe(400);

    // 2) 登录：注入串**真的进了**参数化查询，被当作普通字符串比对 → 401
    const login = await postJson(app, '/api/auth/login', {
      name: INJECTION,
      password: INJECTION,
    });
    expect(login.status).toBe(401);

    const orLogin = await postJson(app, '/api/auth/login', {
      name: "' OR '1'='1",
      password: "' OR '1'='1",
    });
    expect(orLogin.status).toBe(401);

    // 3) 表还在，数据没被删，也没有多出任何用户
    expect(await store.countUsers()).toBe(1);
    expect((await store.findUserByName('alice'))?.name).toBe('alice');
    expect(await store.findUserByName(INJECTION)).toBeUndefined();
    const tables = await pool.query(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename',
      [TEST_SCHEMA],
    );
    expect(tables.rows.map((t: { tablename: string }) => t.tablename)).toEqual([
      'daily_results',
      'sessions',
      'users',
    ]);
  });
});

describe('CORS', () => {
  it('白名单来源放行，非白名单来源不下发 CORS 头', async () => {
    const { app } = await makeHarness();

    const allowed = await app.request('/api/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const denied = await app.request('/api/health', {
      headers: { origin: 'http://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('预检请求允许 Authorization 头', async () => {
    const { app } = await makeHarness();
    const res = await app.request('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:4173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4173');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it('可用 HUEDLE_ORIGIN 覆盖（逗号分隔）', async () => {
    const { app } = await makeHarness({ allowedOrigins: ['https://huedle.example'] });
    const res = await app.request('/api/health', {
      headers: { origin: 'https://huedle.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://huedle.example');
    const old = await app.request('/api/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(old.headers.get('access-control-allow-origin')).toBeNull();
  });
});

  it('浏览器会把主机名小写化——白名单写大写也必须匹配（实测踩过的坑）', async () => {
    // 页面地址写 https://zhFelix.github.io，但浏览器序列化 Origin 时强制小写。
    // 白名单若原样保存大写，就永远匹配不上，CORS 头不下发，浏览器一律拦截；
    // 而 curl 原样发送字符串，测出来是通的 —— 所以这个 bug 只在真浏览器里复现。
    const { app } = await makeHarness({ allowedOrigins: ['https://zhFelix.github.io'] });

    const lower = await app.request('/api/health', {
      headers: { origin: 'https://zhfelix.github.io' },
    });
    expect(lower.headers.get('access-control-allow-origin')).toBe('https://zhfelix.github.io');

    // 反向也要成立：白名单小写、请求头大写（非浏览器客户端）
    const { app: app2 } = await makeHarness({ allowedOrigins: ['https://zhfelix.github.io'] });
    const upper = await app2.request('/api/health', {
      headers: { origin: 'https://zhFelix.github.io' },
    });
    expect(upper.headers.get('access-control-allow-origin')).toBe('https://zhFelix.github.io');
  });

  it('大小写归一化不会把不该放行的来源放进来', async () => {
    const { app } = await makeHarness({ allowedOrigins: ['https://zhFelix.github.io'] });
    for (const bad of ['https://zhfelix.github.io.evil.com', 'https://evil.com', 'http://zhfelix.github.io']) {
      const res = await app.request('/api/health', { headers: { origin: bad } });
      expect(res.headers.get('access-control-allow-origin'), bad).toBeNull();
    }
  });

  it('allowedOriginsFromEnv 会把白名单规范化（小写、去尾斜杠）', () => {
    expect(allowedOriginsFromEnv({ HUEDLE_ORIGIN: 'https://zhFelix.github.io/' })).toEqual([
      'https://zhfelix.github.io',
    ]);
    expect(
      allowedOriginsFromEnv({ HUEDLE_ORIGIN: 'https://A.example, http://B.example:8080/' }),
    ).toEqual(['https://a.example', 'http://b.example:8080']);
  });

describe('请求体上限与错误信封', () => {
  it('超大请求体 → 413 结构化 JSON', async () => {
    const { app } = await makeHarness({ bodyLimitBytes: 1024 });
    const res = await postJson(app, '/api/auth/register', {
      name: 'alice',
      password: TEST_PASSWORD,
      padding: 'x'.repeat(4096),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' },
    });
  });

  it('未知路由 → 404 结构化 JSON', async () => {
    const { app } = await makeHarness();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  it('内部异常 → 500 固定文案，绝不回传堆栈 / SQL 原文', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      class ExplodingStore extends Store {
        override findUserByName(): never {
          throw new Error('error: relation "users" does not exist');
        }
      }
      const app = createApp({
        store: new ExplodingStore(getTestPool()),
        rateLimit: TEST_RATE_LIMIT,
      });

      const res = await postJson(app, '/api/auth/login', {
        name: 'alice',
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(500);

      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        error: { code: 'INTERNAL', message: '服务器内部错误' },
      });
      expect(text).not.toContain('relation');
      expect(text).not.toContain('at ');
      // 服务端日志里仍然有完整错误，便于排查
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('数据库约束（Postgres）', () => {
  const insertDaily = (userId: string, date: string) =>
    getTestPool().query(
      `INSERT INTO daily_results (user_id, date, hex, cp, rarity, badge_ids, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, date, '#000000', 1, 'trash', '[]', '2026-01-01T00:00:00.000Z'],
    );

  it('外键默认生效（无需 PRAGMA），写孤儿行会被拒绝', async () => {
    await expect(insertDaily('ghost-user', '2026-01-01')).rejects.toMatchObject({ code: '23503' });
  });

  it('daily_results 的 UNIQUE(user_id, date) 生效', async () => {
    const { app } = await makeHarness();
    const { user } = await registerUser(app, 'alice');

    await insertDaily(user.id, '2026-01-01');
    await expect(insertDaily(user.id, '2026-01-01')).rejects.toMatchObject({ code: '23505' });
  });
});
