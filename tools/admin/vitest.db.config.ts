import { defineConfig } from 'vitest/config';

/**
 * 需要**真实 Postgres** 的用例：只读强制（SQLSTATE 25006）与 M1–M8 的 SQL 跑通。
 *
 * 永远不在 CI 里跑（CI 没有凭据）；本地用 `apps/api/.env` 的 `DATABASE_URL`。
 * `DATABASE_URL` 缺失时**不静默 skip**——直接失败，见 `src/db.ts` 的 `requireDatabaseUrl`。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
