/**
 * 加载 `apps/api/.env`（可选）。
 *
 * 用 Node 内置的 `process.loadEnvFile()`，**不引入 dotenv**：
 * 已存在的真实环境变量优先级更高，部署时不会被本地文件覆盖。
 * 文件不存在时静默跳过（生产环境通常直接注入环境变量）。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `<apps/api>/.env` 的绝对路径（从 `src/lib/env.ts` 往上两级）。 */
export const API_ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

export function loadEnvFile(path: string = API_ENV_PATH): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (err) {
    console.warn(`[huedle-api] 读取环境变量文件失败：${path}`, err);
  }
}
