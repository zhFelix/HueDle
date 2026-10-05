/**
 * 徽章**源码指纹**（source fingerprint）——用来发现「改了 `check` 但没重跑枚举」。
 *
 * ## 为什么需要它
 *
 * `pricing.gen.ts` 是由 `scripts/enumerate.test.ts` 遍历 2²⁴ 全色域算出来的**生成文件**
 * （`hits` / `ep` / `rarity` 全部派生自 `badges/*.ts` 里 `check` 函数的实际行为）。
 *
 * 但默认测试套件（`vitest.config.ts` 只 include `src/**\/*.test.ts`）对它的校验**全是自洽**的：
 * `registry.test.ts` 比的是 `PRICING` 与它自己导出的 `ep`，`casino.test.ts` 只在采样里找 witness、
 * 不计数；唯一做完整交叉校验的 `scripts/supersession.test.ts` 在 `scripts/` 下，不跑。
 * 于是「改了 `check`、忘了重跑枚举」在默认测试里**不会红**，而定价表已经过期。
 *
 * 本模块把「生成 `pricing.gen.ts` 时所用的徽章源码」压成一个 sha256，写进生成文件
 * （`SOURCE_FINGERPRINT`）；默认测试再算一次比对。源变了而生成文件没跟上 → 立刻红。
 *
 * ## 为什么哈希**文件文本**，而不是 `check.toString()`
 *
 * 曾考虑哈希 `check.toString()`。**不可行**：枚举脚本用 tsx 直跑 `.ts`，默认测试用 vitest
 * 跑（Vite transform 会把跨模块引用改写成 `__vite_ssr_import_*`），同一个 `check`
 * 在两侧 `toString()` 结果必然不同（`(c) => isPrime(c.r)` vs
 * `(c) => __vite_ssr_import_1__.isPrime(c.r)`），断言会永久红。
 * 文本指纹两侧都只是**读文件**，与加载器无关。
 *
 * ## 指纹的输入（精确边界）
 *
 * - 目录：`src/badges/`（`BADGES_SOURCE_DIR`）；
 * - 文件：该目录下**直接**的 `*.ts`，按文件名升序（`sort`），每个文件先写文件名、再写内容；
 *   - 排除 `*.test.ts`（测试不是 `check` 的实现，改测试不该触发重跑枚举）；
 *   - 排除 `index.ts` / `defs.ts` / `renderDoc.ts`（组装与文档渲染，不参与任何 `check`）；
 *   - **包含 10 个家族文件 + `helpers.ts`**（见下）。
 * - 内容：先剔除 `name` / `description` 文案（见 {@link stripNonInfluentialText}），再入哈希。
 *   理由：这两个字段不进 `check`、不影响 `hits`，而项目已确立「改文案不用重跑枚举」。
 *
 * ### 已知边界（写进代码，避免被误当成完备校验）
 *
 * 1. **只覆盖 `src/badges/` 下的文件。** 若某个 `check` 依赖 `badges/` 之外的文件
 *    （例如 `../types.ts` 里的常量、`../color.ts` 的转换语义），那些改动的**不在**指纹内。
 *    `types.ts` 目前是纯类型 + 少量常量，`color.ts` 是 `toColorInfo`，两者都真的会影响 `hits`，
 *    但它们不在本次约定范围（改动它们需要单独的一次设计，且会牵扯 `apps/**`）。
 * 2. **`helpers.ts` 进了指纹（本轮的决定）。** 它是所有家族共用的判定函数库
 *    （`isPrime` / `isPerfectSquare` / `hexBytes` / `gcd` …），改它**确实会改 `hits`**。
 *    不进指纹就正好漏掉一整类「改了 helpers 没重跑」的情形；进来只是偶尔多触发一次枚举
 *    （比如只改了它的注释），这是 fail-closed 的正确方向。
 * 3. **不做语义解析，只做文本剔除。** 剔除 `name` / `description` 时遇到的任何不确定写法
 *    一律**保留**（fail-closed）：多触发一次枚举，好过漏掉一次真变化。
 * 4. **指纹不判断定价数值对不对**，只判断「源变过没有」。数值正确性由流水线的
 *    supersession 阶段（`scripts/supersession.test.ts`）覆盖。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 家族源文件所在目录（`packages/shared/src/badges`）。 */
export const BADGES_SOURCE_DIR = join(HERE, 'badges');

/**
 * 不参与指纹的文件：只做组装或文档渲染，**不参与任何 `check` 的判定**。
 *
 * `index.ts`（barrel + 注入定价）、`defs.ts`（聚合原始定义）、`renderDoc.ts`（渲染 Markdown）。
 * 它们的变化不会改 `hits`，所以不该要求重跑枚举。
 */
const NON_INFLUENTIAL_FILES: ReadonlySet<string> = new Set([
  'index.ts',
  'defs.ts',
  'renderDoc.ts',
]);

/** 参与指纹的一个源文件（`path` 是相对 `badges/` 的文件名，不含目录）。 */
export interface BadgeSourceEntry {
  /** 相对 `badges/` 的文件名，例如 `casino.ts`。 */
  path: string;
  /** 文件原文（未剔除文案）。 */
  text: string;
}

/** 路径升序比较（显式字节序，避免 `localeCompare` 受环境 locale 影响）。 */
function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 列出参与指纹的文件名（升序）。
 *
 * 规则见模块头注释：`badges/` 下直接的 `*.ts`，去掉 `*.test.ts` 与
 * {@link NON_INFLUENTIAL_FILES}。用目录列举而不是硬编码清单，是为了让
 * **新增 / 删除家族文件**也自动进入指纹。
 */
