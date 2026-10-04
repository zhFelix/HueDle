/**
 * 本地只读统计 UI 的 HTTP 服务（`node:http`，**零依赖**）。
 *
 * 硬约束的落点：
 *   ① 监听地址是常量 {@link UI_HOST} = `127.0.0.1`，**没有任何参数能把它改成 `0.0.0.0`**；
 *      `listenUiServer()` 里写死 `server.listen(port, UI_HOST)`，测试断言的是
 *      `server.address().address`（真实的监听地址），不是源码里的字符串。
 *   ④ 只读：本文件不 import `node:fs`、不 import `pg`；每个请求只是调用注入的
 *      `loadReport(days)`，而它必须是走 `db.ts`（`BEGIN READ ONLY`）的那条通道。
 *      路由只接受 `GET`/`HEAD`，其余方法一律 405——**根本没有写端点**。
 *   ⑤ 不发任何 CORS 头，不登录，不 daemon 化，不写 pid/文件。
 *
 * 查询参数只有 `?days=`，且必须是 1–3650 的整数；非法值 400，绝不做字符串拼接。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { redactSecrets } from '../db';
import type { StatsReport } from '../report';
import { MAX_WINDOW_DAYS, MIN_WINDOW_DAYS } from '../window';
import { renderUiError, renderUiPage } from './render';

/**
 * 监听地址：**常量，不可配置**。
 *
 * `127.0.0.1` 是内核层的不路由——同网段机器在 TCP 层就够不着；这不是应用层过滤，
 * 也不依赖防火墙。改成 `0.0.0.0` 等于把"连着生产库、零认证、含用户名与每日颜色"
 * 的页面交给同一网络里的所有人，因此这里刻意不提供 `--host`。
 */
export const UI_HOST = '127.0.0.1';

/** 默认端口：避开 `apps/api dev`(3001) 与 `vite dev`(5173)，避免撞车或"以为没跑其实在跑"。 */
export const UI_DEFAULT_PORT = 4321;

export const UI_DEFAULT_DAYS = 30;

/**
 * 窗口天数上界（含）。与 `argv.ts` 的 CLI 校验共用 `src/window.ts` 里的同一份常量，
 * 因此"CLI 拒绝的值"与"UI 拒绝的值"不可能漂移。
 */

/**
 * 交给分析层的 M4 上限。UI 想要"默认截断、可展开"，所以先多取一些回来，
 * 再由 `render.ts` 决定默认展示多少行；CLI 不受影响。
 */
export const UI_ANALYZE_TOP_N = 200;

export interface UiServerOptions {
  /** 不带 `?days=` 时用的窗口。 */
  initialDays: number;
  /**
   * 报告来源。生产实现走 `runStats(pool, …)`（`db.ts` 的只读事务），
   * `includeNames` 由该闭包持有；测试注入假实现即可在不起数据库的情况下验证 HTTP 层。
   */
  loadReport: (days: number) => Promise<StatsReport>;
}

/** `?days=` 的解析结果。 */
export type DaysParse = { ok: true; days: number } | { ok: false; error: string };

/**
 * 解析 `?days=`（纯函数，便于单测）。`null` 表示参数缺失 → 用 fallback。
 *
 * 只接受纯数字字符串：`-1` / `abc` / `1.5` / `1e3` / 空串全部拒绝，
 * 因此不存在"把用户输入当数字静默转换"的路径。
 */
export function parseDaysParam(raw: string | null, fallback: number): DaysParse {
  if (raw === null) return { ok: true, days: fallback };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: `?days= 必须是 1–${MAX_WINDOW_DAYS} 的整数，收到：${JSON.stringify(raw)}` };
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
    return { ok: false, error: `?days= 必须是 1–${MAX_WINDOW_DAYS} 的整数，收到：${JSON.stringify(raw)}` };
  }
  return { ok: true, days };
}

/** 统一响应出口：显式**不发** `Access-Control-Allow-Origin`（同源即可）。 */
function send(
  res: ServerResponse,
  status: number,
  body: string,
  extraHeaders: Record<string, string>,
  headOnly: boolean,
): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // 页面自包含、无外链；这个头是"别再往外部带任何东西"的兜底。
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(headOnly ? undefined : body);
}

async function handleRequest(
  options: UiServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';

  // ④ 路由根本不接受写方法：POST/PUT/PATCH/DELETE 一律 405，没有第二个分支。
  if (method !== 'GET' && method !== 'HEAD') {
    send(
      res,
      405,
      renderUiError(405, `本服务不提供写端点，只接受 GET/HEAD（收到 ${method}）。`),
      { Allow: 'GET, HEAD' },
      false,
    );
    return;
  }

  // base 仅用于解析请求行，不发出任何网络请求。
  const url = new URL(req.url ?? '/', `http://${UI_HOST}`);

  if (url.pathname !== '/') {
    send(res, 404, renderUiError(404, `没有这个路由：${url.pathname}（只有 /）`), {}, method === 'HEAD');
    return;
  }

  const parsed = parseDaysParam(url.searchParams.get('days'), options.initialDays);
  if (!parsed.ok) {
    send(res, 400, renderUiError(400, parsed.error), {}, method === 'HEAD');
    return;
  }

  try {
    const report = await options.loadReport(parsed.days);
    send(res, 200, renderUiPage(report, { days: parsed.days }), {}, method === 'HEAD');
  } catch (err) {
    // 与 CLI 同口径：错误信息先脱敏，绝不把连接串/密码带进页面。
    const message = err instanceof Error ? err.message : String(err);
    send(res, 500, renderUiError(500, `读取统计数据失败：${redactSecrets(message)}`), {}, false);
  }
}

/** 创建（但**不**监听）UI 服务。监听由 {@link listenUiServer} 负责。 */
export function createUiServer(options: UiServerOptions): Server {
  return createServer((req, res) => {
    void handleRequest(options, req, res);
  });
}

/**
 * 启动监听并返回内核分配的实际端口。
 *
 * 唯一的 `listen` 调用点：地址写死成 {@link UI_HOST}，端口可以传 0 让内核分配。
 */
export function listenUiServer(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, UI_HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('启动后无法取得监听端口'));
    });
  });
}

/** 等待服务被关闭（Ctrl+C / SIGTERM / 测试里显式 close）。 */
export function waitForServerClose(server: Server): Promise<void> {
  return new Promise<void>(resolve => {
    server.once('close', () => resolve());
  });
}
