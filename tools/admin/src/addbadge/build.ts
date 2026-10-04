/**
 * `toSource()` / `toPredicate()` —— **同一份 spec 的两个后端**（docs/ADMIN.md §3.2(b)）。
 *
 * - `toPredicate()` 编译成可执行的闭包，让「写盘之前跑 2²⁴ 全色域」成为可能；
 * - `toSource()` 渲染成与现有家族文件同格式的 TypeScript 表达式。
 *
 * 两者必须**语义等价**，这由 `__tests__/addbadge.build.test.ts` 用固定采样证明
 * （对 `toSource()` 的产物做白名单标识符检查后 `new Function` 求值，与谓词逐色比对）。
 *
 * 手写路径同样在这里编译：表达式里的自由标识符只允许「白名单 + 作者提供的
 * `evalHelpers`」；求值用 `new Function`，参数名全部来自白名单，所以这是**安全的 eval**。
 */
import * as SHARED from '@huedle/shared';
import type { ColorInfo } from '@huedle/shared';
import { HELPER_ARITY, HELPER_RETURN, SpecError, type Expr, type ExprType, type OpName } from './spec';

/** 15 个冻结 helper 的运行时实现（键与 {@link HELPER_ARITY} 一致）。 */
const BASE_HELPERS: Readonly<Record<string, unknown>> = Object.freeze(
  Object.fromEntries(
    Object.keys(HELPER_ARITY).map(name => [name, (SHARED as unknown as Record<string, unknown>)[name]]),
  ),
);

export const BASE_HELPER_NAMES: readonly string[] = Object.keys(HELPER_ARITY);

/**
 * 手写表达式里除 helper 之外还允许出现的标识符。
 *
 * 这是**防呆，不是安全边界**（docs/ADMIN.md §3.2(c)）：真正的防线是写盘前的
 * 2²⁴ 干跑与写盘后的 `tsc` / 枚举 / 回滚。
 */
export const EXTRA_ALLOWED_IDENTIFIERS: readonly string[] = [
  'c',
  'color',
  'Math',
  'Number',
  'Set',
  'Boolean',
  'String',
  'Array',
  'JSON',
  'true',
  'false',
  'null',
  'undefined',
];

/** 出现即拒绝的标识符（逃逸进程/FS/网络/原型的能力）。 */
export const DENIED_IDENTIFIERS: readonly string[] = [
  'import',
  'require',
  'process',
  'globalThis',
  'global',
  'eval',
  'Function',
  'window',
  'document',
  'fetch',
  'XMLHttpRequest',
  'constructor',
  'prototype',
  '__proto__',
  'arguments',
  'this',
  'module',
  'exports',
];

// ───────────────────────────── 类型推断 ─────────────────────────────

/**
 * 极简类型推断：只为了让「顶层不是布尔」「对字符串做减法」这类**必然 tsc 报错**的
 * spec 在写盘之前就被拒绝。不追求完备——完备的活儿交给 `tsc`。
 */
