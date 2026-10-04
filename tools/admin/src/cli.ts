/**
 * CLI 入口（`tsx src/cli.ts stats …`）。
 *
 * 形态是**本地批处理**：不监听端口、不起 HTTP server、没有任何守护进程。
 * 凭据在运行时从 `apps/api/.env` 读，日志与报告全部脱敏。
 *
 * 退出码：0 成功；2 参数错误；3 数据库错误（消息已脱敏）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAdminArgs, USAGE, UsageError } from './argv';
import { redactSecrets } from './db';
import { renderHtml } from './render/html';
import { renderText } from './render/text';
import { runStatsFromEnv } from './run';

/** `tools/admin/` 根目录：相对路径（`out/...`）以它为基准，而不是调用者的 cwd。 */
export const ADMIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 相对路径按 `tools/admin` 解析；绝对路径原样使用。 */
export function resolveFromAdminRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(ADMIN_ROOT, path);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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

  try {
    const report = await runStatsFromEnv({ days: args.days, includeNames: args.includeNames });
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
