/**
 * HTTP 小工具：统一的错误信封与客户端 IP 提取。
 *
 * 错误信封形状固定为 `{ error: { code, message } }`：
 *   - `code` 给程序判断，`message` 给人看；
 *   - **永不**把堆栈、SQL 原文或内部路径放进来（见 app.ts 的 onError）。
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getConnInfo } from '@hono/node-server/conninfo';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  return c.json<ApiErrorBody>({ error: { code, message } }, status);
}

/**
 * 取客户端 IP，供限流分桶。
 *
 * `X-Forwarded-For` **只有显式信任代理时才采信**（`trustProxy`）：
 * 直连部署下任何客户端都能自己写这个头，无条件采信等于给限流留了一个一行即破的后门。
 *
 * 顺序：可信时 `x-forwarded-for`（取最左） → `x-real-ip` → 真实连接地址。
 * 测试里没有 socket，`getConnInfo` 会抛，因此兜底为 `'unknown'` ——
 * 兜底值本身也是合法的分桶 key（测试正是靠它把同源请求算作同一桶）。
 */
export function clientIp(c: Context, trustProxy = false): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
