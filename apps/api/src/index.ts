/**
 * 进程入口：建连接池 → 连通性自检 → 组装 app → 监听端口。
 *
 * 用 `tsx` 运行（`pnpm dev` / `pnpm start`）：
 * `@huedle/shared` 的相对 import 不带扩展名，Node 原生 ESM 解析不了，
 * tsx 负责补上这一步（详见报告）。
 *
 * 环境变量（可写在 `apps/api/.env`，见 `.env.example`）：
 *   - `DATABASE_URL`   Supabase/Postgres 连接串（**必填**，缺失直接退出）
 *   - `PORT`           监听端口，默认 3001
 *   - `HUEDLE_ORIGIN`  CORS 白名单，逗号分隔，默认 localhost:5173 / 127.0.0.1:4173
 *   - `HUEDLE_TRUST_PROXY=1` 时用 `X-Forwarded-For` 作为限流分桶的客户端 IP
 *     （只有确实跑在反向代理后面才该打开）
 *
 * 建表不在这里：先跑 `pnpm -C apps/api migrate`。启动只做连通性自检
 * （`SELECT 1` + 会话参数校验），失败就明确报错退出，绝不带着坏连接继续对外服务。
 */
import { serve } from '@hono/node-server';
import { allowedOriginsFromEnv, createApp } from './app';
import { assertConnectivity, createPool, Store } from './db';
import { loadEnvFile } from './lib/env';

loadEnvFile();

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(
    '[huedle-api] 启动失败：缺少环境变量 DATABASE_URL（Postgres 连接串）。' +
      '请复制 apps/api/.env.example 为 apps/api/.env 并填写后重启。',
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3001);
const origins = allowedOriginsFromEnv();
const trustProxy = process.env.HUEDLE_TRUST_PROXY === '1';

const pool = createPool(connectionString);

try {
  await assertConnectivity(pool);
} catch (err) {
  console.error('[huedle-api] 启动失败：数据库连通性 / 会话参数自检未通过。', err);
  await pool.end();
  process.exit(1);
}

const app = createApp({ store: new Store(pool), allowedOrigins: origins, trustProxy });

const server = serve({ fetch: app.fetch, port }, info => {
  console.log(`[huedle-api] listening on http://localhost:${info.port}`);
  console.log('[huedle-api] database: postgres（连接串来自 DATABASE_URL）');
  console.log(`[huedle-api] cors origins: ${origins.join(', ')}`);
  console.log(`[huedle-api] trust proxy: ${trustProxy}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
