/**
 * 批量加徽章（一次提交 N 条，整批一个事务）的测试。
 *
 * 覆盖任务书要求的 7 类：
 *   1. **新 vs 新的必然蕴含被拦**（本任务核心新逻辑）；
 *   2. 同组豁免仍然生效；
 *   3. 全有或全无（第 2 条触发的失败 → 三条都没落地、所有文件逐字节复原）；
 *   4. 跨文件批量（3 条落在不同家族文件，回滚覆盖全部）；
 *   5. **整批只跑一次枚举**（enumerate 调用次数与 N 无关）；
 *   6. supersession 里任意一条 100% 被取代 → 整批回滚；
 *   7. 单条路径（现有行为）与 `runBatchPipeline([单条])` 逐字节一致。
 *
 * 全部在临时 git 仓库里跑（真 git、真字节、真 `git diff --exit-code`）。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { affectedPaths } from '../addbadge/families';
import { addBadgePaths } from '../addbadge/state';
import { parseAdminArgs } from '../argv';
import { buildSpecFromArgs } from '../addbadge/commands';
import { makeBatchRunId, submitBadgeBatchJob, type SpawnedChild } from '../addbadge/submit';
import { EXIT_AWAITING_CONFIRMATION, EXIT_LOCKED, EXIT_ROLLED_BACK, runBatchPipeline, runPipeline, type BatchPipelineJob } from '../addbadge/pipeline';
import { parseBadgeSpec, type BadgeSpec } from '../addbadge/spec';
import { createFakeExec, createFakeRepo, pipelineDeps, silenceLogs, type FakeRepo } from './addbadge.fixtures';

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

const rel = (path: string): string => join(repo.root, path);

/** 装配一条结构化 spec（默认 `b === 7`，在 4096 色域上 hits=16）。 */
function makeSpec(overrides: Record<string, unknown>): BadgeSpec {
  return parseBadgeSpec({
    id: 'gray-batch-base',
    name: '批量基准',
    description: 'B = 7',
    family: 'gray',
    group: null,
    when: { eq: [{ field: 'b' }, 7] },
    ...overrides,
  });
}

function batchJob(specs: BadgeSpec[], runId = 'run-batch'): BatchPipelineJob {
  return { runId, specs, logPath: 'log' };
}

/** 记录一批文件的逐字节内容（用于「零写盘 / 已复原」断言）。 */
function capture(root: string, paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) out[path] = readFileSync(join(root, path), 'utf8');
  return out;
}

function expectUnchanged(root: string, before: Record<string, string>): void {
  for (const [path, content] of Object.entries(before)) {
    expect(readFileSync(join(root, path), 'utf8'), path).toBe(content);
  }
}

const SNAPSHOT_DIR = (): string => addBadgePaths(repo.adminRoot).snapshotsDir;
const snapshotCount = (): number => (existsSync(SNAPSHOT_DIR()) ? readdirSync(SNAPSHOT_DIR()).length : 0);

