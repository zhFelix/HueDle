/**
 * 建表脚本：`pnpm -C apps/api migrate`（= `tsx src/db/migrate.ts`）。
 *
 * 应用的 schema 变更**只**在这里发生，服务进程启动时不再隐式建表。
 * 语句全部是 `CREATE ... IF NOT EXISTS`，可重复执行。
 */
import { loadEnvFile } from '../lib/env';
import { createPool, SCHEMA_SQL } from './index';

loadEnvFile();

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(
    '[huedle-api] migrate 失败：缺少环境变量 DATABASE_URL。' +
      '请复制 apps/api/.env.example 为 apps/api/.env 并填入 Postgres 连接串。',
  );
  process.exit(1);
}

const pool = createPool(connectionString);

try {
  await pool.query(SCHEMA_SQL);
  console.log('[huedle-api] migrate 完成：users / sessions / daily_results 已就绪');
} catch (err) {
  console.error('[huedle-api] migrate 失败：', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
