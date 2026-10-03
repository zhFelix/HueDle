/**
 * Bearer 认证中间件与请求上下文类型。
 *
 * 客户端只持有 `token`（32 字节随机 hex）；服务端把它 SHA-256 后去 `sessions` 查。
 * 查不到、已过期、或用户已不存在 → 一律 401，且不区分原因（同样是避免信息泄漏）。
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { Store } from '../db/store';
import { apiError } from './http';
import { hashToken } from './tokens';

export interface AuthUser {
  id: string;
  name: string;
}

export interface AppEnv {
  Variables: {
    user: AuthUser;
    /** 本次请求携带的 token 哈希，登出时用来精确删掉这一条会话。 */
    tokenHash: string;
  };
}

export type AppContext = Context<AppEnv>;

const BEARER_RE = /^Bearer\s+(\S+)$/i;

export function bearerAuth(
  store: Store,
  now: () => Date = () => new Date(),
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const match = BEARER_RE.exec(header.trim());
    if (!match) {
      return apiError(c, 401, 'UNAUTHORIZED', '缺少或无效的认证信息');
    }

    const tokenHash = hashToken(match[1]!);
    const session = await store.findSession(tokenHash);
    if (!session) {
      return apiError(c, 401, 'UNAUTHORIZED', '缺少或无效的认证信息');
    }

    // 过期即失效；顺手清掉这条废会话，避免表里越积越多。
    // 时间源与签发会话时**必须是同一个**（测试注入时钟时尤其重要）。
    if (session.expires_at <= now().toISOString()) {
      await store.deleteSession(tokenHash);
      return apiError(c, 401, 'UNAUTHORIZED', '缺少或无效的认证信息');
    }

    const user = await store.findUserById(session.user_id);
    if (!user) {
      await store.deleteSession(tokenHash);
      return apiError(c, 401, 'UNAUTHORIZED', '缺少或无效的认证信息');
    }

    c.set('user', { id: user.id, name: user.name });
    c.set('tokenHash', tokenHash);
    await next();
  };
}
