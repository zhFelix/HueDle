/**
 * 测试 1：spec 校验 + `toSource()` ↔ `toPredicate()` **语义等价**。
 *
 * 等价的证明方式（docs/ADMIN.md §5.1）：把 `toSource()` 的产物做**白名单标识符检查**后
 * 用 `new Function` 求值，与 `toPredicate()` 在固定采样上逐色比对。
 * 这是唯一能防「渲染器写对了文本、写错了语义」的测试，且不需要 TS 解析器。
 */
import { describe, expect, it } from 'vitest';
import { toColorInfo, type ColorInfo, type RGB } from '@huedle/shared';
import {
  BASE_HELPER_NAMES,
  compileHandwritten,
  freeIdentifiers,
  toPredicate,
  toSource,
} from '../addbadge/build';
import * as SHARED from '@huedle/shared';
import { HELPER_ARITY, SpecError, parseBadgeSpec, parseExpr } from '../addbadge/spec';

/** 固定采样：线性同余，**不用 Math.random**，跑多少次结果都一样。 */
function sampleColors(count: number): ColorInfo[] {
  const out: ColorInfo[] = [];
  let state = 0x2f6e2b1;
  for (let i = 0; i < count; i += 1) {
    state = (state * 1103515245 + 12345) % 0x80000000;
    const v = state % (1 << 24);
    const rgb: RGB = { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    out.push(toColorInfo(rgb));
    // 再补几个边界色
    if (i % 512 === 0) out.push(toColorInfo({ r: i & 255, g: 0, b: 255 }));
  }
  return out;
}

const SAMPLES = sampleColors(4096);

/** 把 toSource 的产物编译成函数（标识符必须在白名单里——这本身就是一条断言）。 */
function compileSource(source: string): (c: ColorInfo) => unknown {
  const identifiers = freeIdentifiers(source);
  const allowed = new Set([...BASE_HELPER_NAMES, 'c', 'Math', 'Number', 'Set', 'String', 'Boolean']);
  const illegal = identifiers.filter(name => !allowed.has(name));
  expect(illegal, `toSource 产物里出现了白名单外的标识符：${illegal.join(', ')}`).toEqual([]);
  const values = BASE_HELPER_NAMES.map(name => (SHARED as unknown as Record<string, unknown>)[name]);
  const fn = new Function('c', ...BASE_HELPER_NAMES, `"use strict"; return (${source});`) as (
    ...args: unknown[]
  ) => unknown;
  return color => fn(color, ...values);
}

const EQUIVALENCE_CASES: Array<{ name: string; when: unknown }> = [
  { name: '单比较', when: { gt: [{ field: 'r' }, 128] } },
  { name: 'and + 比较', when: { all: [{ eq: [{ field: 'r' }, { field: 'g' }] }, { gt: [{ field: 'b' }, 10] }] } },
  { name: 'or', when: { any: [{ lt: [{ field: 'r' }, 3] }, { gt: [{ field: 'b' }, 250] }] } },
  { name: 'not', when: { not: { isGray: true } } },
  { name: 'between', when: { between: [{ minChannel: true }, 120, 136] } },
  { name: '算术 + 括号优先级', when: { lt: [{ sub: [{ maxChannel: true }, { minChannel: true }] }, 3] } },
  { name: '乘法优先于加法', when: { eq: [{ add: [{ mul: [{ field: 'r' }, 2] }, 1] }, { field: 'b' }] } },
  { name: 'helper 组合', when: { all: [{ isGray: true }, { isPrime: true }] } },
  { name: 'gcd/lcm 双参', when: { le: [{ gcd: [{ field: 'r' }, { field: 'g' }] }, { lcm: [2, 4] }] } },
  { name: '取模与回文', when: { all: [{ eq: [{ mod: [{ field: 'r' }, 7] }, 0] }, { isPalindromeNumber: true }] } },
  { name: 'Math.min/max', when: { eq: [{ max: [{ field: 'r' }, 5] }, { min: [200, { field: 'g' }] }] } },
  { name: 'abs', when: { lt: [{ abs: { sub: [{ field: 'r' }, { field: 'b' }] } }, 2] } },
  { name: '字符串比较', when: { eq: [{ field: 'hex' }, '#000000'] } },
  { name: 'hsl', when: { between: [{ hsl: 'h' }, 200, 260] } },
  { name: '整数 helper 与常量', when: { any: [{ isPowerOfTwo: true }, { eq: [1, 2] }] } },
];

describe('测试 1：toSource ↔ toPredicate 语义等价', () => {
  it.each(EQUIVALENCE_CASES)('$name', ({ when }) => {
    const expr = parseExpr(when);
    const source = toSource(expr);
    const predicate = toPredicate(expr);
    const compiled = compileSource(source);
    for (const color of SAMPLES) {
      expect(compiled(color), `${source} @ ${color.hex}`).toBe(predicate(color));
    }
  });

  it('采样里既有命中也有未命中（证明上面的比对不是空转）', () => {
    const predicate = toPredicate(parseExpr({ gt: [{ field: 'r' }, 128] }));
    const hits = SAMPLES.filter(color => predicate(color)).length;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(SAMPLES.length);
  });
});

describe('spec 校验：写盘前就拒绝必然错的东西', () => {
  const bad: Array<[string, unknown]> = [
    ['id 不是 kebab-case', { id: 'Bad_ID', name: '甲甲', description: 'd', family: 'gray', when: { isGray: true } }],
    ['缺 when 与 handwritten', { id: 'a-b', name: '甲甲', description: 'd', family: 'gray' }],
    ['同时给 when 与 handwritten', { id: 'a-b', name: '甲甲', description: 'd', family: 'gray', when: { isGray: true }, handwritten: { check: 'true' } }],
    ['family 非法', { id: 'a-b', name: '甲甲', description: 'd', family: 'nope', when: { isGray: true } }],
    ['name 为空', { id: 'a-b', name: '', description: 'd', family: 'gray', when: { isGray: true } }],
    ['description 为空', { id: 'a-b', name: '甲甲', description: '  ', family: 'gray', when: { isGray: true } }],
  ];
  it.each(bad)('%s 被拒', (_name, input) => {
    expect(() => parseBadgeSpec(input)).toThrow(SpecError);
  });

  it.each([
    ['未知键 spread', { spread: true }],
    ['参数个数不对', { isPrime: [1, 2] }],
    ['表达式对象有两个键', { isGray: true, isPrime: true }],
    ['顶层不是布尔', { add: [1, 2] }],
    ['算术里混入字符串', { lt: [{ add: [{ field: 'hex' }, 1] }, 2] }],
  ])('%s 被拒', (_name, when) => {
    expect(() => toPredicate(parseExpr(when))).toThrow(SpecError);
  });

  it('helper 表与 shared 的导出一致（契约漂移哨兵）', () => {
    for (const name of Object.keys(HELPER_ARITY)) {
      expect(typeof (SHARED as unknown as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

describe('手写路径：白名单 + 干跑可求值', () => {
  it('引用文件私有 helper 时必须把它列入依赖名字（否则拒绝）', () => {
    expect(() => compileHandwritten('onRanks(c)')).toThrow(SpecError);
    // 真品由 loadFamilyHelpers import 进来后注入；这里直接给实现验语义。
    const fn = compileHandwritten('onRanks(c)', { onRanks: (color: ColorInfo) => color.r === 1 });
    expect(fn(toColorInfo({ r: 1, g: 0, b: 0 }))).toBe(true);
    expect(fn(toColorInfo({ r: 2, g: 0, b: 0 }))).toBe(false);
  });

  it('注入的 helper 之间可以互相引用（真品在文件里就是这么写的）', () => {
    const double = (n: number): number => n * 2;
    const quadruple = (n: number): number => double(double(n));
    const fn = compileHandwritten('quadruple(c.r) === 8', { double, quadruple });
    expect(fn(toColorInfo({ r: 2, g: 0, b: 0 }))).toBe(true);
  });

  it('拒绝 process/eval/require 这类标识符', () => {
    for (const expr of ['process.exit(0)', 'eval("1")', 'require("fs")', 'globalThis.x']) {
      expect(() => compileHandwritten(expr)).toThrow(SpecError);
    }
  });

  it('freeIdentifiers 不把属性名/字符串/箭头形参当自由变量', () => {
    expect(freeIdentifiers("c.hex.slice(1).length === 6 && c.hsl.l > 0")).toEqual(['c']);
    expect(freeIdentifiers("xs.filter(n => n > 1).length === 2")).toEqual(['xs']);
    expect(freeIdentifiers("'process'")).toEqual([]);
  });
});
