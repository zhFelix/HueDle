/**
 * 测试用 Postgres 夹具。
 *
 * 两条硬约束：
 *   1. 所有表都建在**独立 schema `huedle_test`** 里（连接级 `search_path`），
 *      绝不读写 `public` 的真实表；`openTestPool()` 会先 `SHOW search_path` 自检，
 *      一旦 `options` 启动参数没生效就**拒绝建表**并报错，而不是悄悄污染 public。
 *   2. 每个用例前 `TRUNCATE ... RESTART IDENTITY CASCADE`，用例之间零串扰。
 *
 * `DATABASE_URL` 缺失时抛错（`beforeAll` 失败 → 整个文件红），**不会静默 skip**。
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { assertConnectivity, createPool } from '../db';
import { SCHEMA_SQL } from '../db/schema';
import { loadEnvFile } from '../lib/env';

/** 测试专用 schema：与 `public` 完全隔离。 */
export const TEST_SCHEMA = 'huedle_test';

/** 建表前的跨进程互斥锁（并发跑多个 vitest 进程时避免 CREATE TABLE 竞态）。 */
const SETUP_LOCK_KEY = 5_728_001;

let pool: Pool | undefined;

/** `DATABASE_URL` 缺失时抛出的可执行错误（不静默 skip）。 */
export function requireDatabaseUrl(): string {
  loadEnvFile();
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  throw new Error(
    [
      '缺少 DATABASE_URL：无法运行 @huedle/api 测试（不会静默跳过）。',
      '请把 Postgres 连接串写进 apps/api/.env，例如：',
      '  DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require',
      `测试只使用独立 schema ${TEST_SCHEMA}，不会读写 public。`,
    ].join('\n'),
  );
}

/** 用一条「干净」连接（不带 search_path）建 schema，并持有 advisory lock 防止并发建表。 */
async function prepareSchema(): Promise<void> {
  const admin = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  let client: PoolClient | undefined;
  try {
    client = await admin.connect();
    await client.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK_KEY]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  } finally {
    if (client) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK_KEY]);
      } catch {
        // 连接已断时解锁失败无所谓：锁随会话结束自动释放。
      }
      client.release();
    }
    await admin.end();
  }
}

/** 建带 `search_path` 的连接池，自检通过后才执行 `SCHEMA_SQL`。 */
async function openTestPool(): Promise<Pool> {
  const candidate = createPool(requireDatabaseUrl(), { max: 10, searchPath: TEST_SCHEMA });
  try {
    // 会话参数自检（extra_float_digits=1），否则 cp 的逐位比对会假阳性失败。
    await assertConnectivity(candidate);

    const shown = await candidate.query('SHOW search_path');
    const searchPath = String(shown.rows[0]?.search_path ?? '');
    if (!searchPath.split(',').some(s => s.trim() === TEST_SCHEMA)) {
      throw new Error(
        `连接级 search_path 未生效（实际为 "${searchPath}"）：拒绝在 public 建表。` +
          '若连接串指向 Supabase 连接池（pgbouncer），请改用直连端口 5432。',
      );
    }

    const current = await candidate.query('SELECT current_schema() AS schema');
    if (String(current.rows[0]?.schema ?? '') !== TEST_SCHEMA) {
      throw new Error(`current_schema() 不是 ${TEST_SCHEMA}，拒绝继续。`);
    }

    await candidate.query(SCHEMA_SQL);
    return candidate;
  } catch (err) {
    await candidate.end().catch(() => {});
    throw err;
  }
}

/** 在测试文件顶层调用：注册建表 / 清表 / 关池钩子。 */
export function registerTestDatabase(): void {
  beforeAll(async () => {
    await prepareSchema();
    pool = await openTestPool();
  });

  beforeEach(async () => {
    await getTestPool().query(
      'TRUNCATE TABLE daily_results, sessions, users RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    const current = pool;
    pool = undefined;
    if (current) await current.end();
  });
}

/** 当前测试文件的连接池；必须在 `registerTestDatabase()` 之后使用。 */
export function getTestPool(): Pool {
  if (!pool) {
    throw new Error('测试连接池尚未初始化：请在测试文件顶层调用 registerTestDatabase()');
  }
  return pool;
}
