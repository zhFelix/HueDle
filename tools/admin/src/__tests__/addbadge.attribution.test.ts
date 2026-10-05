/**
 * 失败归因：现有批量管道**能不能指名到是哪一条 spec 失败的**？
 *
 * 这是树形列表第 ⑦ 条（「失败时只在那一条加 ✕」）的前提。改动前 `pipeline.ts`
 * 只把「哪条」写进给人看的 conclusion 文本，没有结构化字段；本轮补上了
 * `failureAttribution`，并在这里逐类验证归因来源：
 *   - 干跑（逐条检查）→ 唯一自带 violations 的那条；
 *   - tsc（点名写入的家族文件）→ 只涉及一个家族且该家族只有一条时；
 *   - enumerate 断言（输出里出现徽章 id）→ 只有一个新 id 时；
 *   - supersession（点名 id）→ 直接归因；
 *   - **分位平衡类失败 → 整批共同引起，归因不到单条**（这是它的定义）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBatchPipeline, type BatchPipelineJob, type ExecResult, type PipelineDeps } from '../addbadge/pipeline';
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

function makeSpec(overrides: Record<string, unknown>): BadgeSpec {
  return parseBadgeSpec({
    id: 'gray-attr-base',
    name: '归因基准',
    description: 'B = 7',
    family: 'gray',
    group: null,
    when: { eq: [{ field: 'b' }, 7] },
    ...overrides,
  });
}

const batchJob = (specs: BadgeSpec[]): BatchPipelineJob => ({ runId: 'run-attr', specs, logPath: 'log' });

describe('干跑失败：唯一自带 violations 的那条被点名', () => {
  it('三条里只有第二条 hits=0 → 归因到第二条，不是整批', async () => {
    const ok1 = makeSpec({ id: 'gray-attr-ok-1', name: '甲条', description: 'B = 7' });
    const bad = makeSpec({
      id: 'gray-attr-bad-2',
      name: '乙条',
      description: 'B 同时等于 7 和 8',
      when: { all: [{ eq: [{ field: 'b' }, 7] }, { eq: [{ field: 'b' }, 8] }] },
    });
    const ok3 = makeSpec({ id: 'gray-attr-ok-3', name: '丙条', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } });

    const outcome = await runBatchPipeline(batchJob([ok1, bad, ok3]), pipelineDeps(repo));

    expect(outcome.failureClass).toBe('dryrun');
    expect(outcome.failureAttribution).toBeDefined();
    expect(outcome.failureAttribution?.kind).toBe('spec');
    expect(outcome.failureAttribution?.specId).toBe('gray-attr-bad-2');
    expect(outcome.failureAttribution?.reason).toContain('hits === 0');
  });

  it('两条互相蕴含（只有新 vs 新）→ 点名两条，无法单选 → 整批', async () => {
    const a = makeSpec({ id: 'gray-attr-dup-a', name: '重复甲', description: 'B = 7' });
    const b = makeSpec({ id: 'gray-attr-dup-b', name: '重复乙', description: 'B = 7' });
    const outcome = await runBatchPipeline(batchJob([a, b]), pipelineDeps(repo));
    expect(outcome.failureClass).toBe('dryrun');
    expect(outcome.failureAttribution?.kind).toBe('batch');
    expect(outcome.failureAttribution?.specId).toBeUndefined();
  });
});

describe('tsc 失败：按被点名的家族文件归因', () => {
  /** 只把 tsc 换成「输出里点名 math.ts」的假命令，其余沿用真夹具。 */
  function execTypecheckMentions(family: string): PipelineDeps['exec'] {
    const base = createFakeExec(repo.root);
    return (command, options): ExecResult => {
      if (command.includes('typecheck')) {
        return { code: 1, stdout: `packages/shared/src/badges/${family}.ts(12,5): error TS2322: 类型不匹配`, stderr: '', timedOut: false };
      }
      return base(command, options);
    };
  }

  it('只有 math 家族被点名，且批量里 math 只有一条 → 归因到它', async () => {
    const specs = [
      makeSpec({ id: 'gray-tsc-1', name: '灰条', description: 'B = 7' }),
      makeSpec({ id: 'math-tsc-2', name: '数条', description: 'G = 11', family: 'math', when: { eq: [{ field: 'g' }, 11] } }),
    ];
    const outcome = await runBatchPipeline(batchJob(specs), pipelineDeps(repo, { exec: execTypecheckMentions('math') }));
    expect(outcome.failureClass).toBe('typecheck');
    expect(outcome.failureAttribution?.kind).toBe('spec');
    expect(outcome.failureAttribution?.specId).toBe('math-tsc-2');
  });

  it('同家族有两条时指认不唯一 → 整批，不误伤', async () => {
    const specs = [
      makeSpec({ id: 'gray-tsc-3', name: '灰一', description: 'B = 7' }),
      makeSpec({ id: 'gray-tsc-4', name: '灰二', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } }),
    ];
    const outcome = await runBatchPipeline(batchJob(specs), pipelineDeps(repo, { exec: execTypecheckMentions('gray') }));
    expect(outcome.failureAttribution?.kind).toBe('batch');
  });
});

