/**
 * 家族文件的**只读读取**（docs/ADMIN.md §4.1 的 `families.ts`）。
 *
 * 这里刻意**不做 TS 解析**：`typescript@7.0.2` 是原生端口，进程内没有编译器 API
 * （docs/ADMIN.md F7，已实测 `createSourceFile === undefined`）。所以：
 *   - 读 id / name / import / 缩进模板一律用**字符串操作**，且只读；
 *   - 真正的语法与类型校验交给写盘之后的 `tsc --noEmit`（它在 enumerate 之前）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Family } from '@huedle/shared';
import { FAMILIES, SpecError } from './spec';

/** `packages/shared/src/badges` 相对仓库根的路径。 */
export const BADGES_DIR = 'packages/shared/src/badges';

/** 本工具会改动/读取的**全部**受影响路径（`docs/ADMIN.md` S1.1）。 */
export function affectedPaths(family: Family): string[] {
  return [
    `${BADGES_DIR}/${family}.ts`,
    'packages/shared/src/pricing.gen.ts',
    'docs/research/PRICING-CURRENT.md',
    'docs/BADGES.md',
    'docs/research/SUPERSESSION-AUDIT.md',
  ];
}

/**
 * 多条徽章（批量）的**全部**受影响路径：逐个家族的 {@link affectedPaths} 取并集。
 *
 * 批量时 N 条可能落在不同家族文件里，快照与回滚必须覆盖全部受影响文件。
 * 对单一家族调用时返回值与 {@link affectedPaths} 完全一致（顺序也一致）。
 */
export function affectedPathsFor(families: readonly Family[]): string[] {
  const out: string[] = [];
  for (const family of families) {
    for (const path of affectedPaths(family)) {
      if (!out.includes(path)) out.push(path);
    }
  }
  return out;
}

export function familyFilePath(root: string, family: Family): string {
  return join(root, BADGES_DIR, `${family}.ts`);
}

export function readFamilyFile(root: string, family: Family): { path: string; content: string } {
  const path = familyFilePath(root, family);
  if (!existsSync(path)) {
    throw new SpecError(`家族文件不存在：${path}`, 'family');
  }
  return { path, content: readFileSync(path, 'utf8') };
}

/** 一条既有徽章的「静态」信息（不含 `check` 函数）。 */
export interface ExistingBadge {
  id: string;
  name: string;
  family: string;
  group: string | null;
}

const ID_LINE = /^\s*id:\s*'([^']+)'/gm;
const NAME_LINE = /^\s*name:\s*'([^']*)'/gm;
const GROUP_LINE = /^\s*group:\s*'([^']+)'/gm;

/** 逐家族文件扫出所有既有徽章（只读，字符串级，够用且不依赖 TS 解析器）。 */
export function listExistingBadges(root: string): ExistingBadge[] {
  const out: ExistingBadge[] = [];
  for (const family of FAMILIES) {
    const path = familyFilePath(root, family);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    // 以 `id:` 行为主键，就近取同一个对象里的 name / group。
    const objects = content.split(/\n\s*\{\n/).slice(1);
    for (const chunk of objects) {
      const id = ID_LINE.exec(chunk)?.[1];
      ID_LINE.lastIndex = 0;
      if (!id) continue;
      const name = NAME_LINE.exec(chunk)?.[1] ?? '';
      NAME_LINE.lastIndex = 0;
      const group = GROUP_LINE.exec(chunk)?.[1] ?? null;
      GROUP_LINE.lastIndex = 0;
      out.push({ id, name, family, group });
    }
  }
  return out;
}

/** 全局唯一的 id 校验（扫描全部家族文件，而不是只看当前家族）。 */
export function assertIdUnique(root: string, id: string): void {
  const clash = listExistingBadges(root).find(badge => badge.id === id);
  if (clash) {
    throw new SpecError(`id "${id}" 已存在于 ${clash.family}.ts（同名徽章：${clash.name}）`, 'id');
  }
}

/** 同家族内 name 不得重复（跨家族允许）。 */
export function assertNameUniqueInFamily(root: string, family: Family, name: string): void {
  const clash = listExistingBadges(root).find(badge => badge.family === family && badge.name === name);
  if (clash) {
    throw new SpecError(`family "${family}" 里已存在同名徽章 "${name}"（id: ${clash.id}）`, 'name');
  }
}

/** 目标文件里 `export const <family>Badges: BadgeDef[] = [` 这一行的数组名（只用于报错信息）。 */
export function arrayVarName(family: Family): string {
  return `${family}Badges`;
}

/**
 * 取「数组末尾插入点」：文件里 `\n];\n` 必须**恰好出现一次**，
 * 否则拒绝（不猜测、不用正则去修格式，docs/ADMIN.md §3.2(d)）。
 */
export function findArrayAnchor(content: string): number {
  const needle = '\n];\n';
  const first = content.indexOf(needle);
  if (first < 0) {
    throw new SpecError('目标文件里找不到数组结束标记 "\\n];\\n"（格式与预期不符，拒绝猜测）', 'insert');
  }
  if (content.indexOf(needle, first + 1) >= 0) {
    throw new SpecError('目标文件里 "\\n];\\n" 出现了多次，无法确定唯一插入点（拒绝猜测）', 'insert');
  }
  return first;
}

/**
 * 末尾元素的缩进模板（F6：每个家族文件里恰好有一条 4 空格缩进，其余 2 空格）。
 *
 * 规则：取**插入点之前最后一个对象字面量**的前导空白。硬编码 2 空格会在
 * 「末元素恰好是那条 4 空格」时制造新的不一致。
 */
export function lastElementIndent(content: string, anchor: number): string {
  const before = content.slice(0, anchor);
  const matches = [...before.matchAll(/\n([ \t]*)\{\n/g)];
  const last = matches[matches.length - 1];
  if (!last) {
    throw new SpecError('无法从目标文件里提取「末元素缩进模板」（找不到对象字面量）', 'insert');
  }
  return last[1]!;
}

/** 目标文件从 `./helpers` import 了哪些名字（用于「生成的源码用到的 helper 必须先 import」）。 */
export function importedHelperNames(content: string): string[] {
  const match = /import\s*\{([^}]*)\}\s*from\s*'\.\/helpers'/.exec(content);
  if (!match) return [];
  return match[1]!
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

/** 目标文件里是否存在 `const <name> =` 这样的顶层声明（手写路径引用 private helper 时用）。 */
export function hasLocalDeclaration(content: string, name: string): boolean {
  const pattern = new RegExp(`^\\s*const\\s+${escapeRegExp(name)}\\s*[:=]`, 'm');
  return pattern.test(content);
}

/** 抽出某个 `const <name> = …;` 声明的源码文本（用于「干跑副本 vs 文件」的漂移提示）。 */
export function extractLocalDeclaration(content: string, name: string): string | undefined {
  const pattern = new RegExp(`^([ \\t]*)const\\s+${escapeRegExp(name)}\\s*[:=]`, 'm');
  const match = pattern.exec(content);
  if (!match) return undefined;
  const start = match.index;
  // 从 start 起做一次括号/引号平衡扫描，找到声明结尾的 `;`。
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < content.length; i += 1) {
    const ch = content[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === ';' && depth <= 0) return content.slice(start, i + 1);
  }
  return content.slice(start);
}

/** 所有家族文件的路径（供只读扫描使用）。 */
export function allFamilyFiles(root: string): string[] {
  const dir = join(root, BADGES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts'))
    .map(name => join(dir, name));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
