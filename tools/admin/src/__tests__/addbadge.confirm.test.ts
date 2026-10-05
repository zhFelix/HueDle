/**
 * 两级蕴含判定 + 两阶段确认流程的测试（本次改动的核心）。
 *
 * 覆盖任务要求的 9 类，重点在「放开的那一侧不能放开过头」：
 *   1. **回归**：现有 26 条严格单色徽章（`hits: 1`）当候选喂给干跑 → 没有 error 级 violation；
 *   2. `#404404` 那种（1 色、被既有徽章包含）→ 只有警告，无错误；
 *   3. **互相蕴含仍然拒绝**（两个不同 id、同一个 check）；
 *   4. 单向蕴含出现在警告清单里（对方 id / 共命中数 / Jaccard / 方向）；
 *   5. 只有警告时状态是【待确认】而**不是失败**；硬错误时才是 refused；
 *   6. 待确认时**子进程已退出**（真起一个 detached 子进程，断言 pid 不在、锁已释放）；
 *   7. 确认绑定 spec 内容哈希：哈希不匹配 → 作废、重新给警告；
 *   8. 「继续」真的接着跑（走完剩余阶段并写盘）；
 *   9. 「修改」什么都不发生（HTTP 层，文件零改动、无快照）。
 *
 * 第 1、2、6 类用的是**真实数据与真实 2²⁴ 全色域**（现有合法数据就是最好的用例），
 * 因此比其余用例慢几秒；其余用 4096 色的小色域 + 假夹具，是秒级的。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TOTAL_COLORS } from '@huedle/shared';
import { loadExistingChecks, runBatchDryRun, runDryRun } from '../addbadge/dryrun';
import {
  EXIT_AWAITING_CONFIRMATION,
  EXIT_ROLLED_BACK,
  runBatchPipeline,
  specContentHash,
  type BatchPipelineJob,
} from '../addbadge/pipeline';
import { compileSpec } from '../addbadge/compile';
import { parseBadgeSpec, type BadgeSpec } from '../addbadge/spec';
import { continuePendingBatch, readStaging } from '../addbadge/staging';
import {
  addBadgePaths,
  ensureOutDirs,
  isProcessAlive,
  makeStatus,
  readStatus,
  writeStatus,
} from '../addbadge/state';
import { stateFromRaw } from '../addbadge/tree';
import { renderBatchTree } from '../ui/batch-tree';
import { createUiServer, listenUiServer } from '../ui/server';
import type { StatsReport } from '../report';
import { createFakeRepo, pipelineDeps, silenceLogs, type FakeRepo } from './addbadge.fixtures';
import { sampleReport } from './fixtures';

const ADMIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

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

const batchJob = (specs: BadgeSpec[], extra: Partial<BatchPipelineJob> = {}): BatchPipelineJob => ({
  runId: 'run-confirm',
  specs,
  logPath: 'log',
  ...extra,
});

function makeSpec(overrides: Record<string, unknown>): BadgeSpec {
  return parseBadgeSpec({
    id: 'gray-confirm-base',
    name: '确认基准',
    description: 'B = 7',
    family: 'gray',
    group: null,
    when: { eq: [{ field: 'b' }, 7] },
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 回归：现有 26 条严格单色徽章当候选 → 没有 error 级 violation
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 1（回归，最重要）：现有严格单色徽章喂给干跑必须通过', () => {
  it('128 条里 hits: 1 的全部 26 条：没有任何 error 级 violation，只有单向警告', async () => {
    const existing = loadExistingChecks();
    const singles = existing.filter(item => item.hits === 1);
    // 钉住数据：这正是「越稀有的徽章越必然被更宽的徽章包含」的那一批。
    expect(singles).toHaveLength(26);
    expect(singles.map(item => item.id)).toContain('culture-klein-blue');
    expect(singles.map(item => item.id)).toContain('culture-facebook-blue');
    expect(singles.map(item => item.id)).toContain('culture-discord-blurple');

    // 候选 = 这 26 条自己（用它们真实的 check）；existing = 其余 102 条
    // （候选彼此的关系由批量干跑的新 vs 新检查覆盖）。
    const singleIds = new Set(singles.map(item => item.id));
    const others = existing.filter(item => !singleIds.has(item.id));
    const result = runBatchDryRun({
      candidates: singles.map(item => ({ id: item.id, group: item.group, check: item.check })),
      existing: others,
      total: TOTAL_COLORS,
    });

    // 关键断言：一条 error 都没有（放开的正是单向包含这一侧）。
    expect(result.violations).toEqual([]);
    for (const candidate of result.candidates) {
      expect(candidate.violations, candidate.id).toEqual([]);
      expect(candidate.empty, candidate.id).toBe(false);
      expect(candidate.implications.every(item => item.level !== 'error'), candidate.id).toBe(true);
    }
    // 不是空转：它们确实和既有徽章构成单向蕴含（这正是以前会被误拒的 273 处）。
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.warnings.every(text => text.includes('警告，不是错误'))).toBe(true);
    }
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. extreme-404 那种：1 色、被 13 条包含 → 只有警告
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 2：extreme-404（严格 #404404）只有警告、无错误', () => {
  it('hits = 1，与既有徽章的 13 处蕴含全部是 warning 级', async () => {
    const spec = parseBadgeSpec({
      id: 'extreme-404',
      name: '极四零四',
      description: '严格等于 #404404',
      family: 'extreme',
      group: null,
      when: { eq: [{ field: 'hex' }, '#404404'] },
    });
    // 真的把 spec 编译成谓词（不是手写一个 check 糊弄过去）。
    const compiled = await compileSpec(spec, REPO_ROOT);
    const result = runDryRun({ check: compiled.predicate, existing: loadExistingChecks(), total: TOTAL_COLORS });

    expect(result.hits).toBe(1);
    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(13);
    expect(result.implications).toHaveLength(13);
    expect(result.implications.every(item => item.level === 'warning')).toBe(true);
    expect(result.implications.every(item => item.direction === 'new-subset-of-old')).toBe(true);
    for (const warning of result.warnings) expect(warning).toContain('警告，不是错误');
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 互相蕴含仍然拒绝
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 3：互相蕴含（A ≡ B）仍然拒绝', () => {
  it('两个不同 id、同一个 check → 干跑报 error（不是 warning）', async () => {
    const result = runBatchDryRun({
      candidates: [
        { id: 'gray-eq-a', group: null, check: (c: { b: number }) => c.b === 7 },
        { id: 'gray-eq-b', group: null, check: (c: { b: number }) => c.b === 7 },
      ],
      existing: [],
      total: 4096,
    });
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
    expect(result.pairwise[0]?.level).toBe('error');
    expect(result.pairwise[0]?.direction).toBe('equal');
    expect(result.violations.join('\n')).toContain('双倍计分');
  });

  it('管道层：两条等价 spec → refused、退出码 2、零写盘', async () => {
    const a = makeSpec({ id: 'gray-eq-pipe-a', name: '等价甲', description: 'B = 7' });
    const b = makeSpec({ id: 'gray-eq-pipe-b', name: '等价乙', description: 'B = 7' });
    const outcome = await runBatchPipeline(batchJob([a, b]), pipelineDeps(repo));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(outcome.failureClass).toBe('dryrun');
    expect(outcome.warnings).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 单向蕴含出现在警告清单里
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 4：警告清单带方向 / 对方 id / 共命中数 / Jaccard', () => {
  it('新 ⊆ 旧：warning 里有对端 id、cohits、jaccard，且文案写明不是错误', async () => {
    const result = runDryRun({
      check: c => c.b === 7,
      existing: [{ id: 'gray-broad', group: null, hits: 2048, check: c => c.b < 128 }],
      total: 4096,
    });
    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    const item = result.implications[0]!;
    expect(item.id).toBe('gray-broad');
    expect(item.direction).toBe('new-subset-of-old');
    expect(item.level).toBe('warning');
    expect(item.cohits).toBe(16);
    expect(item.jaccard).toBeCloseTo(16 / 2048, 6);
    expect(result.warnings[0]).toContain('gray-broad');
    expect(result.warnings[0]).toContain('共命中 16 色');
    expect(result.warnings[0]).toContain('警告，不是错误');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 待确认 vs 失败
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 5：只有警告时是【待确认】，不是失败；硬错误才是失败', () => {
  it('单向蕴含 → state = awaiting_confirmation（图标 awaiting，不是 failed）', async () => {
    const narrow = makeSpec({ id: 'gray-await-narrow', name: '窄幅', description: 'B = 7' });
    const wide = makeSpec({ id: 'gray-await-wide', name: '宽幅', description: 'B < 128', when: { lt: [{ field: 'b' }, 128] } });
    const outcome = await runBatchPipeline(batchJob([narrow, wide]), pipelineDeps(repo));
    expect(outcome.state).toBe('awaiting_confirmation');
    expect(outcome.exitCode).toBe(EXIT_AWAITING_CONFIRMATION);
    expect(outcome.failureClass).toBe('dryrun-warnings');
    expect(outcome.conclusion).toContain('这不是失败');
    // 树形图标：待确认 ≠ 失败。
    expect(stateFromRaw('awaiting_confirmation')).toBe('awaiting');
    expect(stateFromRaw('refused')).toBe('failed');
  });

  it('硬错误（hits = 0）→ refused，仍然是失败', async () => {
    const never = makeSpec({
      id: 'gray-await-never',
      name: '永不命中',
      description: 'B 同时等于 7 和 8',
      when: { all: [{ eq: [{ field: 'b' }, 7] }, { eq: [{ field: 'b' }, 8] }] },
    });
    const outcome = await runBatchPipeline(batchJob([never]), pipelineDeps(repo));
    expect(outcome.state).toBe('refused');
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(stateFromRaw('refused')).toBe('failed');
  });

  it('待确认批次渲染：图标有别于失败、展开可见警告清单、有继续/修改两个按钮', async () => {
    const html = renderBatchTree(
      [
        {
          key: 'run-await-1',
          title: '批次 run-await-1',
          state: 'awaiting',
          rawState: 'awaiting_confirmation',
          specHash: 'hash-abc',
          items: [{ id: 'extreme-404', name: '极四零四', family: 'extreme', failed: false }],
          warnings: [
            {
              otherId: 'channel-all-low',
              scope: 'existing',
              direction: 'new-subset-of-old',
              cohits: 1,
              jaccard: 1 / 2097152,
              message: '⚠ 警告，不是错误：与 "channel-all-low" 构成单向蕴含（new-subset-of-old，共命中 1 色，Jaccard=0.0000）。',
            },
          ],
          pending: false,
        },
      ],
      { token: 'tok' },
    );
    expect(html).toContain('batch-awaiting');
    expect(html).not.toContain('batch-failed');
    expect(html).not.toContain('class="item-fail"');
    expect(html).toContain('有 1 条单向蕴含警告，等待确认（这不是失败，工作区零改动）');
    expect(html).toContain('channel-all-low');
    expect(html).toContain('警告，不是错误');
    expect(html).toContain('action="/badge/continue"');
    expect(html).toContain('action="/badge/modify"');
    expect(html).toContain('name="specHash" value="hash-abc"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 子进程不挂在「待确认」上等
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 6：待确认时子进程已经退出（不是挂着等输入）', () => {
  it('真起一个子进程跑 runChild：退出码 9、状态待确认、pid 不在、锁已释放', async () => {
    const paths = ensureOutDirs(repo.adminRoot);
    const runId = 'child-await-1';
    const jobPath = join(paths.jobsDir, `${runId}.json`);
    const rawSpec = {
      id: 'gray-confirm-one',
      name: '严格一色',
      description: '严格等于 #404404（与 13 条既有徽章单向蕴含）',
      family: 'gray',
      group: null,
      when: { eq: [{ field: 'hex' }, '#404404'] },
    };
    writeFileSync(jobPath, JSON.stringify({ runId, spec: rawSpec, logPath: join(paths.logsDir, `${runId}.log`) }), 'utf8');

    // 子进程入口按 (job, adminRoot, root) 三个参数调用 runChild；这里用真实 2²⁴ 干跑
    // （只有 hits=1，几秒），在【待确认】处正常退出——不写盘、不跑 enumerate。
    const wrapper = join(repo.root, 'child-runner.ts');
    const childUrl = pathToFileURL(join(ADMIN_ROOT, 'src/addbadge/child.ts')).href;
    writeFileSync(
      wrapper,
      `import { runChild } from ${JSON.stringify(childUrl)};\n`
      + 'runChild(process.argv[2], process.argv[3], process.argv[4]).then(\n'
      + '  code => { process.exitCode = code; },\n'
      + '  err => { console.error(err); process.exitCode = 1; },\n'
      + ');\n',
      'utf8',
    );
    const result = spawnSync(
      join(ADMIN_ROOT, 'node_modules', '.bin', 'tsx'),
      [wrapper, jobPath, repo.adminRoot, repo.root],
      { cwd: ADMIN_ROOT, encoding: 'utf8', timeout: 120_000 },
    );
    expect(result.error, String(result.error)).toBeUndefined();
    expect(result.status).toBe(EXIT_AWAITING_CONFIRMATION);
    expect(result.stderr).not.toContain('子进程内部错误');

    const view = readStatus(repo.adminRoot);
    expect(view.status?.state).toBe('awaiting_confirmation');
    expect(view.status?.warnings?.length).toBeGreaterThan(0);
    // ① 子进程真的退出了（不是挂着等「继续」）。
    expect(isProcessAlive(view.status!.pid)).toBe(false);
    // ② 锁也释放了（没人管的进程会一直持有它）。
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(view.interrupted).toBe(false);
    // ③ 零写盘：没有任何快照。
    expect(existsSync(paths.snapshotsDir) ? readdirSync(paths.snapshotsDir) : []).toEqual([]);
  }, 150_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 确认绑定内容哈希
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 7：确认绑定 spec 的内容哈希', () => {
  it('哈希不匹配（确认后改了 spec）→ 作废、重新给警告；匹配才继续', async () => {
    const wide = makeSpec({ id: 'gray-hash-wide', name: '宽幅', description: 'B < 128', when: { lt: [{ field: 'b' }, 128] } });
    const hash = specContentHash([wide]);

    // 改了 spec：内容哈希必须变。
    const modified = makeSpec({ id: 'gray-hash-wide', name: '宽幅', description: 'B < 64', when: { lt: [{ field: 'b' }, 64] } });
    expect(specContentHash([modified])).not.toBe(hash);

    // 先跑「旧确认 + 改后的内容」：哈希对不上 → 确认作废、重新停在待确认。
    const stale = await runBatchPipeline(batchJob([modified], { runId: 'run-stale', acceptedSpecHash: hash }), pipelineDeps(repo));
    expect(stale.state).toBe('awaiting_confirmation');
    expect(stale.exitCode).toBe(EXIT_AWAITING_CONFIRMATION);
    expect(stale.conclusion).toContain('不匹配');
    expect(stale.conclusion).toContain('已作废');
    expect(stale.specHash).not.toBe(hash);
    expect(stale.warnings?.length).toBeGreaterThan(0);
    // 零写盘。
    expect(readFileSync(join(repo.root, 'packages/shared/src/badges/gray.ts'), 'utf8')).not.toContain('gray-hash-wide');

    // 带上正确哈希 → 确认生效，继续往下跑完。
    const accepted = await runBatchPipeline(batchJob([modified], { runId: 'run-accepted', acceptedSpecHash: specContentHash([modified]) }), pipelineDeps(repo));
    expect(accepted.state).toBe('succeeded');
    expect(accepted.evidence.join('\n')).toContain('已接受');
    expect(readFileSync(join(repo.root, 'packages/shared/src/badges/gray.ts'), 'utf8')).toContain('gray-hash-wide');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. 「继续」真的接着跑
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 8：「继续」真的接着跑（走完剩余阶段）', () => {
  it('管道层：带正确哈希 → 走完写盘/枚举并成功', async () => {
    const wide = makeSpec({ id: 'gray-cont-wide', name: '宽幅', description: 'B < 128', when: { lt: [{ field: 'b' }, 128] } });
    const calls: string[] = [];
    const outcome = await runBatchPipeline(
      batchJob([wide], { runId: 'run-cont', acceptedSpecHash: specContentHash([wide]) }),
      pipelineDeps(repo, { exec: (cmd, opts) => { calls.push(cmd); return pipelineDeps(repo).exec(cmd, opts); } }),
    );
    expect(outcome.state).toBe('succeeded');
    expect(calls.some(command => command.includes('enumerate'))).toBe(true);
    expect(readFileSync(join(repo.root, 'packages/shared/src/badges/gray.ts'), 'utf8')).toContain('gray-cont-wide');
  });

  it('暂存层：continuePendingBatch 读回待确认作业，带上确认哈希、新起一次运行', async () => {
    const paths = ensureOutDirs(repo.adminRoot);
    const rawSpec = {
      id: 'gray-cont-two',
      name: '继续二',
      description: 'B < 128',
      family: 'gray',
      group: null,
      when: { lt: [{ field: 'b' }, 128] },
    };
    const pendingRun = 'run-pending-two';
    writeFileSync(
      join(paths.jobsDir, `${pendingRun}.json`),
      JSON.stringify({ runId: pendingRun, specs: [rawSpec], logPath: join(paths.logsDir, `${pendingRun}.log`) }),
      'utf8',
    );
    writeStatus(repo.adminRoot, {
      ...makeStatus({
        runId: pendingRun,
        spec: { id: 'gray-cont-two', name: '继续二', family: 'gray', group: null },
        logPath: join(paths.logsDir, `${pendingRun}.log`),
      }),
      state: 'awaiting_confirmation',
      phase: 'done',
      specHash: 'hash-of-pending',
      warnings: [
        { otherId: 'gray-black', scope: 'existing', direction: 'new-subset-of-old', cohits: 1, jaccard: 0.5, message: '警告，不是错误' },
      ],
    });

    const spawned: Array<{ command: string; args: string[] }> = [];
    const result = continuePendingBatch({
      adminRoot: repo.adminRoot,
      root: repo.root,
      spawn: ((command: string, args: string[]) => {
        spawned.push({ command, args });
        return { pid: process.pid, unref: () => {}, on: () => {} };
      }) as never,
      now: () => new Date('2026-10-05T12:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.runId).not.toBe(pendingRun);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args[0]).toContain('addbadge/child.ts');
    const job = JSON.parse(readFileSync(join(paths.jobsDir, `${result.runId}.json`), 'utf8')) as { acceptedSpecHash?: string; spec?: unknown };
    expect(job.acceptedSpecHash).toBe('hash-of-pending');
    expect(job.spec).toEqual(rawSpec);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. 「修改」什么都不发生
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 9：「修改」什么都不发生（文件零改动、无快照）', () => {
  const TOKEN = 'm'.repeat(32);
  let root: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'huedle-badge-modify-'));
    mkdirSync(join(root, 'packages/shared/src/badges'), { recursive: true });
    writeFileSync(join(root, 'packages/shared/src/badges/gray.ts'), '// gray（初始）\n', 'utf8');
    writeFileSync(join(root, 'status.json.txt'), 'do-not-touch\n', 'utf8');
    server = createUiServer({
      initialDays: 30,
      loadReport: async (days): Promise<StatsReport> => sampleReport({ windowDays: days, namesRequested: false, names: [] }),
      badge: { adminRoot: join(root, 'tools/admin'), root, token: TOKEN },
    });
    base = `http://127.0.0.1:${await listenUiServer(server, 0)}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it('POST /badge/modify → 303 回编辑态，仓库与暂存区一个字节都没变、零快照', async () => {
    const before = readFileSync(join(root, 'packages/shared/src/badges/gray.ts'), 'utf8');
    const stagingBefore = readStaging(join(root, 'tools/admin'));

    const res = await fetch(`${base}/badge/modify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: `http://${new URL(base).host}`,
      },
      body: new URLSearchParams({ token: TOKEN, runId: 'run-await-1' }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/badge?modified=1');

    expect(readFileSync(join(root, 'packages/shared/src/badges/gray.ts'), 'utf8')).toBe(before);
    expect(readStaging(join(root, 'tools/admin'))).toEqual(stagingBefore);
    const paths = addBadgePaths(join(root, 'tools/admin'));
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(existsSync(paths.statusFile)).toBe(false);
    expect(existsSync(paths.snapshotsDir) ? readdirSync(paths.snapshotsDir) : []).toEqual([]);
    expect(existsSync(paths.jobsDir) ? readdirSync(paths.jobsDir) : []).toEqual([]);
  });

  it('没有令牌 → 403，同样什么都不发生', async () => {
    const res = await fetch(`${base}/badge/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://${new URL(base).host}` },
      body: new URLSearchParams({ token: 'x'.repeat(32) }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(403);
  });
});
