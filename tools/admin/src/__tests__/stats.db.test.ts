/**
 * M1–M8 的 SQL **真的连库跑通**（读真实生产库，只读事务，不写任何东西）。
 *
 * 空库 / 单行库的健壮性由纯函数用例覆盖（`stats.test.ts`）——只读连接不允许建临时表，
 * 所以这里只验证"真库上不报错、输出干净"，形状健壮性在纯函数层断言。
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReadOnlyPool, requireDatabaseUrl } from '../db';
import { renderHtml } from '../render/html';
import { renderText } from '../render/text';
import { runStats } from '../run';

let pool: Pool;

beforeAll(() => {
  pool = createReadOnlyPool(requireDatabaseUrl());
});

afterAll(async () => {
  await pool.end();
});

describe('M1–M8 在真实数据库上跑通', () => {
  it('8 条指标全部返回，输出不含 NaN', async () => {
    const report = await runStats(pool, { days: 30, includeNames: false });

    expect(report.sections.map(section => section.id)).toEqual([
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'M8',
    ]);
    expect(Number.isFinite(report.totals.draws)).toBe(true);
    expect(Number.isFinite(report.totals.players)).toBe(true);

    const cells = report.sections.flatMap(section => section.table.rows.flat());
    for (const cell of cells) {
      expect(cell).not.toContain('NaN');
      expect(cell).not.toContain('undefined');
    }

    const text = renderText(report);
    const html = renderHtml(report);
    expect(text).not.toContain('NaN');
    expect(html).not.toContain('NaN');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  }, 60_000);

  it('--include-names 时用户名只出现在文本，HTML 报告里绝不出现', async () => {
    const report = await runStats(pool, { days: 30, includeNames: true });
    const text = renderText(report);
    const html = renderHtml(report);

    expect(text).toContain('用户明细');
    for (const row of report.names) {
      expect(html).not.toContain(row.name);
    }
  }, 60_000);
});
