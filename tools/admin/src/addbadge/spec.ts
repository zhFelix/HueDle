/**
 * 加徽章的条件 spec：**类型 + 手写校验器**（不引 zod/ajv，见 docs/ADMIN.md §4.1）。
 *
 * 两条一等公民路径（docs/ADMIN.md §3.2）：
 *
 *   1. **结构化 spec**（默认）：`when` 是一棵用 JSON 写成的判定表达式，
 *      词汇表只有 `packages/shared/src/badges/helpers.ts` 的 15 个函数 +
 *      `ColorInfo` 的字段 + 字面量 + 四则/比较/逻辑运算符。
 *      它同时能编译出「源码」与「可执行谓词」，因此**能在写盘之前**跑 2²⁴ 全色域干跑。
 *   2. **手写路径**（一等公民，不是逃生舱）：`handwritten.check` 是一段单表达式，
 *      可以引用目标家族文件里**已经存在**的 private helper。写盘前同样干跑——
 *      引用到的 private helper 必须由作者用 `handwritten.evalHelpers` 提供一份
 *      **仅用于干跑求值**的 JS 版本（见 `build.ts` 的说明与报告里的「不确定项」）。
 *
 * 这里只做**结构**校验；「合不合法」的语义校验（id 全局唯一、name 同家族不重名……）
 * 由 `families.ts` 读真实文件后完成。
 */
import type { Family } from '@huedle/shared';

/** 家族表：顺序与 `packages/shared/src/badges/defs.ts` 的拼接顺序一致。 */
export const FAMILIES: readonly Family[] = [
  'gray',
  'extreme',
  'pure',
  'channel',
  'math',
  'perception',
  'pattern',
  'culture',
  'lucky',
  'casino',
];

export function isFamily(value: unknown): value is Family {
  return typeof value === 'string' && (FAMILIES as readonly string[]).includes(value);
}

/**
 * 结构化条件可用的 helper（来自 `helpers.ts`，签名已冻结）。
 *
 * value = 参数个数。**刻意不包含文件私有 helper**（`spread` / `onRanks` /
 * `allCharsIn` …）：它们不在冻结词汇表里，属于手写路径的范畴——把 27% 的复杂形态
 * 硬塞进构造器会让工具长成一个半吊子 DSL（docs/ADMIN.md §3.2(b) 的结论）。
 */
export const HELPER_ARITY: Readonly<Record<string, number>> = {
  isPowerOfTwo: 1,
  isPrime: 1,
  isPerfectSquare: 1,
  isFibonacci: 1,
  digitSum: 1,
  isPalindromeNumber: 1,
  gcd: 2,
  lcm: 2,
  maxChannel: 1,
  minChannel: 1,
  channelSum: 1,
  distinctChannelCount: 1,
  isGray: 1,
  hexBytes: 1,
  toHexByte: 1,
};

/** helper 的返回类型（用于 `toSource` 的类型推断，把类型错误挡在写盘之前）。 */
export const HELPER_RETURN: Readonly<Record<string, 'number' | 'boolean'>> = {
  isPowerOfTwo: 'boolean',
  isPrime: 'boolean',
  isPerfectSquare: 'boolean',
  isFibonacci: 'boolean',
  digitSum: 'number',
  isPalindromeNumber: 'boolean',
  gcd: 'number',
  lcm: 'number',
  maxChannel: 'number',
  minChannel: 'number',
  channelSum: 'number',
  distinctChannelCount: 'number',
  isGray: 'boolean',
  hexBytes: 'number',
  toHexByte: 'number',
};

/** 运算符：名字 → [最小参数个数, 最大参数个数]。 */
export const OP_ARITY = {
  and: [1, Infinity],
  or: [1, Infinity],
  not: [1, 1],
  add: [2, Infinity],
  sub: [2, Infinity],
  mul: [2, Infinity],
  div: [2, 2],
  mod: [2, 2],
  min: [2, Infinity],
  max: [2, Infinity],
  abs: [1, 1],
  eq: [2, 2],
  ne: [2, 2],
  lt: [2, 2],
  le: [2, 2],
  gt: [2, 2],
  ge: [2, 2],
  between: [3, 3],
} as const satisfies Record<string, readonly [number, number]>;

/** 运算符别名：`docs/ADMIN.md` §3.2(b) 的示例用的是 `all`，这里两种写法都接受。 */
export const OP_ALIASES: Readonly<Record<string, OpName>> = { all: 'and', any: 'or' };

export type OpName = keyof typeof OP_ARITY;

/** `ColorInfo` 的顶层数值/字符串字段。 */
export const COLOR_FIELDS = ['r', 'g', 'b', 'hex'] as const;
export type ColorField = (typeof COLOR_FIELDS)[number];

/** `ColorInfo.hsl` 的子字段。 */
export const HSL_FIELDS = ['h', 's', 'l'] as const;
export type HslField = (typeof HSL_FIELDS)[number];

