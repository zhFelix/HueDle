/**
 * `docs/BADGES.md` 一致性校验（文档漂移的守门人）。
 *
 * - 默认模式：读取 `docs/BADGES.md`，与 `renderBadgesDoc()` 的输出**逐字节比较**，
 *   不一致即失败，并在错误信息里给出可执行的修复命令；
 * - 更新模式：`UPDATE_DOCS=1` 时把渲染结果写回 `docs/BADGES.md`（即 `pnpm run docs`）。
 *
 * 仓库根由本文件位置向上查找 `pnpm-workspace.yaml` 得到——vitest 的 process.cwd()
 * 是 `packages/shared`，直接用它拼路径会拼错。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderBadgesDoc } from '../renderDoc';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 从 start 向上查找含 `pnpm-workspace.yaml` 的目录。 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`未能从 ${start} 向上找到仓库根（pnpm-workspace.yaml）`);
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(HERE);
const DOC_PATH = join(REPO_ROOT, 'docs', 'BADGES.md');
const REGEN_COMMAND = 'pnpm -C packages/shared run docs';
const UPDATE = process.env.UPDATE_DOCS === '1';

/** 定位第一处不同的行，输出人类可读的差异摘要。 */
function firstDifference(expected: string, actual: string): string {
  const expLines = expected.split('\n');
  const actLines = actual.split('\n');
  const max = Math.max(expLines.length, actLines.length);
  for (let i = 0; i < max; i++) {
    if (expLines[i] !== actLines[i]) {
      return [
        `首个差异在第 ${i + 1} 行：`,
        `  期望（代码渲染）：${expLines[i] ?? '<文件已结束>'}`,
        `  实际（磁盘文件）：${actLines[i] ?? '<文件已结束>'}`,
      ].join('\n');
    }
  }
  return '（逐行内容一致，差异仅在结尾换行）';
}

describe('docs/BADGES.md 与 allBadges 一致', () => {
  it('渲染结果与磁盘文件逐字节一致', () => {
    const rendered = renderBadgesDoc();

    if (UPDATE) {
      mkdirSync(dirname(DOC_PATH), { recursive: true });
      writeFileSync(DOC_PATH, rendered, 'utf8');
      console.log(`[docs] 已写入 ${DOC_PATH}`);
      return;
    }

    if (!existsSync(DOC_PATH)) {
      throw new Error(`${DOC_PATH} 不存在。运行以下命令生成：\n  ${REGEN_COMMAND}`);
    }

    const actual = readFileSync(DOC_PATH, 'utf8');
    if (actual !== rendered) {
      throw new Error(
        [
          `docs/BADGES.md 与 allBadges 的渲染结果不一致：${DOC_PATH}`,
          firstDifference(rendered, actual),
          '修复命令：',
          `  ${REGEN_COMMAND}`,
        ].join('\n'),
      );
    }

    expect(actual).toBe(rendered);
  });
});
