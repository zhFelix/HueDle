/**
 * 最小 Node 环境 ambient 声明。
 *
 * 本仓库没有安装 `@types/node`（不引入新依赖），而文档生成路径需要读写文件、
 * 计算仓库根目录，因此在这里按需声明用到的 Node 内建模块与全局量。
 * 只覆盖 `src` 下实际用到的 API；若日后引入 `@types/node`，删除本文件即可。
 */

interface ImportMeta {
  /** ESM 模块自身的 `file://` URL（Node / vitest / Vite 均提供）。 */
  url: string;
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function mkdirSync(path: string, options: { recursive: boolean }): void;
  export function existsSync(path: string): boolean;
  /** 目录项名（不保证顺序；调用方必须自行排序——`badgeSourceFingerprint.ts` 会 sort）。 */
  export function readdirSync(path: string): string[];
}

declare module 'node:crypto' {
  /** 只声明本项目用到的流式哈希接口（`src/badgeSourceFingerprint.ts`）。 */
  export interface Hasher {
    update(data: string, encoding?: 'utf8'): Hasher;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hasher;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
