/**
 * 反硬编码守卫：不许再出现「会随徽章表增长而过期的**当前数量**」写法。
 *
 * 背景：徽章总数已经走过 76 → 126 → 128 → 129。每当它增长，全仓库里
 * 「现有 128 条全部有」「当前 128 条里没有」「全部 128 条既有徽章」这类把
 * **当前数量写进文字**的句子就集体过期——而且大多不会让任何测试变红。
 * 项目已确立的正确写法是**指向源头**：`allBadges.length` / `totalCount` /
 * `docs/BADGES.md`（自动生成，`docs.test.ts` 逐字节比对）。
 *
 * 本测试只做一件很窄的事：扫手工维护的文档与源码，命中下列「当前数量」句式就失败。
 * 自然语言无法完全枚举，但它覆盖了实际踩过的那几类。
 *
 * ## 豁免（都是明确的「历史记录」，不是当前状态）
 * - `docs/research/**`、`docs/badges/**`：带日期的审计 / 测量记录，数字是当时实测值；
 * - `docs/resolved/**`：`.gitignore` 忽略的决议归档；
 * - 生成文件：`docs/BADGES.md`、`pricing.gen.ts`、两份 research 生成报告——由生成器同步；
 * - **带显式时间限定的行**（当时 / 原有 / 首批 / 起始 / 审计时 / 规划时）：写了限定词
 *   就是在陈述历史测量而不是当前状态，这正是历史数字该有的写法（见 DESIGN.md §12.1）。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 仓库根目录：本文件在 `packages/shared/src/badges/__tests__/`，
 * 往上五级即根（不依赖全局 `URL`——本包只有最小 Node shim，见 `node-shims.d.ts`）。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const SCAN_DIRS = ['docs', 'apps', 'packages', 'tools'];
const SCAN_FILES = ['README.md'];
const EXTENSIONS = ['.md', '.ts', '.vue'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', '.vite', '.turbo']);
const SKIP_PREFIXES = ['docs/research/', 'docs/badges/', 'docs/resolved/'];
const SKIP_FILES = new Set([
  // 生成文件：数量由生成器写，且就该等于 allBadges.length。
  'docs/BADGES.md',
  'packages/shared/src/pricing.gen.ts',
  // 本文件自身：反例字符串必须写在源码里，跳过自己。
  'packages/shared/src/badges/__tests__/noStaleBadgeCount.test.ts',
]);

/** 「当前数量」句式 → 人类可读的名字。 */
const FORBIDDEN: { id: string; re: RegExp }[] = [
  { id: '现有 N 条', re: /现有\s*\d+\s*条/ },
  { id: '当前 N 条', re: /当前\s*\d+\s*条/ },
  { id: '实测 N 条里', re: /实测\s*\d+\s*条里/ },
  { id: '全部 N 条(既有)徽章', re: /全部\s*\d+\s*条(?:既有)?徽章/ },
  { id: '徽章总数是 **N**', re: /徽章总数是\s*\*\*\d+\*\*/ },
  { id: '现有/当前/全部 N 个家族', re: /(?:现有|当前|全部)\s*\d+\s*个家族/ },
  { id: '还有 N 条', re: /还有\s*\d+\s*条/ },
];

/** 显式时间限定：写了它就是在陈述历史，豁免（这是历史数字的正确写法）。 */
const HISTORICAL = /当时|原有|首批|起始|审计时|规划时/;

function matchedPatterns(line: string): string[] {
  return FORBIDDEN.filter(({ re }) => re.test(line)).map(({ id }) => id);
}

/** 递归列出目录下的目标文件（仓库相对 POSIX 路径）。 */
function listFiles(dir: string, out: string[] = []): string[] {
  const absolute = join(ROOT, dir);
  for (const name of readdirSync(absolute)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      listFiles(rel, out);
      continue;
    }
    if (!EXTENSIONS.some(ext => name.endsWith(ext))) continue;
    if (SKIP_PREFIXES.some(prefix => rel.startsWith(prefix))) continue;
    if (SKIP_FILES.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

function scanSourceFiles(): string[] {
  return [...SCAN_DIRS.flatMap(dir => listFiles(dir)), ...SCAN_FILES];
}

describe('反硬编码：不再写死会过期的徽章数量', () => {
  it('自检：下列句式必须被抓到（否则本测试是假的）', () => {
    const samples = [
      '现有 128 条全部有',
      '当前 128 条里没有',
      '实测 128 条里 70 条',
      '全部 128 条既有徽章',
      '徽章总数是 **128**',
      '现有 10 个家族',
      '让玩家看到「还有 76 条」',
    ];
    for (const sample of samples) {
      expect(matchedPatterns(sample), sample).not.toEqual([]);
    }
  });

  it('自检：带时间限定的历史写法不该被抓到', () => {
    const samples = [
      '当时的 64 条里若没有……',
      '原有 64 条徽章里一个合法的 group 都没有',
      '实际首批做了 76 条徽章',
      '起始 76 条 / 10 家族（当前数量见 BADGES.md）',
      '审计当时的徽章总数为 **128**，不是 76',
      '76 条时 1.0537%、126 条时 0.3797%',
    ];
    for (const sample of samples) {
      expect(matchedPatterns(sample), sample).toEqual([]);
    }
  });

  it('手工维护的文档与源码里没有「当前数量」硬编码', () => {
    const violations: string[] = [];
    for (const file of scanSourceFiles()) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (HISTORICAL.test(line)) return;
        const hits = matchedPatterns(line);
        if (hits.length > 0) {
          violations.push(`${file}:${index + 1} [${hits.join(', ')}] ${line.trim()}`);
        }
      });
    }
    expect(violations, `发现「当前数量」硬编码（改为指向 allBadges.length / docs/BADGES.md）：\n${violations.join('\n')}`).toEqual([]);
  });
});
