/**
 * 任务 A：`evalHelpers` 漂移 → 干跑直接 import 家族文件里的**真品**。
 *
 * 覆盖四件事：
 *   1. **漂移不再可能**：作者只能给依赖名字列表，实现永远来自目标家族文件；
 *      旧形状（作者给实现副本）被 `parseBadgeSpec` 直接拒绝。
 *   2. **降级**：import 失败 / 名字不存在（没声明 / 没 export）/ 求值抛异常 → 报错中止。
 *   3. **写盘后自检**：helper 哈希与干跑时不同 → 内部错误中止并回滚。
 *   4. **34 条回归**（最强）：现有引用 private helper 的徽章，各自构造等价 spec 跑干跑，
 *      hits 必须与 `pricing.gen.ts`（枚举用真品算出来的值）**精确相等**。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PRICING, TOTAL_COLORS, allBadges, toColorInfo } from '@huedle/shared';
import {
  BASE_HELPER_NAMES,
  EXTRA_ALLOWED_IDENTIFIERS,
  freeIdentifiers,
  loadFamilyHelpers,
} from '../addbadge/build';
import { analyzeSpec, compileSpec, helperHashMismatches } from '../addbadge/compile';
import { runBatchDryRun, runDryRun } from '../addbadge/dryrun';
import { EXIT_ROLLED_BACK, runPipeline } from '../addbadge/pipeline';
import { SpecError, isHandwritten, parseBadgeSpec } from '../addbadge/spec';
import { REPO_ROOT } from '../addbadge/child';
import { createFakeRepo, pipelineDeps, silenceLogs, type FakeRepo } from './addbadge.fixtures';

const BADGES_DIR = 'packages/shared/src/badges';

const temps: string[] = [];
const repos: FakeRepo[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  temps.length = 0;
  for (const repo of repos) repo.cleanup();
  repos.length = 0;
});

/** 一个最小的临时仓库根：只放目标家族文件（其余路径用不到）。 */
function makeTempRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'huedle-evalhelpers-'));
  temps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

function specForHandwritten(overrides: Record<string, unknown>): ReturnType<typeof parseBadgeSpec> {
  return parseBadgeSpec({
    id: 'casino-eval-probe',
    name: '探测徽章',
    description: '干跑用文件里的真品求值',
    family: 'casino',
    handwritten: { check: 'onRanks(c, counts => ranksAtLeast(counts, 2) >= 1)', evalHelpers: ['onRanks', 'ranksAtLeast'] },
    ...overrides,
  });
}

// ───────────────────── 1. 漂移不再可能：实现只来自文件 ─────────────────────

describe('测试 1：干跑用的是目标家族文件里的实现（没有副本可漂移）', () => {
  it('旧形状「evalHelpers 是 { 名字: 源码 }」被 parseBadgeSpec 直接拒绝', () => {
    expect(() =>
      parseBadgeSpec({
        id: 'casino-old-shape',
        name: '旧形状',
        description: 'd',
        family: 'casino',
        handwritten: { check: 'onRanks(c, counts => true)', evalHelpers: { onRanks: 'color => true' } },
      }),
    ).toThrow(SpecError);
    // 合法的名字数组仍然接受。
    const spec = parseBadgeSpec({
      id: 'casino-new-shape',
      name: '新形状',
      description: 'd',
      family: 'casino',
      handwritten: { check: 'onRanks(c, counts => true)', evalHelpers: ['onRanks'] },
    });
    if (!isHandwritten(spec)) throw new Error('应当是手写 spec');
    expect(spec.handwritten.evalHelpers).toEqual(['onRanks']);
  });

  it('谓词跟着目标文件走：文件里换成「简化副本」，干跑结果随之改变（作者无处注入）', async () => {
    const color = toColorInfo({ r: 0, g: 0, b: 0 }); // hex = #000000

    // 一个「简化副本」式的临时家族文件：ranksAtLeast 恒返回 0（正是演示脚本里发生过的 bug 形态）。
    const simplified = makeTempRoot({
      [`${BADGES_DIR}/casino.ts`]: [
        "import type { ColorInfo } from '../types';",
        'export const onRanks = (color: ColorInfo, test: (counts: number[]) => boolean): boolean => {',
        '  const counts: number[] = new Array<number>(16).fill(0);',
        "  for (const ch of color.hex.slice(1)) counts[parseInt(ch, 16)] += 1;",
        '  return test(counts);',
        '};',
        'export const ranksAtLeast = (): number => 0; // ← 错误的「副本」，证明跑的是文件里这一份',
        'export const casinoBadges: unknown[] = [];',
      ].join('\n'),
    });

    const fromFile = await compileSpec(specForHandwritten({}), simplified);
    const fromReal = await compileSpec(specForHandwritten({}), REPO_ROOT);

    // 真品：#000000 六个字符全同 → 至少一种点数出现 6 次 → 命中。
    expect(fromReal.predicate(color)).toBe(true);
    // 简化副本：干跑老实用文件里那份「错实现」→ 不命中。
    expect(fromFile.predicate(color)).toBe(false);
  });

  it('loadFamilyHelpers 取到的就是模块 export 的同一个函数（同一个对象引用）', async () => {
    const path = join(REPO_ROOT, BADGES_DIR, 'gray.ts');
    const helpers = await loadFamilyHelpers(path, ['spread']);
    const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    expect(helpers.spread).toBe(module.spread);
    expect(typeof helpers.spread).toBe('function');
  });
});

