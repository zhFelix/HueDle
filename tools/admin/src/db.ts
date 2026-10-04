/**
 * 数据库访问层：**只读**连接池 + SQL 入口校验 + 连接串脱敏。
 *
 * 只读是**三层**的（见 docs/ADMIN.md §6.3），任何一层单独都不算数：
 *   1. 连接级：pool 的 `options` 带 `-c default_transaction_read_only=on`；
 *   2. 事务级：每条查询包在 `BEGIN READ ONLY` 里（服务端保证），并 `SET LOCAL statement_timeout='30s'`；
 *   3. 应用级：{@link assertReadOnlySql} 要求 SQL 以 `SELECT`/`WITH` 开头。
 *
 * 注意：Supabase 的连接池（Supavisor）会**吃掉 libpq 的 `options`**（apps/api/src/db/index.ts 有实测记录），
 * 所以第 1 层在托管池上可能不生效——真正兜底的是第 2 层的 `BEGIN READ ONLY`，
 * 它由 PG 强制执行，`apps/api` 的池子吃不吃 `options` 都拦得住写操作。
 *
 * 凭据只在运行时读 `apps/api/.env`（{@link loadAdminEnv}），**不复制**该文件到本包；
 * 任何日志/报告都只允许出现 {@link redactConnectionString} 的产物（`host:port/db`）。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

/** `<repo>/apps/api/.env` 的绝对路径（从 `tools/admin/src/db.ts` 往上三级）。 */
export const API_ENV_PATH = fileURLToPath(new URL('../../../apps/api/.env', import.meta.url));

/** 连接级只读 + 资源上限。`statement_timeout` 的单位是毫秒。 */
export const READ_ONLY_OPTIONS = '-c default_transaction_read_only=on -c statement_timeout=30000';

/** 单条统计的服务端超时（事务内 `SET LOCAL`）。 */
export const STATEMENT_TIMEOUT = '30s';

/** 连接池上限：刻意低于 API 的 10，避免和线上抢连接。 */
export const ADMIN_POOL_MAX = 2;

/**
 * 读取 `apps/api/.env`（可选）。复用 Node 内置的 `process.loadEnvFile()`，不引 dotenv。
 * 已存在的真实环境变量优先级更高，不会被文件覆盖。
 */
export function loadAdminEnv(path: string = API_ENV_PATH): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (err) {
    // 不打印 err 的完整内容：它可能包含文件路径，但不会包含连接串；这里仍然只给路径。
    console.warn(`[huedle-admin] 读取环境变量文件失败：${path}`, redactSecrets(String(err)));
  }
}

/** `DATABASE_URL` 缺失时给出**可执行**的报错，而不是静默跳过。 */
export function requireDatabaseUrl(): string {
  loadAdminEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  throw new Error(
    [
      '缺少 DATABASE_URL：无法连接 Postgres（不会静默跳过）。',
      `请把连接串写进 ${API_ENV_PATH}，例如：`,
      '  DATABASE_URL=postgresql://postgres:<password>@<host>:5432/<db>',
      '本工具只读，但请仍然只使用开发机既有的凭据。',
    ].join('\n'),
  );
}

/**
 * 把连接串脱敏成 `host:port/db`（去掉用户名、密码与全部查询参数）。
 * 解析失败时返回一个**不含原文**的占位符——绝不把解析失败的原文带进日志。
 */
export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString.trim());
    const host = url.hostname || '(unknown-host)';
    const port = url.port || '5432';
    const db = url.pathname.replace(/^\//, '') || '(default)';
    return `${host}:${port}/${db}`;
  } catch {
    return '(unparseable-connection-string)';
  }
}

/**
 * 文本级脱敏：抹掉任何 `postgres://…` / `postgresql://…` 形式的内容，
 * 以及 `DATABASE_URL=…` / `DATABASE_URL: …` 的赋值。用于错误信息与日志。
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, 'postgresql://***')
    .replace(/DATABASE_URL(\s*[=:]\s*)\S+/gi, 'DATABASE_URL$1***');
}

/** SQL 入口校验失败。 */
export class SqlGuardError extends Error {
  constructor(sql: string) {
    super(
      `拒绝执行：只允许以 SELECT 或 WITH 开头的 SQL（收到：${JSON.stringify(sql.slice(0, 40))}）`,
    );
    this.name = 'SqlGuardError';
  }
}

/**
 * 应用级只读守卫。
 *
 * - 空串 / 纯空白 → 拒绝；
 * - **注释开头 → 拒绝**（注释可以藏住后面的语句，不做"跳过注释"的猜测）；
 * - 只放行 `SELECT` / `WITH` 开头；
 * - 顺带拒绝"多条语句"（分号后还有非空白字符），统计 SQL 全是常量，用不到多语句。
 */
export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) throw new SqlGuardError(sql);
  if (!/^(select|with)\b/i.test(trimmed)) throw new SqlGuardError(sql);
  if (/;\s*\S/.test(trimmed)) {
    throw new Error('拒绝执行：SQL 入口只接受单条语句（分号后不允许还有内容）');
  }
}

/** 连接级只读的连接池。**惰性连接**，这里不发任何查询。 */
export function createReadOnlyPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  const trimmed = connectionString.trim();
  if (!trimmed) throw new Error('createReadOnlyPool 需要一个非空的 Postgres 连接串');
  return new Pool({
    connectionString: trimmed,
    max: ADMIN_POOL_MAX,
    // 托管连接池可能忽略 options；真正的保证是每条查询的 BEGIN READ ONLY。
    options: READ_ONLY_OPTIONS,
    ...overrides,
  });
}

/** 带 SQLSTATE 的数据库错误（message 已脱敏）。 */
export class AdminDbError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(redactSecrets(message));
    this.name = 'AdminDbError';
  }
}

/**
 * 低层：在 `BEGIN READ ONLY` 事务里执行一条 SQL，**不做应用级守卫**。
 *
 * 存在的唯一理由是让测试能绕过 {@link assertReadOnlySql} 直接验证
 * "数据库真的拒绝写"（SQLSTATE 25006）——只测自己的守卫函数不算数。
 * 业务代码请用 {@link runReadOnlyQuery}。
 */
export async function runInReadOnlyTransaction<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const result = await client.query<T>(sql, params);
    await client.query('ROLLBACK');
    return result.rows;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 事务已经被服务端终止时 ROLLBACK 也会失败：忽略，原始错误更重要。
    }
    if (err instanceof Error) {
      throw new AdminDbError(err.message, (err as { code?: string }).code);
    }
    throw new AdminDbError(String(err), undefined);
  } finally {
    client.release();
  }
}

/** 业务入口：先过应用级守卫，再进只读事务。 */
export async function runReadOnlyQuery<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertReadOnlySql(sql);
  return runInReadOnlyTransaction<T>(pool, sql, params);
}
