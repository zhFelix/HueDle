/**
 * 把一份 {@link BadgeSpec} 编译成「源码片段 + 可执行谓词 + 静态检查所需的名字」。
 *
 * 两条路径在这里合流（docs/ADMIN.md §3.2）：
 *   - 结构化：`toSource()` / `toPredicate()`；
 *   - 手写：单表达式 + 作者提供的 `evalHelpers`（**只用于干跑求值**，不写进仓库）。
 */
import type { ColorInfo } from '@huedle/shared';
import {
  BASE_HELPER_NAMES,
  EXTRA_ALLOWED_IDENTIFIERS,
  compileHandwritten,
  collectHelperNames,
  diagnoseHandwritten,
  freeIdentifiers,
  toPredicate,
  toSource,
} from './build';
import { importedHelperNames, readFamilyFile, hasLocalDeclaration } from './families';
import { SpecError, isHandwritten, type BadgeSpec } from './spec';

export interface CompiledBadge {
  /** 插入文件里的 `check` 源码（结构化 = 表达式；手写 = 作者写的单表达式）。 */
  source: string;
  /** 干跑用的谓词（允许返回 unknown，由干跑检查是否为布尔）。 */
  predicate: (color: ColorInfo) => unknown;
  /** 结构化路径用到的 helpers.ts 函数（必须已经在目标文件里 import）。 */
  helperNames: string[];
  /** 手写路径引用的、必须已经在目标文件里声明的 private helper。 */
  localNames: string[];
  /** 作者为干跑提供的 private helper 副本（只提示漂移，不写盘）。 */
  evalHelperNames: string[];
}

/** 白名单：helpers + `c`/`Math`/`Set` …（与 `build.ts` 共用同一份契约）。 */
export function allowedIdentifiers(): Set<string> {
  return new Set([...BASE_HELPER_NAMES, ...EXTRA_ALLOWED_IDENTIFIERS]);
}

/** 编译并做**写盘前**的静态检查（import 是否齐、private helper 是否存在）。 */
export function compileSpec(spec: BadgeSpec, root: string): CompiledBadge {
  const content = readFamilyFile(root, spec.family).content;

  if (!isHandwritten(spec)) {
    const source = toSource(spec.when);
    const helperNames = collectHelperNames(spec.when);
    assertHelpersImported(content, helperNames);
    return { source, predicate: toPredicate(spec.when), helperNames, localNames: [], evalHelperNames: [] };
  }

  const check = spec.handwritten.check;
  const evalHelpers = spec.handwritten.evalHelpers ?? {};
  const diagnosis = diagnoseHandwritten(check, evalHelpers);
  if (diagnosis.deniedIdentifiers.length > 0) {
    throw new SpecError(`手写表达式含有禁止的标识符：${diagnosis.deniedIdentifiers.join(', ')}`, 'handwritten.check');
  }
  if (diagnosis.unknownIdentifiers.length > 0) {
    throw new SpecError(
      `手写表达式引用了无法求值的标识符：${diagnosis.unknownIdentifiers.join(', ')}。`
      + '手写路径要求在 spec 里用 evalHelpers 给出一份**仅用于写盘前干跑**的等价实现；'
      + '写进仓库的仍然只是 check 表达式本身（依赖目标文件里已有的 private helper）。',
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

  return {
    source: check,
    predicate: compileHandwritten(check, evalHelpers),
    helperNames,
    localNames,
    evalHelperNames: Object.keys(evalHelpers),
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