// ─────────────────────────────────────────────────────────────────────────────
// 1. 新 vs 新：两条互相蕴含的新徽章 → 干跑拦下、零写盘
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 1：新 vs 新的必然蕴含被拦（核心新逻辑）', () => {
  it('两条完全等价、group 不同 → 干跑拒绝，一个字节都没写、零快照', () => {
    // 两条规则的命中集合完全相同（都等价），且不在同一个 group 里。
    const a = makeSpec({ id: 'gray-batch-a', name: '批量甲', description: 'B = 7' });
    const b = makeSpec({ id: 'gray-batch-b', name: '批量乙', description: 'B = 7' });
    const before = capture(repo.root, affectedPaths('gray'));

    const outcome = runBatchPipeline(batchJob([a, b]), pipelineDeps(repo));

    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(outcome.failureClass).toBe('dryrun');
    // 点名两条新徽章，并说清后果（双倍计分）
    expect(outcome.conclusion).toContain('gray-batch-a');
    expect(outcome.conclusion).toContain('gray-batch-b');
    expect(outcome.conclusion).toContain('双倍计分');
    // 一次扫描就发现了这处「新 vs 新」蕴含
    expect(outcome.evidence.join('\n')).toContain('新 vs 新必然蕴含 1 处');
    // 零写盘 + 零快照
    expectUnchanged(repo.root, before);
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).not.toContain('gray-batch-a');
    expect(snapshotCount()).toBe(0);
  });

  it('A ⊂ B（一条是另一条的子集）→ 只算警告：停在【待确认】，不是失败', () => {
    // `b === 7` 命中集合 ⊂ `b < 128` 命中集合，且 group 不同。
    const narrow = makeSpec({ id: 'gray-batch-narrow', name: '窄规则', description: 'B = 7' });
    const wide = makeSpec({ id: 'gray-batch-wide', name: '宽规则', description: 'B < 128', when: { lt: [{ field: 'b' }, 128] } });
    const outcome = runBatchPipeline(batchJob([narrow, wide]), pipelineDeps(repo));
    // 单向蕴含不再拒绝：状态是待确认（不是 refused），退出码是专用码 9。
    expect(outcome.exitCode).toBe(EXIT_AWAITING_CONFIRMATION);
    expect(outcome.state).toBe('awaiting_confirmation');
    expect(outcome.failureClass).toBe('dryrun-warnings');
    expect(outcome.conclusion).toContain('gray-batch-narrow');
    expect(outcome.conclusion).toContain('gray-batch-wide');
    expect(outcome.conclusion).toContain('这不是失败');
    expect(outcome.warnings?.some(item => item.scope === 'new')).toBe(true);
    expect(outcome.warnings?.length).toBeGreaterThanOrEqual(1);
    expect(outcome.specHash).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 同组豁免
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 2：同 group 的互相蕴含是允许的（阶梯规则）', () => {
  it('两条等价但 group 相同 → 干跑通过、全部落地', () => {
    const a = makeSpec({ id: 'gray-ladder-5', name: '阶梯五', description: 'B = 7', group: 'batch-ladder' });
    const b = makeSpec({ id: 'gray-ladder-9', name: '阶梯九', description: 'B = 7', group: 'batch-ladder' });

    const outcome = runBatchPipeline(batchJob([a, b]), pipelineDeps(repo));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.state).toBe('succeeded');
    const gray = readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8');
    expect(gray).toContain("id: 'gray-ladder-5',");
    expect(gray).toContain("id: 'gray-ladder-9',");
    // 同组豁免在证据里被显式记出（pairwise 1 处，allowed 1 处）
    expect(outcome.evidence.join('\n')).toContain('同组豁免 1 处');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 全有或全无
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 3：全有或全无（一个事务）', () => {
  it('第 2 条 hits=0 → 三条都没落地，所有受影响文件逐字节复原', () => {
    const ok1 = makeSpec({ id: 'gray-ok-1', name: '甲条', description: 'B = 7' });
    const bad = makeSpec({
      id: 'gray-bad-2',
      name: '乙条',
      description: 'B 同时等于 7 和 8（永不命中）',
      when: { all: [{ eq: [{ field: 'b' }, 7] }, { eq: [{ field: 'b' }, 8] }] },
    });
    const ok3 = makeSpec({ id: 'gray-ok-3', name: '丙条', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } });
    const before = capture(repo.root, affectedPaths('gray'));

    const outcome = runBatchPipeline(batchJob([ok1, bad, ok3]), pipelineDeps(repo));

    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(outcome.failureClass).toBe('dryrun');
    expect(outcome.conclusion).toContain('gray-bad-2');
    // 三条都没落地
    const gray = readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8');
    for (const id of ['gray-ok-1', 'gray-bad-2', 'gray-ok-3']) expect(gray).not.toContain(id);
    // 所有文件 md5 复原（逐字节）
    expectUnchanged(repo.root, before);
    expect(snapshotCount()).toBe(0);
  });

  it('三条都合法但写盘后 typecheck 失败 → 三条一起回滚、逐字节复原', () => {
    const specs = [
      makeSpec({ id: 'gray-roll-1', name: '回滚一', description: 'B = 7' }),
      makeSpec({ id: 'gray-roll-2', name: '回滚二', description: 'B = 11', when: { eq: [{ field: 'b' }, 11] } }),
      makeSpec({ id: 'gray-roll-3', name: '回滚三', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } }),
    ];
    const before = capture(repo.root, affectedPaths('gray'));

    const outcome = runBatchPipeline(
      batchJob(specs),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { typecheck: 'fail' }) }),
    );

    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('rolled_back');
    expect(outcome.failureClass).toBe('typecheck');
    const gray = readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8');
    for (const spec of specs) expect(gray).not.toContain(spec.id);
    expectUnchanged(repo.root, before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 跨文件批量
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 4：跨文件批量（3 条落在不同家族文件）', () => {
  const crossSpecs = (): BadgeSpec[] => [
    makeSpec({ id: 'gray-cross-1', name: '跨文件灰', description: 'B = 7' }),
    makeSpec({ id: 'math-cross-2', name: '跨文件数', description: 'G = 11', family: 'math', when: { eq: [{ field: 'g' }, 11] } }),
    makeSpec({ id: 'pure-cross-3', name: '跨文件纯', description: 'B = 13', family: 'pure', when: { eq: [{ field: 'b' }, 13] } }),
  ];

  it('三条分别落到 gray/math/pure.ts，一次流水线全部成功', () => {
    const outcome = runBatchPipeline(batchJob(crossSpecs()), pipelineDeps(repo));
    expect(outcome.exitCode).toBe(0);
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).toContain("id: 'gray-cross-1',");
    expect(readFileSync(rel('packages/shared/src/badges/math.ts'), 'utf8')).toContain("id: 'math-cross-2',");
    expect(readFileSync(rel('packages/shared/src/badges/pure.ts'), 'utf8')).toContain("id: 'pure-cross-3',");
    expect(outcome.hitsBySpec?.map(item => item.id)).toEqual(['gray-cross-1', 'math-cross-2', 'pure-cross-3']);
  });

  it('enumerate 失败 → 三个家族文件全部回滚、逐字节复原', () => {
    const before = capture(repo.root, [
      ...affectedPaths('gray'),
      ...affectedPaths('math'),
      ...affectedPaths('pure'),
    ]);
    const outcome = runBatchPipeline(
      batchJob(crossSpecs()),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'fail' }) }),
    );
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('rolled_back');
    expectUnchanged(repo.root, before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 只跑一次枚举
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 5：enumerate 对整批只跑一次（性能目标）', () => {
  const countEnumerate = (calls: string[]): number => calls.filter(command => command.includes('enumerate')).length;

  it('批量 3 条的 enumerate 调用次数 === 单条，且不随 N 增长', () => {
    // 两次运行各自用**全新的临时仓库**：上一次成功会留下未提交改动，同仓库再跑会被
    // 脏工作区检查（exit 7）拒绝——那是另一条安全性质，不该干扰这条性能断言。
    const singleRepo = createFakeRepo();
    const singleCalls: string[] = [];
    try {
      const single = runBatchPipeline(
        batchJob([makeSpec({ id: 'gray-count-1', name: '计数一', description: 'B = 7' })]),
        pipelineDeps(singleRepo, { exec: createFakeExec(singleRepo.root, { calls: singleCalls }) }),
      );
      expect(single.exitCode).toBe(0);
    } finally {
      singleRepo.cleanup();
    }

    const batchRepo = createFakeRepo();
    const batchCalls: string[] = [];
    try {
      const batch = runBatchPipeline(
        batchJob([
          makeSpec({ id: 'gray-count-a', name: '计数甲', description: 'B = 7' }),
          makeSpec({ id: 'gray-count-b', name: '计数乙', description: 'B = 11', when: { eq: [{ field: 'b' }, 11] } }),
          makeSpec({ id: 'gray-count-c', name: '计数丙', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } }),
        ]),
        pipelineDeps(batchRepo, { exec: createFakeExec(batchRepo.root, { calls: batchCalls }) }),
      );
      expect(batch.exitCode).toBe(0);
    } finally {
      batchRepo.cleanup();
    }

    // 2 次 = 一次主 enumerate + 一次 md5 幂等复跑；关键：**与批量条数无关**（不是 3 次/6 次）。
    expect(countEnumerate(singleCalls)).toBe(2);
    expect(countEnumerate(batchCalls)).toBe(2);
    expect(countEnumerate(batchCalls)).toBe(countEnumerate(singleCalls));
    // 其余阶段同样只跑一次整批
    const countCommand = (calls: string[], needle: string): number => calls.filter(command => command.includes(needle)).length;
    expect(countCommand(batchCalls, 'typecheck')).toBe(1);
    expect(countCommand(batchCalls, 'supersession')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. supersession：任意一条被 100% 取代 → 整批回滚
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 6：supersession 里任意一条 100% 被取代 → 整批回滚', () => {
  it('第 2 条是死徽章 → 退出码 2、三条全部回滚、点名死徽章', () => {
    const specs = [
      makeSpec({ id: 'gray-sup-1', name: '取代一', description: 'B = 7' }),
      makeSpec({ id: 'gray-sup-2', name: '取代二', description: 'B = 11', when: { eq: [{ field: 'b' }, 11] } }),
      makeSpec({ id: 'gray-sup-3', name: '取代三', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } }),
    ];
    const before = capture(repo.root, affectedPaths('gray'));

    const outcome = runBatchPipeline(
      batchJob(specs),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { supersession: 'dead', deadBadgeId: 'gray-sup-2' }) }),
    );

    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('rolled_back');
    expect(outcome.failureClass).toBe('supersession-dead');
    expect(outcome.conclusion).toContain('gray-sup-2');
    const gray = readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8');
    for (const spec of specs) expect(gray).not.toContain(spec.id);
    expectUnchanged(repo.root, before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 单条路径逐字节不变
// ─────────────────────────────────────────────────────────────────────────────

describe('批量测试 7：单条路径（现有行为）不被批量改变', () => {
  it('runPipeline(spec) 与 runBatchPipeline([spec]) 的结果与文件字节完全一致', () => {
    const specJson = {
      id: 'gray-single-echo',
      name: '单条回声',
      description: 'B = 7',
      family: 'gray' as const,
      group: null,
      when: { eq: [{ field: 'b' }, 7] },
    };

    const singleRepo = createFakeRepo();
    try {
      const single = runPipeline(
        { runId: 'run-same', spec: parseBadgeSpec(specJson), logPath: 'log' },
        pipelineDeps(singleRepo),
      );
      const batchRepo = createFakeRepo();
      try {
        const batch = runBatchPipeline(
          { runId: 'run-same', specs: [parseBadgeSpec(specJson)], logPath: 'log' },
          pipelineDeps(batchRepo),
        );
        expect(batch.exitCode).toBe(single.exitCode);
        expect(batch.state).toBe(single.state);
        expect(batch.hits).toBe(single.hits);
        expect(batch.conclusion).toBe(single.conclusion);
        expect(readFileSync(join(batchRepo.root, 'packages/shared/src/badges/gray.ts'), 'utf8'))
          .toBe(readFileSync(join(singleRepo.root, 'packages/shared/src/badges/gray.ts'), 'utf8'));
      } finally {
        batchRepo.cleanup();
      }
    } finally {
      singleRepo.cleanup();
    }
  });

  it('批量内部 id 重复 → 写盘前拒绝，零写盘', () => {
    const a = makeSpec({ id: 'gray-dup', name: '重一条', description: 'B = 7' });
    const b = makeSpec({ id: 'gray-dup', name: '重二条', description: 'B = 13' });
    const before = capture(repo.root, affectedPaths('gray'));
    const outcome = runBatchPipeline(batchJob([a, b]), pipelineDeps(repo));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(outcome.conclusion).toContain('gray-dup');
    expectUnchanged(repo.root, before);
    expect(snapshotCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 附：CLI 接口形态（--spec 数组 = 批量）与批量提交的作业文件/锁
// ─────────────────────────────────────────────────────────────────────────────

describe('批量接口：--spec 文件内容是数组即批量', () => {
  const rawA = { id: 'gray-spec-a', name: '规格甲', description: 'B = 7', family: 'gray', when: { eq: [{ field: 'b' }, 7] } };
  const rawB = { id: 'math-spec-b', name: '规格乙', description: 'G = 11', family: 'math', when: { eq: [{ field: 'g' }, 11] } };

  it('数组 → kind=batch，逐条 parse；对象 → kind=single（旧行为）', () => {
    const batchPath = join(repo.root, 'badges.json');
    writeFileSync(batchPath, JSON.stringify([rawA, rawB]), 'utf8');
    const batchArgs = parseAdminArgs(['add-badge', '--spec', batchPath]);
    const built = buildSpecFromArgs(batchArgs as never);
    expect(built.kind).toBe('batch');
    if (built.kind !== 'batch') throw new Error('unreachable');
    expect(built.specs.map(spec => spec.id)).toEqual(['gray-spec-a', 'math-spec-b']);
    expect(built.rawSpecs).toEqual([rawA, rawB]);

    const singlePath = join(repo.root, 'one.json');
    writeFileSync(singlePath, JSON.stringify(rawA), 'utf8');
    const single = buildSpecFromArgs(parseAdminArgs(['add-badge', '--spec', singlePath]) as never);
    expect(single.kind).toBe('single');
  });

  it('空数组被拒绝（批量至少要有一条）', () => {
    const emptyPath = join(repo.root, 'empty.json');
    writeFileSync(emptyPath, '[]', 'utf8');
    expect(() => buildSpecFromArgs(parseAdminArgs(['add-badge', '--spec', emptyPath]) as never)).toThrow(/空/);
  });
});

describe('批量提交：作业文件存原始数组、并发仍被锁拒绝', () => {
  function fakeSpawn(pid = process.pid): (command: string, args: string[]) => SpawnedChild {
    return () => ({ pid, unref: () => {}, on: () => {} });
  }

  it('submits specs 数组，子进程能逐条重新 parse；第二次提交被 exit 6 拒绝', () => {
    const rawSpecs = [
      { id: 'gray-job-a', name: '作业甲', description: 'B = 7', family: 'gray', when: { eq: [{ field: 'b' }, 7] } },
      { id: 'math-job-b', name: '作业乙', description: 'G = 11', family: 'math', when: { eq: [{ field: 'g' }, 11] } },
    ];
    const specs = rawSpecs.map(raw => parseBadgeSpec(raw));
    const now = new Date('2026-10-04T10:00:00.000Z');
    const runId = makeBatchRunId(specs, now);
    const base = {
      rawSpecs,
      specs,
      root: repo.root,
      adminRoot: repo.adminRoot,
      logPath: join(repo.adminRoot, 'out/addbadge/logs/batch.log'),
    };

    const first = submitBadgeBatchJob({ ...base, runId, spawn: fakeSpawn() as never });
    expect(first.ok).toBe(true);

    const jobFile = JSON.parse(readFileSync(join(addBadgePaths(repo.adminRoot).jobsDir, `${runId}.json`), 'utf8')) as {
      specs: unknown[];
    };
    expect(jobFile.specs).toEqual(rawSpecs);
    expect(jobFile.specs.map(raw => parseBadgeSpec(raw).id)).toEqual(['gray-job-a', 'math-job-b']);

    const second = submitBadgeBatchJob({ ...base, runId: `${runId}-2`, spawn: fakeSpawn() as never });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.exitCode).toBe(EXIT_LOCKED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 附：批量不能放松既有安全性质
// ─────────────────────────────────────────────────────────────────────────────

describe('批量安全性质：全局平衡保留现场 / 脏工作区拒绝开跑', () => {
  it('enumerate 全局平衡类失败 → 退出码 3、**保留现场**（不自动回滚整批）', () => {
    const specs = [
      makeSpec({ id: 'gray-bal-1', name: '平衡一', description: 'B = 7' }),
      makeSpec({ id: 'gray-bal-2', name: '平衡二', description: 'B = 11', when: { eq: [{ field: 'b' }, 11] } }),
      makeSpec({ id: 'gray-bal-3', name: '平衡三', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } }),
    ];
    const outcome = runBatchPipeline(
      batchJob(specs),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'global' }) }),
    );
    expect(outcome.exitCode).toBe(3);
    expect(outcome.state).toBe('needs_manual');
    expect(outcome.failureClass).toBe('enumerate-global-balance');
    // 现场保留：三条都还在文件里（供人工复核，绝不自动回滚）
    const gray = readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8');
    for (const spec of specs) expect(gray).toContain(spec.id);
    expect(outcome.snapshotPath).toBeDefined();
  });

  it('受影响路径有未提交改动 → 退出码 7、零写盘、零快照', () => {
    const grayPath = rel('packages/shared/src/badges/gray.ts');
    const dirtyContent = `${readFileSync(grayPath, 'utf8')}\n// 别人未提交的改动\n`;
    writeFileSync(grayPath, dirtyContent, 'utf8');

    const outcome = runBatchPipeline(
      batchJob([
        makeSpec({ id: 'gray-dirty-1', name: '脏一', description: 'B = 7' }),
        makeSpec({ id: 'gray-dirty-2', name: '脏二', description: 'B = 11', when: { eq: [{ field: 'b' }, 11] } }),
      ]),
      pipelineDeps(repo),
    );
    expect(outcome.exitCode).toBe(7);
    expect(outcome.state).toBe('refused');
    expect(outcome.failureClass).toBe('precondition-dirty');
    // 别人的改动一个字节都没被碰
    expect(readFileSync(grayPath, 'utf8')).toBe(dirtyContent);
    expect(snapshotCount()).toBe(0);
  });
});

describe('批量干跑：扫描中途异常的候选不参与新 vs 新判定（部分 hits 不可用）', () => {
  it('两条同规则候选，其中一条抛异常 → 只报它自己的异常，不产生假的 pairwise 蕴含', async () => {
    const { runBatchDryRun } = await import('../addbadge/dryrun');
    const throwing = (c: { b: number }): boolean => {
      if (c.b === 5) throw new Error('boom');
      return false;
    };
    const result = runBatchDryRun({
      candidates: [
        { id: 'cand-throws', group: null, check: throwing },
        { id: 'cand-fine', group: null, check: () => false },
      ],
      existing: [],
      total: 4096,
    });
    expect(result.candidates[0]!.exception?.message).toBe('boom');
    expect(result.violations.join('\n')).toContain('抛异常');
    expect(result.pairwise).toEqual([]);
  });
});
