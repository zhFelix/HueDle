/**
 * 测试 4（锁）与测试 5（状态文件）。
 *
 * 锁：**已有管道在跑时，新的提交被拒绝并说明原因**——不排队、不并发（O_EXCL 是内核保证）。
 * 状态：各阶段被正确写入；**进程中途死亡后能被发现**（绝不静默忽略）。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBadgeSpec } from '../addbadge/spec';
import { PHASES, acquireLock, addBadgePaths, ensureOutDirs, makeStatus, readLock, readStatus, writeStatus } from '../addbadge/state';
import { submitBadgeJob, type SpawnedChild } from '../addbadge/submit';
import { waitForCompletion } from '../addbadge/watch';
import { EXIT_INTERRUPTED, EXIT_LOCKED, runPipeline } from '../addbadge/pipeline';
import { ADMIN_ROOT, REPO_ROOT } from '../cli';
import { createFakeRepo, pipelineDeps, silenceLogs, SAFE_SPEC_JSON, type FakeRepo } from './addbadge.fixtures';

let repo: FakeRepo;
let restoreLogs: () => void;

beforeEach(() => {
  repo = createFakeRepo();
  restoreLogs = silenceLogs();
});

afterEach(() => {
  restoreLogs();
  repo.cleanup();
});

const spec = (): ReturnType<typeof parseBadgeSpec> => parseBadgeSpec(SAFE_SPEC_JSON);
/** 原始 JSON：作业文件里存的是它（见 submit.ts 的说明）。 */
const rawSpec = (): unknown => SAFE_SPEC_JSON;

function fakeSpawn(
  record: Array<{ command: string; args: string[] }>,
  pid: number = process.pid,
): (command: string, args: string[]) => SpawnedChild {
  return (command, args) => {
    record.push({ command, args });
    return { pid, unref: () => {}, on: () => {} };
  };
}

describe('测试 4：锁 —— 并发提交被拒绝，不是排队', () => {
  it('第二次提交返回 EXIT_LOCKED，且只拉起过一个子进程', async () => {
    const record: Array<{ command: string; args: string[] }> = [];
    const base = { rawSpec: rawSpec(), spec: spec(), root: repo.root, adminRoot: repo.adminRoot, logPath: join(repo.adminRoot, 'out/addbadge/logs/x.log') };

    const first = submitBadgeJob({ ...base, runId: 'run-1', spawn: fakeSpawn(record) as never });
    expect(first.ok).toBe(true);
    expect(record).toHaveLength(1);

    const second = submitBadgeJob({ ...base, runId: 'run-2', spawn: fakeSpawn(record) as never });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.exitCode).toBe(EXIT_LOCKED);
    expect(second.reason).toContain('已有管道在跑');
    expect(second.reason).toContain('不排队');
    // 没有排队：第二个作业没有留下作业文件，也没有第二次 spawn
    expect(record).toHaveLength(1);
    expect(readdirSync(addBadgePaths(repo.adminRoot).jobsDir)).toEqual(['run-1.json']);
  });

  it('作业文件里存的是**原始 JSON**（子进程能重新 parse 它，而不是 AST）', async () => {
    const record: Array<{ command: string; args: string[] }> = [];
    submitBadgeJob({
      rawSpec: rawSpec(),
      spec: spec(),
      root: repo.root,
      adminRoot: repo.adminRoot,
      runId: 'run-raw',
      logPath: join(repo.adminRoot, 'out/addbadge/logs/raw.log'),
      spawn: fakeSpawn(record) as never,
    });
    const jobFile = JSON.parse(readFileSync(join(addBadgePaths(repo.adminRoot).jobsDir, 'run-raw.json'), 'utf8')) as {
      spec: unknown;
    };
    // 存的是原始 JSON（when 还是 {"all":[…]} 的形状），不是归一化后的 AST
    expect(jobFile.spec).toEqual(SAFE_SPEC_JSON);
    // 关键回归：它能被重新 parse（结构化 spec 曾因存 AST 而让子进程在解析处崩掉）
    expect(parseBadgeSpec(jobFile.spec).id).toBe(SAFE_SPEC_JSON.id);
    // 归一化后的 AST 若被存进去，就会变成「表达式对象有 3 个键」而 parse 失败
    expect(() => parseBadgeSpec({ ...SAFE_SPEC_JSON, when: { kind: 'op', name: 'and', args: [] } })).toThrow();
  });

  it('acquireLock 用 O_EXCL：同一把锁只有一个成功', async () => {
    ensureOutDirs(repo.adminRoot);
    const lock = {
      runId: 'a',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      spec: { id: 'x', name: 'x', family: 'gray', group: null },
      logPath: 'l',
    };
    expect(acquireLock(repo.adminRoot, lock)).toEqual({ ok: true });
    const again = acquireLock(repo.adminRoot, { ...lock, runId: 'b' });
    expect(again.ok).toBe(false);
  });

  it('stale 锁（pid 已消失）：默认拒绝并点名原因；--force 才接管', async () => {
    ensureOutDirs(repo.adminRoot);
    writeFileSync(
      addBadgePaths(repo.adminRoot).lockFile,
      JSON.stringify({
        runId: 'dead-run',
        pid: 999_999,
        startedAt: '2026-10-04T00:00:00.000Z',
        spec: { id: 'x', name: 'x', family: 'gray', group: null },
        logPath: 'l',
      }),
      'utf8',
    );
    expect(readLock(repo.adminRoot).kind).toBe('stale');

    const base = { rawSpec: rawSpec(), spec: spec(), root: repo.root, adminRoot: repo.adminRoot, logPath: join(repo.adminRoot, 'out/addbadge/logs/y.log') };
    const refused = submitBadgeJob({ ...base, runId: 'run-3', spawn: fakeSpawn([]) as never });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.exitCode).toBe(EXIT_INTERRUPTED);
    expect(refused.reason).toContain('未跑完');

    const forced = submitBadgeJob({ ...base, runId: 'run-4', force: true, spawn: fakeSpawn([]) as never });
    expect(forced.ok).toBe(true);
    const after = readLock(repo.adminRoot);
    expect(after.kind).not.toBe('none');
    if (after.kind === 'none') throw new Error('unreachable');
    expect(after.lock.runId).toBe('run-4');
  });

  it('锁文件损坏时按 stale 处理（宁可拒绝，也不并发）', async () => {
    ensureOutDirs(repo.adminRoot);
    writeFileSync(addBadgePaths(repo.adminRoot).lockFile, '{ 这不是 JSON', 'utf8');
    expect(readLock(repo.adminRoot).kind).toBe('stale');
  });
});

