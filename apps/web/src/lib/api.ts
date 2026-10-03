/**
 * 后端 API 客户端（契约见 docs/DESIGN.md 第 9 节）。
 *
 * 三条设计约束：
 *
 * 1. **成功判定用 `res.ok`，不写死 200** —— 注册返回 201、登出返回 204，
 *    任何 `2xx` 都算成功。
 * 2. **失败必须可识别**：HTTP 错误统一抛 {@link ApiError}，带上 `status` 与后端
 *    的 `error.code`（`INVALID_CREDENTIALS` / `UNAUTHORIZED` / `RATE_LIMITED` …），
 *    上层据此决定「清 session 回退本地模式」还是「展示一条可重试的错误」。
 * 3. **网络错误（后端没起）不能白屏**：`fetch` 抛出的 `TypeError` 被转成
 *    `status === 0` / `code === 'NETWORK'` 的 {@link ApiError}，与 HTTP 错误走同一条路径。
 *
 * 本模块**不碰任何 localStorage**：token 由调用方（session store）持有并显式传入。
 */
import type { HistoryItem } from './storage';

/** 未配置 `VITE_API_BASE` 时的默认后端地址（与 apps/api 的默认 PORT 一致）。 */
export const DEFAULT_API_BASE = 'http://localhost:3001';

/** 已知的错误码；未知码保留为字符串（后端可能新增，前端不该因此崩）。 */
export type KnownApiErrorCode =
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'INVALID_BODY'
  | 'INVALID_NAME'
  | 'INVALID_PASSWORD'
  | 'NAME_TAKEN'
  | 'NOT_FOUND'
  | 'INTERNAL';

export type ApiErrorCode = KnownApiErrorCode | (string & {});

/** 解析 base URL：去空白、去尾部斜杠；空值回落默认地址。 */
export function resolveApiBase(env?: { VITE_API_BASE?: string | undefined }): string {
  const raw = env?.VITE_API_BASE?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_API_BASE;
  return base.replace(/\/+$/, '');
}

/** 当前生效的 API 根地址（构建期由 `import.meta.env.VITE_API_BASE` 注入）。 */
export const API_BASE: string = resolveApiBase(import.meta.env);

/**
 * 一切失败的可识别形态。
 *
 * - HTTP 失败：`status` 为真实状态码，`code` 取后端 `error.code`；
 * - 网络失败：`status === 0`、`code === 'NETWORK'`；
 * - 响应体不可解析：`code === 'INVALID_RESPONSE'`。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 会话失效（token 过期 / 被撤销）——上层据此清 session 回退本地模式。 */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 压根没连上后端（后端没起、断网、CORS 失败）。 */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export interface ApiUser {
  id: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: ApiUser;
}

export type { HistoryItem };

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 失败响应 → `ApiError`；响应体不是约定的 `{ error: { code, message } }` 也不抛。 */
async function toApiError(response: Response): Promise<ApiError> {
  let code: string | null = null;
  let message: string | null = null;

  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      const { code: rawCode, message: rawMessage } = body.error;
      if (typeof rawCode === 'string' && rawCode.length > 0) code = rawCode;
      if (typeof rawMessage === 'string' && rawMessage.length > 0) message = rawMessage;
    }
  } catch {
    /* 非 JSON 响应体：用状态码兜底 */
  }

  const fallback: KnownApiErrorCode =
    response.status === 401
      ? 'UNAUTHORIZED'
      : response.status === 429
        ? 'RATE_LIMITED'
        : response.status === 404
          ? 'NOT_FOUND'
          : 'HTTP_ERROR';

  return new ApiError(
    response.status,
    code ?? fallback,
    message ?? `请求失败（HTTP ${response.status}）`,
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** 登录 token；存在时注入 `Authorization: Bearer <token>`。 */
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // 后端没起 / 断网 / DNS 失败：转成同一种可识别错误，页面据此显示可重试错误态。
    throw new ApiError(0, 'NETWORK', '无法连接服务器，请确认后端已启动或检查网络。');
  }

  // 201 / 204 都是成功；只在 ok 为假时才解析错误体。
  if (!response.ok) throw await toApiError(response);

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', '服务器返回了无法解析的内容。');
  }
}

function requireArray(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) {
    throw new ApiError(200, 'INVALID_RESPONSE', '服务器返回的历史记录格式不正确。');
  }
  return value as HistoryItem[];
}

function requireUser(value: unknown): ApiUser {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new ApiError(200, 'INVALID_RESPONSE', '服务器返回的用户信息格式不正确。');
  }
  return { id: value.id, name: value.name };
}

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/** `POST /api/auth/register` → 201 `{ token, user }`。重名由后端回 409。 */
export async function register(name: string, password: string): Promise<AuthResponse> {
  const body = await request<{ token?: unknown; user?: unknown }>('/api/auth/register', {
    method: 'POST',
    body: { name, password },
  });
  if (typeof body.token !== 'string') {
    throw new ApiError(200, 'INVALID_RESPONSE', '服务器返回的凭证格式不正确。');
  }
  return { token: body.token, user: requireUser(body.user) };
}

/** `POST /api/auth/login` → 200 `{ token, user }`。 */
export async function login(name: string, password: string): Promise<AuthResponse> {
  const body = await request<{ token?: unknown; user?: unknown }>('/api/auth/login', {
    method: 'POST',
    body: { name, password },
  });
  if (typeof body.token !== 'string') {
    throw new ApiError(200, 'INVALID_RESPONSE', '服务器返回的凭证格式不正确。');
  }
  return { token: body.token, user: requireUser(body.user) };
}

/** `POST /api/auth/logout` → 204（无响应体）。 */
export async function logout(token: string): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST', token });
}

/** `GET /api/auth/me` → `{ id, name }`。token 失效时抛 401 的 {@link ApiError}。 */
export async function me(token: string): Promise<ApiUser> {
  return requireUser(await request<unknown>('/api/auth/me', { token }));
}

/**
 * `GET /api/daily` 的响应：今日结果 + 服务端算好的连续天数。
 *
 * `streak` 是冻结契约里的新字段（`{ date, hex, cp, rarity, badgeIds, streak }`），
 * 有了它客户端就不必再额外调一次 `/api/history` 去数连续天数。
 */
export interface DailyResult extends HistoryItem {
  streak: number;
}

/** `GET /api/daily` → 今日 `DailyResult`（已抽过则原样返回）。 */
export async function getDaily(token: string): Promise<DailyResult> {
  const body = await request<unknown>('/api/daily', { token });
  if (!isRecord(body)) {
    throw new ApiError(200, 'INVALID_RESPONSE', '服务器返回的今日结果格式不正确。');
  }
  return body as unknown as DailyResult;
}

/** `GET /api/history` → `HistoryItem[]`（服务端已按日期降序）。 */
export async function getHistory(token: string): Promise<HistoryItem[]> {
  return requireArray(await request<unknown>('/api/history', { token }));
}
