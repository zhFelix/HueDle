/**
 * 把一份 {@link BadgeSpec} 编译成「源码片段 + 可执行谓词 + 静态检查所需的名字」。
 *
 * 两条路径在这里合流（docs/ADMIN.md §3.2）：
 *   - 结构化：`toSource()` / `toPredicate()`；
 *   - 手写：单表达式，引用目标家族文件里 `export` 出来的 private helper。
 *     干跑**异步 import 真品**（{@link loadFamilyHelpers}），作者只给名字列表。
 */
import { createHash } from 'node:crypto';
import type { ColorInfo } from '@huedle/shared';
import {
  BASE_HELPER_NAMES,
  EXTRA_ALLOWED_IDENTIFIERS,
  compileHandwritten,
  collectHelperNames,
  diagnoseHandwritten,
  freeIdentifiers,
  loadFamilyHelpers,
  toPredicate,
  toSource,
} from './build';
import {
  extractLocalDeclaration,
  importedHelperNames,
  hasLocalDeclaration,
  readFamilyFile,
} from './families';
import { SpecError, isHandwritten, type BadgeSpec } from './spec';

export interface CompiledBadge {
  /** 插入文件里的 `check` 源码（结构化 = 表达式；手写 = 作者写的单表达式）。 */
  source: string;
  /** 干跑用的谓词（允许返回 unknown，由干跑检查是否为布尔）。 */
  predicate: (color: ColorInfo) => unknown;
  /** 结构化路径用到的 helpers.ts 函数（必须已经在目标文件里 import）。 */
  helperNames: string[];
  /** 手写路径引用的、必须已经在目标文件里声明的 private helper（= 依赖名字列表）。 */
  localNames: string[];
  /** 作者为干跑声明的 private helper 名字（与 `localNames` 同源）。 */
  evalHelperNames: string[];
  /**
   * 干跑时**磁盘上**的 private helper 声明文本哈希（名字 → md5）。
   *
   * 写盘后用它做内部自检：工具只往文件末尾追加徽章、从不改 helper，
   * 所以哈希必须不变；不同 = 内部错误，立即中止回滚（见 `pipeline.ts`）。
   */
  helperHashes: Record<string, string>;
}

/** 静态分析结果（同步，不 import 任何模块）。 */
export interface StaticAnalysis {
  /** 目标家族文件绝对路径。 */
  path: string;
  /** 目标家族文件内容。 */
  content: string;
  /** 将要写进文件的 `check` 源码。 */
  source: string;
  helperNames: string[];
  localNames: string[];
}

/** 白名单：helpers + `c`/`Math`/`Set` …（与 `build.ts` 共用同一份契约）。 */
export function allowedIdentifiers(): Set<string> {
  return new Set([...BASE_HELPER_NAMES, ...EXTRA_ALLOWED_IDENTIFIERS]);
}

