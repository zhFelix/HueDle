/**
 * 全色域干跑（docs/ADMIN.md §3.3 阶段 0，S0.3 + S0.4）。
 *
 * **它跑在任何写盘之前**——这套设计最重要的一道防线：`hits === 0`、恒真、
 * `check` 抛异常、**互相蕴含**（A ≡ B，同一条规则写了两个名字），都在这道门被拦下，
 * 工作区**零改动**。
 *
 * **单向蕴含是警告，不是错误**：部分包含是徽章系统的固有性质——任何更稀有的徽章
 * 必然被更宽的徽章包含。严格拒绝会让越稀有的徽章越加不进去，而那是徽章最有价值的一头。
 * 所以 A ⊆ B / B ⊆ A 只进 `warnings`（等待人确认一次），`implications[].level` 决定级别：
 * `equal → error`、单向 `→ warning`、同 group `→ allowed`。
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
  /**
   * 判定级别（本次改动的核心）：
   *   - `equal`（A ≡ B，互相蕴含）→ **`error`**：同一条规则写了两个名字，会双倍计分，
   *     group 救不了，必须删掉或改写其一；
   *   - 单向蕴含（A ⊆ B 或 B ⊆ A）→ **`warning`**：部分包含是徽章系统的固有性质
   *     （越稀有的徽章越必然被更宽的徽章包含），**不阻止写入**；
   *   - 同一个非空 group 内 → **`allowed`**：阶梯关系的显式表达，既不算错也不算警告。
   */
  level: 'error' | 'warning' | 'allowed';
}

/** 由 `allowed` + `direction` 直接导出级别（单条与批量共用同一口径）。 */
export function implicationLevel(
  direction: Implication['direction'] | PairwiseImplication['direction'],
  allowed: boolean,
): Implication['level'] {
  if (allowed) return 'allowed';
  return direction === 'equal' ? 'error' : 'warning';
}

/** 互相蕴含（真冗余）的拒绝文案。`scope` 说明对方是既有徽章还是同批新徽章。 */
export function equalImplicationMessage(otherId: string, item: { direction: string; cohits: number; jaccard: number }): string {
  return `与 "${otherId}" 构成必然蕴含（${item.direction}，共命中 ${item.cohits} 色，Jaccard=${item.jaccard.toFixed(4)}）`
    + '且不在同一个 group 里：**互相蕴含 = 同一条规则写了两个名字**（会双倍计分），group 救不了等价关系，'
    + '必须删掉或改写其一。';
}

/**
 * 单向蕴含的**警告**文案（不是错误）。必须写清四件事：
 * 方向 / 共命中数 / Jaccard / 对方 id；并明确写出「这是警告不是错误」。
 */
export function subsetWarningMessage(
  subject: string,
  otherId: string,
  item: { direction: string; cohits: number; jaccard: number },
): string {
  return `⚠ 警告，不是错误：${subject}与 "${otherId}" 构成单向蕴含（${item.direction}，共命中 ${item.cohits} 色，`
    + `Jaccard=${item.jaccard.toFixed(4)}）。部分包含是徽章系统的固有性质——任何更稀有的徽章必然被更宽的徽章包含；`
    + '可以用同一个 group 表达阶梯关系，但**不是必须**，这不阻止写入。';
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
  /** 人类可读的**硬错误**拒绝理由；为空表示干跑没有拦住。 */
  violations: string[];
  /** 单向蕴含警告（**不阻止写入**，需要人确认）。 */
  warnings: string[];
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
      const direction = newSubset && oldSubset ? 'equal' : newSubset ? 'new-subset-of-old' : 'old-subset-of-new';
      implications.push({
        id: badge.id,
        direction,
        cohits: co,
        jaccard,
        allowed,
        level: implicationLevel(direction, allowed),
      });
    });
  }

  const violations: string[] = [];
  const warnings: string[] = [];
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
      if (item.level === 'error') {
        violations.push(equalImplicationMessage(item.id, item) + '（对方是既有徽章）');
      } else if (item.level === 'warning') {
        warnings.push(subsetWarningMessage('', item.id, item));
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
    warnings,
    samples: { hits, misses },
  };
}

// ───────────────────────── 批量干跑（一次扫描、N 条候选） ─────────────────────────

/**
 * 批量模式的一条候选。
 *
 * 与单条 `runDryRun` 的区别不只是「跑 N 次」——**新增的徽章彼此之间也可能构成必然蕴含**
 * （A 命中 ⇒ B 命中，且不在同一个 group），这会同时命中、双倍计分，违反
 * `docs/ADD-BADGE.md` 的反冗余规则。所以批量干跑必须补上 **N×N 两两检查**。
 *
 * 为了性能，整批只扫一遍色域：每个颜色上依次求值 N 条候选，同时累计
 * 「候选 × 候选」「候选 × 既有」的共命中矩阵。
 */
export interface BatchCandidate {
  id: string;
  group: string | null;
  check: (color: ColorInfo) => unknown;
}

