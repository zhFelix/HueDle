/**
 * 加徽章测试的共用夹具：一个**临时 git 仓库** + 一组假命令。
 *
 * 为什么不用真实仓库：完整流水线要跑 2²⁴ 干跑 + 两次 enumerate（分钟级），
 * 而且成功路径之外的用例会故意写坏工作区。临时仓库让 12 个失败分支变成秒级可测，
 * 同时**回滚的真实性**仍然是真实的（真 git、真字节、真 `git diff --exit-code`）。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExistingCheck } from '../addbadge/dryrun';
import type { ExecResult, PipelineCommands, PipelineDeps } from '../addbadge/pipeline';

export interface FakeRepo {
  root: string;
  adminRoot: string;
  cleanup: () => void;
}

/** 一个合法的家族文件（结构与真实文件一致：2 空格缩进、末尾 `];`）。 */
export const FAKE_GRAY_TS = `// family: gray — 代表色 #808080
import type { BadgeDef } from '../types';
import { isGray, isPrime } from './helpers';

export const grayBadges: BadgeDef[] = [
  {
    id: 'gray-true-monochrome',
    name: '灰阶行者',
    description: 'R = G = B',
    family: 'gray',
    check: c => c.r === c.g && c.g === c.b,
  },
  {
    id: 'gray-prime',
    name: '灰之质数',
    description: 'R = G = B 且该值是质数',
    family: 'gray',
    check: c => isGray(c) && isPrime(c.r),
  },
];
`;

/** 第二条家族文件：批量「跨文件」用例需要 N 条落在不同家族文件里。 */
export const FAKE_MATH_TS = `// family: math — 数字性质
import type { BadgeDef } from '../types';
import { isPrime } from './helpers';

export const mathBadges: BadgeDef[] = [
  {
    id: 'math-prime-sum',
    name: '质数和',
    description: 'R + G + B 是质数',
    family: 'math',
    check: c => isPrime(c.r + c.g + c.b),
  },
];
`;

/** 第三条家族文件。 */
export const FAKE_PURE_TS = `// family: pure — 纯色
import type { BadgeDef } from '../types';
import { isGray } from './helpers';

export const pureBadges: BadgeDef[] = [
  {
    id: 'pure-grayish',
    name: '近灰',
    description: 'R = G = B',
    family: 'pure',
    check: c => isGray(c),
  },
];
`;

