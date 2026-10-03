/**
 * `stores/session.ts` 测试（mock fetch，不起后端）。
 *
 * 盯住两条架构规则：
 *   - **规则 2**：有 token 时 `hydrate()` 用 `GET /api/auth/me` 补回 userId；
 *     401 → 清 token 回本地模式；网络错误 → 保留 token 但按本地模式运行。
 *   - **规则 1**：登录 / 登出**一次都不碰** `huedle:daily` / `huedle:history`
 *     / `huedle:streak`，登出后它们原样还在（DESIGN 11.3）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isApiError } from '../lib/api';
import {
  STORAGE_KEYS,
  loadIdentity,
  loadUserHistory,
  saveUserDaily,
  saveUserHistory,
  userDailyKey,
} from '../lib/storage';
import { apiErrorReply, installFetchMock } from '../test-utils/mock-fetch';
import { useSessionStore, clearSessionOnUnauthorized } from './session';

const LOCAL_KEYS = [STORAGE_KEYS.daily, STORAGE_KEYS.history, STORAGE_KEYS.streak] as const;

/** 预置一份身份缓存（模拟"上次登录过的浏览器"）。 */
function seedIdentity(userId = 'u1', userName = 'Stale'): void {
  localStorage.setItem(STORAGE_KEYS.identity, JSON.stringify({ userId, userName }));
}

const CACHED_DAILY = {
  date: '2026-03-04',
  hex: '#002FA7',
  cp: 42,
  rarity: 'common' as const,
  badgeIds: ['culture-klein-blue'],
};

/** 预置一份"本地模式数据"，用来验证登录 / 登出全程不污染它。 */
function seedLocalData(): Record<string, string> {
  const seeded: Record<string, string> = {
    [STORAGE_KEYS.daily]: JSON.stringify({
      v: 1,
      date: '2026-03-04',
      hex: '#002FA7',
      cp: 42,
      rarity: 'common',
      badgeIds: [],
    }),
    [STORAGE_KEYS.history]: '[]',
    [STORAGE_KEYS.streak]: '3',
  };
  for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  return seeded;
}

function expectLocalDataIntact(seeded: Record<string, string>): void {
  for (const key of LOCAL_KEYS) expect(localStorage.getItem(key)).toBe(seeded[key]);
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('规则 2：启动时用 token 补回 userId（hydrate）', () => {
  it('有 token 且 me 成功 → isLoggedIn true，userId / userName 都补回来', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    const { calls } = installFetchMock(() => ({ body: { id: 'u1', name: 'Alice' } }));

    const store = useSessionStore();
    expect(store.isLoggedIn).toBe(false); // 补回之前：token 在、userId 不在

    await expect(store.hydrate()).resolves.toBe(true);

    expect(store.isLoggedIn).toBe(true);
    expect(store.mode).toBe('user');
    expect(store.userId).toBe('u1');
    expect(store.userName).toBe('Alice');
    expect(calls[0]!.url).toContain('/api/auth/me');
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok-alice');
  });

  it('无 token → false，不请求后端，直接本地模式', async () => {
    const { calls } = installFetchMock(() => ({ body: { id: 'u1', name: 'Alice' } }));

    const store = useSessionStore();
    await expect(store.hydrate()).resolves.toBe(false);

    expect(store.isLoggedIn).toBe(false);
    expect(store.mode).toBe('local');
    expect(calls).toHaveLength(0);
  });

  it('me 返回 401 → token 被清、回本地模式，本地数据不受影响', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-expired');
    const seeded = seedLocalData();
    installFetchMock(() => apiErrorReply(401, 'UNAUTHORIZED', '登录已过期'));

    const store = useSessionStore();
    await expect(store.hydrate()).resolves.toBe(false);

    expect(store.isLoggedIn).toBe(false);
    expect(store.token).toBeNull();
    expect(store.userId).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expectLocalDataIntact(seeded);
  });

  it('网络错误 → 保留 token（后端可能只是没起），本次按本地模式运行', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    installFetchMock(() => {
      throw new TypeError('fetch failed');
    });

    const store = useSessionStore();
    await expect(store.hydrate()).resolves.toBe(false);

    expect(store.isLoggedIn).toBe(false);
    expect(store.token).toBe('tok-alice');
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBe('tok-alice');
  });

  it('hydrate() 幂等：已恢复的会话不会重复请求', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    const { calls } = installFetchMock(() => ({ body: { id: 'u1', name: 'Alice' } }));

    const store = useSessionStore();
    await store.hydrate();
    await store.hydrate();

    expect(calls).toHaveLength(1);
  });
});

