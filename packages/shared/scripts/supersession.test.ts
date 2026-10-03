/**
 * 取代（supersession）审计 —— 查找「计分死徽章」。
 *
 * 问题：有没有徽章在**所有**命中它的颜色上，都会被同 group 更高 `ep` 的成员取代？
 * 若有，它的存在就只是图鉴摆设，玩家永远拿不到它的分。
 *
 * 方法：对全色域 `v = 0 … 0xFFFFFF`（2²⁴ = 16,777,216）**单趟**遍历，
 * 只对**有 `group` 的成员**（目前 2 组共 11 条）跑 `check`。对每个成员统计：
 *
 * - `hits`        ：该徽章命中的颜色数（应与 `PRICING[id].hits` 一致 —— 交叉校验）；
 * - `superseded`  ：命中它、且同组存在另一名成员（同样命中该颜色且）`ep` 严格更大的颜色数；
 * - `ratio`       ：`superseded / hits`；
 * - `lostCp`      ：`Σ (被取代时的 ep)`，即 RNGdle 所谓的 *earned but never paid*。
 *
 * 取代语义与 `src/scoring.ts` 的 `calculateScore` 保持一致：同 group 只保留 `ep`
 * 最高的一条，`ep` 相等时**不**互相取代（判定用严格大于）。
 *
 * 输出：`docs/research/SUPERSESSION-AUDIT.md`（每次运行覆盖）。
 * 运行：`pnpm -C packages/shared run supersession`
 *
 * 注意：本脚本**不修改**任何徽章定义、`scoring.ts`、`pricing.gen.ts`；
 * 若发现 100% 被取代的徽章，只报告，不自行改徽章或 group。
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { allBadges } from '../src/badges/index';
import { toColorInfo } from '../src/color';
import { TOTAL_COLORS } from '../src/pricing';
import { PRICING } from '../src/pricing.gen';
import type { Badge, ColorInfo } from '../src/types';

// ───────────────────────────── 路径 ─────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/shared/scripts
const PACKAGE_ROOT = dirname(HERE); // packages/shared

/** 从 start 向上查找含 `pnpm-workspace.yaml` 的目录（与 enumerate.test.ts 同法）。 */
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
const REPORT_PATH = join(REPO_ROOT, 'docs', 'research', 'SUPERSESSION-AUDIT.md');

const N = TOTAL_COLORS;

// ───────────────────────────── 小工具 ─────────────────────────────

interface MemberAudit {
  badge: Badge;
  /** 所属 group 名。 */
  group: string;
  /** 该徽章的 `ep`（= `cp`，来自 `PRICING`）。 */
  ep: number;
  /** 命中颜色数（本趟实测）。 */
  hits: number;
  /** 命中且被同组更高 ep 成员取代的颜色数。 */
  superseded: number;
  /** 被取代时损失的 `ep` 之和。 */
  lostCp: number;
  /** `superseded / hits`。 */
  ratio: number;
}

/** 表格单元格转义（防止 name 里的 `|` 破坏表格）。 */
const cell = (s: string | number): string => String(s).replace(/\|/g, '\\|');

/** 整数千位分隔。 */
const comma = (n: number): string => Math.round(n).toLocaleString('en-US');

/** 比例展示（6 位小数百分比）。 */
const pct = (r: number): string => `${(100 * r).toFixed(6)}%`;

// ───────────────────────────── 主测试 ─────────────────────────────