describe('测试 5：状态文件', () => {
  it('writeStatus/readStatus 往返一致（原子写：临时文件 + rename）', async () => {
    const status = makeStatus({
      runId: 'r1',
      spec: { id: 'a', name: 'n', family: 'gray', group: null },
      phase: 'enumerate',
      logPath: 'log',
    });
    writeStatus(repo.adminRoot, status);
    const view = readStatus(repo.adminRoot);
    expect(view.status?.runId).toBe('r1');
    expect(view.status?.phase).toBe('enumerate');
    expect(view.interrupted).toBe(false);
  });

  it('流水线把每个阶段按顺序写进状态文件', async () => {
    const seen: string[] = [];
    const outcome = await runPipeline(
      { runId: 'run-phases', spec: spec(), logPath: 'log' },
      pipelineDeps(repo, {
        onStatus: status => {
          if (seen[seen.length - 1] !== status.phase) seen.push(status.phase);
        },
      }),
    );
    expect(outcome.exitCode).toBe(0);
    expect(seen).toEqual([...PHASES, 'done']);
    // 关键顺序：干跑必须在写盘之前
    expect(seen.indexOf('dryrun')).toBeLessThan(seen.indexOf('write'));
    expect(seen.indexOf('snapshot')).toBeLessThan(seen.indexOf('write'));
    expect(seen.indexOf('write')).toBeLessThan(seen.indexOf('typecheck'));
    expect(seen.indexOf('enumerate')).toBeLessThan(seen.indexOf('idempotency'));
  });

  it('子进程中途死亡：下一次读取能发现「有一个没跑完的管道」', async () => {
    writeStatus(repo.adminRoot, makeStatus({
      runId: 'died',
      spec: { id: 'a', name: 'n', family: 'gray', group: null },
      phase: 'enumerate',
      pid: 999_999,
      state: 'running',
      logPath: 'log',
    }));
    const view = readStatus(repo.adminRoot);
    expect(view.interrupted).toBe(true);
    expect(view.interruption).toContain('999999');
    expect(view.interruption).toContain('enumerate');
  });

  it('只有 stale 锁、没有状态文件时也能发现异常', async () => {
    ensureOutDirs(repo.adminRoot);
    writeFileSync(
      addBadgePaths(repo.adminRoot).lockFile,
      JSON.stringify({ runId: 'lost', pid: 999_998, startedAt: '', spec: {}, logPath: '' }),
      'utf8',
    );
    const view = readStatus(repo.adminRoot);
    expect(view.interrupted).toBe(true);
    expect(view.interruption).toContain('lost');
  });

  it('状态文件内容是合法 JSON 且带时间戳/阶段计数（UI 轮询的契约）', async () => {
    await runPipeline(
      { runId: 'run-json', spec: spec(), logPath: 'log' },
      pipelineDeps(repo, { onStatus: status => writeStatus(repo.adminRoot, status) }),
    );
    const raw = readFileSync(addBadgePaths(repo.adminRoot).statusFile, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.state).toBe('succeeded');
    expect(parsed.phaseCount).toBe(PHASES.length);
    expect(typeof parsed.startedAt).toBe('string');
    expect(typeof parsed.updatedAt).toBe('string');
    expect(parsed.logPath).toBe('log');
  });

  it('状态文件损坏时 readStatus 不抛异常（页面不能因此 500）', async () => {
    ensureOutDirs(repo.adminRoot);
    writeFileSync(addBadgePaths(repo.adminRoot).statusFile, '{坏掉的', 'utf8');
    const view = readStatus(repo.adminRoot);
    expect(view.status).toBeNull();
    expect(view.interrupted).toBe(false);
  });
});

