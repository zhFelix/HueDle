/**
 * M1–M8 的**纯函数**渲染器：原始行 → 展示表格。
 *
 * 这一层刻意不碰数据库，因此可以被秒级单测覆盖，也是 CI 里能跑的那部分。
 * 两条硬约束由 `stats.test.ts` 断言：
 *   1. 空行集 / 单行集都不崩；
 *   2. 输出里**永远不出现 `NaN`**（非有限值一律降级成 `—`）。
 */
import { allBadges, PRICING, TOTAL_COLORS } from '@huedle/shared';

/** 通用展示表格。 */
export interface Table {
  columns: string[];
  rows: string[][];
  caption?: string;
}

export interface AnalyzeContext {
  /** 窗口内总抽取行数（M4 的期望基线）。 */
  draws: number;
  /** 是否给出统计结论（样本足够）。 */
  conclusive: boolean;
  /** M4 最多展示多少条（按 |z| 排序）。 */
  topN: number;
}

export const DEFAULT_CONTEXT: AnalyzeContext = { draws: 0, conclusive: false, topN: 10 };

/**
 * M4 的结论门槛：窗口内抽取数低于它就不给结论（小样本的 z 值无意义）。
 *
 * 这个常量是**唯一**的门槛来源——CLI、UI 与测试都必须走 {@link contextForDraws}，
 * 这样"换了个界面就偷偷给结论"在类型层面就做不到。
 */
export const M4_MIN_DRAWS = 200;

/** 由窗口内抽取数推导分析上下文（`conclusive` 只由 {@link M4_MIN_DRAWS} 决定）。 */
export function contextForDraws(draws: number, topN = 10): AnalyzeContext {
  return { draws, conclusive: draws >= M4_MIN_DRAWS, topN };
}

/** 非有限值 → `—`，其余按定点格式化。绝不输出 `NaN`。 */
export function fmtNumber(value: unknown, digits = 2): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

export function fmtInt(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return String(Math.trunc(n));
}

/** 占比：分母为 0 / 非有限时给 `—`。 */
export function fmtShare(part: unknown, whole: unknown): string {
  const p = typeof part === 'number' ? part : Number(part);
  const w = typeof whole === 'number' ? whole : Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w === 0) return '—';
  return `${((100 * p) / w).toFixed(2)}%`;
}

function emptyTable(columns: string[], caption: string): Table {
  return { columns, rows: [], caption };
}

export interface DailyRow {
  date: string;
  draws: number;
  players: number;
}
export interface NewReturningRow {
  date: string;
  new_players: number;
  returning_players: number;
}
export interface SilenceRow {
  bucket: string;
  users: number;
  one_day_users: number;
}
export interface BadgeHitRow {
  badge_id: string;
  hit_days: number;
}
export interface GhostRow {
  badge_id: string;
  n: number;
  first_seen: string | null;
}
export interface DriftRow {
  wk: string;
  rarity: string;
  n: number;
}
export interface CpRow {
  date: string;
  min: number;
  p50: number;
  p99: number;
  max: number;
}
export interface IntegrityRow {
  bad_hex: number;
  bad_date: number;
  future_date: number;
  bad_badge_ids: number;
  bad_cp: number;
  expired_sessions: number;
}

/** M1：每日抽取量 + 唯一约束哨兵。 */
export function analyzeM1(rows: DailyRow[]): Table {
  const table = emptyTable(['日期', '抽取数', '玩家数', '唯一约束'], 'M1 每日抽取量');
  table.rows = rows.map(row => [
    row.date,
    fmtInt(row.draws),
    fmtInt(row.players),
    row.draws === row.players ? 'OK' : '⚠ 约束被破坏',
  ]);
  return table;
}

/** M2：新增 vs 回访。 */
export function analyzeM2(rows: NewReturningRow[]): Table {
  const table = emptyTable(['日期', '新增', '回访'], 'M2 新增 vs 回访');
  table.rows = rows.map(row => [row.date, fmtInt(row.new_players), fmtInt(row.returning_players)]);
  return table;
}

/** M3：沉默用户分桶。 */
export function analyzeM3(rows: SilenceRow[]): Table {
  const table = emptyTable(['沉默天数', '用户数', '只抽过一天'], 'M3 沉默用户分桶');
  table.rows = rows.map(row => [row.bucket, fmtInt(row.users), fmtInt(row.one_day_users)]);
  return table;
}

/**
 * M4：实际命中 vs 理论概率。
 *
 * `hit_days` 是窗口内**出现该徽章的记录行数**；期望 = `draws * hits / TOTAL_COLORS`。
 * 一条记录里可以有多个徽章，严格来说不是独立泊松，但用于发现「数量级漂移」足够；
 * 判断口径写进 caption，避免被当成精确检验。
 */
