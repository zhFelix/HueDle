import { defineConfig } from 'vitest/config';

/**
 * 默认测试套件：**不连数据库、无副作用**。
 *
 * 这一条是硬的：根 `pnpm test` 是 `pnpm -r test`，会遍历到本包；
 * CI 里也没有凭据。带数据库的用例一律命名为 `*.db.test.ts`，
 * 由 `pnpm -C tools/admin run test:db`（`vitest.db.config.ts`）显式执行。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.db.test.ts'],
  },
});
