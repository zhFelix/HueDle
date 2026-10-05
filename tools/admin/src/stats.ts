/**
 * M1–M8 只读统计的**定义**（纯数据：id / 标题 / SQL / 说明）。
 *
 * 这里的 SQL 全是**常量**，不接受任何用户拼接；唯一的外部输入是窗口起始日 `$1`
 * 与"当前时刻" `$1`（M8 用），两者都不是用户可控的自由文本。
 *
 * 每条 SQL 都以 `SELECT` / `WITH` 开头（应用级守卫 + `sqlGuard.test.ts` 回归）。
 * 每条指标都必须在 `analyze.ts` 里有一个**纯函数**的渲染器；`stats.test.ts` 用
 * 空行集 / 单行集喂它，断言不崩、不出现 `NaN`。
 */
import type { QueryResultRow } from 'pg';

/** SQL 里 `$n` 占位符的来源。 */
export type ParamKey = 'start' | 'now';

/** 附加查询（同一指标需要第二条 SQL 时）。 */
export interface ExtraQuery {
  label: string;
  sql: string;
  params: ParamKey[];
}

export interface MetricDef {
  id: MetricId;
  title: string;
  /**
   * 左栏导航的**短名**（完整标题太长、只出现在右栏的 `<h2>` 里）。
   *
   * 它是这个指标对象的字段，而不是另一份平行常量：侧栏与卡片是**同一份数据**，
   * 不可能再漂移。类型层面强制每个指标都提供。
   */
  navLabel: string;
  /** 这条数字能导出的人要做的决定。 */
  question: string;
  sql: string;
  params: ParamKey[];
  extra?: ExtraQuery;
  notes: string[];
}

export type MetricId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8';

/** 窗口总抽取量（M4 的期望值基线；不进报告主体）。 */
export const WINDOW_TOTALS_SQL =
  'SELECT COUNT(*)::int AS draws, COUNT(DISTINCT user_id)::int AS players FROM daily_results WHERE date >= $1';

/** 用户名明细：**只在终端**显示，`--html` 报告永不包含（见 docs/ADMIN.md §6.2）。 */
export const NAMES_SQL =
  'SELECT u.name AS name, COUNT(DISTINCT d.date)::int AS days, MAX(d.date) AS last_date '
  + 'FROM daily_results d JOIN users u ON u.id = d.user_id '
  + 'GROUP BY 1 ORDER BY 2 DESC, 1 ASC';

export interface WindowTotalsRow extends QueryResultRow {
  draws: number;
  players: number;
}

export interface NameRow extends QueryResultRow {
  name: string;
  days: number;
  last_date: string;
}

