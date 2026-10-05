/**
 * 测试 2：**插入的字节级正确性**（对每个真实家族文件做内存插入）。
 *
 * 断言：
 *   ① 新 id 的 `id: '…',` 出现次数恰好 +1；
 *   ② 原文所有字节不变（纯插入 = 新文件可由「原文前缀 + 新块 + 原文后缀」还原）；
 *   ③ 文件仍以 `];\n` 结尾；
 *   ④ 新元素的缩进等于**同文件末元素**的缩进（F6：每个文件里恰好有一条 4 空格）。
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FAMILIES, parseBadgeSpec } from '../addbadge/spec';
import { findArrayAnchor, lastElementIndent, readFamilyFile } from '../addbadge/families';
import { CHECK_LINE_LIMIT, countOccurrences, insertBlock, planInsertion, renderBadgeBlock } from '../addbadge/insert';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function specFor(family: string, id: string) {
  return parseBadgeSpec({
    id,
    name: '测试徽章',
    description: 'R = 0（仅用于插入自检）',
    family,
    group: null,
    when: { eq: [{ field: 'r' }, 0] },
  });
}

describe('测试 2：对每个真实家族文件的字节级插入', () => {
  it.each(FAMILIES.map(family => [family]))('%s.ts：纯插入 + 缩进取末元素', family => {
    const { content: original } = readFamilyFile(ROOT, family);
    const anchor = findArrayAnchor(original);
    const indent = lastElementIndent(original, anchor);
    const id = `${family}-insert-selftest`;
    const spec = specFor(family, id);

    const plan = planInsertion({ original, anchor, indent, spec, checkSource: 'c.r === 0' });

    // ① id 恰好 +1
    expect(countOccurrences(plan.content, `id: '${id}',`)).toBe(1);
    // ② 其余字节完全不变（逐字节）
    expect(plan.content.slice(0, plan.insertAt)).toBe(original.slice(0, plan.insertAt));
    expect(plan.content.slice(plan.insertAt + plan.block.length)).toBe(original.slice(plan.insertAt));
    expect(plan.content.length).toBe(original.length + plan.block.length);
    // ③ 仍以 `];\n` 结尾
    expect(plan.content.endsWith('];\n')).toBe(true);
    // ④ 新块用的是「末元素缩进」模板，且插入后的末元素就是它
    expect(plan.block.startsWith(`${indent}{`)).toBe(true);
    const anchorAfter = findArrayAnchor(plan.content);
    expect(lastElementIndent(plan.content, anchorAfter)).toBe(indent);
    // 追加的内容紧贴在 `];` 之前，原 `];\n` 原样保留
    expect(plan.content.endsWith(`${plan.block}];\n`)).toBe(true);
  });

  it.each(FAMILIES.map(family => [family]))('%s.ts：插入前的末元素缩进 = 插入模板', family => {
    const { content } = readFamilyFile(ROOT, family);
    const anchor = findArrayAnchor(content);
    const before = content.slice(0, anchor);
    const matches = [...before.matchAll(/\n([ \t]*)\{\n/g)];
    const last = matches[matches.length - 1]![1]!;
    expect(lastElementIndent(content, anchor)).toBe(last);
    // 既有家族文件里只用这两种缩进（4 空格是 F6 的那一条）
    expect(['  ', '    ']).toContain(last);
  });

  it('数组结束标记出现多次 → 拒绝（不猜测、不用正则修格式）', () => {
    const { content } = readFamilyFile(ROOT, 'gray');
    expect(() => findArrayAnchor(`${content}\n];\n`)).toThrowError(/多次/);
  });

  it('找不到数组结束标记 → 拒绝', () => {
    expect(() => findArrayAnchor('export const x = [];')).toThrowError(/找不到/);
  });
});

describe('测试 2：block 渲染的格式契约', () => {
  it('短表达式 一行；长表达式 折行；多行体 block body', () => {
    const spec = specFor('gray', 'gray-format-check');
    const short = renderBadgeBlock(spec, 'c.r === 0', '  ').block;
    expect(short).toContain('    check: c => c.r === 0,\n');
    expect(short.endsWith('  },\n')).toBe(true);

    const longSource =
      'isPrime(c.r) && isPrime(c.g) && isPrime(c.b) && isPalindromeNumber(c.r) && c.r + c.g + c.b > 900';
    const long = renderBadgeBlock(spec, longSource, '  ').block;
    expect(long).toContain('    check: c =>\n');
    expect(long).toContain(`      ${longSource},\n`);

    const body = ['  const a = c.r;', '  return a === 0;'].join('\n');
    const block = renderBadgeBlock(spec, body, '    ').block;
    expect(block).toContain('      check: c => {\n');
    expect(block).toContain('        const a = c.r;');
    expect(block).toContain('      },\n');
  });

  it('折行阈值是 100 字符（含缩进）', () => {
    const spec = specFor('gray', 'gray-format-limit');
    const indent = '  ';
    const prefix = `${indent}  check: c => `;
    const suffix = ',';
    const exact = 'x'.repeat(CHECK_LINE_LIMIT - prefix.length - suffix.length);
    expect(renderBadgeBlock(spec, exact, indent).block).toContain(`${prefix}${exact}${suffix}\n`);
    const tooLong = `${exact}x`;
    expect(renderBadgeBlock(spec, tooLong, indent).block).toContain(`${prefix.trimEnd()}\n`);
  });

  it('尾随逗号与字段顺序与现有文件一致', () => {
    const spec = specFor('gray', 'gray-field-order');
    const block = renderBadgeBlock(spec, 'c.r === 0', '  ').block;
    const lines = block.split('\n');
    expect(lines[0]).toBe('  {');
    expect(lines[1]).toBe("    id: 'gray-field-order',");
    expect(lines[2]).toBe("    name: '测试徽章',");
    expect(lines[3]).toBe("    description: 'R = 0（仅用于插入自检）',");
    expect(lines[4]).toBe("    family: 'gray',");
  });

  it('单引号会被转义（description 里带撇号也不会破坏源码）', () => {
    const spec = parseBadgeSpec({
      id: 'gray-quote-check',
      name: '引号检查',
      description: "reader's condition",
      family: 'gray',
      when: { eq: [{ field: 'r' }, 0] },
    });
    const block = renderBadgeBlock(spec, 'c.r === 0', '  ').block;
    expect(block).toContain("description: 'reader\\'s condition',");
  });

  it('insertBlock 是纯插入（可逆）', () => {
    const original = 'a\n];\n';
    const anchor = original.indexOf('\n];\n');
    const { content, insertAt } = insertBlock(original, 'X\n', anchor);
    expect(content).toBe('a\nX\n];\n');
    expect(content.slice(0, insertAt) + content.slice(insertAt + 2)).toBe(original);
  });
});