// ───────────────────────────── 2. 降级：报错中止 ─────────────────────────────

describe('测试 2：import 失败 / 名字不存在 / 求值异常 一律报错中止', () => {
  it('import 失败 → SpecError（不静默退回副本）', async () => {
    const root = makeTempRoot({
      [`${BADGES_DIR}/casino.ts`]: "import './does-not-exist';\nexport const casinoBadges: unknown[] = [];\n",
    });
    await expect(compileSpec(specForHandwritten({}), root)).rejects.toThrow(SpecError);
    await expect(compileSpec(specForHandwritten({}), root)).rejects.toThrow(/import/);
  });

  it('名字不存在（文件里没有这个顶层声明）→ SpecError', () => {
    const root = makeTempRoot({
      [`${BADGES_DIR}/casino.ts`]: 'export const onRanks = (): boolean => true;\nexport const casinoBadges: unknown[] = [];\n',
    });
    expect(() => analyzeSpec(specForHandwritten({}), root)).toThrow(SpecError);
    expect(() => analyzeSpec(specForHandwritten({}), root)).toThrow(/ranksAtLeast/);
  });

  it('名字存在但没有 export → import 时 SpecError', async () => {
    const root = makeTempRoot({
      [`${BADGES_DIR}/casino.ts`]: [
        'const onRanks = (_c: unknown, test: (counts: number[]) => boolean): boolean => test([6, 0, 0, 0, 0, 0]);',
        'const ranksAtLeast = (counts: number[], n: number): number => counts.filter(x => x >= n).length;',
        'export const casinoBadges: unknown[] = [];',
      ].join('\n'),
    });
    await expect(compileSpec(specForHandwritten({}), root)).rejects.toThrow(SpecError);
    await expect(compileSpec(specForHandwritten({}), root)).rejects.toThrow(/export/);
  });

  it('真品求值抛异常 → 干跑报异常、中止（hits 不可信，不会写盘）', async () => {
    const root = makeTempRoot({
      [`${BADGES_DIR}/casino.ts`]: 'export const boom = (): boolean => { throw new Error("helper boom"); };\nexport const casinoBadges: unknown[] = [];\n',
    });
    const spec = parseBadgeSpec({
      id: 'casino-boom',
      name: '炸弹',
      description: 'd',
      family: 'casino',
      handwritten: { check: 'boom(c)', evalHelpers: ['boom'] },
    });
    const compiled = await compileSpec(spec, root);
    const result = runDryRun({ check: compiled.predicate, existing: [], total: 64 });
    expect(result.exception?.message).toContain('helper boom');
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

// ───────────────────────── 3. 写盘后 helper 哈希自检 ─────────────────────────

describe('测试 3：写盘后自检 private helper 哈希', () => {
  it('helperHashMismatches：追加徽章不影响 helper；改了 helper 实现就报不一致', async () => {
    const file = `${BADGES_DIR}/gray.ts`;
    const root = makeTempRoot({ [file]: 'export const spread = (c: { r: number }): number => c.r;\n' });
    const spec = parseBadgeSpec({
      id: 'gray-hash-probe',
      name: '哈希探测',
      description: 'd',
      family: 'gray',
      handwritten: { check: 'spread(c) > 0', evalHelpers: ['spread'] },
    });
    const compiled = await compileSpec(spec, root);
    expect(helperHashMismatches(root, 'gray', compiled.helperHashes)).toEqual([]);

    // 文件末尾追加一条徽章（工具的真实行为）：helper 不变 → 仍然一致。
    const full = join(root, file);
    writeFileSync(full, `${readFileSync(full, 'utf8')}export const grayBadges = [];\n`, 'utf8');
    expect(helperHashMismatches(root, 'gray', compiled.helperHashes)).toEqual([]);

    // 改动 helper 实现（守卫本不该允许，构造注入来测自检）→ 报出名字。
    writeFileSync(full, 'export const spread = (c: { r: number }): number => c.r + 1;\n', 'utf8');
    expect(helperHashMismatches(root, 'gray', compiled.helperHashes)).toEqual(['spread']);
  });

  it('管道层：写盘后哈希不一致 → 内部错误中止并回滚（构造注入）', async () => {
    const repo = createFakeRepo();
    repos.push(repo);
    const spec = parseBadgeSpec({
      id: 'gray-selfcheck',
      name: '自检',
      description: 'B = 7',
      family: 'gray',
      when: { eq: [{ field: 'b' }, 7] },
    });
    const restore = silenceLogs();
    let outcome: Awaited<ReturnType<typeof runPipeline>>;
    try {
      outcome = await runPipeline(
        { runId: 'run-helper-drift', spec, logPath: 'log' },
        pipelineDeps(repo, { verifyHelperHashes: () => ['spread'] }),
      );
    } finally {
      restore();
    }
    expect(outcome.exitCode).toBe(EXIT_ROLLED_BACK);
    expect(outcome.state).toBe('rolled_back');
    expect(outcome.failureClass).toBe('helper-drift');
    expect(outcome.conclusion).toContain('private helper');
    // 工作区逐字节复原：新徽章没留下。
    expect(readFileSync(join(repo.root, BADGES_DIR, 'gray.ts'), 'utf8')).not.toContain('gray-selfcheck');
  });
});

// ───────────── 4. 最强回归：34 条私有 helper 徽章 hits 精确相等 ─────────────

/** 家族文件里所有顶层 `const` 声明（= private helper / 常量的名字集合）。 */
function declaredLocals(): Set<string> {
  const names = new Set<string>();
  for (const name of ['gray', 'extreme', 'pure', 'channel', 'math', 'perception', 'pattern', 'culture', 'lucky', 'casino']) {
    const content = readFileSync(join(REPO_ROOT, BADGES_DIR, `${name}.ts`), 'utf8');
    for (const match of content.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/gm)) names.add(match[1]!);
  }
  return names;
}

/**
 * vitest 会把**从别的模块 import 的** helper 转译成命名空间包装
 * （`(0,__vite_ssr_import_0__.maxChannel)(c)`）。生产路径跑在 `tsx` 下没有这层，
 * 这里把它还原回作者写的 `maxChannel(c)`，否则 `freeIdentifiers` 会误报。
 */
function normalizeCheckSource(source: string): string {
  return source.replace(/\(0,\s*__vite_ssr_import_\d+__\.([A-Za-z_$][\w$]*)\)/g, '$1');
}

describe('测试 4：引用 private helper 的既有徽章，干跑 hits 与枚举精确相等', () => {
  const privateNames = declaredLocals();
  const allowed = new Set<string>([...BASE_HELPER_NAMES, ...EXTRA_ALLOWED_IDENTIFIERS, ...privateNames]);

  /** 单表达式、且引用了 private helper 的既有徽章（block body 不属手写路径，排除）。 */
  const cases = allBadges
    .map(badge => {
      const source = normalizeCheckSource(badge.check.toString());
      const identifiers = freeIdentifiers(source);
      const locals = identifiers.filter(name => privateNames.has(name));
      const unknown = identifiers.filter(name => !allowed.has(name));
      return { badge, source, locals, compilable: locals.length > 0 && unknown.length === 0 };
    })
    .filter(item => item.compilable);

  let hitsById = new Map<string, number>();
  let violationsById = new Map<string, string[]>();
  let scanned = 0;

  // 34 条候选放进**一次批量干跑**（一次扫描；单条逐个跑要 34×2²⁴ 次 ColorInfo 分配）。
  // 每条候选仍然各自有独立的 hits / violations，逐条断言。
  beforeAll(async () => {
    const candidates = [];
    for (const item of cases) {
      const spec = parseBadgeSpec({
        id: `${item.badge.id}-eval-regression`,
        name: '回归',
        description: '等价 spec（引用家族文件的 private helper）',
        family: item.badge.family,
        group: item.badge.group ?? null,
        // 用文件里的原生 check 源码；`(source)(c)` 把它接到干跑的单参数 `c` 上，
        // 于是自由标识符（private helper）由 compileSpec 从家族文件 import 真品补齐。
        handwritten: { check: `(${item.source})(c)`, evalHelpers: item.locals },
      });
      const compiled = await compileSpec(spec, REPO_ROOT);
      candidates.push({ id: item.badge.id, group: item.badge.group ?? null, check: compiled.predicate });
    }
    const result = runBatchDryRun({ candidates, existing: [], total: TOTAL_COLORS, sampleLimit: 0 });
    scanned = result.total;
    hitsById = new Map(result.candidates.map(candidate => [candidate.id, candidate.hits]));
    violationsById = new Map(result.candidates.map(candidate => [candidate.id, candidate.violations]));
  }, 900_000);

  it('恰好 34 条（与决策纪要的判据一致）', () => {
    expect(cases.map(item => item.badge.id).sort()).toHaveLength(34);
  });

  it.each(cases.map(item => [item.badge.id] as const))(
    '%s：干跑 hits === pricing.gen.ts',
    id => {
      expect(violationsById.get(id)).toEqual([]);
      const expected = PRICING[id]?.hits;
      expect(expected, `${id} 缺少定价数据`).toBeTypeOf('number');
      expect(scanned).toBe(TOTAL_COLORS);
      expect(hitsById.get(id)).toBe(expected);
    },
  );
});
