/**
 * 内存滑动窗口限流（按「客户端 IP + 路径」分桶）。
 *
 * 只用于 `/api/auth/*`，目的是把在线暴力猜密码的速率压到没有意义。
 * 单进程内存实现：重启即清零；多实例部署时需要换成共享存储（见报告「未做」一节）。
 */
import type { MiddlewareHandler } from 'hono';
import { apiError, clientIp } from './http';

export interface RateLimitOptions {
  /** 窗口内允许的最大请求数。 */
  limit: number;
  /** 窗口长度（毫秒）。 */
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 60_000 };

/**
 * 滑动窗口：每桶保存最近若干次成功计入的时间戳，过期戳在每次访问时顺手剔除。
 * 桶数量与「被攻击的 IP 数」同阶，窗口一到自然清空，不会无限增长。
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(private readonly options: RateLimitOptions = DEFAULT_RATE_LIMIT) {}

  /** 记一次请求；返回 `true` 表示放行，`false` 表示超限。 */
  hit(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.options.windowMs;
    const recent = (this.buckets.get(key) ?? []).filter(t => t > windowStart);

    if (recent.length >= this.options.limit) {
      this.buckets.set(key, recent);
      return false;
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  /** 仅供测试观察内部状态。 */
  size(): number {
    return this.buckets.size;
  }
}

export function rateLimitByIpAndPath(
  limiter: SlidingWindowRateLimiter,
  trustProxy = false,
): MiddlewareHandler {
  return async (c, next) => {
    const key = `${clientIp(c, trustProxy)}:${c.req.path}`;
    if (!limiter.hit(key)) {
      return apiError(c, 429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
    }
    await next();
  };
}
