/**
 * 暂存区：**保存是纯写入**，统一跑才走现有批量管道。
 *
 * 覆盖任务要求的四类：
 *   1. 保存不触发任何计算（无 job / 无锁 / 无快照 / 干跑零调用）；
 *   2. 暂存不碰徽章源码（mtime + md5 不变）；
 *   6. 草稿可删（删了列表与暂存文件同步，还能删了再加）；
 *   7. 统一跑真的调了现有批量管道（作业文件是 `specs` 数组 + 同一把 O_EXCL 锁）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDraft, clearStaging, readStaging, removeDraft, runStagedBatch, stagingFile, type DraftFields } from '../addbadge/staging';
import { readBatches } from '../addbadge/history';
import { addBadgePaths } from '../addbadge/state';
import { EXIT_LOCKED } from '../addbadge/pipeline';
import type { SpawnedChild } from '../addbadge/submit';
import { createFakeRepo, silenceLogs, type FakeRepo } from './addbadge.fixtures';

// 干跑被包一层计数：保存路径如果（将来）偷偷跑了干跑，这两个 mock 会记录到。
vi.mock('../addbadge/dryrun', async importOriginal => {
  const actual = await importOriginal<typeof import('../addbadge/dryrun')>();
  return {
    ...actual,
    runDryRun: vi.fn(actual.runDryRun),
    runBatchDryRun: vi.fn(actual.runBatchDryRun),
  };
});
import * as dryrun from '../addbadge/dryrun';

let repo: FakeRepo;
let restoreLogs: () => void;

beforeEach(() => {
  repo = createFakeRepo();
  restoreLogs = silenceLogs();
  vi.mocked(dryrun.runDryRun).mockClear();
  vi.mocked(dryrun.runBatchDryRun).mockClear();
});

afterEach(() => {
  restoreLogs();
  repo.cleanup();
});

const fields = (overrides: Partial<DraftFields> = {}): DraftFields => ({
  id: 'gray-stage-one',
  name: '暂存一',
  description: 'B = 7',
  family: 'gray',
  group: '',
  mode: 'when',
  when: '{"eq":[{"field":"b"},7]}',
  check: '',
  evalHelpers: '',
  ...overrides,
});

function fakeSpawn(record: Array<{ command: string; args: string[] }>): (command: string, args: string[]) => SpawnedChild {
  return (command, args) => {
    record.push({ command, args });
    return { pid: process.pid, unref: () => {}, on: () => {} };
  };
}

/** 徽章源码的 md5 + mtime（测试 2 的「碰没碰」判据）。 */
function snapshotBadges(root: string): Record<string, { md5: string; mtimeMs: number }> {
  const dir = join(root, 'packages/shared/src/badges');
  const out: Record<string, { md5: string; mtimeMs: number }> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    out[name] = {
      md5: createHash('md5').update(readFileSync(path)).digest('hex'),
      mtimeMs: statSync(path).mtimeMs,
    };
  }
  return out;
}

