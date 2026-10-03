import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 后端是纯 Node：没有 DOM / localStorage，测试直接打 Hono app（app.request），不开端口。
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 三个测试文件共用同一个 Postgres schema，用例前会 TRUNCATE；
    // 并行跑文件会互相清掉对方刚写入的行，因此串行执行。
    fileParallelism: false,
    // 数据库可能是远端（Supabase），单用例时延高于本地 SQLite：放宽超时，断言不放宽。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
