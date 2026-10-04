/**
 * CLI 入口（`tsx src/cli.ts <stats|ui> …`）。
 *
 * - `stats`：本地批处理，不监听端口；
 * - `ui`   ：本地只读统计页面（`node:http`，**只监听 127.0.0.1**，见 `src/ui/`）。
 *
 * `ui` 启动前先过 `findDeploymentReason()`：检测到 `NODE_ENV=production` /
 * `RAILWAY_*` / 外部 `PORT` 等部署迹象就打印原因并以退出码 5 退出（绝不监听）。
 * 凭据在运行时从 `apps/api/.env` 读，日志与页面全部脱敏。
 *
 * 退出码：0 成功；2 参数错误；3 数据库错误（消息已脱敏）；5 疑似部署环境，拒绝启动。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAdminArgs, USAGE, UsageError, type UiCommand } from './argv';
import { runAddBadgeCommand, runRollbackCommand } from './addbadge/commands';
import { shellExec } from './addbadge/pipeline';
import { createCachedReportLoader } from './cache';
import { createReadOnlyPool, redactSecrets, requireDatabaseUrl } from './db';
import { renderHtml } from './render/html';
import { renderText } from './render/text';
import { runStats, runStatsFromEnv } from './run';
import {
  createUiServer,
  listenUiServer,
  UI_ANALYZE_TOP_N,
  UI_HOST,
  waitForServerClose,
} from './ui/server';
import { EXIT_DEPLOYMENT_REFUSED, findDeploymentReason, type EnvLike } from './ui/guard';

/** `tools/admin/` 根目录：相对路径（`out/...`）以它为基准，而不是调用者的 cwd。 */
export const ADMIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 仓库根（`tools/admin/src/` 往上三级）。加徽章流水线改的是仓库里的源码。 */
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** 相对路径按 `tools/admin` 解析；绝对路径原样使用。 */
export function resolveFromAdminRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(ADMIN_ROOT, path);
}

export interface MainDeps {
  /**
   * 环境变量来源。默认 `process.env`；测试用它注入部署平台变量，
   * 从而在**不起服务、不连库**的前提下断言"拒绝启动 + 非零退出码"。
   */
  env?: EnvLike;
}

/** 起 UI 服务并阻塞到它被关闭（Ctrl+C / SIGTERM）。 */
async function runUi(args: UiCommand, env: EnvLike): Promise<number> {
  // ② 部署环境拒绝启动：这一步在 requireDatabaseUrl() **之前**，所以拒绝时不碰数据库。
  const reason = findDeploymentReason(env);
  if (reason) {
    console.error(`拒绝启动：${reason}`);
    console.error('本服务只允许在开发机上运行。若确实要在本机跑，请先清掉上述环境变量。');
    return EXIT_DEPLOYMENT_REFUSED;
  }

  try {
    const pool = createReadOnlyPool(requireDatabaseUrl());
    // 缓存只在 UI 进程内（内存 Map，不落盘）：同一窗口的重复访问不必重跑跨洋查询。
    // 键含 includeNames —— 带用户名的报告绝不会被无用户名的请求命中。
    const cached = createCachedReportLoader(key =>
      runStats(pool, { days: key.days, includeNames: key.includeNames, topN: key.topN }),
    );
    const server = createUiServer({
      initialDays: args.days,
      // ④ 唯一的取数通道：与 CLI 完全相同的 runStats（db.ts 的 BEGIN READ ONLY）。
      // ?refresh=1 时绕过缓存，但仍然走同一条只读通道。
      loadReport: (days, options) =>
        cached.loadReport(
          { days, includeNames: args.includeNames, topN: UI_ANALYZE_TOP_N },
          { refresh: options?.refresh === true },
        ),
      // 加徽章页：HTTP 层只提交（抢锁 + 拉起 detached 子进程）与读状态文件，
      // **绝不在请求处理器里跑管道**。
      badge: { adminRoot: ADMIN_ROOT, root: REPO_ROOT },
    });

    // ① 地址写死在 listenUiServer 里（127.0.0.1），端口可传 0 让内核分配。
    let port: number;
    try {
      port = await listenUiServer(server, args.port);
    } catch (err) {
      await pool.end();
      const message = err instanceof Error ? err.message : String(err);
      console.error(`无法监听 ${UI_HOST}:${args.port}：${redactSecrets(message)}`);
      return 3;
    }

    console.log(`HueDle 只读统计 UI 已启动：http://${UI_HOST}:${port}/`);
    console.log(`  窗口：最近 ${args.days} 天（页面上可切换 7/30/90）；按指标跳转用 #M1…M8`);
    console.log(
      `  用户明细：${args.includeNames ? '显示（仅页面，绝不写文件）' : '不显示（默认，需 --include-names）'}`,
    );
    console.log(
      `  只监听 ${UI_HOST}；只读统计只有 GET/HEAD，唯一的写入口是 POST /badge/submit`
      + '（只抢锁 + 拉起 detached 子进程，绝不在请求里跑管道）。无登录、无 CORS。Ctrl+C 结束。',
    );

    const stop = (): void => {
      server.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await waitForServerClose(server);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await pool.end();
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`数据库错误：${redactSecrets(message)}`);
    return 3;
  }
}

export async function main(argv: string[] = process.argv.slice(2), deps: MainDeps = {}): Promise<number> {
  let args;
  try {
    args = parseAdminArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`参数错误：${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  if (args.command === 'ui') return runUi(args, deps.env ?? process.env);

  // 加徽章：CLI 也只做「提交」，真正的管道在 detached 子进程里（见 addbadge/submit.ts）。
  if (args.command === 'add-badge') {
    return runAddBadgeCommand(args, {
      adminRoot: ADMIN_ROOT,
      root: REPO_ROOT,
      error: message => console.error(message),
    });
  }
  if (args.command === 'rollback') {
    const exec = shellExec(REPO_ROOT);
    return runRollbackCommand(args, {
      adminRoot: ADMIN_ROOT,
      root: REPO_ROOT,
      error: message => console.error(message),
      runTest: () => exec('pnpm -C packages/shared test', { timeoutMs: 15 * 60 * 1000 }).code,
    });
  }

  try {
    const report = await runStatsFromEnv({
      days: args.days,
      includeNames: args.includeNames,
    });
    console.log(renderText(report));

    if (args.htmlPath !== undefined) {
      const target = resolveFromAdminRoot(args.htmlPath);
      mkdirSync(dirname(target), { recursive: true });
      // 自包含：无 <script>、无外链；用户名明细不会进入这里。
      writeFileSync(target, renderHtml(report), 'utf8');
      console.log(`\nHTML 报告已写入：${target}`);
    }
    return 0;
  } catch (err) {
    // 任何数据库错误都先脱敏再打印：绝不让连接串/密码出现在终端历史里。
    const message = err instanceof Error ? err.message : String(err);
    console.error(`数据库错误：${redactSecrets(message)}`);
    return 3;
  }
}

// 只有直接执行（而不是被测试 import）时才跑，避免 import 触发副作用。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
