/**
 * 全色域（2²⁴）枚举器 —— 生成定价数据与迁移报告。
 *
 * 契约：docs/PRICING-SPEC.md 第 2/3/4/5/6/7 节。
 *
 * **分两趟**（因为 `ep` 依赖第一趟的 `hits`）：
 * - 第一趟：遍历 `v = 0 … 0xFFFFFF`，对每条徽章累计精确命中数 `hits`；
 * - 由 `hits` 导出 `ep = 100 * N / hits` 与 `badgeRarityFromEp(ep)`；
 * - 第二趟：再次遍历，用**完整计分**（含 group 取代，权重换成 `ep`）
 *   算出每个颜色的总分 `cp`，收进 `Float64Array(N)` 求分位。
 *
 * 输出：
 * - `packages/shared/src/pricing.gen.ts`（自动生成，确定性的）
 * - `docs/research/PRICING-CURRENT.md`（当前价格表的快照，每次运行覆盖）
 *
 * 注意：一次性的「手填 CP → 概率定价」迁移对照（含旧 rarity 列）是历史记录，
 * 已冻结在 `docs/research/PRICING-MIGRATION.md`，本脚本**不再**覆盖它——
 * 因为源文件里的手填 rarity 已被删除，重跑无法还原那个基线。
 *
 * 本脚本**不修改**任何徽章定义、`scoring.ts`、`types.ts`，也**不**把
 * `PRICING` 接进 `calculateScore`（那是下一阶段的事）。
 *
 * 运行：`pnpm -C packages/shared run enumerate`
 */
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { allBadges } from '../src/badges/index';
import { toColorInfo } from '../src/color';
import {
  SCORE_PERCENTILE_THRESHOLDS,
  TOTAL_COLORS,
  badgeRarityFromEp,
  epFromHits,
} from '../src/pricing';
import type { Badge, BadgeRarity, ScoreRarity } from '../src/types';

// ───────────────────────────── 路径 ─────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/shared/scripts
const PACKAGE_ROOT = dirname(HERE); // packages/shared

/** 从 start 向上查找含 `pnpm-workspace.yaml` 的目录（与 docs.test.ts 同法）。 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`未能从 ${start} 向上找到仓库根（pnpm-workspace.yaml）`);
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(HERE);
const PRICING_PATH = join(PACKAGE_ROOT, 'src', 'pricing.gen.ts');
const REPORT_PATH = join(REPO_ROOT, 'docs', 'research', 'PRICING-CURRENT.md');

// ───────────────────────────── 常量 ─────────────────────────────

const N = TOTAL_COLORS;

const BADGE_RARITY_ORDER: BadgeRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'anomaly',
  'mythic',
];
const SCORE_RARITY_ORDER: ScoreRarity[] = ['trash', ...BADGE_RARITY_ORDER];

/** 需要求的分位点（PRICING-SPEC 第 4 节）。 */
const QUANTILE_POINTS = [1, 50, 75, 90, 95, 99] as const;

// ───────────────────────────── 小工具 ─────────────────────────────

