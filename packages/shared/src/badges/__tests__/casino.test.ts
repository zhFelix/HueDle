import { describe, expect, it } from 'vitest';
import type { ColorInfo } from '../../types';
import { toColorInfo } from '../../color';
import { allBadges, casinoBadges } from '../index';
import { PRICING } from '../../pricing.gen';
import { badgeRarityFromEp } from '../../pricing';

const badge = (id: string) => casinoBadges.find(b => b.id === id)!;
const hit = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b })), `${id} 应命中 #${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`).toBe(true);
};
const miss = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b })), `${id} 不应命中 #${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`).toBe(false);
};

/** 精选语料：覆盖既有家族里「精确色值 / 稀有结构」的命中集，并保证每个稀有牌型都有代表。 */
const CORPUS_HEX = [
  '#000000', '#FFFFFF', '#111111', '#222222', '#333333', '#444444',
  '#555555', '#666666', '#777777', '#888888', '#999999', '#AAAAAA',
  '#BBBBBB', '#CCCCCC', '#DDDDDD', '#EEEEEE',
  '#ABCDEF', '#FEDCBA', '#012345', '#123456', '#456789', '#9ABCDE', '#001234',
  '#ABCABC', '#012012', '#808080',
  '#002FA7', '#0ABAB5', '#018574', '#003153', '#BA3B40', '#1B3B6F', '#789262', '#9D2933',
  '#FFD700', '#FF00FF', '#FF0080', '#00FF00', '#FF0000', '#0000FF', '#010101',
];

const fromHex = (hex: string): ColorInfo =>
  toColorInfo({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });

/** 确定性伪随机采样（xorshift32），保证测试可复现。 */
function sampleColors(count: number): ColorInfo[] {
  const colors: ColorInfo[] = [];
  let seed = 0x9e3779b9;
  const next = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed;
  };
  for (let i = 0; i < count; i += 1) {
    colors.push(toColorInfo({ r: next() % 256, g: next() % 256, b: next() % 256 }));
  }
  return colors;
}

/** 16³ 分层网格，保证低概率结构（如六条）也有代表。 */
function gridColors(): ColorInfo[] {
  const colors: ColorInfo[] = [];
  const step = 255 / 15;
  for (let r = 0; r < 16; r += 1) {
    for (let g = 0; g < 16; g += 1) {
      for (let b = 0; b < 16; b += 1) {
        colors.push(toColorInfo({
          r: Math.round(r * step),
          g: Math.round(g * step),
          b: Math.round(b * step),
        }));
      }
    }
  }
  return colors;
}

const SAMPLES: ColorInfo[] = [
  ...CORPUS_HEX.map(fromHex),
  ...gridColors(),
  ...sampleColors(150000),
];

/** [子, 超集]：左者的命中集合是右者的子集（全部由「至少型」条件保证）。 */
const INCLUSIONS: Array<[string, string]> = [
  ['casino-six-kind', 'casino-five-kind'],
  ['casino-five-kind', 'casino-four-kind'],
  ['casino-four-kind', 'casino-three-kind'],
  ['casino-full-house', 'casino-three-kind'],
  ['casino-full-house', 'casino-two-pair'],
  ['casino-three-kind', 'casino-pair'],
  ['casino-triple-pair', 'casino-two-pair'],
  ['casino-two-pair', 'casino-pair'],
  ['casino-royal', 'casino-straight-six'],
  ['casino-straight-six', 'casino-straight'],
];

describe('casino 家族', () => {
  it('起手对子：至少一种点数出现至少 2 次', () => {
    hit('casino-pair', 0x12, 0x34, 0x52);
    miss('casino-pair', 0x12, 0x34, 0x56);
  });

  it('双对临门：至少 2 种点数各出现至少 2 次', () => {
    hit('casino-two-pair', 0x12, 0x12, 0x34);
    miss('casino-two-pair', 0x12, 0x34, 0x15);
  });

  it('三对连环：至少 3 种点数各出现至少 2 次', () => {
    hit('casino-triple-pair', 0x11, 0x22, 0x33);
    miss('casino-triple-pair', 0x12, 0x12, 0x34);
  });

  it('三条鼎立：至少一种点数出现至少 3 次', () => {
    hit('casino-three-kind', 0x12, 0x12, 0x13);
    miss('casino-three-kind', 0x12, 0x12, 0x34);
  });

  it('葫芦满堂：一种点数 ≥3 次且另一种 ≥2 次', () => {
    hit('casino-full-house', 0x12, 0x12, 0x13);
    miss('casino-full-house', 0x12, 0x12, 0x34);
  });

  it('四条压阵：至少一种点数出现至少 4 次', () => {
    hit('casino-four-kind', 0x11, 0x12, 0x13);
    miss('casino-four-kind', 0x12, 0x12, 0x13);
  });

  it('五条通天：至少一种点数出现至少 5 次', () => {
    hit('casino-five-kind', 0x11, 0x11, 0x12);
    miss('casino-five-kind', 0x11, 0x12, 0x13);
  });

  it('六条同辉：六个字符完全相同', () => {
    hit('casino-six-kind', 0xaa, 0xaa, 0xaa);
    miss('casino-six-kind', 0x11, 0x11, 0x12);
  });

  it('五连顺：存在 5 个互不相同的连续点数', () => {
    hit('casino-straight', 0x12, 0x34, 0x56);
    miss('casino-straight', 0x00, 0x11, 0x22);
  });

  it('六连顺：六个字符互不相同且恰为 6 个连续整数', () => {
    hit('casino-straight-six', 0x12, 0x34, 0x56);
    miss('casino-straight-six', 0x12, 0x34, 0x57);
  });

  it('皇家同花顺：恰为 A、B、C、D、E、F 各一次', () => {
    hit('casino-royal', 0xab, 0xcd, 0xef);
    miss('casino-royal', 0x9a, 0xbc, 0xde);
  });

  it('同花：六个字符全落在 0–7 或全落在 8–F', () => {
    hit('casino-flush', 0x12, 0x34, 0x56);
    hit('casino-flush', 0xab, 0xcd, 0xef);
    miss('casino-flush', 0x12, 0x34, 0x5a);
  });
});

