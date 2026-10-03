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
export type { DailyRow, NewDaily, NewUser, SessionRow, UserRow } from './store';

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
 *
 * 通过 libpq 的 `options` 启动参数下发；`assertConnectivity()` 会验证它真的生效
 * （连接池代理 pgbouncer 会忽略 `options`，那时必须显式失败而不是悄悄丢精度）。
 */
export const FLOAT_DIGITS_OPTION = '-c extra_float_digits=1';

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

  return new Pool({
    connectionString: trimmed,
    max,
    options: sessionOptions.join(' '),
  });
}

/** 启动自检：连不上、或会话参数没生效就抛，让调用方明确报错退出，而不是带着坏连接继续跑。 */
export async function assertConnectivity(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');

  const shown = await pool.query('SHOW extra_float_digits');
  const digits = String(shown.rows[0]?.extra_float_digits ?? '');
  if (digits !== '1') {
    throw new Error(
      `会话参数 extra_float_digits 未生效（实际为 "${digits}"）：cp 会丢精度，拒绝启动。` +
        '通常是连接串指向了 pgbouncer/连接池（端口 6543），请改用直连端口 5432。',
    );
  }
}