export const METRICS: readonly MetricDef[] = [
  {
    id: 'M1',
    title: '每日抽取量 + 唯一约束哨兵',
    navLabel: '抽取量与唯一约束',
    question: '产品今天还有没有人用；某天骤降＝抽取链路/部署出了问题，同时 daily_results 的唯一约束有没有被绕过。',
    params: ['start'],
    sql: `
SELECT date,
       COUNT(*)::int          AS draws,
       COUNT(DISTINCT user_id)::int AS players
  FROM daily_results
 WHERE date >= $1
 GROUP BY date
 ORDER BY date`,
    notes: ['draws 必须恒等于 players（UNIQUE(user_id, date)）；不等＝有人绕过 API 写过库。'],
  },
  {
    id: 'M2',
    title: '新增用户 vs 回访用户',
    navLabel: '新增与回访',
    question: '增长是从哪来的；新增恒为 0＝不必谈拉新，新增有而回访恒为 0＝问题在留存不在渠道。',
    params: ['start'],
    sql: `
WITH firsts AS (
  SELECT user_id, MIN(date) AS first_date FROM daily_results GROUP BY user_id
)
SELECT d.date,
       COUNT(*) FILTER (WHERE f.first_date = d.date)::int AS new_players,
       COUNT(*) FILTER (WHERE f.first_date <  d.date)::int AS returning_players
  FROM daily_results d JOIN firsts f USING (user_id)
 WHERE d.date >= $1
 GROUP BY d.date
 ORDER BY d.date`,
    notes: [],
  },
  {
    id: 'M3',
    title: '沉默用户分桶 + 一次性用户占比',
    navLabel: '沉默分桶与一次性',
    question: '召回值不值得做；以及"只抽过一天"的用户占比——它决定留存是不是真问题。',
    params: [],
    sql: `
SELECT CASE WHEN gap = 0 THEN '0' WHEN gap <= 7 THEN '1-7'
            WHEN gap <= 30 THEN '8-30' ELSE '31+' END AS bucket,
       COUNT(*)::int                        AS users,
       COUNT(*) FILTER (WHERE days = 1)::int AS one_day_users
  FROM (
    SELECT user_id,
           (CURRENT_DATE - MAX(date::date))::int AS gap,
           COUNT(DISTINCT date)::int             AS days
      FROM daily_results
     GROUP BY user_id
  ) t
 GROUP BY 1
 ORDER BY 1`,
    notes: [],
  },
  {
    id: 'M4',
    title: '徽章实际命中率 vs 理论概率',
    navLabel: '徽章命中率',
    question: '线上跑的徽章表与仓库代码是不是同一份（部署漂移）；有没有 check 写错（恒真/近恒真）；玩家实际稀有度是否符合预期。',
    params: ['start'],
    sql: `
SELECT b.badge_id, COUNT(*)::int AS hit_days
  FROM daily_results d,
       jsonb_array_elements_text(d.badge_ids::jsonb) AS b(badge_id)
 WHERE d.date >= $1
 GROUP BY 1
 ORDER BY 2 DESC`,
    notes: [
      '新增徽章不补进旧记录（抽出即定）：必须限定在改动生效日之后的窗口比较，否则新徽章实际命中必然偏低。',
      '窗口内 draws < 200 时不给结论，只给原始计数（小样本的 z 值无意义）。',
    ],
  },
  {
    id: 'M5',
    title: '幽灵徽章 id（存档里有、代码里没有）',
    navLabel: '幽灵徽章 id',
    question: '存档里是否在积累已删除/已改名的 id——restoreScore 会静默丢弃它们，导致玩家"图鉴缺一格、分变少"。',
    params: [],
    sql: `
SELECT b.badge_id, COUNT(*)::int AS n, MIN(d.date) AS first_seen
  FROM daily_results d,
       jsonb_array_elements_text(d.badge_ids::jsonb) AS b(badge_id)
 GROUP BY 1
 ORDER BY 2 DESC`,
    notes: ['非空 → 决定是否给徽章引入墓碑（tombstone）。'],
  },
  {
    id: 'M6',
    title: '稀有度构成的时间漂移',
    navLabel: '稀有度漂移',
    question: '徽章表/枚举改动有没有改变玩家每天抽到的东西；某档周占比突变＝分位表或阈值变了。',
    params: [],
    sql: `
SELECT date_trunc('week', date::date)::date::text AS wk,
       rarity,
       COUNT(*)::int AS n
  FROM daily_results
 GROUP BY 1, 2
 ORDER BY 1, 2`,
    notes: [],
  },
  {
    id: 'M7',
    title: 'cp 分布漂移与离群',
    navLabel: 'cp 分布',
    question: 'cp 是否随时间整体抬升（新增徽章最容易被忽略的副作用）；有没有不可能的离群值。',
    params: ['start'],
    sql: `
SELECT date,
       MIN(cp)                                                     AS min,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY cp)             AS p50,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY cp)            AS p99,
       MAX(cp)                                                     AS max
  FROM daily_results
 WHERE date >= $1
 GROUP BY date
 ORDER BY date`,
    notes: [],
  },
  {
    id: 'M8',
    title: '数据完整性哨兵',
    navLabel: '完整性哨兵',
    question: '其余 7 条统计的前提是否成立；任何 bad_* 非 0 都意味着有东西绕过 API 直接写了库。',
    params: ['now'],
    sql: `
SELECT
  COUNT(*) FILTER (WHERE hex !~ '^#[0-9A-F]{6}$')                     AS bad_hex,
  COUNT(*) FILTER (WHERE date !~ '^\\d{4}-\\d{2}-\\d{2}$')            AS bad_date,
  COUNT(*) FILTER (WHERE date::date > CURRENT_DATE)                   AS future_date,
  COUNT(*) FILTER (WHERE jsonb_typeof(badge_ids::jsonb) <> 'array')   AS bad_badge_ids,
  COUNT(*) FILTER (WHERE cp < 0 OR cp > 1e12)                        AS bad_cp,
  (SELECT COUNT(*) FROM sessions WHERE expires_at <= $1)              AS expired_sessions
  FROM daily_results`,
    extra: {
      label: '唯一约束自检（必须为 0）',
      sql: `
SELECT COUNT(*)::int AS duplicates
  FROM (SELECT user_id, date FROM daily_results GROUP BY 1, 2 HAVING COUNT(*) > 1) x`,
      params: [],
    },
    notes: ['expired_sessions 是清理债而非漏洞：会话过期在鉴权时有强制校验。'],
  },
] as const;