describe('casino 家族 —— group 包含链', () => {
  it('两条链的成员都在同一个 group 里，且每个 group 至少 2 名成员', () => {
    const groups = new Map<string, string[]>();
    for (const b of casinoBadges) {
      if (!b.group) continue;
      groups.set(b.group, [...(groups.get(b.group) ?? []), b.id]);
    }
    expect([...groups.keys()].sort()).toEqual(['casino-rank-count', 'casino-sequence']);
    for (const [group, ids] of groups) {
      expect(ids.length, `group ${group} 成员不足`).toBeGreaterThanOrEqual(2);
      expect(group).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(groups.get('casino-rank-count')).toHaveLength(8);
    expect(groups.get('casino-sequence')).toHaveLength(3);
  });

  it('包含方向上的 CP 严格递增（保证引擎取到「最强牌型」）', () => {
    for (const [sub, sup] of INCLUSIONS) {
      expect(badge(sub).cp, `${sub} ⊂ ${sup}，但 CP 未递增`).toBeGreaterThan(badge(sup).cp);
      expect(badge(sub).group, `${sub} 与 ${sup} 应同组`).toBe(badge(sup).group);
    }
  });

  it('包含关系在 150000 个采样色上无反例', () => {
    for (const [sub, sup] of INCLUSIONS) {
      let violations = 0;
      let witnesses = 0;
      for (const color of SAMPLES) {
        if (!badge(sub).check(color)) continue;
        witnesses += 1;
        if (!badge(sup).check(color)) violations += 1;
      }
      expect(witnesses, `${sub} 在采样上从未命中，用例失效`).toBeGreaterThan(0);
      expect(violations, `${sub} 命中但 ${sup} 未命中 ${violations} 次`).toBe(0);
    }
  });

  it('每个 group 的成员在采样上确实被同时命中过（不是互斥分组）', () => {
    const groups = new Map<string, string[]>();
    for (const b of casinoBadges) {
      if (!b.group) continue;
      groups.set(b.group, [...(groups.get(b.group) ?? []), b.id]);
    }
    for (const [group, ids] of groups) {
      let overlap = 0;
      for (const color of SAMPLES) {
        let n = 0;
        for (const id of ids) if (badge(id).check(color)) n += 1;
        if (n >= 2) overlap += 1;
      }
      expect(overlap, `group ${group} 没有任何 ≥2 成员同时命中的采样色`).toBeGreaterThan(0);
    }
  });

  it('family 全为 casino、id 与 name 唯一', () => {
    // 条数刻意不写死：徽章会持续增补，写死只会让每次加徽章都得来改这里。
    // 真正要守的是「家族归属正确」与「id / name 唯一」。
    expect(casinoBadges.length).toBeGreaterThan(0);
    expect(casinoBadges.every(b => b.family === 'casino')).toBe(true);
    expect(new Set(casinoBadges.map(b => b.id)).size).toBe(casinoBadges.length);
    expect(new Set(casinoBadges.map(b => b.name)).size).toBe(casinoBadges.length);
  });

  it('定价由概率导出，而非手填（rarity 不再是作者的选择）', () => {
    for (const b of casinoBadges) {
      const pricing = PRICING[b.id];
      expect(pricing, `${b.id} 缺少定价数据`).toBeDefined();
      expect(b.cp).toBe(pricing.ep);
      expect(b.rarity).toBe(pricing.rarity);
      expect(b.rarity, `${b.id} 的 rarity 应等于 ep 的分档`).toBe(badgeRarityFromEp(b.cp));
    }
  });
});

describe('casino 家族 —— 与既有徽章的等价性核查', () => {
  it('与既有徽章不存在逐字等价（全 6 字符空间差异见证）', () => {
    const existing = allBadges.filter(b => b.family !== 'casino');
    // 条数不写死：它只是「除 casino 外的全部徽章」，会随增补变化。
    expect(existing.length).toBeGreaterThan(0);

    const NC = casinoBadges.length;
    const NE = existing.length;
    // pending 中每一对只要找到「一方命中、另一方不命中」的颜色，即证明二者不等价。
    const pending = new Set<number>();
    for (let p = 0; p < NC * NE; p += 1) pending.add(p);

    // 用「命中下标掩码」而不是 32 位整数位掩码。
    //
    // 原实现用 `1 << j` / `(elo >> j) & 1`，而 JS 的位运算是 **32 位**的：
    // `existing` 一旦超过 32 条，`j >= 32` 的位就会回绕、与低位共享同一个 bit，
    // 于是两枚无关徽章被当成同一枚判读——**结论静默出错，测试却照样绿**。
    // 现在 existing 已有一百多条，必须换成不受位宽限制的表示。
    const cMask = new Uint8Array(NC);
    const eMask = new Uint8Array(NE);

    const inspect = (color: ColorInfo): void => {
      if (pending.size === 0) return;
      cMask.fill(0);
      eMask.fill(0);
      for (let i = 0; i < NC; i += 1) if (casinoBadges[i].check(color)) cMask[i] = 1;
      for (let j = 0; j < NE; j += 1) if (existing[j].check(color)) eMask[j] = 1;

      for (const p of pending) {
        const i = Math.floor(p / NE);
        const j = p % NE;
        // 一方命中、另一方不命中 ⇒ 这一对已被区分
        if (cMask[i] !== eMask[j]) pending.delete(p);
      }
    };

    for (const hex of CORPUS_HEX) inspect(fromHex(hex));
    // 穷举整个 6 字符空间；所有对都被区分后提前退出。
    // 若有任意一对跑完全空间仍未区分，它们就是逐字等价，测试失败。
    for (let v = 0; v < 1 << 24 && pending.size > 0; v += 1) {
      inspect(toColorInfo({ r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }));
    }

    const report = [...pending].map(
      p => `${casinoBadges[Math.floor(p / NE)].id} ≡ ${existing[p % NE].id}`,
    );
    expect(report, `发现逐字等价：${report.join(', ')}`).toEqual([]);
  }, 600000);

  it('与既有徽章的包含关系（150000 采样报告，精确值见 docs/badges/casino.md）', () => {
    const existing = allBadges.filter(b => b.family !== 'casino');
    const NC = casinoBadges.length;
    const NE = existing.length;

    // 先为每个采样色算出双方命中掩码，再用联合计数推包含关系：
    //   casinoOnly(i,j) = A_i − B_ij，existOnly(i,j) = C_j − B_ij
    const casinoCount = new Int32Array(NC);
    const existCount = new Int32Array(NE);
    const joint = new Int32Array(NC * NE);
    const casinoHits: number[] = [];
    const existHits: number[] = [];
    for (const s of SAMPLES) {
      casinoHits.length = 0;
      existHits.length = 0;
      for (let i = 0; i < NC; i += 1) if (casinoBadges[i].check(s)) casinoHits.push(i);
      for (let j = 0; j < NE; j += 1) if (existing[j].check(s)) existHits.push(j);
      for (const i of casinoHits) {
        casinoCount[i] += 1;
        for (const j of existHits) joint[i * NE + j] += 1;
      }
      for (const j of existHits) existCount[j] += 1;
    }

    const lines: string[] = [];
    const equivalent: string[] = [];
    for (let i = 0; i < NC; i += 1) {
      const sub: string[] = [];
      const sup: string[] = [];
      for (let j = 0; j < NE; j += 1) {
        // 采样覆盖率不足的对不参与报告（可能既无 casino 命中也无 existing 命中）
        if (casinoCount[i] === 0 || existCount[j] === 0) continue;
        const both = joint[i * NE + j];
        const casinoOnly = casinoCount[i] - both;
        const existOnly = existCount[j] - both;
        if (casinoOnly === 0 && existOnly === 0) {
          equivalent.push(`${casinoBadges[i].id} ≡ ${existing[j].id}`);
          sub.push(`≡${existing[j].id}`);
        } else if (existOnly === 0) {
          sub.push(`⊂${existing[j].id}`);
        } else if (casinoOnly === 0) {
          sup.push(`⊃${existing[j].id}`);
        }
      }
      lines.push(
        `${casinoBadges[i].id} (采样命中 ${casinoCount[i]}/${SAMPLES.length})`
        + ` | casino ⊂ existing: ${sup.join(' ') || '无'}`
        + ` | existing ⊂ casino: ${sub.join(' ') || '无'}`,
      );
    }
    console.log(`\n[casino × 64 采样包含报告]\n${lines.join('\n')}`);

    // 包含关系允许存在（不同维度，重叠是正常的，见 spec 第 11 节）；
    // 逐字等价必须消除——全空间精确结论由上一用例给出，这里只是采样交叉验证。
    expect(equivalent, `采样上疑似等价：${equivalent.join(', ')}`).toEqual([]);
    // 显式超时：本测试做 15 万次采样 × 全部徽章的判定（千万次级），
    // 默认 5 秒在负载高时会超时——表现为「偶发失败」，实际是资源争抢，与断言无关。
  }, 120_000);
});