describe('提交时必须立刻覆盖状态文件（否则 --wait 会读到上一次的结论）', () => {
  it('submit 后 status.json 的 runId 立刻是本次作业', async () => {
    // 先制造一份「上一次作业」的状态
    writeStatus(repo.adminRoot, makeStatus({
      runId: 'previous-run',
      spec: { id: 'old', name: 'old', family: 'gray', group: null },
      state: 'succeeded',
      phase: 'done',
      pid: 999_996,
      logPath: 'old.log',
    }));
    const result = submitBadgeJob({
      rawSpec: rawSpec(),
      spec: spec(),
      root: repo.root,
      adminRoot: repo.adminRoot,
      runId: 'run-fresh',
      logPath: join(repo.adminRoot, 'out/addbadge/logs/fresh.log'),
      spawn: fakeSpawn([]) as never,
    });
    expect(result.ok).toBe(true);
    const view = readStatus(repo.adminRoot);
    expect(view.status?.runId).toBe('run-fresh');
    expect(view.status?.state).toBe('running');
    expect(view.interrupted).toBe(false);
  });
});

describe('观察者：waitForCompletion 不能在子进程写第一份状态之前就放弃', () => {
  it('状态文件晚到：会一直等到终态（而不是第一次读到 null 就返回）', async () => {
    const runId = 'run-late';
    let polls = 0;
    const sleep = async (): Promise<void> => {
      polls += 1;
      if (polls === 3) {
        writeStatus(repo.adminRoot, makeStatus({
          runId,
          spec: { id: 'a', name: 'n', family: 'gray', group: null },
          phase: 'enumerate',
          state: 'running',
          pid: process.pid,
          logPath: 'log',
        }));
      }
      if (polls === 5) {
        const status = makeStatus({
          runId,
          spec: { id: 'a', name: 'n', family: 'gray', group: null },
          phase: 'done',
          state: 'succeeded',
          pid: process.pid,
          logPath: 'log',
        });
        status.exitCode = 0;
        writeStatus(repo.adminRoot, status);
      }
    };
    const view = await waitForCompletion(repo.adminRoot, runId, { sleep, intervalMs: 0 });
    expect(polls).toBeGreaterThanOrEqual(5);
    expect(view.status?.state).toBe('succeeded');
  });

  it('子进程根本没起来（锁 stale 且过了宽限期）→ 返回而不是无限等', async () => {
    ensureOutDirs(repo.adminRoot);
    writeFileSync(
      addBadgePaths(repo.adminRoot).lockFile,
      JSON.stringify({ runId: 'never', pid: 999_997, startedAt: '', spec: {}, logPath: '' }),
      'utf8',
    );
    const view = await waitForCompletion(repo.adminRoot, 'never', {
      sleep: async () => {},
      intervalMs: 0,
      startGraceMs: 0,
    });
    expect(view.status).toBeNull();
    expect(view.interrupted).toBe(true);
  });

  it('别人的 run 不继续等（CLI 不会挂在不属于自己的作业上）', async () => {
    writeStatus(repo.adminRoot, makeStatus({
      runId: 'other',
      spec: { id: 'a', name: 'n', family: 'gray', group: null },
      state: 'running',
      phase: 'enumerate',
      pid: process.pid,
      logPath: 'log',
    }));
    const view = await waitForCompletion(repo.adminRoot, 'mine', {
      sleep: async () => {},
      intervalMs: 0,
      startGraceMs: 0,
    });
    expect(view.status?.runId).toBe('other');
  });
});

describe('路径常量：CLI 里的 REPO_ROOT 必须真的指向仓库根', () => {
  // 这条是 E2E 抓出来的真实 bug：`new URL('../..')` 会落到 `<repo>/tools`，
  // 而单元测试全都注入 root，所以只有「常量本身」的断言能守住它。
  it('REPO_ROOT 下有 pnpm-workspace.yaml 与 packages/shared/src/badges', async () => {
    expect(existsSync(join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'packages/shared/src/badges/culture.ts'))).toBe(true);
    expect(existsSync(join(ADMIN_ROOT, 'package.json'))).toBe(true);
    expect(REPO_ROOT.endsWith('/tools/')).toBe(false);
  });
});

describe('测试 5（补充）：临时目录隔离', () => {
  it('夹具用的是系统临时目录，不碰真实仓库', async () => {
    expect(repo.root.startsWith(tmpdir())).toBe(true);
    expect(repo.root).toContain('huedle-addbadge-');
    const isolated = mkdtempSync(join(tmpdir(), 'huedle-isolated-'));
    rmSync(isolated, { recursive: true, force: true });
  });
});
