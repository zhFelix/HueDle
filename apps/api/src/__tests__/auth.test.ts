/**
 * 认证路由用例（任务书 F 节 1–4、10、11）。
 *
 * 数据库改为 Postgres 后，`Store` 全部是异步的：夹具与每个断言都补了 `await`。
 */
import { describe, expect, it } from 'vitest';
import { hashToken } from '../lib/tokens';
import { authHeaders, makeHarness, postJson, registerUser, TEST_PASSWORD } from './helpers';
import { registerTestDatabase } from './testDb';

registerTestDatabase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('POST /api/auth/register', () => {
  it('注册成功：返回 token 与服务端分配的 UUID（账户种子）', async () => {
    const { app } = await makeHarness();
    const { res, token, user } = await registerUser(app, 'alice');

    expect(res.status).toBe(201);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(user.id).toMatch(UUID_RE);
    expect(user.name).toBe('alice');
    // 响应里绝不能出现密码或哈希
    expect(Object.keys(user).sort()).toEqual(['id', 'name']);
  });

  it('两次注册的 UUID 不同（种子由服务端分配，不可预测/不可复用）', async () => {
    const { app } = await makeHarness();
    const a = await registerUser(app, 'alice');
    const b = await registerUser(app, 'bob');
    expect(a.user.id).not.toBe(b.user.id);
  });

  it('重复同名 → 409，且不产生第二个用户', async () => {
    const { app, store } = await makeHarness();
    await registerUser(app, 'alice');

    const again = await postJson(app, '/api/auth/register', {
      name: 'alice',
      password: TEST_PASSWORD,
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: { code: 'NAME_TAKEN', message: '该用户名已被占用' },
    });
    expect(await store.countUsers()).toBe(1);
  });

  it('用户名/密码不合规 → 400', async () => {
    const { app } = await makeHarness();
    expect((await postJson(app, '/api/auth/register', { name: 'ab', password: TEST_PASSWORD })).status).toBe(400);
    expect((await postJson(app, '/api/auth/register', { name: 'alice', password: 'short' })).status).toBe(400);
    expect((await postJson(app, '/api/auth/register', { name: 'a b', password: TEST_PASSWORD })).status).toBe(400);
    expect((await app.request('/api/auth/register', { method: 'POST', body: 'not json' })).status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('登录成功返回新 token 与用户', async () => {
    const { app } = await makeHarness();
    const { user } = await registerUser(app, 'alice');

    const res = await postJson(app, '/api/auth/login', { name: 'alice', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { id: string; name: string } };
    expect(body.user).toEqual(user);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('密码错误与用户不存在 → 响应体完全相等（不泄露用户名是否存在）', async () => {
    const { app } = await makeHarness();
    await registerUser(app, 'alice');

    const wrongPassword = await postJson(app, '/api/auth/login', {
      name: 'alice',
      password: 'definitely-not-it',
    });
    const unknownUser = await postJson(app, '/api/auth/login', {
      name: 'nobody-here',
      password: 'definitely-not-it',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);

    const a = await wrongPassword.text();
    const b = await unknownUser.text();
    // 逐字节相同：状态码、文案、字段顺序都不能成为枚举信道
    expect(a).toBe(b);
    expect(a).toBe('{"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码不正确"}}');
  });
});

describe('GET /api/auth/me', () => {
  it('无 token → 401；有 token → 返回用户', async () => {
    const { app } = await makeHarness();
    expect((await app.request('/api/auth/me')).status).toBe(401);
    expect(
      (await app.request('/api/auth/me', { headers: { authorization: 'Bearer nonsense' } })).status,
    ).toBe(401);

    const { token, user } = await registerUser(app, 'alice');
    const res = await app.request('/api/auth/me', { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user.id, name: 'alice' });
  });

  it('库里只存 token 的 SHA-256，不存明文', async () => {
    const { app, store } = await makeHarness();
    const { token } = await registerUser(app, 'alice');

    expect(await store.findSession(token)).toBeUndefined();
    expect(await store.findSession(hashToken(token))).toBeDefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('登出 → 204，原 token 立即失效（401）', async () => {
    const { app } = await makeHarness();
    const { token } = await registerUser(app, 'alice');

    const out = await app.request('/api/auth/logout', { method: 'POST', headers: authHeaders(token) });
    expect(out.status).toBe(204);
    expect((await out.text()).length).toBe(0);

    expect((await app.request('/api/auth/me', { headers: authHeaders(token) })).status).toBe(401);
    expect((await app.request('/api/daily', { headers: authHeaders(token) })).status).toBe(401);
  });

  it('登出只删自己那条会话，另一台设备的 token 不受影响', async () => {
    const { app } = await makeHarness();
    await registerUser(app, 'alice');
    const phone = await postJson(app, '/api/auth/login', { name: 'alice', password: TEST_PASSWORD });
    const laptop = await postJson(app, '/api/auth/login', { name: 'alice', password: TEST_PASSWORD });
    const phoneToken = ((await phone.json()) as { token: string }).token;
    const laptopToken = ((await laptop.json()) as { token: string }).token;

    await app.request('/api/auth/logout', { method: 'POST', headers: authHeaders(phoneToken) });
    expect((await app.request('/api/auth/me', { headers: authHeaders(phoneToken) })).status).toBe(401);
    expect((await app.request('/api/auth/me', { headers: authHeaders(laptopToken) })).status).toBe(200);
  });
});

describe('会话过期', () => {
  it('expires_at 改成过去 → 401', async () => {
    const { app, store } = await makeHarness();
    const { token } = await registerUser(app, 'alice');

    await store.setSessionExpiry(hashToken(token), new Date(Date.now() - 1000).toISOString());

    expect((await app.request('/api/auth/me', { headers: authHeaders(token) })).status).toBe(401);
  });
});