/** 表达式 AST。`self` 只在 JSON 的 `true` 简写里出现，渲染成 `c`。 */
export type Expr =
  | { kind: 'const'; value: number | string | boolean }
  | { kind: 'self' }
  | { kind: 'field'; name: ColorField }
  | { kind: 'hsl'; name: HslField }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'op'; name: OpName; args: Expr[] };

export type ExprType = 'number' | 'string' | 'boolean';

/** 校验失败的规范错误：message 会原样打印给用户。 */
export class SpecError extends Error {
  constructor(
    message: string,
    /** 出错的字段路径，如 `when.all[0].le[1]`。 */
    readonly path = '',
  ) {
    super(path ? `${path}：${message}` : message);
    this.name = 'SpecError';
  }
}

/**
 * 把 JSON 里的一个节点解析成 {@link Expr}。
 *
 * 接受的形状（`true` 是「以 `c` 为唯一参数」的简写）：
 *
 * ```json
 * 7                                    // 字面量
 * { "field": "r" }                     // c.r / c.g / c.b / c.hex
 * { "hsl": "h" }                       // c.hsl.h / .s / .l
 * { "isPrime": true }                  // isPrime(c)
 * { "gcd": [{ "field": "r" }, 8] }     // gcd(c.r, 8)
 * { "spread": true }                   // ❌ 不在冻结词汇表里 → 手写路径
 * { "all": [ { "gt": [{ "field": "r" }, 128] } ] }
 * { "between": [{ "minChannel": true }, 120, 136] }
 * ```
 */
export function parseExpr(node: unknown, path = 'when'): Expr {
  if (typeof node === 'number' || typeof node === 'string' || typeof node === 'boolean') {
    return { kind: 'const', value: node };
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new SpecError(
      `只接受 数字 / 字符串 / 布尔 / 单键对象，收到 ${describe(node)}`,
      path,
    );
  }

  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new SpecError(`表达式对象必须恰好有一个键，收到 ${entries.length} 个`, path);
  }
  const [key, raw] = entries[0]!;

  if (key === 'field') {
    if (!(COLOR_FIELDS as readonly string[]).includes(String(raw))) {
      throw new SpecError(`field 只能是 ${COLOR_FIELDS.join('/')}，收到 ${describe(raw)}`, path);
    }
    return { kind: 'field', name: raw as ColorField };
  }
  if (key === 'hsl') {
    if (!(HSL_FIELDS as readonly string[]).includes(String(raw))) {
      throw new SpecError(`hsl 只能是 ${HSL_FIELDS.join('/')}，收到 ${describe(raw)}`, path);
    }
    return { kind: 'hsl', name: raw as HslField };
  }

  const arity = HELPER_ARITY[key];
  if (arity !== undefined) {
    const args = raw === true
      ? [{ kind: 'self' } as Expr]
      : readArgList(raw, path, key);
    if (args.length !== arity) {
      throw new SpecError(`helper ${key} 需要 ${arity} 个参数，收到 ${args.length} 个`, path);
    }
    return { kind: 'call', name: key, args };
  }

  const canonical = (OP_ALIASES as Readonly<Record<string, OpName | undefined>>)[key];
  const opKey = (canonical ?? key) as OpName;
  const opArity = (OP_ARITY as Readonly<Record<string, readonly [number, number] | undefined>>)[opKey];
  if (opArity !== undefined) {
    let args: Expr[];
    if (raw === true && opArity[0] === 1) {
      args = [{ kind: 'self' }];
    } else if (opArity[0] === 1 && !Array.isArray(raw)) {
      // 单参数运算符允许把唯一的参数直接写成对象：`{ "not": { "isGray": true } }`。
      args = [parseExpr(raw, `${path}.${key}`)];
    } else {
      args = readArgList(raw, path, key);
    }
    if (args.length < opArity[0] || args.length > opArity[1]) {
      const range = opArity[1] === Infinity ? `≥${opArity[0]}` : `${opArity[0]}`;
      throw new SpecError(`运算符 ${key} 需要 ${range} 个参数，收到 ${args.length} 个`, path);
    }
    return { kind: 'op', name: opKey, args };
  }

  if (key === 'spread' || key === 'onRanks' || key === 'allCharsIn' || key === 'exactHex') {
    throw new SpecError(
      `${key} 是家族文件私有 helper，不在冻结词汇表里：请改用手写路径（--ts / handwritten），`
      + '或把它展开成 helpers.ts + 运算符的组合',
      path,
    );
  }
  throw new SpecError(`未知的键 ${JSON.stringify(key)}`, path);
}