export function listFingerprintedBadgeFiles(dir: string = BADGES_SOURCE_DIR): string[] {
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts'))
    .filter(name => !name.endsWith('.test.ts'))
    .filter(name => !NON_INFLUENTIAL_FILES.has(name))
    .sort(comparePaths);
}

/** 读取参与指纹的全部源文件（未剔除文案，便于测试自行变异）。 */
export function readBadgeSourceEntries(dir: string = BADGES_SOURCE_DIR): BadgeSourceEntry[] {
  return listFingerprintedBadgeFiles(dir).map(path => ({
    path,
    text: readFileSync(join(dir, path), 'utf8'),
  }));
}

/**
 * 由「文件名 + 剔除文案后的内容」算 sha256（内部按 path 排序，与入参顺序无关）。
 *
 * 文件名也进哈希：重命名 / 新增 / 删除文件都必须触发重跑。
 */
export function fingerprintSourceEntries(entries: readonly BadgeSourceEntry[]): string {
  const hash = createHash('sha256');
  const sorted = [...entries].sort((a, b) => comparePaths(a.path, b.path));
  for (const entry of sorted) {
    // 文件名与内容之间、以及各文件之间都用 NUL 分隔，避免边界歧义
    // （例如文件 A 的尾巴拼上文件 B 的头恰好等于另一个文件的内容）。
    hash.update(`file ${entry.path}\0`, 'utf8');
    hash.update(stripNonInfluentialText(entry.text), 'utf8');
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
}

/** 读盘并算出当前徽章源码指纹（枚举脚本与默认测试都调它）。 */
export function computeBadgeSourceFingerprint(dir: string = BADGES_SOURCE_DIR): string {
  return fingerprintSourceEntries(readBadgeSourceEntries(dir));
}

/**
 * 指纹不一致时的失败提示（枚举脚本不消费，测试与文档共用同一段文案）。
 */
export const FINGERPRINT_STALE_MESSAGE = [
  'pricing.gen.ts 已过期：徽章源码的指纹与生成文件里的 SOURCE_FINGERPRINT 不一致。',
  '请跑一次枚举（pnpm -C packages/shared run enumerate）或走 tools/admin 的加徽章流水线。',
].join('\n');

// ───────────────────────── 文案剔除 ─────────────────────────

/** 行首的 `name:` / `description:` 属性键。只认属性键，注释与字符串内部不会命中。 */
const COPY_KEY_RE = /^[ \t]*(?:name|description)[ \t]*:/;

/**
 * 找同一行内从 `from` 处的引号开始的闭合引号；处理 `\` 转义。
 * 找不到（字符串跨行等）返回 `-1`。
 */
function findClosingQuote(line: string, from: number, quote: string): number {
  for (let i = from + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i++; // 跳过被转义的下一个字符
      continue;
    }
    if (ch === quote) return i;
  }
  return -1;
}

/**
 * 找模板串的闭合反引号。
 *
 * 见到 `${` **立刻放弃**（返回 `null`）：插值里可能有嵌套反引号 / 花括号，
 * 不猜——那种写法会整段保留（fail-closed）。
 */
function findTemplateEnd(
  lines: readonly string[],
  startLine: number,
  startIndex: number,
): { line: number; index: number } | null {
  for (let li = startLine; li < lines.length; li++) {
    const line = lines[li];
    for (let i = li === startLine ? startIndex + 1 : 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '$' && line[i + 1] === '{') return null;
      if (ch === '`') return { line: li, index: i };
    }
  }
  return null;
}

/** 值的收尾是否只允许「空」或「一个逗号」。其余（拼接、`as const`、注释……）一律不剔除。 */
function isValueTail(tail: string): boolean {
  const trimmed = tail.trim();
  return trimmed === '' || trimmed === ',';
}

/**
 * 判定从第 `keyIndex` 行起的 `name:` / `description:` 值**终止于哪一行**。
 * 只接受能被确定性识别的字符串字面量（`'…'`、`"…"`、`` `…` ``）；
 * 其余（标识符、函数调用、拼接、含插值的模板串……）返回 `null`，调用方原样保留。
 */
function findCopyValueEnd(lines: readonly string[], keyIndex: number): number | null {
  let valueLine = keyIndex;
  let rest = lines[keyIndex].replace(COPY_KEY_RE, '');
  while (rest.trim() === '') {
    valueLine++;
    if (valueLine >= lines.length) return null;
    rest = lines[valueLine];
  }

  const lead = rest.length - rest.trimStart().length;
  const first = rest[lead];

  if (first === "'" || first === '"') {
    const close = findClosingQuote(rest, lead, first);
    if (close === -1) return null;
    return isValueTail(rest.slice(close + 1)) ? valueLine : null;
  }

  if (first === '`') {
    const end = findTemplateEnd(lines, valueLine, lead);
    if (end === null) return null;
    return isValueTail(lines[end.line].slice(end.index + 1)) ? end.line : null;
  }

  return null;
}

/**
 * 剔除 `name` / `description` 文案，返回剩下用于指纹的文本。
 *
 * 只处理能确认是「一个字符串字面量」的写法；**任何不确定的写法都原样保留**
 * （fail-closed：宁可多触发一次枚举，也不漏掉一次真变化）。
 * 行结构保持（其余行原样、顺序不变），所以输出对同一输入是确定的。
 */
export function stripNonInfluentialText(source: string): string {
  const lines = source.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!COPY_KEY_RE.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    const end = findCopyValueEnd(lines, i);
    if (end === null) {
      kept.push(lines[i]); // 拿不准 → 保留
      continue;
    }
    i = end; // 丢掉 key 行 … 值结束行（含之间的空白行）
  }
  return kept.join('\n');
}
