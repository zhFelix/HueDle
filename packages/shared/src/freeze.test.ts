/**
 * hex 反解与「冻结结果还原」的测试。
 *
 * 「抽出即定」是产品承诺（见 docs/DESIGN.md 第 11 节），因此这里要专门钉住：
 * **存档一旦写下，徽章表怎么变都不能改动那一天的 cp / rarity。**
 */
import { describe, expect, it } from 'vitest';
import { colorInfoFromHex, parseHex, toColorInfo } from './color';
import { calculateScore, partitionByGroup, restoreScore } from './scoring';
import { allBadges } from './badges/index';
import type { Badge } from './types';

const byId = (id: string): Badge => {
  const b = allBadges.find(x => x.id === id);
  if (!b) throw new Error(`测试引用了不存在的徽章 ${id}`);
  return b;
};

describe('parseHex / colorInfoFromHex', () => {
  it('解析大小写与带不带 # 的写法', () => {
    expect(parseHex('#002FA7')).toEqual({ r: 0x00, g: 0x2f, b: 0xa7 });
    expect(parseHex('#002fa7')).toEqual({ r: 0x00, g: 0x2f, b: 0xa7 });
    expect(parseHex('002FA7')).toEqual({ r: 0x00, g: 0x2f, b: 0xa7 });
    // 首尾空白**有意**容忍（存储里可能有脏空白），所以它不算非法输入
    expect(parseHex('  #FFFFFF  ')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('\t002fa7\n')).toEqual({ r: 0x00, g: 0x2f, b: 0xa7 });
  });

  it('对任何非法输入返回 null，且绝不抛异常', () => {
    // 这些全部来自可能被用户篡改的 localStorage
    const bad = [
      null, undefined, 42, {}, [], '', 'blue', '#FFF', '#GGGGGG',
      '#002FA7FF', 'rgb(0,47,167)', '# 002FA7', '#00_2FA7',
    ];
    for (const v of bad) {
      expect(() => parseHex(v), `parseHex(${JSON.stringify(v)}) 不应抛`).not.toThrow();
      expect(parseHex(v), `parseHex(${JSON.stringify(v)}) 应为 null`).toBeNull();
      expect(colorInfoFromHex(v)).toBeNull();
    }
  });

  it('与 toColorInfo 往返一致（hex / hsl 都能还原）', () => {
    for (const rgb of [{ r: 0, g: 0, b: 0 }, { r: 0xdf, g: 0x69, b: 0xed }, { r: 255, g: 255, b: 255 }]) {
      const a = toColorInfo(rgb);
      const b = colorInfoFromHex(a.hex);
      expect(b).toEqual(a);
    }
  });
});

describe('partitionByGroup —— 取代逻辑', () => {
  it('无 group 的徽章全部保留', () => {
    const hits = [byId('casino-flush'), byId('pattern-echo'), byId('gray-true-monochrome')];
    const { scoringBadges, supersededBadges } = partitionByGroup(hits);
    expect(scoringBadges).toHaveLength(3);
    expect(supersededBadges).toHaveLength(0);
  });

  it('同 group 只留 cp 最高的一条，其余进 superseded', () => {
    const hits = [byId('casino-pair'), byId('casino-six-kind'), byId('casino-three-kind')];
    const { scoringBadges, supersededBadges } = partitionByGroup(hits);
    expect(scoringBadges.map(b => b.id)).toEqual(['casino-six-kind']);
    expect(supersededBadges.map(b => b.id).sort()).toEqual(['casino-pair', 'casino-three-kind']);
  });

  it('不同 group 互不影响', () => {
    const hits = [byId('casino-pair'), byId('casino-straight')];
    const { scoringBadges } = partitionByGroup(hits);
    expect(scoringBadges).toHaveLength(2);
  });

  it('返回结果按 cp 降序', () => {
    const { scoringBadges } = partitionByGroup(allBadges);
    for (let i = 1; i < scoringBadges.length; i++) {
      expect(scoringBadges[i - 1].cp).toBeGreaterThanOrEqual(scoringBadges[i].cp);
    }
  });
});

describe('restoreScore —— 冻结语义', () => {
  it('cp 与 rarity 直接来自存档，不重算', () => {
    const r = restoreScore(['pattern-echo', 'casino-pair'], 999999, 'mythic');
    expect(r.cp).toBe(999999);
    expect(r.rarity).toBe('mythic');
    // 就算真实 ep 之和远小于 999999，也不允许被"修正"
    expect(r.scoringBadges.reduce((s, b) => s + b.cp, 0)).not.toBe(999999);
  });

  it('命中集合决定展示的徽章与取代关系', () => {
    const r = restoreScore(['casino-pair', 'casino-three-kind', 'casino-six-kind'], 0, 'trash');
    expect(r.badges.map(b => b.id).sort())
      .toEqual(['casino-pair', 'casino-six-kind', 'casino-three-kind']);
    expect(r.scoringBadges.map(b => b.id)).toEqual(['casino-six-kind']);
    expect(r.supersededBadges.map(b => b.id).sort())
      .toEqual(['casino-pair', 'casino-three-kind']);
  });

  it('存档里已删除 / 改名的 id 被丢弃，但不影响 cp', () => {
    const r = restoreScore(['pattern-echo', 'badge-that-no-longer-exists'], 4242, 'rare');
    expect(r.badges.map(b => b.id)).toEqual(['pattern-echo']);
    expect(r.cp).toBe(4242);
    expect(r.rarity).toBe('rare');
  });

  it('空存档是合法的（cp 0 / trash）', () => {
    const r = restoreScore([], 0, 'trash');
    expect(r.badges).toEqual([]);
    expect(r.scoringBadges).toEqual([]);
    expect(r.supersededBadges).toEqual([]);
    expect(r.cp).toBe(0);
    expect(r.rarity).toBe('trash');
  });

  it('**冻结不变量**：徽章表变化后，旧存档的 cp / rarity 一字不改', () => {
    // 用真实颜色走一遍实时计分，拿到当时的存档形态
    const color = colorInfoFromHex('#DF69ED')!;
    const live = calculateScore(color);
    const archivedIds = live.badges.map(b => b.id);
    const archivedCp = live.cp;
    const archivedRarity = live.rarity;

    // 模拟"之后又发布了一批新徽章"：拿一个真徽章伪装成新增的
    // 必须挑一条**确实命中该颜色**的徽章，否则前提不成立。
    // 去掉 group 让它变成独立计分项，等价于「新增了一条会命中的规则」。
    const artificiallyExpanded = [
      ...allBadges,
      { ...byId('casino-pair'), id: 'brand-new-badge', group: undefined },
    ];
    const recomputed = calculateScore(color, artificiallyExpanded);
    expect(recomputed.cp, '前提：新徽章确实改变了实时计算的结果').not.toBe(archivedCp);

    // 冻结还原必须无视这一切
    const restored = restoreScore(archivedIds, archivedCp, archivedRarity, artificiallyExpanded);
    expect(restored.cp).toBe(archivedCp);
    expect(restored.rarity).toBe(archivedRarity);
  });
});