export function analyzeM4(rows: BadgeHitRow[], ctx: AnalyzeContext): Table {
  if (!ctx.conclusive) {
    const table = emptyTable(['徽章', '实际命中(天)'], 'M4 实际命中率 vs 理论概率');
    table.rows = rows
      .slice(0, ctx.topN)
      .map(row => [row.badge_id, fmtInt(row.hit_days)]);
    table.caption += `：窗口内仅 ${fmtInt(ctx.draws)} 次抽取（< ${M4_MIN_DRAWS}），不给结论，只列原始计数`;
    return table;
  }

  const table = emptyTable(
    ['徽章', '实际命中(天)', '期望命中(天)', '偏差 z', '云端稀有度', '仓库稀有度'],
    'M4 实际命中率 vs 理论概率（|z| 最大的前 N 条）',
  );
  const priced = rows
    .map(row => {
      const pricing = PRICING[row.badge_id];
      if (!pricing) return undefined;
      const expected = (ctx.draws * pricing.hits) / TOTAL_COLORS;
      return { row, pricing, expected };
    })
    .filter((x): x is { row: BadgeHitRow; pricing: (typeof PRICING)[string]; expected: number } =>
      x !== undefined,
    );

  const scored = priced
    .filter(x => x.expected >= 5)
    .map(x => ({ ...x, z: (x.row.hit_days - x.expected) / Math.sqrt(x.expected) }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, ctx.topN);

  const unscored = priced.filter(x => x.expected < 5);

  table.rows = scored.map(x => [
    x.row.badge_id,
    fmtInt(x.row.hit_days),
    fmtNumber(x.expected),
    fmtNumber(x.z),
    // 线上实际观察到的那条徽章在仓库里的稀有度；"漂移"靠 z 列体现。
    x.pricing.rarity,
    x.pricing.rarity,
  ]);
  if (scored.length === 0) {
    table.caption += '：窗口样本不足以计算 z（期望命中 < 5）';
  }
  if (unscored.length > 0) {
    table.caption += `；另有 ${unscored.length} 条期望命中 < 5，未计入`;
  }
  return table;
}

/** M5：幽灵徽章 id。 */
export function analyzeM5(rows: GhostRow[]): Table {
  const known = new Set(allBadges.map(badge => badge.id));
  const ghosts = rows.filter(row => !known.has(row.badge_id));
  const table = emptyTable(['幽灵 id', '出现次数', '首次出现'], 'M5 幽灵徽章 id');
  table.rows = ghosts.length
    ? ghosts.map(row => [row.badge_id, fmtInt(row.n), row.first_seen ?? '—'])
    : [['（无）', '—', '—']];
  return table;
}

/** M6：稀有度构成的时间漂移（附周内占比）。 */
export function analyzeM6(rows: DriftRow[]): Table {
  const table = emptyTable(['周', '稀有度', '数量', '周内占比'], 'M6 稀有度构成时间漂移');
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.wk, (totals.get(row.wk) ?? 0) + row.n);
  table.rows = rows.map(row => [
    row.wk,
    row.rarity,
    fmtInt(row.n),
    fmtShare(row.n, totals.get(row.wk) ?? 0),
  ]);
  return table;
}

/** M7：cp 分布漂移与离群。 */
export function analyzeM7(rows: CpRow[]): Table {
  const table = emptyTable(['日期', 'min', 'p50', 'p99', 'max'], 'M7 cp 分布');
  table.rows = rows.map(row => [
    row.date,
    fmtNumber(row.min),
    fmtNumber(row.p50),
    fmtNumber(row.p99),
    fmtNumber(row.max),
  ]);
  return table;
}

/** M8：数据完整性哨兵。 */
export function analyzeM8(row: IntegrityRow | undefined, duplicates: number | undefined): Table {
  const table = emptyTable(['检查项', '值', '含义'], 'M8 数据完整性哨兵');
  if (!row) return table;
  const checks: Array<[string, number, string]> = [
    ['bad_hex', row.bad_hex, 'hex 不匹配 ^#[0-9A-F]{6}$'],
    ['bad_date', row.bad_date, 'date 不是 YYYY-MM-DD'],
    ['future_date', row.future_date, 'date 在未来'],
    ['bad_badge_ids', row.bad_badge_ids, 'badge_ids 不是 JSON 数组'],
    ['bad_cp', row.bad_cp, 'cp < 0 或 > 1e12'],
    ['expired_sessions', row.expired_sessions, '过期会话（清理债，非漏洞）'],
    ['duplicate_user_date', duplicates ?? Number.NaN, 'UNIQUE(user_id, date) 自检，必须为 0'],
  ];
  table.rows = checks.map(([name, value, meaning]) => [name, fmtInt(value), meaning]);
  return table;
}
