/**
 * `lib/api.ts` 测试：**全部 mock `fetch`，不真的起后端**。
 *
 * 覆盖任务书的 3 条要求：
 *   - 401 → 抛带 `status = 401` 的可识别错误；
 *   - 网络异常（后端没起）→ 可识别错误（`status = 0` / `code = NETWORK`），不是白屏；
 *   - token 正确注入 `Authorization: Bearer <token>` 头。
 * 外加：成功判定用 `res.ok`（201 / 204 都算成功）、错误体各码如实透传。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_BASE,
  ApiError,
  getDaily,
  getHistory,
  isApiError,
  login,
  logout,
  me,
  register,
  resolveApiBase,
} from './api';
import { apiErrorReply, installFetchMock, type FetchCall } from '../test-utils/mock-fetch';

/** 统一的断言辅助：抓住抛出的 ApiError（没有抛就失败）。 */
async function catchApiError(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('预期抛出 ApiError，但没有抛');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveApiBase', () => {
  it('未配置 → 默认 http://localhost:3001', () => {
    expect(resolveApiBase({})).toBe('http://localhost:3001');
    expect(resolveApiBase()).toBe('http://localhost:3001');
  });

  it('读取 VITE_API_BASE，去空白与尾部斜杠；空串回落默认值', () => {
    expect(resolveApiBase({ VITE_API_BASE: ' https://api.example.com/ ' })).toBe(
      'https://api.example.com',
    );
    expect(resolveApiBase({ VITE_API_BASE: 'http://localhost:3001///' })).toBe(
      'http://localhost:3001',
    );
    expect(resolveApiBase({ VITE_API_BASE: '   ' })).toBe('http://localhost:3001');
  });

  it('导出当前生效的 API_BASE', () => {
    expect(API_BASE).toBe(resolveApiBase(import.meta.env));
  });
});

describe('token 注入与请求形状', () => {
  it('me() 注入 Authorization: Bearer <token>', async () => {
    const { calls } = installFetchMock(() => ({ body: { id: 'u1', name: 'Alice' } }));

    await expect(me('tok-1')).resolves.toEqual({ id: 'u1', name: 'Alice' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${API_BASE}/api/auth/me`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok-1');
  });

  it('getDaily() / getHistory() 都带 token', async () => {
    const { calls } = installFetchMock(call =>
      call.url.endsWith('/api/history') ? { body: [] } : { body: { date: '2026-03-04' } },
    );

    await getDaily('tok-2');
    await getHistory('tok-2');

    expect(calls.map(call => call.url)).toEqual([
      `${API_BASE}/api/daily`,
      `${API_BASE}/api/history`,
    ]);
    for (const call of calls) expect(call.headers.Authorization).toBe('Bearer tok-2');
  });

  it('register() 发 POST + JSON body，不带 Authorization', async () => {
    const { calls } = installFetchMock(() => ({
      status: 201,
      body: { token: 't', user: { id: 'u1', name: 'Alice' } },
    }));

    await expect(register('Alice', 'password123')).resolves.toEqual({
      token: 't',
      user: { id: 'u1', name: 'Alice' },
    });

    const call = calls[0] as FetchCall;
    expect(call.url).toBe(`${API_BASE}/api/auth/register`);
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toEqual({ name: 'Alice', password: 'password123' });
  });

  it('logout() 发 POST + token，204 无响应体也算成功（用 res.ok 判定）', async () => {
    const { calls } = installFetchMock(() => ({ status: 204 }));

    await expect(logout('tok-3')).resolves.toBeUndefined();

    expect(calls[0]!.url).toBe(`${API_BASE}/api/auth/logout`);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok-3');
  });
});

describe('错误识别', () => {
  it('401 → ApiError(status=401, code=UNAUTHORIZED)，isUnauthorized 为 true', async () => {
    installFetchMock(() => apiErrorReply(401, 'UNAUTHORIZED', '未登录或登录已过期'));

    const error = await catchApiError(() => me('expired'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toBe('未登录或登录已过期');
    expect(error.isUnauthorized).toBe(true);
    expect(error.isNetworkError).toBe(false);
  });

  it('401 且响应体不可解析 → 仍能用状态码兜底识别', async () => {
    installFetchMock(() => ({ status: 401 })); // body undefined → json() 抛

    const error = await catchApiError(() => me('expired'));

    expect(error.status).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toContain('401');
  });

  it('后端错误码如实透传：INVALID_CREDENTIALS / NAME_TAKEN / RATE_LIMITED / VALIDATION', async () => {
    const cases = [
      { status: 401, code: 'INVALID_CREDENTIALS', message: '用户名或密码不正确' },
      { status: 409, code: 'NAME_TAKEN', message: '该用户名已被占用' },
      { status: 429, code: 'RATE_LIMITED', message: '请求过于频繁' },
      { status: 400, code: 'VALIDATION', message: '参数不合法' },
    ] as const;

    for (const item of cases) {
      installFetchMock(() => apiErrorReply(item.status, item.code, item.message));
      const error = await catchApiError(() => login('Alice', 'password123'));
      expect(error.status).toBe(item.status);
      expect(error.code).toBe(item.code);
      expect(error.message).toBe(item.message);
    }
  });

  it('网络异常（后端没起）→ status=0 / code=NETWORK，可识别、不白屏', async () => {
    installFetchMock(() => {
      throw new TypeError('fetch failed');
    });

    const error = await catchApiError(() => getDaily('tok'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK');
    expect(error.isNetworkError).toBe(true);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('2xx 但响应体不是合法 JSON → INVALID_RESPONSE', async () => {
    installFetchMock(() => ({ status: 200 })); // json() 抛

    const error = await catchApiError(() => getHistory('tok'));

    expect(error.status).toBe(200);
    expect(error.code).toBe('INVALID_RESPONSE');
  });
});

describe('响应结构守卫', () => {
  it('getHistory() 非数组 → INVALID_RESPONSE（不让页面拿到脏数据）', async () => {
    installFetchMock(() => ({ body: { items: [] } }));

    const error = await catchApiError(() => getHistory('tok'));
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('me() 缺 name → INVALID_RESPONSE', async () => {
    installFetchMock(() => ({ body: { id: 'u1' } }));

    const error = await catchApiError(() => me('tok'));
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('login() 缺 token → INVALID_RESPONSE', async () => {
    installFetchMock(() => ({ body: { user: { id: 'u1', name: 'Alice' } } }));

    const error = await catchApiError(() => login('Alice', 'password123'));
    expect(error.code).toBe('INVALID_RESPONSE');
  });
});
