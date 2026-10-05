/**
 * 测试 6（回滚真能还原）、测试 7（全局平衡类失败保留现场）、测试 8（脏工作区拒绝开跑），
 * 以及其余失败分支的退出码契约。
 *
 * 全部在**临时 git 仓库**里跑：真 git、真字节、真 `git diff --exit-code`。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBadgeSpec, SpecError } from '../addbadge/spec';
import { affectedPaths } from '../addbadge/families';
import { addBadgePaths } from '../addbadge/state';
import {
  EXIT_DIRTY_WORKTREE,
  EXIT_GLOBAL_BALANCE,
  EXIT_ROLLED_BACK,
  EXIT_ROLLBACK_FAILED,
  classifyEnumerateFailure,
  failingTestFiles,
  findDeadBadge,
  runPipeline,
} from '../addbadge/pipeline';
import { createFakeExec, createFakeRepo, fakeExisting, pipelineDeps, silenceLogs, SAFE_SPEC_JSON, type FakeRepo } from './addbadge.fixtures';

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

const spec = () => parseBadgeSpec(SAFE_SPEC_JSON);
const job = () => ({ runId: 'run-test', spec: spec(), logPath: 'log' });
const rel = (path: string) => join(repo.root, path);

function snapshotBytes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of affectedPaths('gray')) out[path] = readFileSync(rel(path), 'utf8');
  return out;
}

function gitExitCode(args: string[]): number {
  return spawnSync('git', args, { cwd: repo.root, encoding: 'utf8' }).status ?? 1;
}

describe('测试 6：回滚真能还原（枚举失败注入）', () => {
  it('注入 enumerate 失败 → 文件逐字节回到快照，且 git diff --exit-code 通过', async () => {
    const before = snapshotBytes();
    const calls: string[] = [];
    const outcome = await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'fail' }) }));

    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('rolled_back');
    expect(outcome.failureClass).toBe('enumerate-empty');

    // ① 字节级还原
    for (const [path, content] of Object.entries(before)) {
      expect(readFileSync(rel(path), 'utf8'), path).toBe(content);
    }
    // ② git 层面也干净
    expect(gitExitCode(['diff', '--exit-code', '--', ...affectedPaths('gray')])).toBe(0);
    expect(gitExitCode(['status', '--porcelain', '--', ...affectedPaths('gray')])).toBe(0);
    void calls;
  });

  it('「复制回去 + 证明回到绿」：回滚会真的跑一遍 packages/shared test', async () => {
    const calls: string[] = [];
    await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'fail', calls }) }));
    expect(calls.filter(command => command.includes('test')).length).toBeGreaterThan(0);
  });

  it('回滚本身失败（还原后 test 仍红）→ 退出码 4，绝不静默', async () => {
    const outcome = await runPipeline(
      job(),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'fail', test: 'fail' }) }),
    );
    expect(outcome.exitCode).toBe(EXIT_ROLLBACK_FAILED);
    expect(outcome.state).toBe('rollback_failed');
    expect(outcome.conclusion).toContain('人工介入');
  });

  it('typecheck 失败 → 回滚，退出码 2', async () => {
    const before = snapshotBytes();
    const outcome = await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { typecheck: 'fail' }) }));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.failureClass).toBe('typecheck');
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).toBe(before['packages/shared/src/badges/gray.ts']);
  });

  it('enumerate 超时（可能半写）→ 回滚，退出码 2', async () => {
    const before = snapshotBytes();
    const outcome = await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'timeout' }) }));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.failureClass).toBe('enumerate-timeout');
    expect(readFileSync(rel('packages/shared/src/pricing.gen.ts'), 'utf8')).toBe(before['packages/shared/src/pricing.gen.ts']);
  });

  it('幂等性 md5 不一致 → 回滚，退出码 2', async () => {
    const before = snapshotBytes();
    const outcome = await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'nondeterministic' }) }));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.failureClass).toBe('idempotency');
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).toBe(before['packages/shared/src/badges/gray.ts']);
  });

  it('supersession 报「新徽章 100% 被取代」→ 回滚，退出码 2', async () => {
    const outcome = await runPipeline(
      job(),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { supersession: 'dead', deadBadgeId: SAFE_SPEC_JSON.id }) }),
    );
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.failureClass).toBe('supersession-dead');
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).not.toContain(SAFE_SPEC_JSON.id);
  });

  it('只有 docs.test.ts 失败 → 重跑 docs 后再判（不误伤）', async () => {
    const calls: string[] = [];
    const outcome = await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { test: 'docs-only-fail', calls }) }));
    expect(outcome.exitCode).toBe(0);
    expect(calls.filter(command => command.includes('docs')).length).toBeGreaterThanOrEqual(2);
  });

  it('普通 test 失败 → 回滚，退出码 2', async () => {
    const calls: string[] = [];
    const outcome = await runPipeline(job(), pipelineDeps(repo, { exec: createFakeExec(repo.root, { test: 'fail-once', calls }) }));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.failureClass).toBe('test');
  });
});

describe('测试 7：全局平衡类失败 → 保留现场、不自动回滚、退出码 3', () => {
  it('bucketsSelfConsistent 失败：退出码 3，工作区保持脏（不删复核材料）', async () => {
    const before = snapshotBytes();
    const calls: string[] = [];
    const outcome = await runPipeline(
      job(),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { enumerate: 'global', calls }) }),
    );

    expect(outcome.exitCode).toBe(EXIT_GLOBAL_BALANCE);
    expect(outcome.state).toBe('needs_manual');
    expect(outcome.failureClass).toBe('enumerate-global-balance');
    // **没有**回滚：现场保留
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).not.toBe(
      before['packages/shared/src/badges/gray.ts'],
    );
    expect(readFileSync(rel('packages/shared/src/pricing.gen.ts'), 'utf8')).toContain('GLOBAL');
    // 现场仍然是脏的（这正是有信息量的信号）
    expect(gitExitCode(['diff', '--exit-code', '--', ...affectedPaths('gray')])).not.toBe(0);
    // 没有跑 test（那是回滚路径才做的事）
    expect(calls.some(command => command.includes('test'))).toBe(false);
    // 快照被保留，人可以从这里复核
    expect(outcome.snapshotPath).toBeDefined();
    expect(existsSync(outcome.snapshotPath!)).toBe(true);
  });

  it('分类器只认「带 caret 的失败行」，不会被源码框的上下文误判', async () => {
    const frame = [
      'AssertionError: expected [] to deeply equal []',
      '    868|       expect(',
      '    869|         emptyBadges.map(b => b.id),',
      '    870|         \'hits === 0 的徽章（永不命中…）\',',
      '    871|       ).toEqual([]);',
      '       |         ^',
    ].join('\n');
    expect(classifyEnumerateFailure(frame, false)).toBe('enumerate-empty');

    const globalFrame = ['AssertionError: expected false to be true', '    846|       expect(bucketsSelfConsistent).toBe(true);', '       |              ^'].join('\n');
    expect(classifyEnumerateFailure(globalFrame, false)).toBe('enumerate-global-balance');
    expect(classifyEnumerateFailure('...\n    862|       expect(minAtomCount).toBeGreaterThan(0);\n       |                  ^', false)).toBe('enumerate-global-balance');
    expect(classifyEnumerateFailure('随便什么', true)).toBe('enumerate-timeout');
    expect(classifyEnumerateFailure('随便什么', false)).toBe('enumerate');
  });

  it('supersession 报告解析：只看第 1 节，不会把第 2 节的明细当成死徽章', async () => {
    const report = [
      '# 取代审计',
      '## 1. 结论',
      '- **100% 被取代的徽章：0 条** ✅',
      '## 2. 逐组明细',
      '| `casino-pair` | 1 | 2 | 3 |',
    ].join('\n');
    expect(findDeadBadge(report, 'casino-pair')).toBe(false);
    const dead = ['## 1. 结论', '🚨 **100% 被取代的徽章：1 条**', '| `x` | `g` |', '## 2. 逐组明细'].join('\n');
    expect(findDeadBadge(dead, 'x')).toBe(true);
  });

  it('test 失败文件解析（docs-only 归因）', async () => {
    expect(failingTestFiles(' ❯ src/badges/__tests__/docs.test.ts (1 test | 1 failed)')).toEqual([
      'src/badges/__tests__/docs.test.ts',
    ]);
    expect(failingTestFiles(' FAIL  src/foo.test.ts > x\n')).toEqual(['src/foo.test.ts']);
    expect(failingTestFiles(' ✓ src/foo.test.ts (1 test)')).toEqual([]);
  });
});

describe('测试 8：受影响路径有未提交改动 → 默认拒绝开跑', () => {
  it('dirty → 退出码 7，且不写任何东西（含快照）', async () => {
    const gray = rel('packages/shared/src/badges/gray.ts');
    appendFileSync(gray, '\n// 别人未提交的改动\n', 'utf8');
    const dirtyContent = readFileSync(gray, 'utf8');

    const outcome = await runPipeline(job(), pipelineDeps(repo));

    expect(outcome.exitCode).toBe(EXIT_DIRTY_WORKTREE);
    expect(outcome.state).toBe('refused');
    expect(outcome.failureClass).toBe('precondition-dirty');
    expect(outcome.conclusion).toContain('未提交改动');
    // 别人的改动一个字节都没被动过
    expect(readFileSync(gray, 'utf8')).toBe(dirtyContent);
    // 连快照都没建（拒绝发生在写盘/快照之前）
    const snapshotsDir = addBadgePaths(repo.adminRoot).snapshotsDir;
    expect(existsSync(snapshotsDir) ? readdirSync(snapshotsDir) : []).toEqual([]);
  });

  it('脏的只是「不受影响的路径」时不拒绝（不误伤）', async () => {
    mkdirSync(rel('docs'), { recursive: true });
    writeFileSync(rel('docs/UNRELATED.md'), '无关文件\n', 'utf8');
    const outcome = await runPipeline(job(), pipelineDeps(repo));
    expect(outcome.exitCode).toBe(0);
  });
});

describe('干跑失败：工作区零改动、零快照', () => {
  it('hits=0 的候选 → 退出码 2、state=refused、一个字节都没写', async () => {
    const before = snapshotBytes();
    const specZero = parseBadgeSpec({
      id: 'gray-never-hits',
      name: '永不命中',
      description: '永不命中（测试用）',
      family: 'gray',
      when: { all: [{ eq: [{ field: 'r' }, 0] }, { eq: [{ field: 'r' }, 1] }] },
    });
    const outcome = await runPipeline({ runId: 'r0', spec: specZero, logPath: 'log' }, pipelineDeps(repo));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(outcome.failureClass).toBe('dryrun');
    for (const [path, content] of Object.entries(before)) {
      expect(readFileSync(rel(path), 'utf8'), path).toBe(content);
    }
    const snapshotsDir = addBadgePaths(repo.adminRoot).snapshotsDir;
    expect(existsSync(snapshotsDir) ? readdirSync(snapshotsDir) : []).toEqual([]);
  });

  it('与既有徽章必然蕴含的候选 → 干跑拦下（不进入写盘）', async () => {
    const collide = parseBadgeSpec({
      id: 'gray-collide',
      name: '撞车',
      description: '与 gray-black 完全等价',
      family: 'gray',
      when: { all: [{ eq: [{ field: 'r' }, 0] }, { eq: [{ field: 'g' }, 0] }, { eq: [{ field: 'b' }, 0] }] },
    });
    const outcome = await runPipeline({ runId: 'r1', spec: collide, logPath: 'log' }, pipelineDeps(repo));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.failureClass).toBe('dryrun');
    expect(outcome.conclusion).toContain('gray-black');
  });

  it('spec 校验在准备阶段就失败（id 重复）→ 工作区零改动', async () => {
    const duplicate = parseBadgeSpec({
      id: 'gray-prime',
      name: '重复 id',
      description: 'id 与文件里已有徽章重复',
      family: 'gray',
      when: { eq: [{ field: 'r' }, 0] },
    });
    const outcome = await runPipeline({ runId: 'r2', spec: duplicate, logPath: 'log' }, pipelineDeps(repo));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(outcome.conclusion).toContain('已存在');
  });

  it('helper 没 import → 写盘前拒绝（不靠 tsc 在写盘后才发现）', async () => {
    const needsMissingHelper = parseBadgeSpec({
      id: 'gray-missing-helper',
      name: '缺 import',
      description: '用到文件里没 import 的 helper',
      family: 'gray',
      when: { isPalindromeNumber: true },
    });
    const outcome = await runPipeline({ runId: 'r3', spec: needsMissingHelper, logPath: 'log' }, pipelineDeps(repo));
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.conclusion).toContain('isPalindromeNumber');
  });
});

describe('成功路径（阶段全绿）', () => {
  it('退出码 0；新徽章进了文件、定价/文档已重生成、快照被清掉', async () => {
    const outcome = await runPipeline(job(), pipelineDeps(repo));
    expect(outcome.exitCode).toBe(0);
    expect(outcome.state).toBe('succeeded');
    expect(outcome.hits).toBe(16);

    const gray = readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8');
    expect(gray).toContain(`id: '${SAFE_SPEC_JSON.id}',`);
    expect(gray).toContain('check: c => c.r === 0 && c.b === 7,');
    expect(gray.endsWith('];\n')).toBe(true);
    expect(readFileSync(rel('packages/shared/src/pricing.gen.ts'), 'utf8')).toContain('OK');
    expect(readFileSync(rel('docs/BADGES.md'), 'utf8')).toContain('第 1 次生成');
    // 快照在成功后删除（失败时才保留）
    const snapshotsDir = addBadgePaths(repo.adminRoot).snapshotsDir;
    expect(existsSync(snapshotsDir) ? readdirSync(snapshotsDir) : []).toEqual([]);
  });

  it('结论里明确「不自动 commit」，并提醒家族备注文件', async () => {
    const outcome = await runPipeline(job(), pipelineDeps(repo));
    expect(outcome.conclusion).toContain('不自动 commit');
    expect(outcome.conclusion).toContain('docs/badges/');
  });
});

describe('注入式错误也必须走回滚（不能绕过）', () => {
  it('既有徽章列表读取失败 → 干跑阶段失败、零写盘', async () => {
    const outcome = await runPipeline(
      job(),
      pipelineDeps(repo, {
        existingChecks: () => {
          throw new Error('读不到定价数据');
        },
      }),
    );
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('refused');
    expect(readFileSync(rel('packages/shared/src/badges/gray.ts'), 'utf8')).not.toContain(SAFE_SPEC_JSON.id);
  });

  it('SpecError 在准备阶段 → 不会被当成内部错误吞掉', async () => {
    const bad = { ...SAFE_SPEC_JSON, id: 'X-BAD' };
    expect(() => parseBadgeSpec(bad)).toThrow(SpecError);
    void fakeExisting;
  });
});
