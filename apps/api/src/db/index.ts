/**
 * 数据库连接池（PostgreSQL / `pg`，纯 JS 驱动，无原生编译）。
 *
 * - 连接串只从环境变量 `DATABASE_URL` 读，见 `src/index.ts`；
 * - `max: 10`：单进程默认最多 10 条连接（Supabase 免费档连接数有限，别开大）；
 * - 这里**不建表**：schema 由 `pnpm -C apps/api migrate` 显式执行，
 *   应用启动只做一次连通性自检（`SELECT 1` + 会话参数校验，见 {@link assertConnectivity}）。
 *
 * SQLite 时代的 `openDb(file)` / `HUEDLE_DB` 已整体移除。
 */
import { Pool } from 'pg';

export { SCHEMA_SQL } from './schema';
export { Store } from './store';
export type { DailyRow, NewDaily, NewUser, SessionRow, SessionWithUser, UserRow } from './store';

/** 单进程默认连接上限。 */
export const DEFAULT_POOL_MAX = 10;

export interface CreatePoolOptions {
  max?: number;
  /**
   * 会话级 `search_path`（测试用：把所有表限制在独立 schema 里，绝不碰 `public`）。
   * 通过 libpq 的 `options` 启动参数下发；会校验成合法标识符，避免拼进连接串。
   */
  searchPath?: string;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * 必须的会话参数：`extra_float_digits = 1`。
 *
 * 某些托管 Postgres（实测 Supabase）把该 GUC 设成 `0`，float8 的文本输出只有 15 位有效数字，
 * `cp`（`ep` 之和的浮点值）从库里读回来就与 `@huedle/shared` 的 `calculateScore` 不再逐位相等。
 * 置 1 后 PG12+ 用最短且精确的十进制表示，double 往返无损。
 */
export const FLOAT_DIGITS_OPTION = '-c extra_float_digits=1';

/**
 * 会话参数初始化语句。**这是让 `extra_float_digits` 生效的主路径。**
 *
 * 为什么不能只靠 `options` 启动参数：Supabase 的 Supavisor 连接池**会把 `options` 整个吃掉**。
 * 实测（ap-southeast-2 池子）：
 *
 *   | 连接方式            | 端口 | 靠 options | 精度     |
 *   |---------------------|------|------------|----------|
 *   | 直连                | 5432 | 1 ✅       | 完整     |
 *   | Session pooler      | 5432 | 0 ❌       | 丢失     |
 *   | Transaction pooler  | 6543 | 0 ❌       | 丢失     |
 *
 * 而**连上之后再 `SET`，三种方式都生效且稳定**（同一实测里连续 6 次查询取值不变）。
 *
 * 安全性依据：`pg-pool` 在 `_acquireClient()` 里**同步** `emit('connect', client)`，
 * 发生在 `client.release` 赋值、连接交给调用方**之前**；而 `pg` 的 Client 按队列顺序发送查询。
 * 所以这里排进去的 `SET` 一定排在任何业务查询之前——不是碰运气。
 */
export function sessionSetupSql(searchPath?: string): string {
  const statements = ['SET extra_float_digits = 1'];
  if (searchPath !== undefined) {
    // searchPath 已由 IDENT_RE 校验为合法标识符，不含引号/分号，可安全内插。
    statements.push(`SET search_path = ${searchPath}`);
  }
  return statements.join('; ');
}

/**
 * 在一条已建立的连接上应用会话参数。
 *
 * 导出是为了让测试能**在不带 `options` 的连接**上直接验证——那正是模拟连接池的场景。
 */
export async function applySessionParams(
  client: { query: (sql: string) => Promise<unknown> },
  searchPath?: string,
): Promise<void> {
  await client.query(sessionSetupSql(searchPath));
}

/**
 * 建连接池。**不**发起任何查询（`pg` 是惰性连接）。
 *
 * @param connectionString `postgresql://...`，来自 `DATABASE_URL`。
 */
export function createPool(connectionString: string, options: CreatePoolOptions = {}): Pool {
  const trimmed = connectionString.trim();
  if (!trimmed) {
    throw new Error('createPool 需要一个非空的 Postgres 连接串（DATABASE_URL）');
  }

  const { max = DEFAULT_POOL_MAX, searchPath } = options;
  if (searchPath !== undefined && !IDENT_RE.test(searchPath)) {
    throw new Error(`searchPath 必须是合法的小写标识符，收到：${searchPath}`);
  }

  const sessionOptions = [FLOAT_DIGITS_OPTION];
  if (searchPath !== undefined) {
    sessionOptions.push(`-c search_path=${searchPath}`);
  }

  const pool = new Pool({
    connectionString: trimmed,
    max,
    // `options` 在直连时生效，在连接池后面会被忽略。留着它没坏处（直连能少一次往返），
    // 但**不能只靠它**——真正的保证是下面 connect 事件里的 SET。
    options: sessionOptions.join(' '),
  });

  // 每条新连接建立后立刻应用会话参数。
  //
  // 刻意不 await：该事件在 pg-pool 里是同步触发的，且**早于连接被交出去**；
  // pg 的 Client 会把这条查询排进队列，因此它一定先于任何业务查询执行。
  // 在这里 await 反而会触发 pg 不支持的用法（客户端正在执行查询时再 query）。
  pool.on('connect', (client) => {
    void applySessionParams(client, searchPath).catch((err: unknown) => {
      // 不静默：会话参数没设上就意味着 cp 会丢精度。启动自检能兜住首条连接，
      // 但运行期新开的连接只有这条日志能提示。
      console.warn('[huedle-api] 会话参数初始化失败（cp 可能丢精度）：', err);
    });
  });

  return pool;
}

/** 启动自检：连不上、或会话参数没生效就抛，让调用方明确报错退出，而不是带着坏连接继续跑。 */
export async function assertConnectivity(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');

  const shown = await pool.query('SHOW extra_float_digits');
  const digits = String(shown.rows[0]?.extra_float_digits ?? '');
  if (digits !== '1') {
    throw new Error(
      `会话参数 extra_float_digits 未生效（实际为 "${digits}"）：cp 会丢精度，拒绝启动。` +
        'createPool() 会在每条新连接上执行 SET extra_float_digits = 1；' +
        '若这里仍然失败，说明连接被某种代理改写、或该 SET 被拒绝，请检查 DATABASE_URL。',
    );
  }
}