export function inferType(expr: Expr): ExprType {
  switch (expr.kind) {
    case 'const':
      return typeof expr.value as ExprType;
    case 'self':
      // `self` 只在 `true` 简写里作为 helper 的实参出现，永远不是顶层；
      // 顶层类型由 `topLevelType()` 处理。这里给一个占位值。
      return 'number';
    case 'field':
      return expr.name === 'hex' ? 'string' : 'number';
    case 'hsl':
      return 'number';
    case 'call':
      return HELPER_RETURN[expr.name] ?? 'number';
    case 'op': {
      if (expr.name === 'and' || expr.name === 'or' || expr.name === 'not') return 'boolean';
      if (['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'between'].includes(expr.name)) return 'boolean';
      return 'number';
    }
  }
}

// ───────────────────────────── toPredicate ─────────────────────────────

/** 编译成 `(c) => unknown`。顶层必须是布尔，见 {@link compilePredicate}。 */
function compile(expr: Expr): (c: ColorInfo) => unknown {
  switch (expr.kind) {
    case 'const': {
      const value = expr.value;
      return () => value;
    }
    case 'self':
      return c => c;
    case 'field':
      return expr.name === 'hex' ? c => c.hex : c => c[expr.name];
    case 'hsl':
      return c => c.hsl[expr.name];
    case 'call': {
      const fn = BASE_HELPERS[expr.name] as (...args: unknown[]) => unknown;
      const args = expr.args.map(compile);
      return c => fn(...args.map(arg => arg(c)));
    }
    case 'op':
      return compileOp(expr.name, expr.args.map(compile));
  }
}

function compileOp(name: OpName, args: Array<(c: ColorInfo) => unknown>): (c: ColorInfo) => unknown {
  const at = (index: number) => args[index]!;
  switch (name) {
    case 'and':
      return c => args.every(arg => arg(c) === true);
    case 'or':
      return c => args.some(arg => arg(c) === true);
    case 'not':
      return c => at(0)(c) !== true;
    case 'add':
      return c => args.reduce<number>((sum, arg) => sum + Number(arg(c)), 0);
    case 'sub':
      return c => args.slice(1).reduce<number>((acc, arg) => acc - Number(arg(c)), Number(at(0)(c)));
    case 'mul':
      return c => args.reduce<number>((acc, arg) => acc * Number(arg(c)), 1);
    case 'div':
      return c => Number(at(0)(c)) / Number(at(1)(c));
    case 'mod':
      return c => Number(at(0)(c)) % Number(at(1)(c));
    case 'min':
      return c => Math.min(...args.map(arg => Number(arg(c))));
    case 'max':
      return c => Math.max(...args.map(arg => Number(arg(c))));
    case 'abs':
      return c => Math.abs(Number(at(0)(c)));
    case 'eq':
      return c => at(0)(c) === at(1)(c);
    case 'ne':
      return c => at(0)(c) !== at(1)(c);
    case 'lt':
      return c => Number(at(0)(c)) < Number(at(1)(c));
    case 'le':
      return c => Number(at(0)(c)) <= Number(at(1)(c));
    case 'gt':
      return c => Number(at(0)(c)) > Number(at(1)(c));
    case 'ge':
      return c => Number(at(0)(c)) >= Number(at(1)(c));
    case 'between':
      return c => {
        const value = Number(at(0)(c));
        return value >= Number(at(1)(c)) && value <= Number(at(2)(c));
      };
  }
}

/**
 * 结构化 spec 的谓词。顶层必须是布尔（`check: (color) => boolean` 是 `BadgeDef` 的契约），
 * 这里用类型推断在编译期就拒绝非布尔顶层。
 */
export function toPredicate(expr: Expr): (c: ColorInfo) => boolean {
  assertBooleanTopLevel(expr, 'when');
  const fn = compile(expr);
  return color => fn(color) === true;
}

function assertBooleanTopLevel(expr: Expr, path: string): void {
  const type = topLevelType(expr);
  if (type !== 'boolean') {
    throw new SpecError(`顶层条件必须是布尔（比较 / 逻辑 / 布尔 helper），推断出 ${type}`, path);
  }
  validateTypes(expr, path);
}

/** `self` 在类型推断里交给调用方决定：这里先统一把它当成「颜色对象」。 */
function topLevelType(expr: Expr): ExprType {
  if (expr.kind === 'self') return 'boolean';
  return inferType(expr);
}

/** 逐节点检查明显的类型错误（拒绝 spec，而不是等 `tsc` 在写盘后报错）。 */
function validateTypes(expr: Expr, path: string): void {
  if (expr.kind === 'const' || expr.kind === 'self' || expr.kind === 'field' || expr.kind === 'hsl') return;
  if (expr.kind === 'call') {
    expr.args.forEach((arg, index) => {
      validateTypes(arg, `${path}.${expr.name}[${index}]`);
      if (arg.kind === 'const' && typeof arg.value === 'boolean') {
        throw new SpecError(`${expr.name} 不接受布尔参数`, `${path}.${expr.name}[${index}]`);
      }
    });
    return;
  }
  expr.args.forEach((arg, index) => validateTypes(arg, `${path}.${expr.name}[${index}]`));
  const types = expr.args.map(arg => (arg.kind === 'const' ? (typeof arg.value as ExprType) : topLevelType(arg)));
  const need = (index: number, expected: ExprType, what: string): void => {
    const type = types[index]!;
    if (type !== expected) {
      throw new SpecError(`${what} 需要 ${expected}，第 ${index + 1} 个参数是 ${type}`, `${path}.${expr.name}`);
    }
  };
  switch (expr.name) {
    case 'and':
    case 'or':
      types.forEach((type, index) => {
        if (type !== 'boolean') throw new SpecError(`and/or 只接受布尔，第 ${index + 1} 个是 ${type}`, path);
      });
      break;
    case 'not':
      need(0, 'boolean', 'not');
      break;
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'min':
    case 'max':
    case 'abs':
      types.forEach((type, index) => {
        if (type !== 'number') throw new SpecError(`算术运算只接受数字，第 ${index + 1} 个是 ${type}`, path);
      });
      break;
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
    case 'between':
      types.forEach((type, index) => {
        if (type !== 'number' && type !== 'string') {
          throw new SpecError(`比较只接受数字或字符串，第 ${index + 1} 个是 ${type}`, path);
        }
      });
      break;
    case 'eq':
    case 'ne':
      break;
  }
}

// ───────────────────────────── toSource ─────────────────────────────

/** 运算符优先级（数字越大越紧）。 */
const PRECEDENCE: Readonly<Record<OpName, number>> = {
  or: 1,
  and: 2,
  not: 3,
  eq: 4,
  ne: 4,
  lt: 4,
  le: 4,
  gt: 4,
  ge: 4,
  between: 4,
  add: 5,
  sub: 5,
  mul: 6,
  div: 6,
  mod: 6,
  abs: 7,
  min: 8,
  max: 8,
};

const COMPARISON_SYMBOL: Readonly<Partial<Record<OpName, string>>> = {
  eq: '===',
  ne: '!==',
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
};

/** 渲染成 TypeScript 表达式。必要时加括号（宁可多一层，也不改变语义）。 */
export function toSource(expr: Expr): string {
  return render(expr, 0);
}

function render(expr: Expr, parentPrecedence: number): string {
  const text = renderRaw(expr);
  const precedence = expr.kind === 'op' ? PRECEDENCE[expr.name] : 9;
  return precedence < parentPrecedence ? `(${text})` : text;
}

function renderRaw(expr: Expr): string {
  switch (expr.kind) {
    case 'const':
      return renderConst(expr.value);
    case 'self':
      return 'c';
    case 'field':
      return `c.${expr.name}`;
    case 'hsl':
      return `c.hsl.${expr.name}`;
    case 'call':
      return `${expr.name}(${expr.args.map(arg => render(arg, 0)).join(', ')})`;
    case 'op':
      return renderOp(expr.name, expr.args);
  }
}

function renderConst(value: number | string | boolean): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SpecError(`字面量必须是有限数，收到 ${value}`, 'const');
    return String(value);
  }
  return String(value);
}

