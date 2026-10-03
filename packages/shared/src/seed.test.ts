/**
 * 种子与每日颜色的测试（覆盖 docs/DESIGN.md 第 17 节列出的核心不变量）。
 */
import { describe, expect, it } from 'vitest';
import {
  COLOR_SPACE_SIZE,
  buildSeed,
  fnv1a,
  getDailyColor,
  getDailyColorInfo,
  utcDate,
} from './seed';

const localId = (id: string) => ({ mode: 'local' as const, anonymousId: id });
const userId = (id: string) => ({ mode: 'user' as const, userId: id });

const DAY1 = new Date('2026-10-03T12:00:00Z');
const DAY2 = new Date('2026-10-04T00:00:00Z');

describe('fnv1a', () => {
  it('匹配 FNV-1a 32 位的标准测试向量', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('返回无符号 32 位整数（不会因 imul 溢出成负数）', () => {
    for (const s of ['', 'a', 'huedle', 'x'.repeat(500), '🎨']) {
      const h = fnv1a(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(0x100000000);
    }
  });

  it('对微小输入差异敏感（雪崩）', () => {
    expect(fnv1a('day-1')).not.toBe(fnv1a('day-2'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
});

describe('utcDate', () => {
  it('按 UTC 切片，而不是本地时区', () => {
    expect(utcDate(new Date('2026-10-03T23:59:59Z'))).toBe('2026-10-03');
    expect(utcDate(new Date('2026-10-04T00:00:00Z'))).toBe('2026-10-04');
  });

  it('同一时刻的不同写法得到同一天', () => {
    // 下面三个是同一个 UTC 瞬间，只是时区表示不同
    const a = new Date('2026-10-03T20:00:00Z');
    const b = new Date('2026-10-03T23:00:00+03:00');
    const c = new Date('2026-10-03T13:00:00-07:00');
    expect(utcDate(a)).toBe(utcDate(b));
    expect(utcDate(b)).toBe(utcDate(c));
  });

  it('UTC 00:00 恰好换天', () => {
    expect(utcDate(new Date('2026-10-03T23:59:59.999Z'))).toBe('2026-10-03');
    expect(utcDate(new Date('2026-10-04T00:00:00.000Z'))).toBe('2026-10-04');
  });
});

describe('buildSeed', () => {
  it('两种模式使用不同的种子前缀与字段', () => {
    expect(buildSeed(localId('X'), DAY1)).toBe('2026-10-03:local:X');
    expect(buildSeed(userId('X'), DAY1)).toBe('2026-10-03:user:X');
  });
});

describe('getDailyColor —— 核心不变量', () => {
  it('同一天同一身份，多次调用返回相同颜色（刷新不变）', () => {
    const id = localId('device-abc');
    const first = getDailyColor(id, DAY1);
    for (let i = 0; i < 50; i++) {
      expect(getDailyColor(id, DAY1)).toEqual(first);
    }
    // 用「同一时刻的不同时区写法」再验一次，确保与本地时区无关
    expect(getDailyColor(id, new Date('2026-10-03T23:00:00+03:00'))).toEqual(first);
    expect(getDailyColor(id, new Date('2026-10-03T13:00:00-07:00'))).toEqual(first);
  });

  it('跨天返回不同颜色', () => {
    const id = localId('device-abc');
    expect(getDailyColor(id, DAY2)).not.toEqual(getDailyColor(id, DAY1));
  });

  it('本地模式与登录模式使用不同种子，结果不同', () => {
    // 关键：即使匿名 ID 与账户 ID 字符串完全相同，两种模式也必须给出不同颜色，
    // 否则「本地身份」与「账户身份」会在同一天撞成同一个结果。
    expect(getDailyColor(localId('same-string'), DAY1))
      .not.toEqual(getDailyColor(userId('same-string'), DAY1));
  });

  it('不同身份得到不同颜色（至少在本样本内不撞车）', () => {
    const seen = new Set<string>();
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const c = getDailyColor(localId(`user-${i}`), DAY1);
      seen.add(`${c.r},${c.g},${c.b}`);
    }
    // 2²⁴ 空间抽 2000 次，按生日问题期望碰撞数约 0.12，允许极少量
    expect(seen.size).toBeGreaterThan(n - 5);
  });

  it('输出恒为合法的 0–255 整数三元组', () => {
    for (let i = 0; i < 500; i++) {
      const c = getDailyColor(localId(`u${i}`), DAY1);
      for (const v of [c.r, c.g, c.b]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('getDailyColorInfo 与 getDailyColor + toColorInfo 一致', () => {
    const id = localId('device-abc');
    const info = getDailyColorInfo(id, DAY1);
    const raw = getDailyColor(id, DAY1);
    expect(info.r).toBe(raw.r);
    expect(info.g).toBe(raw.g);
    expect(info.b).toBe(raw.b);
    expect(info.hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('getDailyColor —— 分布健康度', () => {
  const N = 20000;
  const colors = Array.from({ length: N }, (_, i) => getDailyColor(localId(`dist-${i}`), DAY1));

  it('覆盖整个 24 位空间（三个通道都出现过接近 0 与 255 的值）', () => {
    for (const ch of ['r', 'g', 'b'] as const) {
      const values = colors.map(c => c[ch]);
      expect(Math.min(...values)).toBeLessThan(8);
      expect(Math.max(...values)).toBeGreaterThan(247);
    }
  });

  it('三通道均值接近 127.5（模运算没有引入明显偏置）', () => {
    for (const ch of ['r', 'g', 'b'] as const) {
      const mean = colors.reduce((s, c) => s + c[ch], 0) / N;
      // 二项分布标准差 ≈ 73.6/√N ≈ 0.52，留 5 倍余量
      expect(Math.abs(mean - 127.5), `${ch} 均值 ${mean.toFixed(2)} 偏离过大`).toBeLessThan(3);
    }
  });

  it('哈希落在 2²⁴ 取模后分布均匀（卡方统计量在合理范围）', () => {
    // 把空间切成 256 个桶，检验观测频数
    const buckets = new Array(256).fill(0);
    for (const c of colors) buckets[(c.r << 8 | c.g) % 256]++;
    const expected = N / 256;
    const chi2 = buckets.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
    // df = 255，99.9% 分位约 340；给足余量避免偶发抖动
    expect(chi2, `卡方统计量 ${chi2.toFixed(1)} 偏大`).toBeLessThan(400);
  });

  it('颜色空间常量与色值位数一致', () => {
    expect(COLOR_SPACE_SIZE).toBe(2 ** 24);
    expect(COLOR_SPACE_SIZE).toBe(0x1000000);
  });
});