describe('enumerate 失败：全局平衡类绝不归因到单条', () => {
  function execEnumerate(output: string, global: boolean): PipelineDeps['exec'] {
    const base = createFakeExec(repo.root, { enumerate: global ? 'global' : 'fail' });
    return (command, options): ExecResult => {
      if (command.includes('enumerate')) {
        const result = base(command, options);
        return global ? result : { ...result, stdout: output, stderr: output };
      }
      return base(command, options);
    };
  }

  it('分位平衡类（bucketsSelfConsistent）→ kind=batch', async () => {
    const specs = [makeSpec({ id: 'gray-bal-a', name: '平衡甲', description: 'B = 7' })];
    const outcome = await runBatchPipeline(batchJob(specs), pipelineDeps(repo, { exec: execEnumerate('', true) }));
    expect(outcome.failureClass).toBe('enumerate-global-balance');
    expect(outcome.failureAttribution?.kind).toBe('batch');
    expect(outcome.failureAttribution?.reason).toContain('无法归因到单条');
  });

  it('普通 enumerate 失败且输出里只有一个新 id → 归因到它', async () => {
    const specs = [
      makeSpec({ id: 'gray-enum-a', name: '枚举甲', description: 'B = 7' }),
      makeSpec({ id: 'math-enum-b', name: '枚举乙', description: 'G = 11', family: 'math', when: { eq: [{ field: 'g' }, 11] } }),
    ];
    const output = 'AssertionError: 徽章 "gray-enum-a" 缺少定价数据';
    const outcome = await runBatchPipeline(batchJob(specs), pipelineDeps(repo, { exec: execEnumerate(output, false) }));
    expect(outcome.failureClass).toBe('enumerate');
    expect(outcome.failureAttribution?.kind).toBe('spec');
    expect(outcome.failureAttribution?.specId).toBe('gray-enum-a');
  });
});

describe('supersession：点名的 id 直接归因', () => {
  it('批量里任意一条 100% 被取代 → 归因到那一条', async () => {
    const specs = [
      makeSpec({ id: 'gray-super-ok', name: '取代甲', description: 'B = 7' }),
      makeSpec({ id: 'gray-super-dead', name: '取代乙', description: 'B = 13', when: { eq: [{ field: 'b' }, 13] } }),
    ];
    const outcome = await runBatchPipeline(
      batchJob(specs),
      pipelineDeps(repo, { exec: createFakeExec(repo.root, { supersession: 'dead', deadBadgeId: 'gray-super-dead' }) }),
    );
    expect(outcome.failureClass).toBe('supersession-dead');
    expect(outcome.failureAttribution?.kind).toBe('spec');
    expect(outcome.failureAttribution?.specId).toBe('gray-super-dead');
  });
});