function renderOp(name: OpName, args: Expr[]): string {
  const level = PRECEDENCE[name];
  switch (name) {
    case 'and':
      return args.map(arg => render(arg, level + 1)).join(' && ');
    case 'or':
      return args.map(arg => render(arg, level + 1)).join(' || ');
    case 'not':
      return `!(${render(args[0]!, 0)})`;
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod': {
      const symbol = { add: '+', sub: '-', mul: '*', div: '/', mod: '%' }[name];
      let out = render(args[0]!, level);
      for (let i = 1; i < args.length; i += 1) out += ` ${symbol} ${render(args[i]!, level + 1)}`;
      return out;
    }
    case 'min':
    case 'max':
      return `Math.${name}(${args.map(arg => render(arg, 0)).join(', ')})`;
    case 'abs':
      return `Math.abs(${render(args[0]!, 0)})`;
    case 'between': {
      const [value, low, high] = args as [Expr, Expr, Expr];
      return `(${render(value, level + 1)} >= ${render(low, level + 1)} && ${render(value, level + 1)} <= ${render(high, level + 1)})`;
    }
    default: {
      const symbol = COMPARISON_SYMBOL[name]!;
      return `${render(args[0]!, level + 1)} ${symbol} ${render(args[1]!, level + 1)}`;
    }
  }
}

/** 收集表达式里用到的 helper 名（`insert.ts` 用它检查目标文件是否已 import）。 */
export function collectHelperNames(expr: Expr): string[] {
  const found = new Set<string>();
  const walk = (node: Expr): void => {
    if (node.kind === 'call') {
      found.add(node.name);
      node.args.forEach(walk);
    } else if (node.kind === 'op') {
      node.args.forEach(walk);
    }
  };
  walk(expr);
  return [...found].sort();
}

// ───────────────────────────── 手写路径 ─────────────────────────────

