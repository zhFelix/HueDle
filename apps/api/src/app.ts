/**
 * 组装 Hono app。
 *
 * 与 `index.ts`（真正监听端口）分开，是为了让测试直接 `app.request(...)` ——
 * 不占端口、不起进程、快且无冲突。
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Store } from './db/store';
import type { AppEnv } from './lib/auth';
import { apiError } from './lib/http';
import {
  DEFAULT_RATE_LIMIT,
  SlidingWindowRateLimiter,
  rateLimitByIpAndPath,
  type RateLimitOptions,
} from './lib/rateLimit';
import { authRoutes } from './routes/auth';
import { dailyRoutes } from './routes/daily';
import { historyRoutes } from './routes/history';

/** 默认允许的前端来源（可用 `HUEDLE_ORIGIN` 覆盖，逗号分隔）。 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:4173',
] as const;

/** 请求体上限：认证请求只有两个短字段，16KB 已经非常宽松。 */
export const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * 规范化一个来源，用于**比较**。
 *
 * 为什么要小写：浏览器序列化 `Origin` 时会把主机名统一小写——这是 URL 规范的强制行为，
 * 页面地址写 `https://zhFelix.github.io`，发出的请求头也是 `https://zhfelix.github.io`。
 *
 * 实测踩过：`HUEDLE_ORIGIN` 里写了大写的 `F`，于是白名单**永远匹配不上**，
 * CORS 头不下发，浏览器一律拦截。而用 curl 测却是通的——因为 curl 原样发送你给的字符串，
 * 不会做规范化。这类"只在真浏览器里复现"的配置错误极难查，所以在这里一次性消化掉：
 * 白名单和请求头**两边都规范化后再比**，写大写小写都能用。
 *
 * 来源只由 `scheme://host:port` 构成（没有路径），三段都是大小写无关的，整体小写是安全的。
 */
export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.HUEDLE_ORIGIN?.trim();
  if (!raw) return [...DEFAULT_ALLOWED_ORIGINS];
  const origins = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
  return origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS];
}

export interface CreateAppOptions {
  store: Store;
  /** CORS 白名单；默认 {@link DEFAULT_ALLOWED_ORIGINS}。 */
  allowedOrigins?: string[];
  /** `/api/auth/*` 的限流参数；默认 10 次 / 60 秒 / (IP, 路径)。 */
  rateLimit?: RateLimitOptions;
  bodyLimitBytes?: number;
  /**
   * 是否信任 `X-Forwarded-For` / `X-Real-IP` 作为限流分桶的客户端 IP。
   * 默认 `false`：直连部署下这些头可被客户端伪造，采信等于限流形同虚设；
   * 反向代理后面部署时用 `HUEDLE_TRUST_PROXY=1` 打开。
   */
  trustProxy?: boolean;
  /** 可注入时钟，测试用。 */
  now?: () => Date;
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const {
    store,
    allowedOrigins = [...DEFAULT_ALLOWED_ORIGINS],
    rateLimit = DEFAULT_RATE_LIMIT,
    bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
    trustProxy = false,
    now = () => new Date(),
  } = options;

  const app = new Hono<AppEnv>();

  // 两边都规范化后再比，并且把**原始请求头**回给浏览器
  // （浏览器拿自己发出去的那个值来比对，所以回原始值最稳）。
  const allowedOriginSet = new Set(allowedOrigins.map(normalizeOrigin));

  app.use(
    '*',
    cors({
      origin: (requestOrigin: string) =>
        allowedOriginSet.has(normalizeOrigin(requestOrigin)) ? requestOrigin : undefined,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: bodyLimitBytes,
      onError: c => apiError(c, 413, 'PAYLOAD_TOO_LARGE', '请求体过大'),
    }),
  );

  app.use('/api/auth/*', rateLimitByIpAndPath(new SlidingWindowRateLimiter(rateLimit), trustProxy));

  app.get('/api/health', c => c.json({ ok: true }));

  app.route('/api/auth', authRoutes({ store, now }));
  app.route('/api', dailyRoutes({ store, now }));
  app.route('/api', historyRoutes({ store, now }));

  app.notFound(c => apiError(c, 404, 'NOT_FOUND', '接口不存在'));

  // 兜底：任何未捕获异常都只回一条固定文案，堆栈与 SQL 原文留在服务端日志里。
  app.onError((err, c) => {
    console.error('[huedle-api] unhandled error:', err);
    return apiError(c, 500, 'INTERNAL', '服务器内部错误');
  });

  return app;
}
