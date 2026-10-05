/**
 * 末尾插入 + 缩进模板 + 写盘后的三自检（docs/ADMIN.md §3.2(d)）。
 *
 * 关键约定：
 *   - **纯插入**：`原文(前缀) + 新块 + 原文(后缀) === 新文件`，逐字节；
 *   - 插入点是文件里**唯一**的 `\n];\n` 之前；
 *   - 缩进取「插入点之前最后一个对象字面量」的前导空白，不硬编码 2 空格（F6）；
 *   - 尾随逗号必须有（全部既有条目均有）。
 *
 * 手写路径的 block body 也在这里渲染：`check: c => { … }`。
 */
import { familyFilePath, type ExistingBadge } from './families';
import { SpecError, type BadgeSpec } from './spec';

/** `check` 折行阈值（整行字符数，含缩进）。 */
export const CHECK_LINE_LIMIT = 100;

export interface RenderedBlock {
  /** 要插入的文本（以缩进开头、以 `,\n` 结尾）。 */
  block: string;
  /** 新徽章在文件里的缩进（末元素模板）。 */
  indent: string;
}

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * 渲染新徽章对象。
 *
 * `spec` 只用来取元数据；`checkSource` 由调用方给出（结构化路径来自 `toSource()`，
 * 手写路径来自作者写的表达式）。
 */
export function renderBadgeBlock(
  spec: BadgeSpec,
  checkSource: string,
  indent: string,
): RenderedBlock {
  const unit = '  ';
  const field = (text: string): string => `${indent}${unit}${text}`;
  const lines: string[] = [];
  lines.push(`${indent}{`);
  lines.push(field(`id: ${quote(spec.id)},`));
  lines.push(field(`name: ${quote(spec.name)},`));
  lines.push(field(`description: ${quote(spec.description)},`));
  lines.push(field(`family: ${quote(spec.family)},`));
  if (spec.group) lines.push(field(`group: ${quote(spec.group)},`));

  const oneLine = `${indent}${unit}check: c => ${checkSource},`;
  const displayWidth = [...oneLine].length;
  if (!checkSource.includes('\n') && displayWidth <= CHECK_LINE_LIMIT) {
    lines.push(oneLine);
  } else if (!checkSource.includes('\n')) {
    // 现有风格（gray.ts:23 / math.ts）：`check: c =>` 换行，表达式再缩进一级。
    lines.push(`${indent}${unit}check: c =>`);
    lines.push(`${indent}${unit}${unit}${checkSource},`);
  } else {
    // block body（手写路径的多语句体）：checkSource 是多行语句体，逐行 +1 级缩进。
    lines.push(`${indent}${unit}check: c => {`);
    for (const bodyLine of checkSource.replace(/\n$/, '').split('\n')) {
      lines.push(bodyLine.trim().length === 0 ? '' : `${indent}${unit}${unit}${bodyLine}`);
    }
    lines.push(`${indent}${unit}},`);
  }
  lines.push(`${indent}},`);
  return { block: lines.join('\n') + '\n', indent };
}

/**
 * 把新块插到 `\n];\n` 之前。返回新内容与插入偏移（供自检使用）。
 *
 * 插入点必须唯一，否则**拒绝**（`findArrayAnchor`）。
 */
export function insertBlock(original: string, block: string, anchor: number): { content: string; insertAt: number } {
  // anchor 指向 `\n];\n` 里的那个 `\n`；插入点紧跟在它之后（即 `]` 之前）。
  const insertAt = anchor + 1;
  const content = original.slice(0, insertAt) + block + original.slice(insertAt);
  return { content, insertAt };
}

/**
 * 写盘后的**三自检**（`docs/ADMIN.md` §3.2(d) 最后一行）。
 *
 * 1. `原文(前缀) + 新块 + 原文(后缀) === 新文件`（字节级）；
 * 2. 文件仍以 `];\n` 结尾；
 * 3. `id: '<id>',` 的出现次数恰好 +1。
 *
 * 失败抛 {@link SpecError}，调用方**立即回滚**。
 */
export function assertSelfCheck(
  original: string,
  next: string,
  block: string,
  insertAt: number,
  id: string,
): void {
  const prefix = original.slice(0, insertAt);
  const suffix = original.slice(insertAt);
  if (!next.startsWith(prefix) || next.slice(insertAt, insertAt + block.length) !== block || next.slice(insertAt + block.length) !== suffix) {
    throw new SpecError('自检①失败：新文件不等于「原文前缀 + 新块 + 原文后缀」（字节级不一致）', 'insert');
  }
  if (!next.endsWith('];\n')) {
    throw new SpecError('自检②失败：写盘后文件不再以 "];\\n" 结尾', 'insert');
  }
  const key = `id: '${id}',`;
  const before = countOccurrences(original, key);
  const after = countOccurrences(next, key);
  if (after !== before + 1) {
    throw new SpecError(`自检③失败：id: '${id}', 出现次数应为 ${before + 1}，实际 ${after}`, 'insert');
  }
}

export function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 组装一份「插入计划」，纯函数，便于单测（不写盘）。 */
export function planInsertion(options: {
  original: string;
  anchor: number;
  indent: string;
  spec: BadgeSpec;
  checkSource: string;
}): { content: string; block: string; insertAt: number } {
  const { block } = renderBadgeBlock(options.spec, options.checkSource, options.indent);
  const { content, insertAt } = insertBlock(options.original, block, options.anchor);
  assertSelfCheck(options.original, content, block, insertAt, options.spec.id);
  return { content, block, insertAt };
}

/** 目标文件路径（便于报错信息里给出绝对路径）。 */
export function targetPath(root: string, spec: BadgeSpec): string {
  return familyFilePath(root, spec.family);
}

/** 既有徽章列表里找同 id（用于错误信息）。 */
export function findById(badges: readonly ExistingBadge[], id: string): ExistingBadge | undefined {
  return badges.find(badge => badge.id === id);
}

/**
 * 手写路径的诊断文案：引用到的 private helper 必须在目标文件里已经存在
 * （本工具只做**末尾纯插入**，不会顺手改 import 或替作者声明新的 private helper）。
 */
export function describeMissingLocals(names: readonly string[]): string {
  return (
    `手写表达式引用了目标文件里不存在的 private helper：${names.join(', ')}。`
    + '本工具只做数组末尾的纯插入（不改 import、不确定义新 helper）——'
    + '请先手工把 helper 加进该家族文件，再重跑。'
  );
}
