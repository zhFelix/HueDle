/**
 * 统计编排：跑 M1–M8，把原始行交给纯函数渲染器，产出 {@link StatsReport}。
 *
 * 取数策略（由 2026-10 的实测决定）：本工具的库在悉尼，服务端算力不是瓶颈
 * （窗口内只有个位数行），时间全花在跨洋往返上。因此：
 *   1. 先构造**全部彼此独立**的查询（窗口总计 / M1–M8 / M8 自检 / 用户名明细）；
 *   2. 用 {@link runReadOnlyBatches} 摊到最多 {@link ADMIN_POOL_MAX} 条连接上并行，
 *      每条连接内部复用**一个** `BEGIN READ ONLY` 事务（见 `db.ts`），把事务开销从
 *      "每条查询 4 次往返"降到"每批 2 次"；
 *   3. 全部结果齐了再进纯函数分析层——所以 M4 的样本门槛等口径完全没动。
 *
 * 只读没有被放松：每条查询仍过 {@link runReadOnlyQuery} 级别的应用守卫（在批次入口），
 * 且事务由 PG 强制只读（`readonly.db.test.ts` 在并发下验证 25006）。
 */
import type { Pool, QueryResultRow } from 'pg';
import { utcDate } from '@huedle/shared';
import {
  ADMIN_POOL_MAX,
  createReadOnlyPool,
  redactConnectionString,
  requireDatabaseUrl,
  runReadOnlyBatches,
} from './db';
import { METRICS, NAMES_SQL, WINDOW_TOTALS_SQL, type MetricDef, type MetricId, type ParamKey } from './stats';
import {
  analyzeM1,
  analyzeM2,
  analyzeM3,
  analyzeM4,
  analyzeM5,
  analyzeM6,
  analyzeM7,
  analyzeM8,
  contextForDraws,
  DEFAULT_CONTEXT,
  type BadgeHitRow,
  type CpRow,
  type DailyRow,
  type DriftRow,
  type GhostRow,
  type IntegrityRow,
  type NewReturningRow,
  type SilenceRow,
} from './analyze';
import type { NameDetail, SectionResult, StatsReport } from './report';

export interface RunStatsOptions {
  /** 回看窗口（天）。 */
  days: number;
  /** 是否查询用户明细（仅终端/本机页面显示）。 */
  includeNames: boolean;
  /** 注入"现在"，便于测试确定性。 */
  now?: Date;
  /**
   * M4 最多让分析层保留多少条（默认 10）。
   *
   * UI 会要一个更大的上限（见 `src/ui/server.ts`），再由展示层自行截断 + `<details>` 展开；
   * CLI 保持默认值，行为不变。
   */
  topN?: number;
}

/** 把 `$n` 占位符映射成实际参数。 */
function buildParams(keys: ParamKey[], start: string, nowIso: string): unknown[] {
  return keys.map(key => (key === 'start' ? start : nowIso));
}

/**
 * 根据 metric.id 分派到对应的纯函数渲染器。
 *
 * 导出是为了让 UI 层与测试能复用**同一条**"原始行 → 展示表格"的路径，
 * 而不是在第二个界面里重新实现一遍 M1–M8（尤其是 M4 的样本门槛）。
 */
export function analyzeMetric(
  metric: MetricDef,
  rows: QueryResultRow[],
  extraRows: QueryResultRow[],
  ctx: typeof DEFAULT_CONTEXT,
): SectionResult {
  const dispatch: Record<MetricId, () => SectionResult['table']> = {
    M1: () => analyzeM1(rows as DailyRow[]),
    M2: () => analyzeM2(rows as NewReturningRow[]),
    M3: () => analyzeM3(rows as SilenceRow[]),
    M4: () => analyzeM4(rows as BadgeHitRow[], ctx),
    M5: () => analyzeM5(rows as GhostRow[]),
    M6: () => analyzeM6(rows as DriftRow[]),
    M7: () => analyzeM7(rows as CpRow[]),
    M8: () => {
      const duplicates = extraRows[0]?.duplicates;
      return analyzeM8(rows[0] as IntegrityRow | undefined, typeof duplicates === 'number' ? duplicates : undefined);
    },
  };
  return {
    id: metric.id,
    title: metric.title,
    question: metric.question,
    table: dispatch[metric.id](),
    notes: metric.notes,
  };
}

