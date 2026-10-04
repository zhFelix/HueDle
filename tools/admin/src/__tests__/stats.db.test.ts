/**
 * M1–M8 的 SQL **真的连库跑通**（读真实生产库，只读事务，不写任何东西）。
 *
 * 空库 / 单行库的健壮性由纯函数用例覆盖（`stats.test.ts`）——只读连接不允许建临时表，
 * 所以这里只验证"真库上不报错、输出干净"，形状健壮性在纯函数层断言。
 */
import type { Pool, QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcDate } from '@huedle/shared';
import { contextForDraws, DEFAULT_CONTEXT } from '../analyze';
import { createReadOnlyPool, redactConnectionString, requireDatabaseUrl, runReadOnlyQuery } from '../db';
import { renderHtml } from '../render/html';
import { renderText } from '../render/text';
import type { NameDetail, SectionResult, StatsReport } from '../report';
import { analyzeMetric, runStats } from '../run';
import { METRICS, NAMES_SQL, WINDOW_TOTALS_SQL, type ParamKey } from '../stats';

let pool: Pool;

beforeAll(() => {
  pool = createReadOnlyPool(requireDatabaseUrl());
});

afterAll(async () => {
  await pool.end();
});

/**
 * **冻结的优化前实现**：每条查询各自一个只读事务、完全串行。
 *
 * 只用于下面那条"逐字节相同"的回归——它是优化前的行为快照，
 * 不是生产路径（生产路径是 `runStats` 的批量 + 并行）。
 */
async function runStatsSerialReference(
  pool: Pool,
  options: { days: number; includeNames: boolean; now?: Date; topN?: number },
): Promise<StatsReport> {
  const { days, includeNames } = options;
  const now = options.now ?? new Date();
  const start = utcDate(new Date(now.getTime() - days * 86_400_000));
  const nowIso = now.toISOString();
  const buildParams = (keys: readonly ParamKey[]): unknown[] =>
    keys.map(key => (key === 'start' ? start : nowIso));

  const totalsRows = await runReadOnlyQuery<{ draws: number; players: number }>(pool, WINDOW_TOTALS_SQL, [
    start,
  ]);
  const draws = totalsRows[0]?.draws ?? 0;
  const players = totalsRows[0]?.players ?? 0;
  const ctx = contextForDraws(draws, options.topN ?? DEFAULT_CONTEXT.topN);

  const sections: SectionResult[] = [];
  for (const metric of METRICS) {
    const rows = await runReadOnlyQuery(pool, metric.sql, buildParams(metric.params));
    let extraRows: QueryResultRow[] = [];
    if (metric.extra) {
      extraRows = await runReadOnlyQuery(pool, metric.extra.sql, buildParams(metric.extra.params));
    }
    sections.push(analyzeMetric(metric, rows, extraRows, ctx));
  }

  let names: NameDetail[] = [];
  if (includeNames) {
    const nameRows = await runReadOnlyQuery<{ name: string; days: number; last_date: string }>(
      pool,
      NAMES_SQL,
    );
    names = nameRows.map(row => ({ name: row.name, days: row.days, lastDate: row.last_date }));
  }

  return {
    generatedAt: nowIso,
    windowDays: days,
    windowStart: start,
    connection: redactConnectionString(requireDatabaseUrl()),
    totals: { draws, players },
    sections,
    names,
    namesRequested: includeNames,
    warnings: collectWarningsReference(sections, names.length),
  };
}

/** 优化前 `run.ts` 的 `collectWarnings` 快照（仅测试用）。 */
function collectWarningsReference(sections: SectionResult[], nameCount: number): string[] {
  const warnings: string[] = [];
  const find = (id: string): SectionResult | undefined => sections.find(section => section.id === id);

  const m1 = find('M1');
  if (m1?.table.rows.some(row => row[3] !== 'OK')) {
    warnings.push('M1：draws ≠ players —— daily_results 的 UNIQUE(user_id, date) 可能被绕过。');
  }
  const m5 = find('M5');
  if (m5 && !(m5.table.rows.length === 1 && m5.table.rows[0]?.[0] === '（无）')) {
    warnings.push(`M5：发现 ${m5.table.rows.length} 个幽灵徽章 id（存档里有、代码里没有）。`);
  }
  const m8 = find('M8');
  if (m8) {
    for (const row of m8.table.rows) {
      const name = row[0] ?? '';
      if (name.startsWith('bad_') || name === 'future_date' || name === 'duplicate_user_date') {
        if (row[1] !== '0') warnings.push(`M8：${name} = ${row[1]}（应为 0）。`);
      }
    }
  }
  if (nameCount > 0) {
    warnings.push(`用户明细含 ${nameCount} 条用户名：只显示在终端，--html 报告不包含。`);
  }
  return warnings;
}

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

describe('结果一致性：优化前后同一窗口的输出逐字节相同', () => {
  it('runStats（批量+并行）== 冻结的串行实现：报告 JSON / renderText / renderHtml', async () => {
    // 注入同一个 now，消除 generatedAt / M8 的 $1 带来的时间差。
    const now = new Date('2026-10-04T00:00:00.000Z');
    const optimized = await runStats(pool, { days: 30, includeNames: true, now });
    const frozen = await runStatsSerialReference(pool, { days: 30, includeNames: true, now });

    // 整个报告对象（含 warnings）逐字节相同。
    expect(JSON.stringify(optimized)).toBe(JSON.stringify(frozen));

    // 真正交付给人和页面的两份字节也要完全相同。
    expect(renderText(optimized)).toBe(renderText(frozen));
    expect(renderHtml(optimized)).toBe(renderHtml(frozen));
  }, 300_000);

  it('days=7 与 days=90 同样逐字节一致', async () => {
    const now = new Date('2026-10-04T00:00:00.000Z');
    for (const days of [7, 90]) {
      const optimized = await runStats(pool, { days, includeNames: false, now });
      const frozen = await runStatsSerialReference(pool, { days, includeNames: false, now });
      expect(JSON.stringify(optimized), `days=${days} 的报告不一致`).toBe(JSON.stringify(frozen));
      expect(renderText(optimized), `days=${days} 的文本输出不一致`).toBe(renderText(frozen));
      expect(renderHtml(optimized), `days=${days} 的 HTML 输出不一致`).toBe(renderHtml(frozen));
    }
  }, 300_000);
});
