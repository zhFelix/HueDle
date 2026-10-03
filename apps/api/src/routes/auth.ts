/**
 * `/api/auth/*` 路由。
 *
 * 安全约定（逐条对应任务书 E 节）：
 *   - 注册：名字被占用**如实告知** 409（否则无法注册）；
 *   - 登录：**任何**失败（用户不存在 / 密码错误）都是同一个 401
 *     与同一条文案，且用户不存在时也跑一次 scrypt，堵住时序侧信道；
 *   - 密码只以 scrypt 哈希落库，比对用 timingSafeEqual；
 *   - 会话 token 只存 SHA-256。
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { PG_UNIQUE_VIOLATION, type SessionRow, type Store } from '../db/store';
import { bearerAuth, type AppContext, type AppEnv } from '../lib/auth';
import { apiError } from '../lib/http';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../lib/password';
import { generateToken, hashToken, sessionExpiry } from '../lib/tokens';

/** 用户名：3–32 个「字母 / 数字 / 下划线 / 连字符 / 汉字」。空格与引号一律拒绝。 */
export const NAME_RE = /^[\p{L}\p{N}_-]{3,32}$/u;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** 登录失败时对外**唯一**的文案与状态（用户不存在与密码错误必须无法区分）。 */
export const INVALID_CREDENTIALS_MESSAGE = '用户名或密码不正确';

export interface AuthRoutesOptions {
  store: Store;
  /** 可注入时钟，测试用。 */
  now?: () => Date;
}

async function readJsonObject(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const raw: unknown = await c.req.json();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 唯一约束冲突判定：SQLite 靠匹配错误文案（`UNIQUE constraint failed`），
 * Postgres 给的是结构化的 SQLSTATE `23505`（`unique_violation`）。
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/** 生成一条会话（明文 token 只在这里出现一次，库里只落 SHA-256）。 */
function newSession(userId: string, at: Date): { token: string; row: SessionRow } {
  const token = generateToken();
  return {
    token,
    row: {
      token_hash: hashToken(token),
      user_id: userId,
      created_at: at.toISOString(),
      expires_at: sessionExpiry(at),
    },
  };
}

async function issueSession(store: Store, userId: string, at: Date): Promise<string> {
  const { token, row } = newSession(userId, at);
  await store.createSession(row);
  return token;
}

export function authRoutes(options: AuthRoutesOptions): Hono<AppEnv> {
  const { store, now = () => new Date() } = options;
  const router = new Hono<AppEnv>();

  router.post('/register', async c => {
    const body = await readJsonObject(c);
    if (!body) {
      return apiError(c, 400, 'INVALID_BODY', '请求体必须是 JSON 对象 { name, password }');
    }

    const { name, password } = body;
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      return apiError(
        c,
        400,
        'INVALID_NAME',
        '用户名需为 3–32 个字母、数字、下划线、连字符或汉字',
      );
    }
    if (
      typeof password !== 'string' ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return apiError(
        c,
        400,
        'INVALID_PASSWORD',
        `密码长度需为 ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 个字符`,
      );
    }

    // 名字唯一性必须如实告知，否则用户无法完成注册。
    if (await store.findUserByName(name)) {
      return apiError(c, 409, 'NAME_TAKEN', '该用户名已被占用');
    }

    const id = randomUUID();
    const at = now();
    const { token, row: session } = newSession(id, at);
    try {
      // users + sessions 一个事务写完，失败不会留下半成品账号。
      await store.createUserWithSession(
        { id, name, passwordHash: hashPassword(password), createdAt: at.toISOString() },
        session,
      );
    } catch (err) {
      // 并发注册同一名字时唯一约束会抛：映射成 409，而不是 500。
      if (isUniqueViolation(err)) {
        return apiError(c, 409, 'NAME_TAKEN', '该用户名已被占用');
      }
      throw err;
    }

    return c.json({ token, user: { id, name } }, 201);
  });

  router.post('/login', async c => {
    const body = await readJsonObject(c);
    if (!body) {
      return apiError(c, 400, 'INVALID_BODY', '请求体必须是 JSON 对象 { name, password }');
    }

    const { name, password } = body;
    if (typeof name !== 'string' || typeof password !== 'string') {
      return apiError(c, 400, 'INVALID_BODY', '请求体必须是 JSON 对象 { name, password }');
    }

    const user = await store.findUserByName(name);
    // 用户不存在时也走一次等价开销的校验：响应时间不构成用户名枚举信道。
    const ok = user
      ? verifyPassword(password, user.password_hash)
      : verifyPassword(password, DUMMY_PASSWORD_HASH);

    if (!user || !ok) {
      return apiError(c, 401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
    }

    const token = await issueSession(store, user.id, now());
    return c.json({ token, user: { id: user.id, name: user.name } });
  });

  router.post('/logout', bearerAuth(store, now), async c => {
    await store.deleteSession(c.get('tokenHash'));
    return c.body(null, 204);
  });

  router.get('/me', bearerAuth(store, now), c => c.json(c.get('user')));

  return router;
}