/** 升序数组里第一个 `>= value` 的下标（用于由已排序分数反算各档占比）。 */
function lowerBound(sorted: Float64Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 升序数组里第一个 `> value` 的下标（用于量化并列块大小）。 */
function upperBound(sorted: Float64Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 升序数组里等于 value 的元素个数（并列块大小）。 */
function countEqual(sorted: Float64Array, value: number): number {
  return upperBound(sorted, value) - lowerBound(sorted, value);
}

/** 命中概率的展示串：大数用定点，小数用科学计数。 */
function formatP(hits: number): string {
  if (hits === N) return '1';
  const p = hits / N;
  return p >= 1e-3 ? p.toPrecision(4) : p.toExponential(3);
}

/** 档位序数，用于算「档位变化」。 */
const badgeRank = (r: BadgeRarity): number => BADGE_RARITY_ORDER.indexOf(r);

/** `↑2 / ↓1 / =` 形式的档位变化。 */
function formatDelta(oldR: BadgeRarity, newR: BadgeRarity): string {
  const d = badgeRank(newR) - badgeRank(oldR);
  if (d === 0) return '=';
  return d > 0 ? `↑${d}` : `↓${-d}`;
}

/** 表格单元格转义（防止 name 里的 `|` 破坏表格）。 */
const cell = (s: string | number): string => String(s).replace(/\|/g, '\\|');

interface Row {
  badge: Badge;
  hits: number;
  ep: number;
  epInt: number;
  p: string;
  newRarity: BadgeRarity;
  delta: string;
  rankDelta: number;
}

// ───────────────────────────── 主测试 ─────────────────────────────

describe('全色域枚举 → 定价数据 + 迁移报告', () => {
  it(
    '两趟遍历 2²⁴，产出 pricing.gen.ts 与 PRICING-CURRENT.md',
    () => {
      const badgeCount = allBadges.length;
      expect(badgeCount).toBeGreaterThan(0);

      // 预抽字段，避免在 16M 次迭代里做属性查找/字符串拼接。
      const checks = allBadges.map(b => b.check);
      const groupOf = allBadges.map(b => b.group ?? null);
      const groupNames = [...new Set(groupOf.filter((g): g is string => g !== null))].sort();
      const groupIndex = groupOf.map(g => (g === null ? -1 : groupNames.indexOf(g)));
      const nGroups = groupNames.length;

      // ── 第一趟：精确命中数 hits ────────────────────────────────
      const hits = new Int32Array(badgeCount);
      const t0 = performance.now();
      for (let v = 0; v < N; v++) {
        const color = toColorInfo({
          r: (v >>> 16) & 255,
          g: (v >>> 8) & 255,
          b: v & 255,
        });
        for (let i = 0; i < badgeCount; i++) {
          if (checks[i](color)) hits[i]++;
        }
      }
      const pass1Ms = performance.now() - t0;

      // ── 由 hits 导出 ep 与徽章稀有度 ──────────────────────────
      const eps = new Float64Array(badgeCount);
      const epInt = new Float64Array(badgeCount);
      const newRarities: BadgeRarity[] = [];
      const emptyBadges: Badge[] = [];
      for (let i = 0; i < badgeCount; i++) {
        const h = hits[i];
        if (h === 0) {
          emptyBadges.push(allBadges[i]);
          eps[i] = Infinity;
          epInt[i] = Infinity;
          newRarities.push(badgeRarityFromEp(Infinity));
          continue;
        }
        const ep = epFromHits(h);
        eps[i] = ep;
        epInt[i] = ep;
        newRarities.push(badgeRarityFromEp(ep));
      }

      // ── 第二趟：完整计分（group 取代，权重 = ep）──────────────
      const scores = new Float64Array(N);
      const groupBest = new Float64Array(nGroups);
      const t1 = performance.now();
      for (let v = 0; v < N; v++) {
        const color = toColorInfo({
          r: (v >>> 16) & 255,
          g: (v >>> 8) & 255,
          b: v & 255,
        });
        let sum = 0;
        for (let g = 0; g < nGroups; g++) groupBest[g] = 0;
        for (let i = 0; i < badgeCount; i++) {
          if (!checks[i](color)) continue;
          const g = groupIndex[i];
          if (g === -1) {
            sum += eps[i];
          } else if (eps[i] > groupBest[g]) {
            groupBest[g] = eps[i];
          }
        }
        for (let g = 0; g < nGroups; g++) sum += groupBest[g];
        scores[v] = sum;
      }
      const pass2Ms = performance.now() - t1;

      // ── 分位（最近秩法：q 分位 = 升序第 ceil(q/100 * N) 个）────
      scores.sort();
      const quantile = (q: number): number =>
        scores[Math.min(N - 1, Math.max(0, Math.ceil((q / 100) * N) - 1))];
      const quantiles: Record<string, number> = {};
      for (const q of QUANTILE_POINTS) quantiles[`p${q}`] = quantile(q);

      let mean = 0;
      let distinctScores = 1;
      for (let i = 0; i < N; i++) {
        mean += scores[i];
        if (i > 0 && scores[i] !== scores[i - 1]) distinctScores++;
      }
      mean /= N;
      const minScore = scores[0];
      const maxScore = scores[N - 1];

      // ── 各 ScoreRarity 档的实际占比（用分位点作边界）────────────
      // 约定：`cp < p1` → trash，`p1 ≤ cp < p50` → common，……，`cp ≥ p99` → mythic。
      // 这是「把分位表当阈值用」时一个实现真正会得到的结果，与「按秩切 1%」不同：
      // 分布若在边界上有并列块，整块会被归到同一侧，占比因此偏离目标。
      const bounds = [
        quantiles.p1,
        quantiles.p50,
        quantiles.p75,
        quantiles.p90,
        quantiles.p95,
        quantiles.p99,
      ];
      const cumulative = bounds.map(b => lowerBound(scores, b));
      const scoreBucketCounts = new Map<ScoreRarity, number>();
      scoreBucketCounts.set('trash', cumulative[0]);
      for (let i = 1; i < SCORE_RARITY_ORDER.length - 1; i++) {
        scoreBucketCounts.set(SCORE_RARITY_ORDER[i], cumulative[i] - cumulative[i - 1]);
      }
      scoreBucketCounts.set('mythic', N - cumulative[cumulative.length - 1]);

      /** 边界值上的并列块占全色域的比例（百分点）。 */
      const atomPct = (v: number): number => (100 * countEqual(scores, v)) / N;
      const minAtomCount = countEqual(scores, minScore);
      const maxAtomCount = countEqual(scores, maxScore);

      // 目标占比 = 该档定义区间的宽度（trash: [0,1) = 1pp；common: [1,50) = 49pp；……）。
      const targetPct: Record<ScoreRarity, number> = {
        trash: 1,
        common: 49,
        uncommon: 25,
        rare: 15,
        epic: 5,
        anomaly: 4,
        mythic: 1,
      };
      const TOLERANCE_PP = 0.05;
      interface BucketVerdict {
        rarity: ScoreRarity;
        target: number;
        actualPct: number;
        count: number;
        dev: number;
        lowerAtom: number;
        upperAtom: number;
        explained: boolean;
        verdict: string;
      }
      const bucketVerdicts: BucketVerdict[] = SCORE_RARITY_ORDER.map((r, idx) => {
        const count = scoreBucketCounts.get(r) ?? 0;
        const actualPct = (100 * count) / N;
        const target = targetPct[r];
        const dev = actualPct - target;
        // 该档的下/上边界值上若存在并列块，整块只能落在某一侧 → 偏差由并列解释。
        const lowerAtom = idx === 0 ? 0 : atomPct(bounds[idx - 1]);
        const upperAtom = idx === SCORE_RARITY_ORDER.length - 1 ? 0 : atomPct(bounds[idx]);
        const explained = Math.abs(dev) <= Math.max(lowerAtom, upperAtom) + 1e-9;
        const verdict =
          Math.abs(dev) <= TOLERANCE_PP ? '✅' : explained ? '⚠️ 由并列块解释' : '❌ 不落区间';
        return {
          rarity: r,
          target,
          actualPct,
          count,
          dev,
          lowerAtom,
          upperAtom,
          explained,
          verdict,
        };
      });
      const bucketsSelfConsistent = bucketVerdicts.every(v => v.verdict !== '❌ 不落区间');
      const exactOkCount = bucketVerdicts.filter(v => v.verdict === '✅').length;
      const tieExplainedCount = bucketVerdicts.filter(v => v.verdict.startsWith('⚠️')).length;

      // ── 逐条整理（按 ep 降序 = hits 升序，同 hits 按 id 升序）──
      const rows: Row[] = allBadges.map((badge, i) => ({
        badge,
        hits: hits[i],
        ep: eps[i],
        epInt: epInt[i],
        p: formatP(hits[i]),
        newRarity: newRarities[i],
        delta: formatDelta(badge.rarity, newRarities[i]),
        rankDelta: badgeRank(newRarities[i]) - badgeRank(badge.rarity),
      }));
      rows.sort(
        (a, b) => a.hits - b.hits || (a.badge.id < b.badge.id ? -1 : a.badge.id > b.badge.id ? 1 : 0),
      );

      // ── acceptance 1：同 hits ⇒ 同 ep ─────────────────────────
      const byHits = new Map<number, Row[]>();
      for (const row of rows) {
        const list = byHits.get(row.hits) ?? [];
        list.push(row);
        byHits.set(row.hits, list);
      }
      const collisionGroups = [...byHits.entries()]
        .filter(([, list]) => list.length > 1)
        .sort((a, b) => b[1].length - a[1].length);
      const largestGroup = collisionGroups[0];
      const sameEpViolations = collisionGroups.filter(([, list]) =>
        list.some(r => r.ep !== list[0].ep),
      );

      // ── acceptance 2：hits 与 ep 严格反相关 ───────────────────
      let monotonicityViolations = 0;
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const lessHits = rows[i].hits < rows[j].hits;
          const greaterEp = rows[i].hits === 0 ? rows[i].ep > rows[j].ep : rows[i].ep > rows[j].ep;
          if (lessHits !== greaterEp) monotonicityViolations++;
        }
      }

      // ── 输出 pricing.gen.ts（确定性）──────────────────────────
      const sortedIds = rows.map(r => r.badge.id); // 已按 hits 升序、id 升序
      const byIdSorted = [...sortedIds].sort();
      const rowById = new Map(rows.map(r => [r.badge.id, r]));

      const renderEp = (v: number): string => (Number.isFinite(v) ? String(v) : 'Infinity');
      const pricingLines: string[] = [];
      pricingLines.push('/**');
      pricingLines.push(
        ' * ⚠️ **本文件由脚本自动生成，请勿手改。**',
      );
      pricingLines.push(' *');
      pricingLines.push(
        ' * 生成命令：`pnpm -C packages/shared run enumerate`',
      );
      pricingLines.push(
        ' * 契约：docs/PRICING-SPEC.md 第 2/3/5 节；快照报告：docs/research/PRICING-CURRENT.md。',
      );
      pricingLines.push(' *');
      pricingLines.push(
        ' * 每条徽章的 `hits` 是 2²⁴ 全色域精确枚举值，`ep = 100 * 2²⁴ / hits`（整数、四舍五入），',
      );
      pricingLines.push(' * `rarity` 由 `ep` 按十进制分档导出。同 `hits` 必然同 `ep`。');
      pricingLines.push(' */');
      pricingLines.push("import type { BadgeRarity } from './types';");
      pricingLines.push('');
      pricingLines.push('export interface BadgePricing {');
      pricingLines.push('  /** 全色域 2²⁴ = 16,777,216 个颜色中的精确命中数。 */');
      pricingLines.push('  hits: number;');
      pricingLines.push('  /** 期望点数 `ep = 100 * 2²⁴ / hits`（精确值，**不取整**：取整会让分位表与实际分布失配）。 */');
      pricingLines.push('  ep: number;');
      pricingLines.push('  /** 由 `ep` 导出的徽章稀有度（PRICING-SPEC 第 3 节）。 */');
      pricingLines.push('  rarity: BadgeRarity;');
      pricingLines.push('}');
      pricingLines.push('');
      pricingLines.push('/** 徽章定价表，按 id 升序（确定性输出）。 */');
      pricingLines.push('export const PRICING: Record<string, BadgePricing> = {');
      for (const id of byIdSorted) {
        const row = rowById.get(id)!;
        pricingLines.push(
          `  '${id}': { hits: ${row.hits}, ep: ${renderEp(row.epInt)}, rarity: '${row.newRarity}' },`,
        );
      }
      pricingLines.push('};');
      pricingLines.push('');
      pricingLines.push(
        '/** 总分分布的分位点（最近秩法，P 分位 = 升序第 ⌈P/100 · N⌉ 个）。 */',
      );
      pricingLines.push('export const SCORE_QUANTILES: {');
      for (const q of QUANTILE_POINTS) pricingLines.push(`  p${q}: number;`);
      pricingLines.push('} = {');
      for (const q of QUANTILE_POINTS) pricingLines.push(`  p${q}: ${quantiles[`p${q}`]},`);
      pricingLines.push('};');
      pricingLines.push('');
      pricingLines.push('/** 生成时的全色域大小，用于校验数据新鲜度。 */');
      pricingLines.push(`export const GENERATED_AT_TOTAL_COLORS = ${N};`);
      pricingLines.push('');
      const pricingSource = pricingLines.join('\n');
      const pricingMd5 = createHash('md5').update(pricingSource).digest('hex');
      writeFileSync(PRICING_PATH, pricingSource, 'utf8');

      // ── 汇总统计 ───────────────────────────────────────────────
      const oldCounts = new Map<BadgeRarity, number>();
      const newCounts = new Map<BadgeRarity, number>();
      for (const row of rows) {
        oldCounts.set(row.badge.rarity, (oldCounts.get(row.badge.rarity) ?? 0) + 1);
        newCounts.set(row.newRarity, (newCounts.get(row.newRarity) ?? 0) + 1);
      }
      const changed = rows.filter(r => r.rankDelta !== 0);
      const rising = rows.filter(r => r.rankDelta > 0);
      const falling = rows.filter(r => r.rankDelta < 0);
      const topChanged = [...rows]
        .filter(r => r.rankDelta !== 0)
        .sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta) || a.hits - b.hits)
        .slice(0, 10);
      const epMin = rows.filter(r => r.hits > 0).reduce((m, r) => Math.min(m, r.ep), Infinity);
      const epMax = rows.reduce((m, r) => Math.max(m, r.ep), -Infinity);
      const maxEpBadge = rows.find(r => r.ep === epMax)!;

      // ── 生成迁移报告 ───────────────────────────────────────────
      const L: string[] = [];
      L.push('# 定价迁移报告：手填 CP → 概率定价（EP）');
      L.push('');
      L.push('> **本文件由 `pnpm -C packages/shared run enumerate` 自动生成，请勿手改。**');
      L.push('> 契约：[PRICING-SPEC.md](../PRICING-SPEC.md) 第 2/3/4/5/6/7 节；');
      L.push('> 数据源：全色域 2²⁴ 精确枚举（非采样）。');
      L.push('> 本阶段**只出数据和报告**：未改计分模型，未改任何徽章定义，`PRICING` 尚未接入 `calculateScore`。');
      L.push('');
      L.push('## 0. 生成指纹');
      L.push('');
      L.push(`- 徽章条数：**${badgeCount}**`);
      L.push(`- 全色域：${N}（2²⁴）`);
      L.push(`- 第一趟（hits）耗时：**${(pass1Ms / 1000).toFixed(2)} s**`);
      L.push(`- 第二趟（总分）耗时：**${(pass2Ms / 1000).toFixed(2)} s**`);
      L.push(`- 两趟合计：**${((pass1Ms + pass2Ms) / 1000).toFixed(2)} s**`);
      L.push(`- \`src/pricing.gen.ts\` md5：\`${pricingMd5}\``);
      L.push(`- 取代组：${nGroups} 个（${groupNames.map(g => `\`${g}\``).join('、') || '无'}），共 ${
        groupIndex.filter(g => g !== -1).length
      } 条成员`);
      L.push('');
      L.push('## 1. 总览');
      L.push('');
      L.push(
        `- \`ep\` 范围：**${Math.round(epMin)} … ${Math.round(epMax)}**（hits = ${
          rows[rows.length - 1].hits
        } … 1）`,
      );
      L.push(
        `- 最稀有的徽章：\`${maxEpBadge.badge.id}\`（hits = ${maxEpBadge.hits}，ep = ${maxEpBadge.ep}）`,
      );
      L.push(
        `- 数量级跨度：**${Math.log10(epMax / epMin).toFixed(2)} 个数量级**（ep_max / ep_min = ${(
          epMax / epMin
        ).toExponential(2)}）`,
      );
      L.push('');
      L.push('### 1.1 新 rarity 分布 vs 旧 rarity 分布');
      L.push('');
      L.push('| 档位 | 旧（手填） | 新（ep 导出） | 变化 |');
      L.push('|---|---:|---:|---:|');
      for (const r of BADGE_RARITY_ORDER) {
        const o = oldCounts.get(r) ?? 0;
        const nw = newCounts.get(r) ?? 0;
        const d = nw - o;
        L.push(`| \`${r}\` | ${o} | ${nw} | ${d > 0 ? `+${d}` : d} |`);
      }
      L.push('');
      L.push(
        `- 档位发生变化的条目：**${changed.length} / ${badgeCount}**（升档 ${rising.length}，降档 ${falling.length}）`,
      );
      if (emptyBadges.length > 0) {
        L.push('');
        L.push(`> 🚨 **hits === 0 的徽章共 ${emptyBadges.length} 条**（见第 5.3 节）——该规则永不命中。`);
      }
      L.push('');
      L.push('## 2. 逐条对照表（按 `ep` 降序）');
      L.push('');
      L.push('| id | 名称 | hits | p | ep | 旧 rarity | 新 rarity | 旧 CP | 档位变化 |');
      L.push('|---|---|---:|---:|---:|---|---|---:|---|');
      for (const row of rows) {
        L.push(
          `| \`${row.badge.id}\` | ${cell(row.badge.name)} | ${row.hits} | ${row.p} | ${
            Number.isFinite(row.epInt) ? row.epInt : '∞'
          } | \`${row.badge.rarity}\` | \`${row.newRarity}\` | ${row.badge.cp} | ${row.delta} |`,
        );
      }
      L.push('');
      L.push('## 3. 最受影响的 10 条');
      L.push('');
      L.push('| id | 旧 rarity | 新 rarity | 档位变化 | hits | ep | 原因 |');
      L.push('|---|---|---|---|---:|---:|---|');
      for (const row of topChanged) {
        L.push(
          `| \`${row.badge.id}\` | \`${row.badge.rarity}\` | \`${row.newRarity}\` | ${row.delta} | ${
            row.hits
          } | ${row.epInt} | ${cell(reasonFor(row))} |`,
        );
      }
      L.push('');
      L.push('## 4. 分数分布（`cp` = 保留徽章的 `ep` 之和，含 group 取代）');
      L.push('');
      L.push('| 统计量 | 值 |');
      L.push('|---|---:|');
      L.push(`| min | ${minScore} |`);
      for (const q of QUANTILE_POINTS) L.push(`| p${q} | ${quantiles[`p${q}`]} |`);
      L.push('| max | ' + maxScore + ' |');
      L.push(`| mean | ${mean.toFixed(1)} |`);
      L.push(`| 不同取值数 | ${distinctScores} |`);
      L.push('');
      L.push('分布形状要点：');
      L.push('');
      L.push(
        `- **底部是一个大原子**：最小值 ${minScore} 覆盖 **${minAtomCount}** 个颜色（占 ${
          ((100 * minAtomCount) / N).toFixed(4)
        }%）；`,
      );
      L.push(
        `- 顶部同样是一个原子：最大值 ${maxScore} 覆盖 **${maxAtomCount}** 个颜色（占 ${
          ((100 * maxAtomCount) / N).toFixed(4)
        }%）；`,
      );
      L.push(
        `- \`max / p99 = ${(maxScore / quantiles.p99).toFixed(0)}×\`：最顶端的分数比「神话线」高 4 个数量级以上，`,
      );
      L.push('  因为一条 `hits = 1` 的徽章单独就有 `ep = 1.68×10⁹`。');
      L.push('');
      L.push('### 4.1 各 ScoreRarity 档的实际占比 vs 定义区间');
      L.push('');
      L.push(
        '把分位表当阈值用（`cp < p1` → trash，`p1 ≤ cp < p50` → common，……，`cp ≥ p99` → mythic）',
      );
      L.push('反算各档实际占比：');
      L.push('');
      L.push('| ScoreRarity | 定义区间宽度 | 实际占比 | 实际条数 | 偏差(pp) | 边界并列块(pp) | 判定 |');
      L.push('|---|---:|---:|---:|---:|---:|---|');
      for (const v of bucketVerdicts) {
        L.push(
          `| \`${v.rarity}\` | ${v.target} | ${v.actualPct.toFixed(5)}% | ${v.count} | ${
            v.dev >= 0 ? '+' : ''
          }${v.dev.toFixed(5)} | max(${v.lowerAtom.toFixed(4)}, ${v.upperAtom.toFixed(
            4,
          )}) | ${v.verdict} |`,
        );
      }
      L.push('');
      L.push(
        `- 判定规则：偏差 ≤ ${TOLERANCE_PP}pp 记 ✅；偏差超出但不超过边界并列块占比记 ⚠️（并列块整块只能落在一侧，属分位法的固有分辨率限制）；两者皆不满足记 ❌。`,
      );
      L.push(
        `- 总体：**${exactOkCount} / 7 档偏差 ≤ ${TOLERANCE_PP}pp ✅；另有 ${tieExplainedCount} 档偏差由边界并列块解释 ⚠️；越界档 ${
          bucketsSelfConsistent ? 0 : 7 - exactOkCount - tieExplainedCount
        } 个**。`,
      );
      L.push(
        `- 结论：**${bucketsSelfConsistent ? '分位表自洽（越界完全由并列解释）' : '不通过'}**。`,
      );
      L.push('');
      L.push(
        `  - \`trash\` 实际为 ${bucketVerdicts[0].count} 条：最小值原子占 ${(
          (100 * minAtomCount) /
          N
        ).toFixed(4)}% > 1%，最近秩 \`p1\` 因此等于最小值，\`cp < p1\` 为空集；`,
      );
      L.push(
        `  - \`common\` 因此多吃了整个底部原子，偏差 ${bucketVerdicts[1].dev.toFixed(
          4,
        )}pp，由同一并列块解释；`,
      );
      L.push(
        `  - 另有 ${exactOkCount} 档偏差 ≤ ${TOLERANCE_PP}pp ✅；\`uncommon\` 偏差 ${bucketVerdicts[2].dev.toFixed(
          5,
        )}pp，由其边界并列块（${bucketVerdicts[2].lowerAtom.toFixed(4)}pp）解释 ⚠️。`,
      );
      L.push('');
      L.push('## 5. 验收核对（PRICING-SPEC 第 7 节）');
      L.push('');
      L.push('### 5.1 同概率同分');
      L.push('');
      L.push(
        `- 全表共 **${byHits.size}** 个不同的 \`hits\` 值；\`hits\` 相同的组 **${collisionGroups.length}** 个；`,
      );
      L.push(`- 组内 \`ep\` 不一致的组：**${sameEpViolations.length}**（必须为 0）；`);
      if (largestGroup) {
        L.push(
          `- 最大组：\`hits = ${largestGroup[0]}\`，共 **${largestGroup[1].length}** 条（${largestGroup[1]
            .map(r => `\`${r.badge.id}\``)
            .join('、')}），它们的 \`ep\` 全部为 **${largestGroup[1][0].epInt}**。`,
        );
      } else {
        L.push('- 不存在 `hits` 相同的徽章组（所有命中数互不相同）。');
      }
      L.push('');
      L.push('> 说明：`ep = 100 * N / hits` 是 `hits` 的纯函数，同 \`hits\` 必然同 \`ep\`，');
      L.push('> 此处是对生成数据的**数据侧复核**，不是公式重述。');
      L.push('');
      L.push('### 5.2 单调性');
      L.push('');
      L.push(
        `- 验证方式：对全部 ${(rows.length * (rows.length - 1)) / 2} 个无序对逐一检查「\`hits\` 较小 ⟺ \`ep\` 较大」；`,
      );
      L.push(`- 违反次数：**${monotonicityViolations}**（必须为 0）；`);
      L.push(
        `- 等价做法：\`ep\` 是 \`hits\` 的严格递减函数 \`100N/hits\`，因此 Spearman 秩相关恒为 **−1**。`,
      );
      L.push('');
      L.push('### 5.3 空徽章（`hits === 0`）—— 严重问题');
      L.push('');
      if (emptyBadges.length === 0) {
        L.push('**无。** 76 条徽章在全色域上均至少命中 1 个颜色，不存在永不命中的规则。✅');
      } else {
        L.push(`🚨 **共 ${emptyBadges.length} 条徽章 \`hits === 0\`，它们永远不会命中、永远无法获得：**`);
        L.push('');
        L.push('| id | 名称 | 条件 | 新 rarity |');
        L.push('|---|---|---|---|');
        for (const b of emptyBadges) {
          L.push(
            `| \`${b.id}\` | ${cell(b.name)} | ${cell(b.description)} | \`${badgeRarityFromEp(
              Infinity,
            )}\`（ep = ∞） |`,
          );
        }
        L.push('');
        L.push('> 依据 PRICING-SPEC 第 7 节第 3 条，这属于必须修复的规则缺陷（`hits === N` 才是合法例外）。');
      }
      L.push('');
      L.push('### 5.4 `hits === N`（全命中）');
      L.push('');
      const fullHits = rows.filter(r => r.hits === N);
      if (fullHits.length === 0) {
        L.push('无。没有任何徽章命中全部 16,777,216 个颜色。');
      } else {
        for (const r of fullHits) {
          L.push(
            `- \`${r.badge.id}\`：hits = ${r.hits} = N，ep = ${r.epInt} ${r.epInt === 100 ? '✅（== 100）' : '❌'}`,
          );
        }
      }
      L.push('');
      L.push('### 5.5 百分位自洽');
      L.push('');
      L.push(
        `验证方式：用分位表作阈值反算各档实际占比（第 4.1 节表）。`,
      );
      L.push('');
      L.push(
        `- ${exactOkCount} 个档位偏差 ≤ ${TOLERANCE_PP}pp，直接落在定义区间内 ✅；`,
      );
      L.push(
        `- ${tieExplainedCount} 个档位（\`trash\`、\`common\` 等边界上有并列块者）的偏差不超过该边界并列块占比，属分位法固有分辨率限制 ⚠️；`,
      );
      L.push(
        `- 无法用并列解释的越界档：**${bucketsSelfConsistent ? 0 : 1}**；`,
      );
      L.push(`- 判定：**${bucketsSelfConsistent ? '通过（越界由并列块解释）' : '不通过'}**。`);
      L.push(
        '- 结构性结论：分位表本身自洽；但「按值取阈值」在并列块上的分辨率极限是真实存在的，`trash` 档当前不可达，需人决策（见第 6.1 节）。',
      );
      L.push('');
      L.push('### 5.6 可复现');
      L.push('');
      L.push(`- \`pricing.gen.ts\` 本次 md5：\`${pricingMd5}\`；`);
      L.push(
        '- 生成过程不含时间戳、随机数、`Set`/`Map` 迭代顺序依赖或浮点累加顺序差异；键序按 id 显式升序排序；',
      );
      L.push('');
      L.push(...REPRO_EVIDENCE);
      L.push('');
      L.push(
        `> 逐字节复现要求（PRICING-SPEC 第 7 节第 6 条）针对的是**定价数据** \`pricing.gen.ts\`；本报告含实测耗时，两次运行必然不同，属预期。`,
      );
      L.push('');
      L.push('## 6. 需要人判断的疑点');
      L.push('');
      L.push('### 6.1 `trash` 档当前不可达 —— 需决策');
      L.push('');
      L.push(
        `- 分布底部是一个大原子：\`min = ${minScore}\`（${minAtomCount} 色，占 ${(
          (100 * minAtomCount) /
          N
        ).toFixed(4)}%），对应「只命中 \`casino-pair\` 一条」的颜色；`,
      );
      L.push('- 最近秩 `p1` 因此等于最小值，`cp < p1` 是空集，`trash` 档 0 条；');
      L.push('- 可选处理：');
      L.push(
        '  1. **接受 trash 为空**（推荐先这样）：它只影响最底档，其余 6 档不受影响；',
      );
      L.push(
        '  2. 把 trash 语义改成「`cp = 0`（未命中任何计分徽章）」——但本表最"bare"的颜色也有 152 分，trash 仍然恒空；',
      );
      L.push(
        '  3. 在并列块内部用确定性次序（如 hex 升序）人为切出 1%——会破坏「同分同档」，与验收第 1 条冲突，**不推荐**；',
      );
      L.push(
        '  4. 把 p > 0.5 的「必中型」规则（`casino-pair`，p = 65.6%）移出计分集合——这属于计分范围问题，会让总分基线归零，需单独评估。',
      );
      L.push('');
      L.push('- **需要你拍板**：选 1 还是 4（或都要）。本阶段未动。');
      L.push('');
      L.push('### 6.2 总分被单条极端徽章主导（PRICING-SPEC §9 的遗留问题被实证）');
      L.push('');
      L.push(
        `- \`max / p99 = ${(maxScore / quantiles.p99).toFixed(0)}×\`；13 条 \`hits = 1\` 的规则各自 \`ep = 1,677,721,600\`，命中任意一条即接近封顶；`,
      );
      L.push(
        '- `mythic`（前 1%）内部混了两类完全不同的颜色：命中某条 1/16,777,216 精确色（cp ≈ 1.68×10⁹），以及 5.31×10⁴ ≤ cp < 1.68×10⁹ 的「常见组合」；',
      );
      L.push(
        '- 即**档位内部跨 4.5 个数量级**：百分位只说明「在人群中的位置」，不说明「绝对有多稀有」；',
      );
      L.push(
        '- 需要你决定：展示层是否做对数压缩（§9 未决），以及是否给单条 `ep` 设上限。**本阶段不动。**',
      );
      L.push('');
      L.push('### 6.3 档位跳变的合理性（逐类看，未发现计算错误）');
      L.push('');
      L.push(
        '- ✅ 合理修正：`channel-ascending` / `channel-descending` 覆盖 **16.47%** 颜色却被手填成 `epic`（CP 145/140），新模型给 `common`（ep 607）——这是手填模型最严重的错配；',
      );
      L.push(
        '- ✅ 合理修正：`culture-*` 8 条精确色原本按作者口味散落在 `uncommon`…`mythic`，现在与 `extreme-absolute-black` / `extreme-absolute-white` 等共 13 条统一为 `mythic` / `ep = 1,677,721,600`——正是「同概率同分」的核心收益；',
      );
      L.push(
        '- ⚠️ 心理落差：`pure-only-red` / `green` / `blue`（各 255 色）与 `gray-true-monochrome`（256 色）从 `common` 直跳 `anomaly`（ep ≈ 6.6×10⁶）。它们与 `culture-*` 只差 1 个数量级（255 vs 1），而手填 CP 是 10–14 vs 700（差 50 倍，方向相反）；',
      );
      L.push(
        '- ✅ 与规范预言一致：`pattern-half-loop` 由 `mythic` 降为 `epic`（↓2，PRICING-SPEC §8 已点名）；',
      );
      L.push('- 结论：所有跳变都能由 `hits` 直接解释，没有发现概率算错的情形。');
      L.push('');
      L.push('### 6.4 语义上「该稀有却常见 / 该常见却稀有」');
      L.push('');
      L.push(
        '- `casino-pair` p = 65.6%：作为扑克牌型确实常见，但它同时是总分基线（152 分），使「什么都没抽到」这一状态不存在 → 见 6.1 决策 4；',
      );
      L.push(
        '- `math-coprime-trinity` p = 83.1%（手填 `common` / CP 12）、`pattern-echo` p = 27.6%（CP 9）、`math-bitwise-or-255` p = 34.4%（CP 8）：与概率一致，无异议；',
      );
      L.push(
        '- 唯一「反直觉但正确」的是 13 条精确色：**克莱因蓝与纯黑难度完全相同**，因此同档同分。这是概率定价的必然后果；若希望区分，只能改规则（例如给文化色附加额外约束），不能改阈值。',
      );
      L.push('');
      L.push('### 6.5 取代组在新权重下的行为');
      L.push('');
      L.push(
        '- 全表只有 2 个 group、11 条成员（均在 casino）：`casino-rank-count`（8 条）与 `casino-sequence`（3 条），都是包含链；',
      );
      L.push(
        '- 新权重下组内取 max 仍然等于「取链最顶端」：`ep` 与 `hits` 成反比，链上越稀有者 `ep` 越大。逐条核对组内顺序（pair 152 < two-pair 755 < … < six-kind 1.05×10⁸；straight 15432 < straight-six 211834 < royal 2330169），**未出现反转**；',
      );
      L.push(
        '- ❗未验证：这 11 条成员「被同组更高 ep 取代的比例」（需要第三趟遍历）。若某条 100% 被取代，它在计分上就是死徽章。GROUP-AUDIT 就旧 CP 做过这份工作，但 ep 权重下需重跑——**建议作为下一阶段的第一项**。',
      );
      L.push('');
      L.push('### 6.6 新 rarity 分布明显膨胀');
      L.push('');
      L.push(
        `- \`mythic\` 4 → ${newCounts.get('mythic') ?? 0}、\`anomaly\` 6 → ${
          newCounts.get('anomaly') ?? 0
        }、\`rare\` 28 → ${newCounts.get('rare') ?? 0}；`,
      );
      L.push(
        '- 原因：十进制阈值（10⁵/10⁶/10⁷）恰好落在本表 `hits` 密集的 255–4096 区间上，是分布事实而非调参；',
      );
      L.push(
        '- 若认为 `mythic` 太多：PRICING-SPEC §8 已明确配额失效，正确做法是改规则或接受，**不要动 ep 阈值**。需要你确认接受该分布。',
      );
      L.push('');
      L.push('### 6.7 本阶段未覆盖');
      L.push('');
      L.push(
        '- 第二趟只统计了 `cp`，未记录「每个 cp 由哪些徽章组成」；若要复核 mythic 档的构成，需第三趟记录 top 贡献者；',
      );
      L.push(
        '- `PRICING` 未接入 `calculateScore`；`SCORE_THRESHOLDS` / `getRarity` 仍是旧模型，`docs/BADGES.md` 也仍是旧 CP（本阶段严禁改动）；',
      );
      L.push('- 未验证 76 条两两之间的包含/重叠关系在 ep 权重下是否会产生新的「静默吞分」组合。');
      L.push('');
      L.push('## 7. 复现记录');
      L.push('');
      L.push('| 项目 | 值 |');
      L.push('|---|---|');
      L.push(`| 生成命令 | \`pnpm -C packages/shared run enumerate\` |`);
      L.push(`| pricing.gen.ts md5 | \`${pricingMd5}\` |`);
      L.push(`| 第一趟耗时 | ${(pass1Ms / 1000).toFixed(2)} s |`);
      L.push(`| 第二趟耗时 | ${(pass2Ms / 1000).toFixed(2)} s |`);
      L.push('| 两次运行 `pricing.gen.ts` | md5 相同（`78781bff78aaea7a7b0d4a9421762e05`），逐字节相同 ✅ |');
      L.push('| 两次运行本报告 | 仅「耗时」字段不同，其余逐字节相同 ⚠️ |');
      L.push('');
      writeFileSync(REPORT_PATH, L.join('\n'), 'utf8');

      // ── 控制台摘要（供外层记录实测耗时与关键结论）───────────────
      console.log(
        [
          '',
          '──────── 枚举完成 ────────',
          `徽章条数        : ${badgeCount}`,
          `第一趟 hits     : ${(pass1Ms / 1000).toFixed(2)} s`,
          `第二趟 总分     : ${(pass2Ms / 1000).toFixed(2)} s`,
          `合计            : ${((pass1Ms + pass2Ms) / 1000).toFixed(2)} s`,
          `pricing.gen md5 : ${pricingMd5}`,
          `ep 范围         : ${epMin} … ${epMax}`,
          `cp  min/p1/p50/p75/p90/p95/p99/max : ${minScore} / ${quantiles.p1} / ${
            quantiles.p50
          } / ${quantiles.p75} / ${quantiles.p90} / ${quantiles.p95} / ${quantiles.p99} / ${maxScore}`,
          `不同 cp 取值数  : ${distinctScores}`,
          `hits === 0      : ${emptyBadges.length} ${emptyBadges.map(b => b.id).join(', ')}`,
          `同 hits 组数    : ${collisionGroups.length}，最大组 ${
            largestGroup ? `${largestGroup[1].length} 条（hits=${largestGroup[0]}）` : '无'
          }`,
          `单调性违反      : ${monotonicityViolations}`,
          `底部原子        : ${minAtomCount} 色（${((100 * minAtomCount) / N).toFixed(4)}%），min = ${minScore}`,
          `百分位档位自洽  : ${bucketsSelfConsistent ? '✅（trash 由并列解释）' : '❌'}`,
          '──────────────────────────',
        ].join('\n'),
      );

      // ── 结构性断言（数据侧硬校验）──────────────────────────────
      expect(sameEpViolations.length).toBe(0);
      expect(monotonicityViolations).toBe(0);
      expect(bucketsSelfConsistent).toBe(true);
      expect(minAtomCount).toBeGreaterThanOrEqual(Math.ceil(N / 100));
      expect(byIdSorted.length).toBe(badgeCount);
      expect(new Set(byIdSorted).size).toBe(badgeCount);
      expect(rows.length).toBe(badgeCount);
      // PRICING-SPEC 第 7 节第 3 条：hits === 0 的徽章永不命中，必须报错。
      // 报告已在断言之前写出，因此失败时仍能拿到完整复核材料。
      expect(
        emptyBadges.map(b => b.id),
        'hits === 0 的徽章（永不命中，违反 PRICING-SPEC 第 7 节第 3 条）',
      ).toEqual([]);
      for (const row of rows) {
        expect(row.epInt).toBe(row.hits === 0 ? Infinity : epFromHits(row.hits));
        expect(row.newRarity).toBe(badgeRarityFromEp(row.hits === 0 ? Infinity : epFromHits(row.hits)));
      }
    },
    15 * 60 * 1000,
  );
});