/** 手写路径的静态检查 + 名字归类（同步；干跑前的第一道门，`submit.ts` 也复用）。 */
export function analyzeSpec(spec: BadgeSpec, root: string): StaticAnalysis {
  const { path, content } = readFamilyFile(root, spec.family);

  if (!isHandwritten(spec)) {
    const source = toSource(spec.when);
    // 预校验顶层类型与参数类型（抛 SpecError），但谓词由 compileSpec 真正构造。
    toPredicate(spec.when);
    const helperNames = collectHelperNames(spec.when);
    assertHelpersImported(content, helperNames);
    return { path, content, source, helperNames, localNames: [] };
  }

  const check = spec.handwritten.check;
  const declared = spec.handwritten.evalHelpers ?? [];
  const missingDeclared = declared.filter(name => !hasLocalDeclaration(content, name));
  if (missingDeclared.length > 0) {
    throw new SpecError(
      `handwritten.evalHelpers 列出的名字在目标文件 ${spec.family}.ts 里没有顶层 \`const\` 声明：${missingDeclared.join(', ')}。`
      + '干跑只 import 目标文件里的真品，不接受任何作者提供的实现。',
      'handwritten.evalHelpers',
    );
  }
  const diagnosis = diagnoseHandwritten(check, declared);
  if (diagnosis.deniedIdentifiers.length > 0) {
    throw new SpecError(`手写表达式含有禁止的标识符：${diagnosis.deniedIdentifiers.join(', ')}`, 'handwritten.check');
  }
  if (diagnosis.unknownIdentifiers.length > 0) {
    throw new SpecError(
      `手写表达式引用了无法求值的标识符：${diagnosis.unknownIdentifiers.join(', ')}。`
      + '它既不是 helpers.ts 的成员，也没有出现在 handwritten.evalHelpers（依赖名字列表）里——'
      + '若它是目标文件里的 private helper，请把名字加进该列表。',
      'handwritten.check',
    );
  }

  const identifiers = freeIdentifiers(check);
  const allowed = allowedIdentifiers();
  const helperNames = identifiers.filter(name => BASE_HELPER_NAMES.includes(name));
  const localNames = identifiers.filter(name => !allowed.has(name) && !BASE_HELPER_NAMES.includes(name));
  const missingLocals = localNames.filter(name => !hasLocalDeclaration(content, name));
  if (missingLocals.length > 0) {
    throw new SpecError(
      `手写表达式引用了目标文件 ${spec.family}.ts 里不存在的 private helper：${missingLocals.join(', ')}。`
      + '本工具只做数组末尾的纯插入（不改 import、不确定义新 helper）——请先手工把它加进该家族文件。',
      'handwritten.check',
    );
  }
  assertHelpersImported(content, helperNames);

  return { path, content, source: check, helperNames, localNames };
}

/** helper 声明文本的 md5（`extractLocalDeclaration` 取到的就是文件里的那段源码）。 */
function hashLocalDeclarations(content: string, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const source = extractLocalDeclaration(content, name);
    out[name] = source === undefined ? '' : md5(source);
  }
  return out;
}

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

/**
 * 写盘后的内部自检：private helper 的声明文本是否与干跑时一致。
 *
 * 返回**不一致**的名字列表（空数组 = 通过）。默认实现读磁盘重算；
 * `pipeline.ts` 允许通过 deps 注入，便于测试「不一致 → 内部错误中止」。
 */
export function helperHashMismatches(
  root: string,
  family: BadgeSpec['family'],
  expected: Readonly<Record<string, string>>,
): string[] {
  const names = Object.keys(expected);
  if (names.length === 0) return [];
  const { content } = readFamilyFile(root, family);
  const actual = hashLocalDeclarations(content, names);
  return names.filter(name => actual[name] !== expected[name]);
}

/**
 * 编译并做**写盘前**的静态检查（import 是否齐、private helper 是否存在）。
 *
 * 手写路径会 `await import` 目标家族文件取出**真品** helper；import 失败、
 * 名字不存在（或没 export）都会抛 {@link SpecError}，**不会退回任何副本**。
 */
export async function compileSpec(spec: BadgeSpec, root: string): Promise<CompiledBadge> {
  const analysis = analyzeSpec(spec, root);

  if (!isHandwritten(spec)) {
    const predicate = toPredicate(spec.when);
    return {
      source: analysis.source,
      predicate,
      helperNames: analysis.helperNames,
      localNames: [],
      evalHelperNames: [],
      helperHashes: {},
    };
  }

  const helperHashes = hashLocalDeclarations(analysis.content, analysis.localNames);
  const helpers = await loadFamilyHelpers(analysis.path, analysis.localNames);
  return {
    source: analysis.source,
    predicate: compileHandwritten(spec.handwritten.check, helpers),
    helperNames: analysis.helperNames,
    localNames: analysis.localNames,
    evalHelperNames: [...analysis.localNames],
    helperHashes,
  };
}

/** 生成的源码用到的 helper 必须先 import；否则 `tsc` 会在写盘后失败（我们要更早拒绝）。 */
function assertHelpersImported(content: string, helperNames: readonly string[]): void {
  const imported = new Set(importedHelperNames(content));
  const missing = helperNames.filter(name => !imported.has(name));
  if (missing.length > 0) {
    throw new SpecError(
      `目标家族文件还没有 import 这些 helper：${missing.join(', ')}。`
      + '本工具只做「数组末尾纯插入」，不会替你改 import 行——请先手工把名字加进该文件的 '
      + "`import { … } from './helpers';`，再重跑。",
      'check',
    );
  }
}