/** 单个候选的干跑结果（字段与单条 {@link DryRunResult} 对齐，便于人读）。 */
export interface CandidateDryRun {
  id: string;
  group: string | null;
  total: number;
  hits: number;
  exception: DryRunResult['exception'];
  nonBoolean: DryRunResult['nonBoolean'];
  tautology: boolean;
  empty: boolean;
  maxJaccard: DryRunResult['maxJaccard'];
  implications: Implication[];
  /** 该候选自己的**硬错误**。 */
  violations: string[];
  /** 该候选自己的单向蕴含警告（不阻止写入）。 */
  warnings: string[];
  samples: DryRunResult['samples'];
}

/** **新徽章之间**的必然蕴含（单条路径没有这一类检查）。 */
export interface PairwiseImplication {
  a: string;
  b: string;
  direction: 'a-subset-of-b' | 'b-subset-of-a' | 'equal';
  cohits: number;
  jaccard: number;
  /** 同一个非空 group 内的蕴含是允许的（阶梯规则），与单条逻辑口径一致。 */
  allowed: boolean;
  /** 与单条一致：equal → error；单向 → warning；同组 → allowed。 */
  level: Implication['level'];
}

export interface BatchDryRunResult {
  total: number;
  candidates: CandidateDryRun[];
  /** 新 vs 新：所有构成蕴含的候选对（含同组豁免的）。 */
  pairwise: PairwiseImplication[];
  /** 整批的**硬错误**；为空表示整批没有被拦住。 */
  violations: string[];
  /** 整批的单向蕴含警告（**不阻止写入**，需要人确认一次）。 */
  warnings: string[];
}

export interface BatchDryRunOptions {
  candidates: readonly BatchCandidate[];
  existing: readonly ExistingCheck[];
  /** 色域大小，默认 2²⁴。 */
  total?: number;
  sampleLimit?: number;
}

/**
 * 批量干跑：**整批一次扫描**（不是每条扫一遍），并做三类检查：
 *   ① 每条候选自己的 hits=0 / 恒真 / 抛异常 / 非布尔；
 *   ② 每条候选与**既有**徽章的必然蕴含（含同组豁免）；
 *   ③ **新 vs 新**的两两必然蕴含（含同组豁免）——批量特有。
 */