/** 待取数的一条查询：`key` 用于把结果对回指标，`sql`/`params` 直接进只读批次。 */
interface PendingQuery {
  key: string;
  sql: string;
  params: unknown[];
}

/**
 * 构造一次报告需要的**全部**查询。它们之间没有依赖：`totals` 只被分析层用来推导
 * M4 的样本门槛，而不是后续 SQL 的输入，因此可以和 M1–M8 一起并行取回。
 */
function buildQueries(start: string, nowIso: string, includeNames: boolean): PendingQuery[] {
  const queries: PendingQuery[] = [{ key: 'totals', sql: WINDOW_TOTALS_SQL, params: [start] }];
  for (const metric of METRICS) {
    queries.push({
      key: metric.id,
      sql: metric.sql,
      params: buildParams(metric.params, start, nowIso),
    });
    if (metric.extra) {
      queries.push({
        key: `${metric.id}.extra`,
        sql: metric.extra.sql,
        params: buildParams(metric.extra.params, start, nowIso),
      });
    }
  }
  if (includeNames) {
    queries.push({ key: 'names', sql: NAMES_SQL, params: [] });
  }
  return queries;
}

export async function runStats(pool: Pool, options: RunStatsOptions): Promise<StatsReport> {
  const { days, includeNames } = options;
  const now = options.now ?? new Date();
  const start = utcDate(new Date(now.getTime() - days * 86_400_000));
  const nowIso = now.toISOString();

  const queries = buildQueries(start, nowIso, includeNames);
  // 并发度受连接池上限约束：绝不为了提速而放大对生产库的连接占用。
  const concurrency = Math.max(1, Math.min(ADMIN_POOL_MAX, queries.length));
  const rowsByQuery = await runReadOnlyBatches(
    pool,
    queries.map(query => ({ sql: query.sql, params: query.params })),
    concurrency,
  );
  const rowsByKey = new Map(queries.map((query, index) => [query.key, rowsByQuery[index] ?? []]));
  const rowsFor = (key: string): QueryResultRow[] => rowsByKey.get(key) ?? [];

  const totalsRows = rowsFor('totals') as Array<{ draws: number; players: number }>;
  const draws = totalsRows[0]?.draws ?? 0;
  const players = totalsRows[0]?.players ?? 0;
  const ctx = contextForDraws(draws, options.topN ?? DEFAULT_CONTEXT.topN);

  const sections: SectionResult[] = METRICS.map(metric =>
    analyzeMetric(
      metric,
      rowsFor(metric.id),
      metric.extra ? rowsFor(`${metric.id}.extra`) : [],
      ctx,
    ),
  );

  let names: NameDetail[] = [];
  if (includeNames) {
    const nameRows = rowsFor('names') as Array<{ name: string; days: number; last_date: string }>;
    names = nameRows.map(row => ({ name: row.name, days: row.days, lastDate: row.last_date }));
  }

  const warnings = collectWarnings(sections, names.length);

  return {
    generatedAt: nowIso,
    windowDays: days,
    windowStart: start,
    connection: redactConnectionString(requireDatabaseUrl()),
    totals: { draws, players },
    sections,
    names,
    namesRequested: includeNames,
    warnings,
  };
}

/** 从各指标的表格里提取需要**显式提醒**的异常（哨兵非零）。 */
function collectWarnings(sections: SectionResult[], nameCount: number): string[] {
  const warnings: string[] = [];
  const find = (id: MetricId) => sections.find(section => section.id === id);

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

/** 组合入口：读 env → 建只读池 → 跑统计 → 关闭池。 */
export async function runStatsFromEnv(options: RunStatsOptions): Promise<StatsReport> {
  const pool = createReadOnlyPool(requireDatabaseUrl());
  try {
    return await runStats(pool, options);
  } finally {
    await pool.end();
  }
}
