/**
 * 全色域枚举专用 vitest 配置（见 docs/PRICING-SPEC.md 第 6 节）。
 *
 * 枚举要跑 2²⁴ × 76 次判定、耗时以分钟计，**绝不能进默认测试套件**
 * （默认套件必须保持秒级）。因此这里单独 include `scripts/**`，
 * 而 `vitest.config.ts` 只 include `src/**`。
 *
 * 用法：`pnpm -C packages/shared run enumerate`
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
    // 枚举是分钟级任务，默认 5s 超时会直接失败。
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 15 * 60 * 1000,
  },
});
