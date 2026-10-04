/**
 * 快照与还原（docs/ADMIN.md §3.5）。
 *
 * 「回滚不是『把文件复制回去』，是『复制回去 + 证明回到绿』」：
 *   1. 还原：运行前这些路径在 git 里干净 → `git restore --source=<HEAD>`（最快、可证明）；
 *      否则从 `out/addbadge/snapshots/<runId>/` 快照逐字节复制回去；
 *   2. 验证还原：逐文件 md5 与快照一致 + `git diff --exit-code -- <paths>` 为 0；
 *   3. 验证回到绿：跑 `pnpm -C packages/shared test`（由 `pipeline.ts` 负责，因为要注入 exec）。
 *
 * 任何一步失败都**绝不静默**：返回失败清单，调用方以退出码 4 收尾并提示人工介入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SnapFile {
  /** 仓库根相对路径（POSIX）。 */
  rel: string;
  existed: boolean;
  md5: string | null;
  /** 是否可以用 `git restore` 快路径（文件在 HEAD 里且有 git 仓库）。 */
  fromGit: boolean;
}

export interface Snapshot {
  runId: string;
  dir: string;
  head: string;
  files: SnapFile[];
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 跑一条 git 命令（同步、只读语义的命令）。 */
export function git(root: string, args: string[]): GitResult {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return {
    code: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ''),
  };
}

export function isGitRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';
}

export function gitHead(root: string): string {
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

export function md5(bytes: Buffer | string): string {
  return createHash('md5').update(bytes).digest('hex');
}

/** 受影响路径里**有未提交改动**的清单（回滚前置：默认拒绝开跑，§3.5）。 */
export function dirtyPaths(root: string, relPaths: readonly string[]): string[] {
  const existing = relPaths.filter(rel => existsSync(join(root, rel)));
  if (existing.length === 0) return [];
  const result = git(root, ['status', '--porcelain', '--', ...existing]);
  if (result.code !== 0) {
    // 不是 git 仓库（或 git 不可用）：无法证明「干净」，按保守拒绝处理。
    return [...relPaths];
  }
  return result.stdout
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean);
}

function snapshotFilePath(snapshotDir: string, rel: string): string {
  return join(snapshotDir, 'files', rel);
}

/** 记录 HEAD + 受影响路径的逐字节副本。快照自身写在 `out/` 下（.gitignore 已挡）。 */
export function captureSnapshot(
  root: string,
  snapshotsDir: string,
  relPaths: readonly string[],
  runId: string,
): Snapshot {
  const dir = join(snapshotsDir, runId);
  const head = isGitRepo(root) ? gitHead(root) : '';
  const files: SnapFile[] = [];
  const inGit = head !== '';
  for (const rel of relPaths) {
    const full = join(root, rel);
    const existed = existsSync(full);
    const bytes = existed ? readFileSync(full) : null;
    const fromGit =
      inGit && existed && git(root, ['ls-files', '--error-unmatch', '--', rel]).code === 0;
    if (bytes) {
      const target = snapshotFilePath(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    files.push({ rel, existed, md5: bytes ? md5(bytes) : null, fromGit });
  }
  const snapshot: Snapshot = { runId, dir, head, files };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

/** 还原：git 快路径优先，其余从快照逐字节复制（或删除运行时新建的文件）。 */
export function restoreSnapshot(root: string, snapshot: Snapshot): { restored: string[]; failed: Array<{ rel: string; error: string }> } {
  const restored: string[] = [];
  const failed: Array<{ rel: string; error: string }> = [];
  for (const file of snapshot.files) {
    try {
      if (file.fromGit && snapshot.head) {
        const result = git(root, ['restore', `--source=${snapshot.head}`, '--', file.rel]);
        if (result.code === 0) {
          restored.push(file.rel);
          continue;
        }
      }
      const full = join(root, file.rel);
      if (file.existed) {
        const bytes = readFileSync(snapshotFilePath(snapshot.dir, file.rel));
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, bytes);
      } else if (existsSync(full)) {
        rmSync(full, { force: true });
      }
      restored.push(file.rel);
    } catch (err) {
      failed.push({ rel: file.rel, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { restored, failed };
}

/** 验证还原：逐文件 md5 一致 **且** `git diff --exit-code` 为 0。返回不一致清单。 */
export function verifyRestored(root: string, snapshot: Snapshot): string[] {
  const mismatched: string[] = [];
  for (const file of snapshot.files) {
    const full = join(root, file.rel);
    const exists = existsSync(full);
    if (exists !== file.existed) {
      mismatched.push(file.rel);
      continue;
    }
    if (!exists) continue;
    if (md5(readFileSync(full)) !== file.md5) mismatched.push(file.rel);
  }
  if (isGitRepo(root)) {
    const diff = git(root, ['diff', '--exit-code', '--', ...snapshot.files.map(file => file.rel)]);
    if (diff.code !== 0) {
      for (const rel of snapshot.files.map(file => file.rel)) {
        if (!mismatched.includes(rel)) mismatched.push(rel);
      }
    }
  }
  return mismatched;
}

/** 成功后删除快照（S4.3）；失败时保留，路径会被打印出来。 */
export function dropSnapshot(snapshot: Snapshot): void {
  rmSync(snapshot.dir, { recursive: true, force: true });
}

/** 快照的绝对路径（打印给用户，让他知道去哪找复核材料）。 */
export function snapshotPathOf(snapshot: Snapshot): string {
  return snapshot.dir;
}