export function runBatchDryRun(options: BatchDryRunOptions): BatchDryRunResult {
  const total = options.total ?? TOTAL_COLORS;
  const sampleLimit = options.sampleLimit ?? 3;
  const { candidates, existing } = options;
  const n = candidates.length;
  const e = existing.length;

  const hits = new Int32Array(n);
  const pairwiseCo = new Int32Array(n * n);
  const existingCo = new Int32Array(n * e);
  const exceptions: Array<DryRunResult['exception']> = Array.from({ length: n }, () => null);
  const nonBooleans: Array<DryRunResult['nonBoolean']> = Array.from({ length: n }, () => null);
  const broken = new Uint8Array(n);
  const sampleHits: string[][] = Array.from({ length: n }, () => []);
  const sampleMisses: string[][] = Array.from({ length: n }, () => []);
  const flags = new Uint8Array(n);
  let brokenCount = 0;

  for (let v = 0; v < total; v += 1) {
    const color = toColorInfo(rgbAt(v));
    flags.fill(0);
    for (let i = 0; i < n; i += 1) {
      if (broken[i]) continue;
      let result: unknown;
      try {
        result = candidates[i]!.check(color);
      } catch (err) {
        exceptions[i] = { index: v, message: err instanceof Error ? err.message : String(err) };
        broken[i] = 1;
        brokenCount += 1;
        continue;
      }
      if (typeof result !== 'boolean') {
        nonBooleans[i] = { index: v, value: result };
        broken[i] = 1;
        brokenCount += 1;
        continue;
      }
      if (result) {
        flags[i] = 1;
        hits[i] = hits[i]! + 1;
        if (sampleHits[i]!.length < sampleLimit) sampleHits[i]!.push(color.hex);
        for (let k = 0; k < e; k += 1) {
          if (existing[k]!.check(color)) existingCo[i * e + k] = existingCo[i * e + k]! + 1;
        }
      } else if (sampleMisses[i]!.length < sampleLimit) {
        sampleMisses[i]!.push(color.hex);
      }
    }
    // 新 vs 新：只有**本颜色上同时命中**的两条才累计共命中。
    for (let i = 0; i < n; i += 1) {
      if (!flags[i]) continue;
      for (let j = 0; j < n; j += 1) {
        if (flags[j]) pairwiseCo[i * n + j] = pairwiseCo[i * n + j]! + 1;
      }
    }
    if (brokenCount === n) break;
  }

  const results: CandidateDryRun[] = [];
  const violations: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < n; i += 1) {
    const candidate = candidates[i]!;
    const exception = exceptions[i]!;
    const nonBoolean = nonBooleans[i]!;
    const interrupted = exception !== null || nonBoolean !== null;
    const hitCount = hits[i]!;

    const implications: Implication[] = [];
    let maxJaccard: DryRunResult['maxJaccard'] = null;
    if (!interrupted && hitCount > 0) {
      for (let k = 0; k < e; k += 1) {
        const co = existingCo[i * e + k]!;
        if (co === 0) continue;
        const old = existing[k]!;
        const union = hitCount + old.hits - co;
        const jaccard = union > 0 ? co / union : 0;
        if (maxJaccard === null || jaccard > maxJaccard.value) maxJaccard = { id: old.id, value: jaccard };
        const newSubset = co === hitCount;
        const oldSubset = co === old.hits && old.hits > 0;
        if (!newSubset && !oldSubset) continue;
        const allowed = candidate.group !== null && old.group === candidate.group;
        const direction = newSubset && oldSubset ? 'equal' : newSubset ? 'new-subset-of-old' : 'old-subset-of-new';
        implications.push({
          id: old.id,
          direction,
          cohits: co,
          jaccard,
          allowed,
          level: implicationLevel(direction, allowed),
        });
      }
    }

    const own: string[] = [];
    const ownWarnings: string[] = [];
    if (exception) {
      own.push(`徽章 "${candidate.id}" 的 check 在第 ${exception.index} 个颜色上抛异常：${exception.message}`);
    }
    if (nonBoolean) {
      own.push(
        `徽章 "${candidate.id}" 的 check 在第 ${nonBoolean.index} 个颜色上返回了非布尔值（${JSON.stringify(nonBoolean.value)}）——`
        + 'BadgeDef.check 必须是 (color) => boolean',
      );
    }
    if (!interrupted) {
      if (hitCount === 0) own.push(`徽章 "${candidate.id}"：hits === 0——这条规则在全色域（${total} 色）里永不命中。`);
      if (hitCount === total) own.push(`徽章 "${candidate.id}"：hits === 全色域（${total}）——条件恒真，等于白送分。`);
      for (const item of implications) {
        if (item.level === 'error') {
          own.push(equalImplicationMessage(item.id, item) + `（对方是既有徽章；新徽章 "${candidate.id}"）`);
        } else if (item.level === 'warning') {
          ownWarnings.push(subsetWarningMessage(`徽章 "${candidate.id}"：`, item.id, item));
        }
      }
    }

    results.push({
      id: candidate.id,
      group: candidate.group,
      total,
      hits: hitCount,
      exception,
      nonBoolean,
      tautology: !interrupted && hitCount === total,
      empty: !interrupted && hitCount === 0,
      maxJaccard,
      implications,
      violations: own,
      warnings: ownWarnings,
      samples: { hits: sampleHits[i]!, misses: sampleMisses[i]! },
    });
    violations.push(...own);
    warnings.push(...ownWarnings);
  }

  // ── 新 vs 新：N×N 两两检查（批量特有的反冗余门）────────────────
  const pairwise: PairwiseImplication[] = [];
  const interruptedCandidate = (index: number): boolean =>
    exceptions[index] !== null || nonBooleans[index] !== null;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // 扫描中途抛异常/返回非布尔的候选，其 hits 与共命中都是**部分**的，
      // 据此判蕴含会得出错误结论——跳过（它自己已经在 violations 里被点名）。
      if (interruptedCandidate(i) || interruptedCandidate(j)) continue;
      const co = pairwiseCo[i * n + j]!;
      if (co === 0) continue;
      const a = candidates[i]!;
      const b = candidates[j]!;
      const ha = hits[i]!;
      const hb = hits[j]!;
      const aSubset = co === ha && ha > 0;
      const bSubset = co === hb && hb > 0;
      if (!aSubset && !bSubset) continue;
      const union = ha + hb - co;
      const jaccard = union > 0 ? co / union : 0;
      const allowed = a.group !== null && a.group === b.group;
      const direction = aSubset && bSubset ? 'equal' : aSubset ? 'a-subset-of-b' : 'b-subset-of-a';
      const item: PairwiseImplication = {
        a: a.id,
        b: b.id,
        direction,
        cohits: co,
        jaccard,
        allowed,
        level: implicationLevel(direction, allowed),
      };
      pairwise.push(item);
      if (item.level === 'error') {
        violations.push(
          `新徽章 "${a.id}" 与 "${b.id}" 之间构成必然蕴含（两条规则完全等价，共命中 ${co} 色，Jaccard=${jaccard.toFixed(4)}）`
          + '且不在同一个 group 里：两条会同时命中、双倍计分，必须合并/改写其一（group 救不了等价关系）。',
        );
      } else if (item.level === 'warning') {
        const narrow = direction === 'a-subset-of-b' ? a.id : b.id;
        warnings.push(
          subsetWarningMessage(`新徽章 "${a.id}" 与 "${b.id}"（"${narrow}" 是另一条的子集）：`, item.a === narrow ? b.id : a.id, item)
            + `（对方是同批新徽章；共命中 ${co} 色）`,
        );
      }
    }
  }

  return { total, candidates: results, pairwise, violations, warnings };
}