function outDirHas(adminRoot: string, sub: string): string[] {
  const dir = join(addBadgePaths(adminRoot).dir, sub);
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe('测试 1：保存不触发任何计算', () => {
  it('加一条草稿后：无 job、无锁、无快照、无状态文件、干跑函数零调用', () => {
    const paths = addBadgePaths(repo.adminRoot);
    const draft = addDraft(repo.adminRoot, fields());

    // 草稿确实落盘了
    expect(readStaging(repo.adminRoot)).toHaveLength(1);
    expect(readStaging(repo.adminRoot)[0]?.draftId).toBe(draft.draftId);

    // 零计算：没有任何管道产物
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(outDirHas(repo.adminRoot, 'jobs')).toEqual([]);
    expect(outDirHas(repo.adminRoot, 'snapshots')).toEqual([]);
    expect(existsSync(paths.statusFile)).toBe(false);
    expect(existsSync(join(paths.logsDir, `${draft.draftId}.log`))).toBe(false);

    // 干跑零调用（这是「先不跑」的核心保证）
    expect(vi.mocked(dryrun.runDryRun)).not.toHaveBeenCalled();
    expect(vi.mocked(dryrun.runBatchDryRun)).not.toHaveBeenCalled();
  });

  it('暂存文件是**原子写**：写完只留 staging.json，没有 .tmp- 残渣', () => {
    addDraft(repo.adminRoot, fields({ id: 'gray-stage-a' }));
    addDraft(repo.adminRoot, fields({ id: 'gray-stage-b' }));
    const files = readdirSync(addBadgePaths(repo.adminRoot).dir);
    expect(files.filter(name => name.includes('.tmp-'))).toEqual([]);
    expect(files).toContain('staging.json');
  });
});

describe('测试 2：暂存不碰徽章源码', () => {
  it('加草稿前后 packages/shared/src/badges/** 的 mtime 与 md5 不变', () => {
    const before = snapshotBadges(repo.root);
    addDraft(repo.adminRoot, fields({ id: 'gray-touch-a' }));
    addDraft(repo.adminRoot, fields({ id: 'gray-touch-b', family: 'math'}));
    const after = snapshotBadges(repo.root);
    expect(after).toEqual(before);
  });
});

describe('测试 6：草稿可删可改（删了再加）', () => {
  it('删除与暂存文件同步；删了可以再加', () => {
    const a = addDraft(repo.adminRoot, fields({ id: 'gray-del-a' }));
    const b = addDraft(repo.adminRoot, fields({ id: 'gray-del-b' }));
    expect(readStaging(repo.adminRoot).map(item => item.draftId)).toEqual([a.draftId, b.draftId]);

    expect(removeDraft(repo.adminRoot, a.draftId)).toBe(true);
    expect(readStaging(repo.adminRoot).map(item => item.draftId)).toEqual([b.draftId]);
    // 磁盘上的暂存文件与内存读出的列表一致
    const onDisk = JSON.parse(readFileSync(stagingFile(repo.adminRoot), 'utf8')) as Array<{ draftId: string }>;
    expect(onDisk.map(item => item.draftId)).toEqual([b.draftId]);

    // 删除不存在的返回 false，不改变文件
    expect(removeDraft(repo.adminRoot, 'nope')).toBe(false);
    const again = addDraft(repo.adminRoot, fields({ id: 'gray-del-a' }));
    expect(readStaging(repo.adminRoot).map(item => item.draftId)).toEqual([b.draftId, again.draftId]);
  });
});

describe('测试 7：统一跑走的是现有批量管道', () => {
  it('作业文件是 `specs` 数组（批量格式）、抢的是同一把锁、跑完清空暂存区', () => {
    addDraft(repo.adminRoot, fields({ id: 'gray-run-a', family: 'gray' }));
    addDraft(repo.adminRoot, fields({ id: 'math-run-b', family: 'math', when: '{"eq":[{"field":"g"},11]}' }));
    const spawned: Array<{ command: string; args: string[] }> = [];

    const result = runStagedBatch({
      adminRoot: repo.adminRoot,
      root: repo.root,
      spawn: fakeSpawn(spawned) as never,
      now: () => new Date('2026-10-05T10:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const paths = addBadgePaths(repo.adminRoot);

    // ① 作业文件：批量路径写的是 specs 数组（单条路径写 spec），且是真子进程入口
    const jobPath = join(paths.jobsDir, `${result.runId}.json`);
    expect(existsSync(jobPath)).toBe(true);
    const job = JSON.parse(readFileSync(jobPath, 'utf8')) as { specs?: unknown[]; spec?: unknown };
    expect(Array.isArray(job.specs)).toBe(true);
    expect(job.specs).toHaveLength(2);
    expect(job.spec).toBeUndefined();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args[0]).toContain('addbadge/child.ts');

    // ② 锁：与 submitBadgeBatchJob 同一把 O_EXCL 锁，写 specCount
    const lock = JSON.parse(readFileSync(paths.lockFile, 'utf8')) as { specCount?: number; runId: string };
    expect(lock.runId).toBe(result.runId);
    expect(lock.specCount).toBe(2);

    // ③ 批次历史 + 暂存区清空
    const records = readBatches(repo.adminRoot);
    expect(records.map(item => item.runId)).toContain(result.runId);
    expect(records.find(item => item.runId === result.runId)?.state).toBe('running');
    expect(readStaging(repo.adminRoot)).toEqual([]);
  });

  it('已有管道在跑时统一跑被拒绝（EXIT_LOCKED），暂存区保留', () => {
    addDraft(repo.adminRoot, fields({ id: 'gray-lock-a' }));
    const first = runStagedBatch({ adminRoot: repo.adminRoot, root: repo.root, spawn: fakeSpawn([]) as never });
    expect(first.ok).toBe(true);

    addDraft(repo.adminRoot, fields({ id: 'gray-lock-b' }));
    const second = runStagedBatch({ adminRoot: repo.adminRoot, root: repo.root, spawn: fakeSpawn([]) as never });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.exitCode).toBe(EXIT_LOCKED);
    // 被拒时不丢草稿
    expect(readStaging(repo.adminRoot).map(item => item.fields.id)).toEqual(['gray-lock-b']);
  });

  it('草稿无法解析 → 明确拒绝并点出是哪条，暂存区保留（反馈推迟到这里）', () => {
    addDraft(repo.adminRoot, fields({ id: 'gray-bad-json', when: '{不是 JSON' }));
    const result = runStagedBatch({ adminRoot: repo.adminRoot, root: repo.root, spawn: fakeSpawn([]) as never });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('gray-bad-json');
    expect(result.reason).toContain('无法运行');
    expect(readStaging(repo.adminRoot)).toHaveLength(1);
    expect(outDirHas(repo.adminRoot, 'jobs')).toEqual([]);
  });

  it('暂存区为空 → 直接拒绝，不产生任何作业', () => {
    clearStaging(repo.adminRoot);
    const result = runStagedBatch({ adminRoot: repo.adminRoot, root: repo.root, spawn: fakeSpawn([]) as never });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('暂存区为空');
  });
});