export function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败：${result.stderr || result.stdout}`);
  }
}

export function createFakeRepo(): FakeRepo {
  const root = mkdtempSync(join(tmpdir(), 'huedle-addbadge-'));
  const adminRoot = join(root, 'tools/admin');
  const files: Record<string, string> = {
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n  - 'tools/*'\n",
    'tools/admin/out/.gitignore': '*\n!.gitignore\n',
    'packages/shared/src/badges/gray.ts': FAKE_GRAY_TS,
    'packages/shared/src/badges/math.ts': FAKE_MATH_TS,
    'packages/shared/src/badges/pure.ts': FAKE_PURE_TS,
    'packages/shared/src/pricing.gen.ts': "export const PRICING = {};\n",
    'docs/BADGES.md': '# 徽章总表（初始）\n',
    'docs/research/PRICING-CURRENT.md': '# 定价快照（初始）\n',
    'docs/research/SUPERSESSION-AUDIT.md': '# 取代审计（初始）\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'init']);
  return {
    root,
    adminRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** 假既有徽章：与候选不相交，避免测试被无关的蕴含判定干扰。 */
export function fakeExisting(): ExistingCheck[] {
  return [
    { id: 'gray-bright', group: null, hits: 3_000_000, check: c => c.r > 200 },
    { id: 'gray-black', group: null, hits: 1, check: c => c.r === 0 && c.g === 0 && c.b === 0 },
  ];
}

export interface FakeExecOptions {
  /** 让 enumerate 失败：`'fail'` 普通失败、`'global'` 全局平衡、`'timeout'` 超时、`'nondeterministic'`。 */
  enumerate?: 'ok' | 'fail' | 'global' | 'timeout' | 'nondeterministic';
  typecheck?: 'ok' | 'fail';
  docs?: 'ok' | 'fail' | 'fail-once';
  supersession?: 'ok' | 'fail' | 'dead';
  /** `supersession: 'dead'` 时报告里被标成 100% 被取代的 id。 */
  deadBadgeId?: string;
  test?: 'ok' | 'fail' | 'fail-once' | 'docs-only-fail';
  /** 记录所有执行过的命令。 */
  calls?: string[];
}

/** 假的外部命令：在临时仓库里真的写文件（这样才能验证回滚的字节级效果）。 */
export function createFakeExec(root: string, options: FakeExecOptions = {}): PipelineDeps['exec'] {
  let docsRuns = 0;
  let testRuns = 0;
  let enumerateRuns = 0;
  return (command: string, execOptions?: { timeoutMs?: number }): ExecResult => {
    options.calls?.push(command);
    void execOptions;
    if (command.includes('typecheck')) {
      return options.typecheck === 'fail'
        ? { code: 1, stdout: '', stderr: 'TS2322: 类型不匹配', timedOut: false }
        : { code: 0, stdout: '', stderr: '', timedOut: false };
    }
    if (command.includes('enumerate')) {
      enumerateRuns += 1;
      const mode = options.enumerate ?? 'ok';
      if (mode === 'timeout') return { code: 1, stdout: '', stderr: '', timedOut: true };
      if (mode === 'fail') {
        writeFileSync(join(root, 'packages/shared/src/pricing.gen.ts'), 'export const PRICING = { HALF: true };\n', 'utf8');
        return {
          code: 1,
          stdout: '',
          stderr: 'AssertionError: hits === 0 的徽章（永不命中，违反 PRICING-SPEC 第 7 节第 3 条）: expected [] to deeply equal []',
          timedOut: false,
        };
      }
      if (mode === 'global') {
        writeFileSync(join(root, 'packages/shared/src/pricing.gen.ts'), 'export const PRICING = { GLOBAL: true };\n', 'utf8');
        writeFileSync(join(root, 'docs/research/PRICING-CURRENT.md'), '# 定价快照（全局平衡失败时仍写出）\n', 'utf8');
        return {
          code: 1,
          stdout: '',
          stderr: [
            'AssertionError: expected false to be true // Object.is equality',
            '',
            '    846|       expect(bucketsSelfConsistent).toBe(true);',
            '       |              ^',
            '',
          ].join('\n'),
          timedOut: false,
        };
      }
      const body = mode === 'nondeterministic' ? `export const PRICING = { RUN: ${enumerateRuns} };\n` : 'export const PRICING = { OK: true };\n';
      writeFileSync(join(root, 'packages/shared/src/pricing.gen.ts'), body, 'utf8');
      return { code: 0, stdout: '枚举完成', stderr: '', timedOut: false };
    }
    if (command.includes('supersession')) {
      if (options.supersession === 'fail') return { code: 1, stdout: '', stderr: 'supersession 失败', timedOut: false };
      const report = options.supersession === 'dead'
        ? `# 取代审计\n\n## 1. 结论\n\n- 🚨 **100% 被取代的徽章：1 条**\n\n| id | group | ep | hits |\n|---|---|---:|---:|\n| \`${options.deadBadgeId ?? ''}\` | \`g\` | 1 | 1 |\n\n## 2. 逐组明细\n`
        : '# 取代审计\n\n## 1. 结论\n\n- **100% 被取代的徽章：0 条** ✅\n\n## 2. 逐组明细\n';
      writeFileSync(join(root, 'docs/research/SUPERSESSION-AUDIT.md'), report, 'utf8');
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    }
    if (command.includes('docs')) {
      docsRuns += 1;
      if (options.docs === 'fail' || (options.docs === 'fail-once' && docsRuns === 1)) {
        return { code: 1, stdout: '', stderr: 'docs 失败', timedOut: false };
      }
      writeFileSync(join(root, 'docs/BADGES.md'), `# 徽章总表（第 ${docsRuns} 次生成）\n`, 'utf8');
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    }
    if (command.includes('test')) {
      testRuns += 1;
      if (options.test === 'docs-only-fail' && testRuns === 1) {
        return {
          code: 1,
          stdout: ' ❯ src/badges/__tests__/docs.test.ts (1 test | 1 failed)\n',
          stderr: '',
          timedOut: false,
        };
      }
      if (options.test === 'fail' || (options.test === 'fail-once' && testRuns === 1)) {
        return { code: 1, stdout: ' ❯ src/foo.test.ts (1 test | 1 failed)\n', stderr: '', timedOut: false };
      }
      return { code: 0, stdout: ' ✓ src/foo.test.ts (1 test)\n', stderr: '', timedOut: false };
    }
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
}

export function fakeCommands(): PipelineCommands {
  return {
    typecheck: 'pnpm -C packages/shared run typecheck',
    enumerate: 'pnpm -C packages/shared run enumerate',
    docs: 'pnpm -C packages/shared run docs',
    supersession: 'pnpm -C packages/shared run supersession',
    test: 'pnpm -C packages/shared test',
  };
}

/** 一个能通过干跑的候选徽章（在 4096 色的小色域上 hits=256）。 */
export const SAFE_SPEC_JSON = {
  id: 'gray-test-echo',
  name: '测试回声',
  description: 'R = 0 且 B = 7',
  family: 'gray' as const,
  group: null,
  when: { all: [{ eq: [{ field: 'r' }, 0] }, { eq: [{ field: 'b' }, 7] }] },
};

/** 组装一份可用的 deps（默认：成功路径）。 */
export function pipelineDeps(repo: FakeRepo, overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    root: repo.root,
    adminRoot: repo.adminRoot,
    now: () => new Date('2026-10-04T10:00:00.000Z'),
    exec: createFakeExec(repo.root),
    existingChecks: fakeExisting,
    domainSize: 4096,
    commands: fakeCommands(),
    ...overrides,
  };
}

/** 静音 `console.log`（流水线会打印阶段进度）。返回还原函数。 */
export function silenceLogs(): () => void {
  const original = console.log;
  console.log = () => {};
  return () => {
    console.log = original;
  };
}

export function readFile(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}
