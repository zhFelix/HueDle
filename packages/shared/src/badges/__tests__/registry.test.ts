/**
 * 全局徽章表结构校验。
 *
 * 结构约束见 docs/BADGE-SPEC.md（第 3/5/9/11 节）；
 * 定价约束见 docs/PRICING-SPEC.md（第 2/3/7 节）。
 *
 * ⚠️ 旧的「cp 落在 rarity 区间内」「mythic ≤ 4 / anomaly ≤ 6 / 每家族 epic ≤ 2」
 * 三类断言**已在概率定价模型下作废并删除**：rarity 不再是作者的选择，
 * 而是 `ep` 的十进制分档导出值，配额自然失去意义。
 */
import { describe, expect, it } from 'vitest';
import { allBadges } from '../index';
import type { BadgeRarity, Family } from '../../types';
import { toColorInfo } from '../../color';
import { PRICING } from '../../pricing.gen';
import { EP_TIER_THRESHOLDS, TOTAL_COLORS, badgeRarityFromEp, epFromHits } from '../../pricing';

const BADGE_RARITIES: BadgeRarity[] = ['common', 'uncommon', 'rare', 'epic', 'anomaly', 'mythic'];

/** 固定家族顺序与每个家族的最少徽章数。 */
const FAMILIES: Family[] = [
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

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;


describe('allBadges 全局结构', () => {
  it('1. 每个 id 唯一、非空、且为 kebab-case', () => {
    const ids = allBadges.map(b => b.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toBeTruthy();
      expect(id).toMatch(ID_PATTERN);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('2. name 与 description 非空，description 长度 ≥ 4', () => {
    for (const badge of allBadges) {
      expect(badge.name.trim().length).toBeGreaterThan(0);
      expect(badge.description.trim().length).toBeGreaterThanOrEqual(4);
    }
  });

  it('3. 每条徽章都有定价，且 cp/rarity 与 PRICING 完全一致', () => {
    for (const badge of allBadges) {
      const pricing = PRICING[badge.id];
      expect(pricing, `${badge.id} 缺少定价数据（新增徽章后需重跑 enumerate）`).toBeDefined();
      expect(badge.cp, `${badge.id} 的 cp 应等于 PRICING 的 ep`).toBe(pricing.ep);
      expect(badge.rarity, `${badge.id} 的 rarity 应等于 PRICING 的 rarity`).toBe(pricing.rarity);
      expect(badge.rarity, `${badge.id} 的 rarity 应等于 ep 的分档导出值`)
        .toBe(badgeRarityFromEp(badge.cp));
    }
  });

  it('4. PRICING 里的 ep 必须精确等于 epFromHits(hits)（禁止取整漂移）', () => {
    // 取整会让分位表与实际分布失配——分位表是按未取整的 ep 统计的。
    for (const [id, pricing] of Object.entries(PRICING)) {
      if (!Number.isFinite(pricing.ep)) {
        expect(pricing.hits, `${id} 的 ep 非有限值，只允许 hits === 0`).toBe(0);
        continue;
      }
      expect(pricing.ep, `${id} 的 ep 与 epFromHits(hits) 不一致`).toBe(epFromHits(pricing.hits));
    }
  });

  it('5. 没有永不命中的徽章（hits > 0）', () => {
    const dead = Object.entries(PRICING).filter(([, p]) => p.hits <= 0).map(([id]) => id);
    expect(dead, `以下徽章在全色域 2²⁴ 内永不命中：${dead.join(', ')}`).toEqual([]);
  });

  it('6. 同概率同分：hits 相同则 ep 必须相同', () => {
    const byHits = new Map<number, number[]>();
    for (const p of Object.values(PRICING)) {
      byHits.set(p.hits, [...(byHits.get(p.hits) ?? []), p.ep]);
    }
    for (const [hits, eps] of byHits) {
      expect(new Set(eps).size, `hits=${hits} 的徽章 ep 不一致：${eps.join(', ')}`).toBe(1);
    }
  });

  it('7. 单调性：hits 越少则 ep 越大（且 ep 不小于 100 的下界）', () => {
    const rows = Object.entries(PRICING)
      .filter(([, p]) => Number.isFinite(p.ep))
      .map(([id, p]) => ({ id, ...p }));
    for (const a of rows) {
      for (const b of rows) {
        if (a.hits < b.hits) {
          expect(a.ep, `${a.id}(hits=${a.hits}) 应比 ${b.id}(hits=${b.hits}) 更稀有`).toBeGreaterThan(b.ep);
        }
      }
    }
    for (const r of rows) {
      expect(r.ep, `${r.id} 的 ep 低于理论下界 100`).toBeGreaterThanOrEqual(100);
    }
    // 全命中（hits === TOTAL_COLORS）时 ep 恰好等于 100
    for (const r of rows) {
      if (r.hits === TOTAL_COLORS) expect(r.ep).toBe(100);
    }
  });

  it('8. 所有 family 全部至少 6 条徽章', () => {
    const counts = new Map<Family, number>();
    for (const badge of allBadges) {
      counts.set(badge.family, (counts.get(badge.family) ?? 0) + 1);
    }
    for (const family of FAMILIES) {
      expect(counts.get(family) ?? 0, `${family} 家族徽章不足`).toBeGreaterThanOrEqual(6);
    }
    // 不允许多出未知家族
    expect([...counts.keys()].every(f => FAMILIES.includes(f))).toBe(true);
  });

  it('9. 同一 family 内 name 不重复', () => {
    for (const family of FAMILIES) {
      const names = allBadges.filter(b => b.family === family).map(b => b.name);
      expect(new Set(names).size, `${family} 家族存在重名`).toBe(names.length);
    }
  });

  it('10. group 命名合法，且每个 group 至少 2 名成员', () => {
    const groups = new Map<string, string[]>();
    for (const badge of allBadges) {
      if (badge.group === undefined) continue;
      expect(badge.group.trim().length, `${badge.id} 的 group 为空`).toBeGreaterThan(0);
      expect(badge.group, `${badge.id} 的 group 应为 kebab-case`).toMatch(ID_PATTERN);
      groups.set(badge.group, [...(groups.get(badge.group) ?? []), badge.id]);
    }
    for (const [group, ids] of groups) {
      expect(ids.length, `group ${group} 只有 1 名成员（${ids.join(', ')}），分组无意义`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('11. 每个 group 必须存在一个颜色同时命中其中 ≥2 名成员（全色域穷举，早停）', () => {
    const groups = new Map<string, typeof allBadges>();
    for (const badge of allBadges) {
      if (!badge.group) continue;
      groups.set(badge.group, [...(groups.get(badge.group) ?? []), badge]);
    }
    for (const [group, members] of groups) {
      // 注意：这里不能用随机采样。极度罕见的组（如 casino-sequence 的皇家顺，
      // 概率约 1.3e-6）在有限采样下必然零命中，会把「采样不到」误判成「设计错误」。
      // 颜色空间只有 2^24，直接穷举并早停：命中早、代价低；未命中则说明分组真的有问题。
      let witness: string | null = null;
      for (let v = 0; v < 0x1000000 && witness === null; v++) {
        const color = toColorInfo({ r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff });
        let hit = 0;
        for (const badge of members) {
          if (badge.check(color)) {
            hit++;
            if (hit >= 2) { witness = color.hex; break; }
          }
        }
      }
      expect(
        witness,
        `group ${group}（${members.map(b => b.id).join(', ')}）在全色域 2^24 内`
        + '不存在任何同时命中 ≥2 名成员的颜色——成员互斥的分组是 family 的职责，不是 group 的',
      ).not.toBeNull();
    }
  });

  it('12. family 与 rarity 取值合法、check 为函数', () => {
    for (const badge of allBadges) {
      expect(FAMILIES).toContain(badge.family);
      expect(BADGE_RARITIES).toContain(badge.rarity);
      expect(typeof badge.check).toBe('function');
    }
  });
});