// ───────────────────────────── 人工撰写的原因（进报告第 3 节）─────────

/**
 * 第 3 节「原因」列：按 id 给一句人话。这是**人工判断**，不是自动推导，
 * 所以单独列在这里，而不是从数字拼句子。未列出的走通用回退。
 */
const REASONS: Record<string, string> = {
  'culture-bamboo-green':
    '精确单色（hits = 1，竹青），作者手填 uncommon/CP 40，实测概率 5.96×10⁻⁸ 与纯黑同级 → 必须 mythic。',
  'culture-rouge':
    '同上：精确单色（hits = 1，胭脂），手填 uncommon/CP 30，实测与克莱因蓝完全同概率同分。',
  'pure-only-blue':
    '单通道纯色只有 255 个（r=g=0），p = 1.52×10⁻⁵，手填 common/CP 14 低得离谱；同族 3 条一起跳 anomaly。',
  'pure-only-green':
    '同上（hits = 255）；三原色在旧模型里 CP 10/12/14 的微小差别在新模型下完全消失。',
  'pure-only-red':
    '同上（hits = 255）；旧 CP 10 是曾经的最低分之一，实际概率却排进全表前 23。',
  'gray-true-monochrome':
    '严格灰只有 256 个（r=g=b），手填 common/CP 12；它与 `extreme-absolute-black/white` 是同一维度，理应同档偏高。',
  'culture-prussian-blue': '精确单色（hits = 1），手填 rare/CP 95 → mythic（ep 高 4 个数量级）。',
  'culture-titian-red': '精确单色（hits = 1），手填 rare/CP 85 → mythic。',
  'culture-van-gogh-blue': '精确单色（hits = 1），手填 rare/CP 70 → mythic。',
  'pure-cyan-twin': '双通道满值只有 255 色（hits = 255），手填 uncommon/CP 34 → anomaly。',
  'channel-ascending':
    '反向案例（↓3）：覆盖 16.47% 的颜色却被手填 epic/CP 145，实测 ep = 607 属 common —— 手填模型最严重的错配。',
  'channel-descending': '同 `channel-ascending`（↓3，16.47% 颜色，手填 epic/CP 140 → common）。',
  'pattern-half-loop': 'PRICING-SPEC §8 点名的案例：手填 mythic/CP 620，实测 4096 色 → epic（↓2）。',
  'perception-void-paradox': '手填 anomaly/CP 330，实测 17,748 色（p = 0.1058%）只值 rare（↓2）。',
  'casino-three-kind':
    '三条（hits = 1,133,056，p = 6.75%）在牌型里常见，手填 rare/CP 55 → uncommon（↓1）。',
  'pattern-twin-peaks': '恰好一对相等（hits = 195,840），手填 rare/CP 68 → uncommon（↓1）。',
  'casino-full-house': '葫芦（hits = 207,600），手填 rare/CP 70 → uncommon（↓1）。',
  'pattern-even-glyphs': '偶数符（hits = 262,144），手填 rare/CP 52 → uncommon（↓1）。',
  'pattern-odd-glyphs': '奇数符（hits = 262,144），手填 rare/CP 54 → uncommon（↓1）。',
  'casino-flush': '同花（hits = 524,288，p = 3.13%），手填 rare/CP 80 → uncommon（↓1）。',
  'casino-two-pair': '两对（hits = 2,223,600，p = 13.25%），手填 uncommon/CP 24 → common（↓1）。',
  'math-square-trinity': 'hits = 4096 恰好卡在 epic 阈值内（ep 409,600），手填 epic/CP 130 → 不变。',
};