function readArgList(raw: unknown, path: string, key: string): Expr[] {
  if (!Array.isArray(raw)) {
    throw new SpecError(
      `${key} 的参数必须是数组（单参数可写 true 表示以 c 为参数），收到 ${describe(raw)}`,
      path,
    );
  }
  return raw.map((item, index) => parseExpr(item, `${path}.${key}[${index}]`));
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组(${value.length})`;
  if (typeof value === 'object') return '对象';
  return `${typeof value} ${JSON.stringify(value)}`;
}

/** 结构化 spec。 */
export interface StructuredSpec {
  id: string;
  name: string;
  description: string;
  family: Family;
  group: string | null;
  when: Expr;
}

/** 手写 spec（单表达式 + 仅用于干跑求值的 private helper 副本）。 */
export interface HandwrittenSpec {
  id: string;
  name: string;
  description: string;
  family: Family;
  group: string | null;
  handwritten: {
    /** 单表达式（可含嵌套箭头函数），插入成 `check: c => <check>,`。 */
    check: string;
    /**
     * **只用于干跑求值**的私有 helper 源码（不会写进仓库）。
     * 键必须在目标家族文件里已经存在同名声明，否则拒绝（tsc 会拦，但我们更早拦）。
     */
    evalHelpers?: Record<string, string>;
  };
}

export type BadgeSpec = StructuredSpec | HandwrittenSpec;

export function isHandwritten(spec: BadgeSpec): spec is HandwrittenSpec {
  return 'handwritten' in spec;
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** id / name / description / family 的通用字段校验（S0.2）。 */
export function parseCommonFields(raw: Record<string, unknown>): {
  id: string;
  name: string;
  description: string;
  family: Family;
  group: string | null;
} {
  const id = raw.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new SpecError(`id 必须是 kebab-case 纯英文小写（如 gray-mid-echo），收到 ${describe(id)}`, 'id');
  }
  const name = raw.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new SpecError('name 不能为空', 'name');
  }
  const points = [...name.trim()].length;
  if (points < 2 || points > 24) {
    throw new SpecError(`name 长度应在 2–24 个字符之间（推荐 2–6 字），收到 ${points} 个`, 'name');
  }
  const description = raw.description;
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new SpecError('description 不能为空（要写「可判定的条件」，读者能据此手算）', 'description');
  }
  if (!isFamily(raw.family)) {
    throw new SpecError(`family 必须是 ${FAMILIES.join('/')} 之一，收到 ${describe(raw.family)}`, 'family');
  }
  const group = raw.group ?? null;
  if (group !== null && (typeof group !== 'string' || group.trim().length === 0 || !ID_PATTERN.test(group))) {
    throw new SpecError('group 若存在，必须是 kebab-case 且非空', 'group');
  }
  return { id, name: name.trim(), description: description.trim(), family: raw.family, group };
}

/**
 * 把一份 JSON（来自文件或 UI 表单）解析成 {@link BadgeSpec}。
 *
 * `when` 与 `handwritten` **必须恰好有一个**。
 */
export function parseBadgeSpec(input: unknown, path = 'spec'): BadgeSpec {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecError(`spec 必须是一个对象，收到 ${describe(input)}`, path);
  }
  const raw = input as Record<string, unknown>;
  const common = parseCommonFields(raw);

  const hasWhen = raw.when !== undefined && raw.when !== null;
  const hasHandwritten = raw.handwritten !== undefined && raw.handwritten !== null;
  if (hasWhen === hasHandwritten) {
    throw new SpecError(
      '必须恰好给出 when（结构化）或 handwritten（手写）之一',
      path,
    );
  }

  if (hasWhen) {
    return { ...common, when: parseExpr(raw.when, `${path}.when`) };
  }

  const block = raw.handwritten;
  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new SpecError('handwritten 必须是一个对象', `${path}.handwritten`);
  }
  const check = (block as Record<string, unknown>).check;
  if (typeof check !== 'string' || check.trim().length === 0) {
    throw new SpecError('handwritten.check 必须是非空字符串（单表达式）', `${path}.handwritten.check`);
  }
  const evalHelpersRaw = (block as Record<string, unknown>).evalHelpers;
  let evalHelpers: Record<string, string> | undefined;
  if (evalHelpersRaw !== undefined && evalHelpersRaw !== null) {
    if (typeof evalHelpersRaw !== 'object' || Array.isArray(evalHelpersRaw)) {
      throw new SpecError('handwritten.evalHelpers 必须是 { 名字: 源码 } 对象', `${path}.handwritten.evalHelpers`);
    }
    evalHelpers = {};
    for (const [key, value] of Object.entries(evalHelpersRaw as Record<string, unknown>)) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        throw new SpecError(`evalHelpers 的键必须是合法标识符，收到 ${JSON.stringify(key)}`, path);
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new SpecError(`evalHelpers.${key} 必须是非空源码字符串`, path);
      }
      evalHelpers[key] = value;
    }
  }
  // 未使用的变量告警：evalHelpers 为空对象时归一成 undefined，行为一致。
  if (evalHelpers && Object.keys(evalHelpers).length === 0) evalHelpers = undefined;

  return { ...common, handwritten: { check: check.trim(), ...(evalHelpers ? { evalHelpers } : {}) } };
}