describe('login / registerUser / logout', () => {
  it('login() 成功 → 写 huedle:token、进入登录模式', async () => {
    installFetchMock(() => ({ body: { token: 'tok-alice', user: { id: 'u1', name: 'Alice' } } }));

    const store = useSessionStore();
    const user = await store.login('Alice', 'password123');

    expect(user).toEqual({ id: 'u1', name: 'Alice' });
    expect(store.isLoggedIn).toBe(true);
    expect(store.userName).toBe('Alice');
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBe('tok-alice');
  });

  it('registerUser() 成功（201）→ 同样进入登录模式', async () => {
    installFetchMock(() => ({
      status: 201,
      body: { token: 'tok-new', user: { id: 'u2', name: 'Bob' } },
    }));

    const store = useSessionStore();
    await store.registerUser('Bob', 'password123');

    expect(store.isLoggedIn).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBe('tok-new');
  });

  it('login() 失败（401）→ 原样抛出 ApiError，仍是本地模式、不写 token', async () => {
    const seeded = seedLocalData();
    installFetchMock(() => apiErrorReply(401, 'INVALID_CREDENTIALS', '用户名或密码不正确'));

    const store = useSessionStore();
    const error = await store.login('Alice', 'wrong-password').catch((err: unknown) => err);

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('用户名或密码不正确');
    expect(store.isLoggedIn).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expectLocalDataIntact(seeded);
  });

  it('registerUser() 重名（409）→ 抛出 NAME_TAKEN', async () => {
    installFetchMock(() => apiErrorReply(409, 'NAME_TAKEN', '该用户名已被占用'));

    const store = useSessionStore();
    const error = await store
      .registerUser('Alice', 'password123')
      .catch((err: unknown) => err);

    expect((error as ApiError).code).toBe('NAME_TAKEN');
    expect(store.isLoggedIn).toBe(false);
  });

  it('logout() 真的调后端，并且本地数据原封不动（DESIGN 11.3）', async () => {
    const seeded = seedLocalData();
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    const { calls } = installFetchMock(call =>
      call.url.endsWith('/api/auth/me')
        ? { body: { id: 'u1', name: 'Alice' } }
        : { status: 204 },
    );

    const store = useSessionStore();
    await store.hydrate();
    expect(store.isLoggedIn).toBe(true);

    const before = { ...seeded };
    await store.logout();

    expect(store.isLoggedIn).toBe(false);
    expect(store.userId).toBeNull();
    expect(store.userName).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();

    const logoutCall = calls.find(call => call.url.endsWith('/api/auth/logout'));
    expect(logoutCall).toBeDefined();
    expect(logoutCall!.method).toBe('POST');
    expect(logoutCall!.headers.Authorization).toBe('Bearer tok-alice');

    // 规则 1：登录 / 登出全程没碰过本地模式的三个键
    expectLocalDataIntact(before);
  });

  it('logout() 后端失败（网络异常）也要清掉本地登录态', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    installFetchMock(() => {
      throw new TypeError('fetch failed');
    });

    const store = useSessionStore();
    await store.logout();

    expect(store.isLoggedIn).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
  });

  it('clearSessionOnUnauthorized() 清掉会话并留下一条提示（不打后端）', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    const { calls } = installFetchMock(() => ({ body: { id: 'u1', name: 'Alice' } }));

    const store = useSessionStore();
    await store.hydrate();
    clearSessionOnUnauthorized();

    expect(store.isLoggedIn).toBe(false);
    expect(store.notice).toContain('本地模式');
    // 只打了一次 me，没有额外的 logout 请求
    expect(calls).toHaveLength(1);

    // 重新登录会清掉旧提示
    store.setSession('tok-bob', { id: 'u2', name: 'Bob' });
    expect(store.notice).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 身份缓存 `huedle:identity`（任务 B）
//
//   它让首屏立刻按登录模式渲染，**只用于显示**：只要 token 在，
//   `hydrate()` 就一定会调 `GET /api/auth/me` 核对，绝不因缓存跳过授权校验。
// ─────────────────────────────────────────────────────────────────────────────

describe('身份缓存 huedle:identity — 只用于显示，不参与授权', () => {
  it('登录 / 注册成功写入身份缓存；hydrate 成功用服务端结果覆盖', async () => {
    installFetchMock(() => ({ body: { token: 'tok-a', user: { id: 'u1', name: 'Alice' } } }));

    const store = useSessionStore();
    await store.login('Alice', 'password123');

    expect(loadIdentity()).toEqual({ userId: 'u1', userName: 'Alice' });
  });

  it('有身份缓存 → 立即按登录模式渲染，但 hydrate() 仍会调 /api/auth/me 核对', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    seedIdentity('u1', 'Stale');
    const { calls } = installFetchMock(() => ({ body: { id: 'u1', name: 'Alice' } }));

    const store = useSessionStore();
    // 首屏不阻塞：缓存身份直接把界面渲染成登录态
    expect(store.isLoggedIn).toBe(true);
    expect(store.userId).toBe('u1');
    expect(store.userName).toBe('Stale');

    await expect(store.hydrate()).resolves.toBe(true);

    // 关键：缓存没有让校验被跳过，me 确实打了一次
    expect(calls.filter(call => call.url.endsWith('/api/auth/me'))).toHaveLength(1);
    // 服务端的用户名覆盖了缓存（用户名可能改过）
    expect(store.userName).toBe('Alice');
    expect(loadIdentity()).toEqual({ userId: 'u1', userName: 'Alice' });
  });

  it('身份缓存 + 401 → 清 token、清身份缓存与今日缓存，回本地模式', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-expired');
    seedIdentity('u1', 'Alice');
    saveUserDaily('u1', CACHED_DAILY, 3);
    const seeded = seedLocalData();
    installFetchMock(() => apiErrorReply(401, 'UNAUTHORIZED', '登录已过期'));

    const store = useSessionStore();
    expect(store.isLoggedIn).toBe(true);

    await expect(store.hydrate()).resolves.toBe(false);

    expect(store.isLoggedIn).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.identity)).toBeNull();
    expect(localStorage.getItem(userDailyKey('u1'))).toBeNull();
    // 本地模式的数据一个字节都没动
    expectLocalDataIntact(seeded);
  });

  it('logout() 清掉身份缓存与本账户今日缓存，但本地键原样', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    seedIdentity('u1', 'Alice');
    saveUserDaily('u1', CACHED_DAILY, 3);
    const seeded = seedLocalData();
    installFetchMock(call =>
      call.url.endsWith('/api/auth/me')
        ? { body: { id: 'u1', name: 'Alice' } }
        : { status: 204 },
    );

    const store = useSessionStore();
    await store.hydrate();
    await store.logout();

    expect(localStorage.getItem(STORAGE_KEYS.identity)).toBeNull();
    expect(localStorage.getItem(userDailyKey('u1'))).toBeNull();
    expectLocalDataIntact(seeded);
  });

  it('logout() 连带清掉本账户的历史缓存（与今日缓存一起），别的账户不受影响', async () => {
    localStorage.setItem(STORAGE_KEYS.token, 'tok-alice');
    seedIdentity('u1', 'Alice');
    saveUserDaily('u1', CACHED_DAILY, 3);
    saveUserHistory('u1', '2026-03-04', [CACHED_DAILY]);
    saveUserHistory('u2', '2026-03-04', [CACHED_DAILY]);
    installFetchMock(call =>
      call.url.endsWith('/api/auth/me')
        ? { body: { id: 'u1', name: 'Alice' } }
        : { status: 204 },
    );

    const store = useSessionStore();
    await store.hydrate();
    await store.logout();

    expect(localStorage.getItem(userDailyKey('u1'))).toBeNull();
    expect(loadUserHistory('u1', '2026-03-04')).toBeNull();
    // 只清本账户的，别的账户的历史缓存不动
    expect(loadUserHistory('u2', '2026-03-04')).not.toBeNull();
  });
});
