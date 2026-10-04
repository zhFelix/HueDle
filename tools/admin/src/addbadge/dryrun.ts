/**
 * 全色域干跑（docs/ADMIN.md §3.3 阶段 0，S0.3 + S0.4）。
 *
 * **它跑在任何写盘之前**——这套设计最重要的一道防线：`hits === 0`、恒真、
 * `check` 抛异常、与既有徽章构成 `group` 外的必然蕴含，都在这道门被拦下，
 * 工作区**零改动**。
 *
 * 循环与 `toColorInfo` 与 `packages/shared/scripts/enumerate.test.ts` **完全同口径**
 * （`v = 0 … N-1`，`r=(v>>16)&255, g=(v>>8)&255, b=v&255`），否则 hits 对不上。
 *
 * 为了可测，色域大小 `total` 可注入：单测用几千个颜色就能覆盖三类坏条件，
 * 生产路径用 `TOTAL_COLORS`（2²⁴）。
 */
import { PRICING, TOTAL_COLORS, allBadges, toColorInfo } from '@huedle/shared';
import type { ColorInfo, RGB } from '@huedle/shared';

/** 参与冗余检测的既有徽章。 */
export interface ExistingCheck {
  id: string;
  group: string | null;
  check: (color: ColorInfo) => boolean;
  /** 既有徽章的精确命中数（取自 `pricing.gen.ts`，不重算）。 */
  hits: number;
}

export interface Implication {
  id: string;
  direction: 'new-subset-of-old' | 'old-subset-of-new' | 'equal';
  cohits: number;
  jaccard: number;
  /** 同一个非空 group 内的蕴含是**允许**的（阶梯规则）。 */
  allowed: boolean;
}

export interface DryRunResult {
  total: number;
  hits: number;
  /** 第一个抛异常的颜色位置。 */
  exception: { index: number; message: string } | null;
  /** 第一个返回非布尔值的颜色位置。 */
  nonBoolean: { index: number; value: unknown } | null;
  tautology: boolean;
  empty: boolean;
  maxJaccard: { id: string; value: number } | null;
  implications: Implication[];
  /** 人类可读的拒绝理由；为空表示干跑通过。 */
  violations: string[];
  /** 命中/未命中样例（失败时打印，便于一眼看出条件写反了）。 */
  samples: { hits: string[]; misses: string[] };
}

export interface DryRunOptions {
  check: (color: ColorInfo) => unknown;
  existing: readonly ExistingCheck[];
  /** 候选徽章的 group：同组内的必然蕴含是允许的（阶梯规则）。 */
  group?: string | null;
  /** 色域大小，默认 2²⁴。 */
  total?: number;
  /** 样例颜色最多收集几个。 */
  sampleLimit?: number;
}

/** 从 `@huedle/shared` 读出全部既有徽章（含 `check`）与它们的精确 hits。 */
export function loadExistingChecks(): ExistingCheck[] {
  return allBadges.map(badge => {
    const pricing = PRICING[badge.id];
    if (!pricing) {
      throw new Error(
        `既有徽章 "${badge.id}" 缺少定价数据：请先跑 pnpm -C packages/shared run enumerate 把工作区恢复成一致状态。`,
      );
    }
    return {
      id: badge.id,
      group: badge.group ?? null,
      check: badge.check,
      hits: pricing.hits,
    };
  });
}

function rgbAt(index: number): RGB {
  return { r: (index >> 16) & 255, g: (index >> 8) & 255, b: index & 255 };
}

export function runDryRun(options: DryRunOptions): DryRunResult {
  const total = options.total ?? TOTAL_COLORS;
  const sampleLimit = options.sampleLimit ?? 3;
  const { check, existing } = options;
  const group = options.group ?? null;

  const cohits = new Int32Array(existing.length);
  const hits: string[] = [];
  const misses: string[] = [];
  let hitCount = 0;
  let exception: DryRunResult['exception'] = null;
  let nonBoolean: DryRunResult['nonBoolean'] = null;

  for (let v = 0; v < total; v += 1) {
    const color = toColorInfo(rgbAt(v));
    let result: unknown;
    try {
      result = check(color);
    } catch (err) {
      exception = { index: v, message: err instanceof Error ? err.message : String(err) };
      break;
    }
    if (typeof result !== 'boolean') {
      nonBoolean = { index: v, value: result };
      break;
    }
    if (result) {
      hitCount += 1;
      if (hits.length < sampleLimit) hits.push(color.hex);
      for (let i = 0; i < existing.length; i += 1) {
        if (existing[i]!.check(color)) cohits[i]! += 1;
      }
    } else if (misses.length < sampleLimit) {
      misses.push(color.hex);
    }
  }

  const interrupted = exception !== null || nonBoolean !== null;
  const scanned = interrupted ? -1 : total;

  const implications: Implication[] = [];
  let maxJaccard: DryRunResult['maxJaccard'] = null;
  if (!interrupted && hitCount > 0) {
    existing.forEach((badge, index) => {
      const co = cohits[index]!;
      if (co === 0) return;
      const union = hitCount + badge.hits - co;
      const jaccard = union > 0 ? co / union : 0;
      if (maxJaccard === null || jaccard > maxJaccard.value) maxJaccard = { id: badge.id, value: jaccard };
      const newSubset = co === hitCount;
      const oldSubset = co === badge.hits && badge.hits > 0;
      if (!newSubset && !oldSubset) return;
      const allowed = group !== null && badge.group === group;
      implications.push({
        id: badge.id,
        direction: newSubset && oldSubset ? 'equal' : newSubset ? 'new-subset-of-old' : 'old-subset-of-new',
        cohits: co,
        jaccard,
        allowed,
      });
    });
  }

  const violations: string[] = [];
  if (exception) {
    violations.push(`check 在第 ${exception.index} 个颜色上抛异常：${exception.message}`);
  }
  if (nonBoolean) {
    violations.push(
      `check 在第 ${nonBoolean.index} 个颜色上返回了非布尔值（${JSON.stringify(nonBoolean.value)}）——`
      + 'BadgeDef.check 必须是 (color) => boolean',
    );
  }
  if (!interrupted) {
    if (hitCount === 0) violations.push(`hits === 0：这条规则在全色域（${total} 色）里永不命中。`);
    if (hitCount === total) violations.push(`hits === 全色域（${total}）：条件恒真，等于白送分。`);
    for (const item of implications) {
      if (!item.allowed) {
        violations.push(
          `与既有徽章 "${item.id}" 构成必然蕴含（${item.direction}，共命中 ${item.cohits} 色，Jaccard=${item.jaccard.toFixed(4)}）`
          + '且不在同一个 group 里：应改宽/改窄判定，或用 group 表达阶梯关系。',
        );
      }
    }
  }

  return {
    total: scanned < 0 ? total : scanned,
    hits: hitCount,
    exception,
    nonBoolean,
    tautology: !interrupted && hitCount === total,
    empty: !interrupted && hitCount === 0,
    maxJaccard,
    implications,
    violations,
    samples: { hits, misses },
  };
}