describe('取代（supersession）审计', () => {
  it(
    '全色域 2²⁴ 单趟遍历：11 条 group 成员的取代比例',
    () => {
      // ── 只取有 group 的成员，按 group 归并（顺序固定：组名升序、组内声明序）──
      const grouped = new Map<string, Badge[]>();
      for (const badge of allBadges) {
        if (!badge.group) continue;
        const list = grouped.get(badge.group) ?? [];
        list.push(badge);
        grouped.set(badge.group, list);
      }
      const groupNames = [...grouped.keys()].sort();
      const members: MemberAudit[] = [];
      const groupOf: number[] = [];
      for (const g of groupNames) {
        for (const badge of grouped.get(g)!) {
          members.push({
            badge,
            group: g,
            ep: badge.cp,
            hits: 0,
            superseded: 0,
            lostCp: 0,
            ratio: 0,
          });
          groupOf.push(groupNames.indexOf(g));
        }
      }
      const n = members.length;
      const nGroups = groupNames.length;
      expect(n, '有 group 的成员条数').toBeGreaterThan(0);
      expect(groupOf.length).toBe(n);

      // 预抽字段：16M 次迭代里不做属性查找。
      const checks = members.map(m => m.badge.check as (c: ColorInfo) => boolean);
      const eps = Float64Array.from(members.map(m => m.ep));
      const hits = new Int32Array(n);
      const superseded = new Int32Array(n);
      const lostCp = new Float64Array(n);
      const hitFlag = new Uint8Array(n);
      const groupBest = new Float64Array(nGroups);
      // 组内两两命中集合交集计数：inter[a * n + b] = |hit(a) ∩ hit(b)|
      const inter = new Float64Array(n * n);
      const hitList = new Int32Array(n);

      // ── 单趟遍历 ──────────────────────────────────────────────
      const t0 = performance.now();
      for (let v = 0; v < N; v++) {
        const color = toColorInfo({ r: (v >>> 16) & 255, g: (v >>> 8) & 255, b: v & 255 });
        for (let g = 0; g < nGroups; g++) groupBest[g] = -1;
        let hc = 0;
        for (let k = 0; k < n; k++) {
          if (checks[k](color)) {
            hitFlag[k] = 1;
            hits[k]++;
            hitList[hc++] = k;
            const g = groupOf[k];
            if (eps[k] > groupBest[g]) groupBest[g] = eps[k];
          } else {
            hitFlag[k] = 0;
          }
        }
        for (let a = 0; a < hc; a++) {
          const base = hitList[a] * n;
          for (let b = 0; b < hc; b++) inter[base + hitList[b]]++;
        }
        for (let k = 0; k < n; k++) {
          if (hitFlag[k] && eps[k] < groupBest[groupOf[k]]) {
            superseded[k]++;
            lostCp[k] += eps[k];
          }
        }
      }
      const elapsedMs = performance.now() - t0;

      // 把裸数组计数回填到成员对象上。
      members.forEach((m, k) => {
        m.hits = hits[k];
        m.superseded = superseded[k];
        m.lostCp = lostCp[k];
        m.ratio = m.hits === 0 ? 0 : m.superseded / m.hits;
      });

      // ── 全组表格行（组内按 ep 降序）────────────────────────────
      const tableRows: { group: string; m: MemberAudit }[] = [];
      for (const g of groupNames) {
        const list = members.filter(m => m.group === g).sort((a, b) => b.ep - a.ep);
        for (const m of list) tableRows.push({ group: g, m });
      }

      // ── 交叉校验：hits 是否等于 PRICING.hits ───────────────────
      const hitsMismatches = members.filter(m => m.hits !== PRICING[m.badge.id]?.hits);

      // ── 100% 被取代（计分死徽章）──────────────────────────────
      const deadBadges = members.filter(m => m.ratio === 1);

      // ── 每个 group 的 ep 最大成员，取代比例必须为 0 ─────────────
      const maxEpBreakers: string[] = [];
      for (const g of groupNames) {
        const list = members.filter(m => m.group === g);
        const maxEp = Math.max(...list.map(m => m.ep));
        for (const m of list) {
          if (m.ep === maxEp && m.ratio !== 0) {
            maxEpBreakers.push(`${m.badge.id}（ep=${Math.round(m.ep)}，ratio=${pct(m.ratio)}）`);
          }
        }
      }

      // ── 单调性：同组内 ep 越大 ⇒ ratio 越小（允许相等）──────────
      const monotonicViolations: string[] = [];
      for (const g of groupNames) {
        const list = members.filter(m => m.group === g).sort((a, b) => b.ep - a.ep);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            if (list[i].ep > list[j].ep && list[i].ratio > list[j].ratio + 1e-12) {
              monotonicViolations.push(
                `${g}: ${list[i].badge.id}（ep=${Math.round(list[i].ep)}，ratio=${pct(
                  list[i].ratio,
                )}）> ${list[j].badge.id}（ep=${Math.round(list[j].ep)}，ratio=${pct(list[j].ratio)}）`,
              );
            }
          }
        }
      }

      // ── 明显不健康：比例 > 99% ─────────────────────────────────
      const unhealthy = members.filter(m => m.ratio > 0.99).sort((a, b) => b.ratio - a.ratio);

      // ── 取代必须由「包含关系」解释，而不是由 ep 排序解释 ────────
      // 同组内若 A 的命中集合 ⊆ B 的，则 A 命中的每一色 B 也命中；
      // 又因 A 更窄 ⇒ hits 更少 ⇒ ep 更大，B 在这些色上必被 A 取代 ⇒ superseded(B) ≥ hits(A)。
      //
      // 注意：不能反过来期望「ep 越大 ⇒ 取代比例越小」——group 允许是**偏序/DAG**而非全序链
      // （casino-rank-count 就是：casino-triple-pair 与 casino-three-kind 互不包含，
      // 前者因此 0% 被取代，尽管它的 ep 更低）。那条期望已实测证伪并移除。
      const containmentViolations: string[] = [];
      const identicalPairs: string[] = [];
      for (const g of groupNames) {
        const idx = members.map((m, k) => ({ m, k })).filter(x => x.m.group === g);
        for (const { m: A, k: ka } of idx) {
          for (const { m: B, k: kb } of idx) {
            if (ka === kb) continue;
            const ab = inter[ka * n + kb];
            if (ab === A.hits && A.hits === B.hits && A.hits > 0) {
              identicalPairs.push(`${g}: ${A.badge.id} 与 ${B.badge.id}`);
            }
            if (ab === A.hits && eps[ka] > eps[kb] && superseded[kb] < A.hits) {
              containmentViolations.push(
                `${g}: ${A.badge.id}(hits=${A.hits}) ⊆ ${B.badge.id}(hits=${B.hits})，`
                + `但 B 仅在 ${superseded[kb]} 色上被取代（应 ≥ ${A.hits}）`,
              );
            }
          }
        }
      }

      // ── 生成报告（在任何断言之前写盘，失败时仍有材料）──────────
      const L: string[] = [];
      L.push('# 徽章取代审计：计分死徽章（supersession / dead badge）');
      L.push('');
      L.push('> **本文件由 `pnpm -C packages/shared run supersession` 自动生成，请勿手改。**');
      L.push('>');
      L.push('> 目的：找出「在**所有**命中它的颜色上都会被同 group 更高 `ep` 成员取代」的徽章 ——');
      L.push('> 这种徽章永远拿不到分，存在只是图鉴摆设。');
      L.push('>');
      L.push('> 方法：全色域 `2²⁴` **单趟**精确遍历，只对有 `group` 的成员跑 `check`；');
      L.push('> 取代语义与 `src/scoring.ts` 的 `calculateScore` 一致（同组取 `ep` 最大，`ep` 相等不互相取代）。');
      L.push('');
      L.push('## 0. 生成指纹');
      L.push('');
      L.push(`- 有 group 的成员：**${n}** 条，分布在 **${nGroups}** 个组（${groupNames.map(g => `\`${g}\``).join('、')}）`);
      L.push(`- 全色域：${N}（2²⁴）`);
      L.push(`- 单趟遍历耗时：**${(elapsedMs / 1000).toFixed(2)} s**`);
      L.push(`- 交叉校验（\`hits\` vs \`PRICING[id].hits\`）：**${n - hitsMismatches.length} / ${n} 一致**${
        hitsMismatches.length === 0 ? ' ✅' : ' ❌'
      }`);
      L.push('');
      L.push('## 1. 结论');
      L.push('');
      if (deadBadges.length === 0) {
        L.push('- **100% 被取代的徽章：0 条** ✅ —— 不存在「计分死徽章」，每条 group 成员都至少在一部分命中颜色上单独计分。');
      } else {
        L.push(`- 🚨 **100% 被取代的徽章：${deadBadges.length} 条** —— 这些徽章永不单独计分：`);
        L.push('');
        L.push('| id | group | ep | hits | 被取代 | 损失 CP |');
        L.push('|---|---|---:|---:|---:|---:|');
        for (const m of deadBadges) {
          L.push(
            `| \`${m.badge.id}\` | \`${m.group}\` | ${Math.round(m.ep)} | ${m.hits} | ${m.superseded} | ${Math.round(
              m.lostCp,
            )} |`,
          );
        }
      }
      L.push(
        `- 被取代比例 > 99% 的成员：**${unhealthy.length}** 条${
          unhealthy.length === 0 ? ' ✅' : `（${unhealthy.map(m => `\`${m.badge.id}\` ${pct(m.ratio)}`).join('、')}）`
        }`,
      );
      L.push(
        `- 每个 group 的 ep 最大成员取代比例是否为 0：**${maxEpBreakers.length === 0 ? '全部为 0 ✅' : `❌ ${maxEpBreakers.join('、')}`}**`,
      );
      L.push(
        `- 取代由包含关系解释（A ⊆ B 且 ep(A) > ep(B) ⇒ superseded(B) ≥ hits(A)）：**${
          containmentViolations.length === 0 ? '成立 ✅' : `❌ ${containmentViolations.length} 处违反`
        }**`,
      );
      L.push(
        `- 参考：若按「ep 越大 ratio 越小」这一**已被证伪**的期望衡量，有 **${monotonicViolations.length}** 处违反`,
      );
      L.push('  （group 允许是 DAG；该期望不是契约，断言已移除）。');
      if (monotonicViolations.length > 0) {
        L.push('');
        L.push('  违反明细（ep 更大者反而有更高的被取代比例）：');
        L.push('');
        for (const v of monotonicViolations) L.push(`  - ${v}`);
      }
      L.push('');
      L.push('## 2. 逐组明细（组内按 `ep` 降序）');
      L.push('');
      for (const g of groupNames) {
        L.push(`### \`${g}\``);
        L.push('');
        L.push('| id | ep | hits | 被取代 | 被取代比例 | lostCp |');
        L.push('|---|---:|---:|---:|---:|---:|');
        for (const m of members.filter(x => x.group === g).sort((a, b) => b.ep - a.ep)) {
          L.push(
            `| \`${m.badge.id}\` | ${Math.round(m.ep)} | ${m.hits} | ${m.superseded} | ${pct(m.ratio)} | ${comma(
              m.lostCp,
            )} |`,
          );
        }
        L.push('');
      }
      const pair = members.find(m => m.badge.id === 'casino-pair');
      if (pair) {
        L.push('## 3. 特别检查：`casino-pair`（`casino-rank-count` 最弱者）');
        L.push('');
        L.push(
          `- \`casino-pair\`：ep = ${Math.round(pair.ep)}，hits = ${comma(pair.hits)}，被取代 ${comma(
            pair.superseded,
          )}，**比例 = ${pct(pair.ratio)}**，lostCp = ${comma(pair.lostCp)}。`,
        );
        L.push(
          `- 它未被取代的颜色有 **${comma(pair.hits - pair.superseded)}** 个：这些颜色上 ` +
            '`casino-rank-count` 组里只有 `casino-pair` 一条命中（同组其它 7 条都是它的真子集）。',
        );
        L.push(
          '- ⚠️ 任务提示「分布底部有一个 176,788 色的大原子，只命中 `casino-pair` 一条」指的是**全表**',
        );
        L.push(
          '  （76 条徽章中只有 `casino-pair` 命中，故总分恰为最小）；那只是「组内仅 pair 命中」集合中',
        );
        L.push(
          '  额外不命中任何非组徽章的一小部分，**不是**取代比例的分母/补集，因此不能用它推出「接近 100% 被取代」。',
        );
        L.push(
          `- 数值对账：${comma(pair.hits)} − ${comma(pair.superseded)} = ${comma(
            pair.hits - pair.superseded,
          )}（组内仅 pair 命中）；其中再剔除命中其它非组徽章的颜色后才是 176,788。`,
        );
        L.push(
          `- 口径对照：若按「**全表**（不分 group）取最大 ep」这一错误口径统计，pair 的比例会是`,
        );
        L.push(
          `  1 − 176,788 / ${comma(pair.hits)} ≈ 98.39%，任务提示里的 176,788 正是这个口径的产物；`,
        );
        L.push(
          `  但取代机制是 **group 内**的（见 \`scoring.ts\`），正确值是 ${pct(pair.ratio)} —— 两者相差很大，不能混用。`,
        );
        L.push('');
      }
      L.push('## 4. 可疑点');
      L.push('');
      L.push(
        '- ✅ **group 允许是偏序（DAG），不要求是一条包含链。** 判据不是 ep 排序，而是包含关系：',
      );
      L.push(
        '  本脚本断言「若 A ⊆ B 且 ep(A) > ep(B)，则 superseded(B) ≥ hits(A)」，实测**无违反**。',
      );
      L.push(
        '- ⚠️ **「同组内 ep 越大 ⇒ 取代比例越小」这条期望已被实测证伪，断言已移除。** 原因是',
      );
      L.push(
        '  `casino-rank-count` 不是包含链而是 DAG：它同时含「点数计数 ≥k」（pair→two-pair→triple-pair）',
      );
      L.push(
        '  与「同点数出现次数 ≥k」（three-kind→four-kind→five-kind→six-kind）两条独立分支，',
      );
      L.push(
        '  外加 `full-house` 交集节点。分支之间不可比（`casino-triple-pair` 与 `casino-three-kind` 互不包含），',
      );
      L.push(
        '  因此 `triple-pair` 的 ep 虽低于 `four-kind`，取代比例却是 0%。`casino-sequence` 同理（`straight` ⊃ `straight-six`）。',
      );
      L.push(
        '- 结论：**无需拆组。** DAG 形态下「同组取最高 ep」依然正确，且已由上面的包含关系断言守住；',
      );
      L.push('  没有任何成员被 100% 取代。');
      L.push('');
      L.push('## 5. 复现');
      L.push('');
      L.push('| 项目 | 值 |');
      L.push('|---|---|');
      L.push('| 命令 | `pnpm -C packages/shared run supersession` |');
      L.push(`| 单趟遍历耗时 | ${(elapsedMs / 1000).toFixed(2)} s |`);
      L.push(`| 颜色空间 | ${N}（2²⁴，全枚举，非采样） |`);
      L.push('');
      writeFileSync(REPORT_PATH, L.join('\n'), 'utf8');

      // ── 控制台摘要 ────────────────────────────────────────────
      console.log(
        [
          '',
          '──────── 取代审计完成 ────────',
          `成员            : ${n} 条 / ${nGroups} 组`,
          `实测耗时        : ${(elapsedMs / 1000).toFixed(2)} s`,
          `hits 交叉校验   : ${n - hitsMismatches.length}/${n} 一致`,
          `100% 被取代     : ${deadBadges.length} ${deadBadges.map(m => m.badge.id).join(', ')}`,
          `比例 > 99%      : ${unhealthy.length} ${unhealthy.map(m => m.badge.id).join(', ')}`,
          `ep 最大者 ratio : ${maxEpBreakers.length === 0 ? '全部为 0' : maxEpBreakers.join(', ')}`,
          `单调性违反      : ${monotonicViolations.length}`,
          `casino-pair     : ${pair ? pct(pair.ratio) : 'n/a'}(${pair ? pair.superseded : '?'}/${
            pair ? pair.hits : '?'
          })`,
          '─────────────────────────────',
        ].join('\n'),
      );
      console.log(
        tableRows
          .map(
            ({ group, m }) =>
              `${group.padEnd(20)} ${m.badge.id.padEnd(20)} ep=${Math.round(m.ep)
                .toString()
                .padStart(10)} hits=${m.hits.toString().padStart(9)} sup=${m.superseded
                .toString()
                .padStart(9)} ratio=${pct(m.ratio).padStart(12)} lostCp=${comma(m.lostCp).padStart(14)}`,
          )
          .join('\n'),
      );

      // ── 验收断言 ──────────────────────────────────────────────
      // 1) hits 交叉校验
      expect(
        hitsMismatches.map(m => `${m.badge.id}(实测 ${m.hits} ≠ PRICING ${PRICING[m.badge.id]?.hits})`),
        'hits 与 PRICING[id].hits 不一致的成员',
      ).toEqual([]);

      // 2) 不存在 100% 被取代的「计分死徽章」
      expect(
        deadBadges.map(m => m.badge.id),
        `以下徽章被同组更高 ep 成员 100% 取代（计分死徽章）：`,
      ).toEqual([]);

      // 3) 每个 group 的 ep 最大成员不得被任何同组成员取代
      expect(maxEpBreakers, 'group 内 ep 最大成员的取代比例不为 0').toEqual([]);

      // 4) 取代必须由包含关系解释（见上）
      expect(containmentViolations, '存在无法由包含关系解释的取代').toEqual([]);

      // 5) 组内不得存在命中集合完全相同的成员（等价规则，属设计缺陷）
      expect(identicalPairs, '组内存在命中集合完全相同的成员（等价规则）').toEqual([]);
    },
    15 * 60 * 1000,
  );
});
