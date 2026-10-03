/**
 * Bearer 认证中间件与请求上下文类型。
 *
 * 客户端只持有 `token`（32 字节随机 hex）；服务端把它 SHA-256 后去 `sessions` 查。
 * 查不到、已过期、或用户已不存在 → 一律 401，且不区分原因（同样是避免信息泄漏）。
 *
 * 数据库在远端（每个查询往返 ~343ms），所以会话与用户用**一条 JOIN** 一起取回
 * （`findSessionWithUser`），不再做两次独立查询。**这里刻意不做任何认证结果缓存**：
 * 登出即时失效是选 Session 而非 JWT 的唯一理由，详见 `store.findSessionWithUser` 的注释。
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

    // 一次 JOIN 拿到 { userId, name, expiresAt }（原来是 findSession + findUserById 两次往返）。
    // JOIN 查不到 = 会话不存在，或用户已被删除（sessions 外键 ON DELETE CASCADE 会连会话一起删，
    // 所以不存在「有会话没用户」的孤儿行）—— 两种情况的处理本来就相同：401，且无会话可删。
    const session = await store.findSessionWithUser(tokenHash);
    if (!session) {
      return apiError(c, 401, 'UNAUTHORIZED', '缺少或无效的认证信息');
    }

    // 过期即失效；顺手清掉这条废会话，避免表里越积越多。
    // 时间源与签发会话时**必须是同一个**（测试注入时钟时尤其重要）。
    if (session.expiresAt <= now().toISOString()) {
      await store.deleteSession(tokenHash);
      return apiError(c, 401, 'UNAUTHORIZED', '缺少或无效的认证信息');
    }

    c.set('user', { id: session.userId, name: session.name });
    c.set('tokenHash', tokenHash);
    await next();
  };
}