/** 从表达式里抽出所有「自由标识符」（去掉字符串、属性名、对象字面量键、箭头函数形参）。 */
export function freeIdentifiers(source: string): string[] {
  const stripped = source
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\/[^\n]*/g, '');

  const locals = new Set<string>();
  // 箭头函数形参：`x =>` 或 `(a, b) =>`
  for (const match of stripped.matchAll(/(?:^|[^\w$.])(\(([^()]*)\)|[A-Za-z_$][\w$]*)\s*=>/g)) {
    const params = match[2];
    if (params !== undefined) {
      for (const part of params.split(',')) {
        const name = part.trim().split(/[\s=:]/)[0];
        if (name) locals.add(name);
      }
    } else if (match[1]) {
      locals.add(match[1]);
    }
  }

  const free = new Set<string>();
  const regex = /(^|[^\w$.'"])([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const name = match[2]!;
    if (name === 'true' || name === 'false' || name === 'null' || name === 'undefined') continue;
    if (locals.has(name)) continue;
    free.add(name);
  }
  return [...free].sort();
}

export interface HandwrittenDiagnosis {
  /** 无法解析的标识符（既不是白名单，也不是作者提供的 evalHelpers）。 */
  unknownIdentifiers: string[];
  /** 命中了拒绝表。 */
  deniedIdentifiers: string[];
  /** 表达式里被引用、且由 `evalHelpers` 提供的名字（按其出现顺序）。 */
  usedEvalHelpers: string[];
}

/**
 * 静态诊断手写表达式。
 *
 * **这不是安全边界**：`new Function` 的求值环境由白名单参数构成，但 JS 本身
 * 可以通过原型链做很多事。它存在的意义是「防呆 + 让干跑可执行」。
 */
export function diagnoseHandwritten(
  check: string,
  evalHelpers: Record<string, string> = {},
): HandwrittenDiagnosis {
  const identifiers = freeIdentifiers(check);
  const denied = identifiers.filter(name => DENIED_IDENTIFIERS.includes(name));
  const allowed = new Set<string>([...BASE_HELPER_NAMES, ...EXTRA_ALLOWED_IDENTIFIERS]);
  const helperNames = Object.keys(evalHelpers);
  const unknown = identifiers.filter(name => !allowed.has(name) && !helperNames.includes(name));
  const usedEvalHelpers = helperNames.filter(name => identifiers.includes(name));
  return { unknownIdentifiers: unknown, deniedIdentifiers: denied, usedEvalHelpers };
}

/** 用白名单参数把 `evalHelpers` 组成一个受限作用域，返回它们的实现。 */
function materializeEvalHelpers(evalHelpers: Record<string, string>): Record<string, unknown> {
  const names = Object.keys(evalHelpers);
  if (names.length === 0) return {};
  const body = names.map(name => `const ${name} = (${evalHelpers[name]});`).join('\n');
  // 形参只有白名单 helper 名；evalHelpers 之间可以互相引用（按声明顺序）。
  const factory = new Function(...BASE_HELPER_NAMES, `"use strict";\n${body}\nreturn { ${names.join(', ')} };`);
  const values = BASE_HELPER_NAMES.map(name => BASE_HELPERS[name]);
  return factory(...values) as Record<string, unknown>;
}

/**
 * 编译手写表达式成谓词。
 *
 * 参数顺序：`(c, ...白名单 helper, ...evalHelpers)` —— 全部来自白名单，
 * 所以没有任何位置可以注入 `process` / `require`。
 */
export function compileHandwritten(
  check: string,
  evalHelpers: Record<string, string> = {},
): (c: ColorInfo) => unknown {
  const diagnosis = diagnoseHandwritten(check, evalHelpers);
  if (diagnosis.deniedIdentifiers.length > 0) {
    throw new SpecError(`手写表达式含有禁止的标识符：${diagnosis.deniedIdentifiers.join(', ')}`, 'handwritten.check');
  }
  if (diagnosis.unknownIdentifiers.length > 0) {
    throw new SpecError(
      `手写表达式引用了无法求值的标识符：${diagnosis.unknownIdentifiers.join(', ')}。`
      + '它们既不是 helpers.ts 的成员，也没有在 evalHelpers 里给出等价实现（仅用于干跑求值）。',
      'handwritten.check',
    );
  }
  const helperValues = materializeEvalHelpers(evalHelpers);
  const helperNames = Object.keys(evalHelpers);
  const fn = new Function(
    'c',
    ...BASE_HELPER_NAMES,
    ...helperNames,
    `"use strict"; return (${check});`,
  ) as (...args: unknown[]) => unknown;
  const values = BASE_HELPER_NAMES.map(name => BASE_HELPERS[name]);
  const extra = helperNames.map(name => helperValues[name]);
  return color => fn(color, ...values, ...extra);
}

/** 供测试与 `insert.ts` 复用：白名单 helper 的运行时实现。 */
export function baseHelper(name: string): unknown {
  return BASE_HELPERS[name];
}
