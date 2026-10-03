/**
 * 测试用的 `fetch` 替身（**不真的起后端**）。
 *
 * 用法：
 * ```ts
 * const { calls } = installFetchMock(call => ({ body: { ok: true } }));
 * ```
 * 每个用例结束时由调用方 `vi.unstubAllGlobals()` 清理（或由 `afterEach` 统一做）。
 */
import { vi, type Mock } from 'vitest';

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 请求体（已 JSON.parse）；无体时为 undefined。 */
  body: unknown;
}

export interface MockReply {
  /** 缺省 200。 */
  status?: number;
  /** 响应体；undefined 表示 204 / 空响应。 */
  body?: unknown;
}

/** 失败注入：`throw` 一个 Error 模拟 `fetch` 自身 reject（后端没起 / 断网）。 */
export type MockReplyFn = (call: FetchCall) => MockReply | Promise<MockReply>;

export interface FetchMockHandle {
  mock: Mock;
  calls: FetchCall[];
  /** 断言用：某路径被调了几次。 */
  countOf: (suffix: string) => number;
}

function toHeaders(init?: RequestInit): Record<string, string> {
  const raw = init?.headers;
  if (!raw) return {};
  if (Array.isArray(raw)) return Object.fromEntries(raw);
  if (typeof Headers !== 'undefined' && raw instanceof Headers) {
    return Object.fromEntries(raw.entries());
  }
  return { ...(raw as Record<string, string>) };
}

export function installFetchMock(reply: MockReplyFn): FetchMockHandle {
  const calls: FetchCall[] = [];

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: toHeaders(init),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);

    const result = await reply(call);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (result.body === undefined) throw new Error('no body');
        return result.body;
      },
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', mock);

  return {
    mock,
    calls,
    countOf: (suffix: string) => calls.filter(call => call.url.endsWith(suffix)).length,
  };
}

/** 后端标准错误体 `{ error: { code, message } }`。 */
export function apiErrorReply(status: number, code: string, message: string): MockReply {
  return { status, body: { error: { code, message } } };
}
