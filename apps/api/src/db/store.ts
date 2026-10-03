/**
 * 数据访问层（PostgreSQL / `pg`）。
 *
 * 铁律：**所有 SQL 都是参数化语句（`$1, $2, ...`）**，没有任何一处把用户输入拼进 SQL 字符串。
 * 因此 `name = "'; DROP TABLE users; --"` 只会被当成一个普通字符串去比对（存进去也不会执行）。
 *
 * 同步 → 异步：SQLite 的 `prepare(...).get()/all()/run()` 是同步的，
 * `pg` 全异步，所以这一层的**每个方法都返回 Promise**，调用点必须 `await`。
 */
import type { Pool, PoolClient } from 'pg';

export type UserRow = {
  id: string;
  name: string;
  password_hash: string;
  created_at: string;
};

export type SessionRow = {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
};

/**
 * 认证中间件需要的**全部**信息：会话 + 对应用户。
 *
 * 字段名用 camelCase（不是行原样），因为这是「一次 JOIN 的结果」而不是某张表的行。
 */
export type SessionWithUser = {
  userId: string;
  name: string;
  expiresAt: string;
};

export type DailyRow = {
  id: number;
  user_id: string;
  date: string;
  hex: string;
  cp: number;
  rarity: string;
  badge_ids: string;
  created_at: string;
};

export type NewDaily = {
  userId: string;
  date: string;
  hex: string;
  cp: number;
  rarity: string;
  /** 已序列化的 JSON 数组。 */
  badgeIdsJson: string;
  createdAt: string;
};

export type NewUser = {
  id: string;
  name: string;
  passwordHash: string;
  createdAt: string;
};

/** 唯一约束冲突的 SQLSTATE（PG 的 `unique_violation`）。 */
export const PG_UNIQUE_VIOLATION = '23505';

export class Store {
  constructor(public readonly pool: Pool) {}

  // --- 内部小工具：统一做「行 → 类型」的取用与断言 ---------------------------

  private async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  private async one<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.rows<T>(sql, params))[0];
  }

  /**
   * 事务：拿一条专用连接跑 `BEGIN / COMMIT`，任何异常都 `ROLLBACK`。
   * `finally` 里**必须** `release()`，否则连接池会被泄漏的客户端耗尽。
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[huedle-api] ROLLBACK 失败:', rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // --- users ---------------------------------------------------------------

  /**
   * 注册：**一个事务里**写入 users + sessions。
   *
   * 用户名唯一约束（`users.name`）是权威判定：并发注册同名时后到的那条会抛
   * `23505`，事务整体回滚 —— 不会留下「有账号但没会话」的半成品。
   */
  async createUserWithSession(user: NewUser, session: SessionRow): Promise<void> {
    await this.withTransaction(async client => {
      await client.query(
        'INSERT INTO users (id, name, password_hash, created_at) VALUES ($1, $2, $3, $4)',
        [user.id, user.name, user.passwordHash, user.createdAt],
      );
      await client.query(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [session.token_hash, session.user_id, session.created_at, session.expires_at],
      );
    });
  }

  async findUserByName(name: string): Promise<UserRow | undefined> {
    return this.one<UserRow>('SELECT * FROM users WHERE name = $1', [name]);
  }

  async findUserById(id: string): Promise<UserRow | undefined> {
    return this.one<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  }

  async countUsers(): Promise<number> {
    const row = await this.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users');
    return row?.n ?? 0;
  }

  // --- sessions ------------------------------------------------------------

  async createSession(session: SessionRow): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [session.token_hash, session.user_id, session.created_at, session.expires_at],
    );
  }

  async findSession(tokenHash: string): Promise<SessionRow | undefined> {
    return this.one<SessionRow>('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  /**
   * 认证专用：**一条 JOIN** 同时取回会话与用户，替代「先 findSession 再 findUserById」的两次往返。
   *
   * ```sql
   * SELECT u.id AS id, u.name AS name, s.expires_at AS expires_at
   *   FROM sessions s JOIN users u ON u.id = s.user_id
   *  WHERE s.token_hash = $1
   * ```
   *
   * 语义与两次独立查询**完全等价**（sessions.user_id 外键 + ON DELETE CASCADE，
   * 所以「会话存在但用户不存在」这种孤儿行在库里根本不可能出现；JOIN 查不到 = 会话不存在
   * 或用户已随级联删除一起消失，两者本来就都走 401）。
   *
   * ⚠️ **不要在这里加缓存（Redis / 进程内 Map / any TTL 都不行）。**
   * 登出即时失效是我们当初选「服务端 Session」而不是 JWT 的**唯一**理由：
   * 一旦把认证结果缓存哪怕几秒，用户登出后旧 token 仍能继续访问，等于把这个理由还回去。
   * 每次请求都必须真的打到 sessions 表。
   *
   * 保留 {@link findSession} / {@link findUserById}：别处与测试仍在用。
   */
  async findSessionWithUser(tokenHash: string): Promise<SessionWithUser | undefined> {
    const row = await this.one<{ id: string; name: string; expires_at: string }>(
      `SELECT u.id AS id, u.name AS name, s.expires_at AS expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [tokenHash],
    );
    if (!row) return undefined;
    return { userId: row.id, name: row.name, expiresAt: row.expires_at };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  // --- daily_results -------------------------------------------------------

  /**
   * 写入当日结果；已存在则**什么都不做**。
   *
   * `INSERT ... ON CONFLICT (user_id, date) DO NOTHING RETURNING *` 是**单条原子语句**：
   * 并发的两个请求里只有一个能插入成功并拿到返回行，另一个返回 0 行 —— 由调用方随后
   * SELECT 读回「第一行落库的权威值」。**不要**退化成「先 SELECT 再 INSERT」，那有竞态。
   *
   * @returns 本次真的插入成功时的行；已被别人抢先插入时返回 `undefined`。
   */
  async insertDailyIfAbsent(row: NewDaily): Promise<DailyRow | undefined> {
    const inserted = await this.one<DailyRow>(
      `INSERT INTO daily_results
         (user_id, date, hex, cp, rarity, badge_ids, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, date) DO NOTHING
       RETURNING *`,
      [row.userId, row.date, row.hex, row.cp, row.rarity, row.badgeIdsJson, row.createdAt],
    );
    if (inserted) return inserted;
    return this.getDaily(row.userId, row.date);
  }

  async getDaily(userId: string, date: string): Promise<DailyRow | undefined> {
    return this.one<DailyRow>('SELECT * FROM daily_results WHERE user_id = $1 AND date = $2', [
      userId,
      date,
    ]);
  }

  async listDaily(userId: string): Promise<DailyRow[]> {
    return this.rows<DailyRow>('SELECT * FROM daily_results WHERE user_id = $1 ORDER BY date DESC', [
      userId,
    ]);
  }

  async countDaily(): Promise<number> {
    const row = await this.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM daily_results');
    return row?.n ?? 0;
  }

  /** 仅供测试：把某个会话改成已过期。 */
  async setSessionExpiry(tokenHash: string, expiresAt: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET expires_at = $1 WHERE token_hash = $2', [
      expiresAt,
      tokenHash,
    ]);
  }
}
