/**
 * 数据库 schema（见 docs/DESIGN.md 第 10 节，与本轮任务书一致）。
 *
 * 方言：PostgreSQL（Supabase 托管，仅当数据库用）。相对 SQLite 原文的转换：
 *   - `INTEGER PRIMARY KEY AUTOINCREMENT` → `integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
 *     （`integer` 而非 `bigint`：pg 驱动把 int8 解析成字符串，会改变 `DailyRow.id` 的类型）；
 *   - `TEXT` → `text`、`REAL` → `double precision`；
 *   - 不再需要 `PRAGMA foreign_keys`（PG 外键默认生效）与 `PRAGMA journal_mode = WAL`；
 *   - 建表语句用 `IF NOT EXISTS`，由 `pnpm -C apps/api migrate` 显式执行，
 *     应用启动**不**建表（生产库不该由应用改 schema）。
 *
 * 与 DESIGN 原文的两处刻意差异（都已在本轮任务书里写死）：
 *   - `users.id` **就是账户种子**，由服务端 `randomUUID()` 分配，客户端无从影响；
 *   - 另建 `sessions` 表做不透明 token 会话（DESIGN 第 4 节允许 JWT 或 Session）。
 *
 * `cp` 用 double precision：它是 `ep` 之和的浮点值（概率定价，见 PRICING-SPEC），
 * 取整会丢掉区分度，且与 shared 的 `calculateScore` 返回值不一致。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at text NOT NULL,
  expires_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_results (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       text NOT NULL,
  hex        text NOT NULL,
  cp         double precision NOT NULL,
  rarity     text NOT NULL,
  badge_ids  text NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT daily_results_user_id_date_key UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_date ON daily_results(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;