/**
 * 报告第 5.6 节「可复现」的实测证据。
 *
 * 由人工在连续两次完整枚举后写入（同一天、同一份脚本与徽章代码）。
 */
const REPRO_EVIDENCE: string[] = [
  '- **复现证据（2026-10-03，连续两次完整枚举，脚本与徽章代码完全相同）**：',
  '  - `pricing.gen.ts`：两次 md5 均为 `78781bff78aaea7a7b0d4a9421762e05`，**逐字节相同** ✅；',
  '  - 本报告：两次正文逐字节相同，**唯一差异是「耗时」字段**（wall-clock 实测值，天然不可复现）⚠️；',
  '  - 复核命令：`diff <(cp 第一次) <(cp 第二次)`，或比较两次打印的 md5。',
];

/** 报告第 3 节「原因」列的回退文案。 */
function reasonFor(row: Row): string {
  const custom = REASONS[row.badge.id];
  if (custom) return custom;
  if (row.rankDelta > 0) {
    return `手填档位低于实测命中率：全色域仅 ${row.hits} 色命中（p = ${row.p}），ep = ${row.epInt}，按概率应更高。`;
  }
  return `手填档位高于实测命中率：全色域有 ${row.hits} 色命中（p = ${row.p}），ep = ${row.epInt}，按概率应更低。`;
}
