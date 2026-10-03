/**
 * 本地存储层（契约见 docs/DESIGN.md 第 14 节）。
 *
 * 设计原则：**存储是不可信输入**。
 * 用户可能清了缓存、换了浏览器、手改了 DevTools、或被旧版本写入了不兼容结构——
 * 任何一条都不允许让应用白屏。因此这里的每个读取函数都满足：
 *
 *   1. 不抛异常（`localStorage` 本身在隐私模式下也可能 throw）；
 *   2. `JSON.parse` 失败 → 视为空；
 *   3. 结构/字段类型不符 → 视为空；
 *   4. 版本不符 → 视为空。
 *
 * 「版本」放在每条记录的 `v` 字段上，而不是包一层容器对象——
 * 这样 `huedle:history` 仍然是 docs/DESIGN.md 第 11.4 节迁移代码里读的那个**裸数组**。
 */
import { utcDate, type ScoreRarity } from '@huedle/shared';

export const STORAGE_KEYS = {
  anonymousId: 'huedle:anonymousId',
  daily: 'huedle:daily',
  history: 'huedle:history',
  streak: 'huedle:streak',
  token: 'huedle:token',
  /**
   * 登录模式专属的「今天已揭晓」标记（DESIGN 第 11 节）。
   *
   * 登录模式的权威在服务端，`huedle:daily` / `huedle:history` / `huedle:streak`
   * 是**本地模式专属**、登录模式一次都不能写。但「今天这一抽用户看了没有」是纯客户端
   * 的界面状态，服务端没有、也不需要有，所以单独存一个 `{ userId, date }` 标记。
   * 它按 userId 区分，因此同一天切换账户不会串味。
   */
  revealed: 'huedle:revealed',
  /**
   * 登录模式的身份缓存 `{ userId, userName }`。
   *
   * **只用于首屏显示**：启动时先用它把界面渲染成登录态，后台再调
   * `GET /api/auth/me` 核对。它**绝不参与任何授权判定**——token 是否有效
   * 一律以服务端为准（见 `stores/session.ts` 的 `hydrate()`）。
   */
  identity: 'huedle:identity',
  /**
   * 登录模式今日结果缓存的前缀。完整 key 为 `huedle:daily:user:<userId>`，
   * 按用户分键，因此同一天切换账户不会串味。
   *
   * 刻意与本地模式专属的 `huedle:daily` 使用完全不同的 key：
   * 登录模式只写这个前缀下的键，登出后本地数据原样恢复（DESIGN 11.3）。
   */
  userDailyPrefix: 'huedle:daily:user:',
  /**
   * 登录模式历史缓存的前缀。完整 key 为 `huedle:history:user:<userId>`，
   * 按用户分键，因此同一天切换账户不会串味。
   *
   * ⚠️ 它与本地模式专属的 `huedle:history` **不是同一个 key**：登录模式只写这个
   * 前缀下的键，本地历史（裸数组）永远不被登录模式碰（DESIGN 11.3）。
   * 缓存内容形如 `{ day, items }`，`day` 用 `utcDate()` 判定有效期（跨天自然失效）。
   */
  userHistoryPrefix: 'huedle:history:user:',
} as const;

/** 登录模式今日结果缓存的完整 key：`huedle:daily:user:<userId>`。 */
export function userDailyKey(userId: string): string {
  return `${STORAGE_KEYS.userDailyPrefix}${userId}`;
}

/** 登录模式历史缓存的完整 key：`huedle:history:user:<userId>`。 */
export function userHistoryKey(userId: string): string {
  return `${STORAGE_KEYS.userHistoryPrefix}${userId}`;
}

/** 当前写入版本。读取时 `v !== STORAGE_VERSION` 的记录一律丢弃。 */
export const STORAGE_VERSION = 1;

export interface HistoryItem {
  date: string;
  hex: string;
  cp: number;
  rarity: ScoreRarity;
  badgeIds: string[];
}

/** `ScoreRarity` 的全部 7 档（含最低档 `trash`）。 */
export const SCORE_RARITIES: readonly ScoreRarity[] = [
  'trash',
  'common',
  'uncommon',
  'rare',
  'epic',
  'anomaly',
  'mythic',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------------------
// 安全读写：存储不可用（隐私模式 / 配额 / 被禁用）时静默降级，绝不抛。
// ---------------------------------------------------------------------------

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* 存储不可用：本次会话仍然可用，只是不持久化 */
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* 同上 */
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 结构守卫：字段齐全、类型正确、`v` 为当前版本（缺省视为 v1，兼容早期写入）。
 */
export function isHistoryItem(value: unknown): value is HistoryItem {
  if (!isRecord(value)) return false;

  const { v, date, hex, cp, rarity, badgeIds } = value;

  if (v !== undefined && v !== STORAGE_VERSION) return false;
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return false;
  if (typeof cp !== 'number' || !Number.isFinite(cp) || cp < 0) return false;
  if (typeof rarity !== 'string' || !SCORE_RARITIES.includes(rarity as ScoreRarity)) return false;
  if (!Array.isArray(badgeIds) || !badgeIds.every(id => typeof id === 'string')) return false;

  return true;
}

/** 去壳 + 归一化：丢掉未知字段，hex 统一大写，badgeIds 复制一份。 */
function normalize(item: HistoryItem): HistoryItem {
  return {
    date: item.date,
    hex: item.hex.toUpperCase(),
    cp: item.cp,
    rarity: item.rarity,
    badgeIds: [...item.badgeIds],
  };
}

function toRecord(item: HistoryItem): Record<string, unknown> {
  return { v: STORAGE_VERSION, ...item };
}

function compareDateDesc(a: HistoryItem, b: HistoryItem): number {
  return b.date.localeCompare(a.date);
}

// ---------------------------------------------------------------------------
// 今日结果
// ---------------------------------------------------------------------------

/**
 * 读取指定日期的今日结果；缓存不属于该日期（跨天）或数据脏 → `null`。
 *
 * 显式接收 `date` 而不是内部取当前时间：跨天逻辑由调用方注入日期来测，
 * 不依赖系统时钟，也就不需要 mock 时钟。
 */
export function loadTodayResult(date: string): HistoryItem | null {
  const parsed = parseJson(safeGet(STORAGE_KEYS.daily));
  if (!isHistoryItem(parsed)) return null;
  if (parsed.date !== date) return null;
  return normalize(parsed);
}

/**
 * 保存今日结果，并追加到历史（**同一天去重**：同日只保留一条，后写覆盖先写）。
 *
 * 幂等：连续调用 N 次，`huedle:history` 里该日期恒为 1 条。
 */
export function saveTodayResult(item: HistoryItem): void {
  if (!isHistoryItem(item)) return;

  const normalized = normalize(item);
  safeSet(STORAGE_KEYS.daily, JSON.stringify(toRecord(normalized)));

  const history = loadHistory();
  const index = history.findIndex(entry => entry.date === normalized.date);
  if (index === -1) {
    history.push(normalized);
  } else {
    history[index] = normalized;
  }
  history.sort(compareDateDesc);

  safeSet(STORAGE_KEYS.history, JSON.stringify(history.map(toRecord)));
  safeSet(STORAGE_KEYS.streak, String(computeStreak(history, normalized.date)));
}

// ---------------------------------------------------------------------------
// 历史
// ---------------------------------------------------------------------------

/**
 * 读取全部历史，按日期**降序**。
 *
 * 逐条校验：一条坏记录只会丢掉它自己，不会污染整份历史。
 * 同日多条时保留先出现的那条（写入路径本就保证唯一）。
 */
export function loadHistory(): HistoryItem[] {
  const parsed = parseJson(safeGet(STORAGE_KEYS.history));
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const items: HistoryItem[] = [];
  for (const entry of parsed) {
    if (!isHistoryItem(entry)) continue;
    if (seen.has(entry.date)) continue;
    seen.add(entry.date);
    items.push(normalize(entry));
  }

  return items.sort(compareDateDesc);
}

// ---------------------------------------------------------------------------
// 连续天数
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` 往前推一天（纯 UTC 日期算术，不受本地时区与夏令时影响）。 */
function previousUtcDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return utcDate(new Date(Date.UTC(y, m - 1, d) - 86_400_000));
}

/**
 * 以 `today` 为锚点往过去数连续天数。
 *
 * - `today` 不在历史里 → `0`（今天没抽，链条断了）；
 * - 只有今天 → `1`；
 * - 中间断档 → 只数到断档处。
 *
 * 纯函数：不读存储、不读时钟，`today` 由调用方注入。
 */
export function computeStreak(history: HistoryItem[], today: string): number {
  const days = new Set<string>();
  for (const item of history) {
    if (isHistoryItem(item)) days.add(item.date);
  }
  if (!days.has(today)) return 0;

  let streak = 0;
  let cursor = today;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousUtcDay(cursor);
  }
  return streak;
}

/**
 * 读取连续天数。以历史为准重算；`huedle:streak` 只作缓存，
 * 与重算结果不一致时顺手修正（脏数据被静默覆盖，不抛）。
 */
export function loadStreak(): number {
  const cachedRaw = parseJson(safeGet(STORAGE_KEYS.streak));
  const cached =
    typeof cachedRaw === 'number' && Number.isInteger(cachedRaw) && cachedRaw >= 0 ? cachedRaw : null;

  const history = loadHistory();
  if (history.length === 0) return cached ?? 0;

  const computed = computeStreak(history, utcDate());
  if (cached !== computed) safeSet(STORAGE_KEYS.streak, String(computed));
  return computed;
}

// ---------------------------------------------------------------------------
// 登录模式的「今天已揭晓」标记
// ---------------------------------------------------------------------------

/** `{ userId, date }`：哪一个账户的哪一天已经揭晓过。 */
export interface RevealedMarker {
  userId: string;
  date: string;
}

function isRevealedMarker(value: unknown): value is RevealedMarker {
  if (!isRecord(value)) return false;
  const { userId, date } = value;
  return typeof userId === 'string' && userId.length > 0 && typeof date === 'string' && DATE_RE.test(date);
}

/** 读取已揭晓标记；脏数据 / 结构不符一律视为 null（登录模式据此要求重新揭晓）。 */
export function loadRevealedMarker(): RevealedMarker | null {
  const parsed = parseJson(safeGet(STORAGE_KEYS.revealed));
  return isRevealedMarker(parsed) ? { userId: parsed.userId, date: parsed.date } : null;
}

/**
 * 写入已揭晓标记。**这是登录模式唯一会写的 key**（除 token 外），
 * 与本地模式的 `huedle:daily` / `huedle:history` / `huedle:streak` 完全隔离。
 */
export function saveRevealedMarker(userId: string, date: string): void {
  if (!userId || !DATE_RE.test(date)) return;
  safeSet(STORAGE_KEYS.revealed, JSON.stringify({ userId, date } satisfies RevealedMarker));
}

/** 该账户的这一天是否已揭晓过。 */
export function isRevealedToday(userId: string, date: string): boolean {
  const marker = loadRevealedMarker();
  return marker !== null && marker.userId === userId && marker.date === date;
}

// ---------------------------------------------------------------------------
// 登录模式的今日结果缓存（按用户分键）`huedle:daily:user:<userId>`
// ---------------------------------------------------------------------------

/** 非负整数才认；其余（缺字段 / 脏值）一律回落 0。 */
function normalizeStreak(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** 缓存下来的今日结果：`HistoryItem` + 服务端随 `/api/daily` 下发的连续天数。 */
export interface UserDailyRecord extends HistoryItem {
  streak: number;
}

/**
 * 读取某账户某一天的今日结果缓存。
 *
 * 有效性判定用 `date` 字段（**跨天自然失效**），不用时间戳 TTL——
 * 服务端的今日结果当天冻结，所以「同一天」就是正确的有效期。
 * 不属于该日期 / 脏数据 → `null`（调用方据此走服务端）。
 */
export function loadUserDaily(userId: string, date: string): UserDailyRecord | null {
  if (!userId) return null;

  const parsed = parseJson(safeGet(userDailyKey(userId)));
  if (!isHistoryItem(parsed)) return null;
  if (parsed.date !== date) return null;

  const { streak } = parsed as HistoryItem & { streak?: unknown };
  return { ...normalize(parsed), streak: normalizeStreak(streak) };
}

/**
 * 写入某账户的今日结果缓存（**不追加历史**，只存这一条）。
 *
 * 这是登录模式除 token / identity / revealed 之外唯一会写的记录类 key，
 * 且 key 带 userId，与本地模式的 `huedle:daily` 天然隔离。
 */
export function saveUserDaily(userId: string, item: HistoryItem, streak: number): void {
  if (!userId || !isHistoryItem(item)) return;

  const record = { v: STORAGE_VERSION, ...normalize(item), streak: normalizeStreak(streak) };
  safeSet(userDailyKey(userId), JSON.stringify(record));
}

/** 删掉某账户的今日结果缓存（登出 / 401 回退 / 缓存脏时调用）。 */
export function clearUserDaily(userId: string): void {
  if (!userId) return;
  safeRemove(userDailyKey(userId));
}

/** 按前缀删掉所有键（前缀扫描；删之前先把 key 收集齐，避免边遍历边删）。 */
function clearKeysWithPrefix(prefix: string): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;

    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    /* 存储不可用：没有可清的东西 */
  }
}

/** 删掉**所有**账户的今日结果缓存（`clearLocalData` 用）。 */
function clearAllUserDaily(): void {
  clearKeysWithPrefix(STORAGE_KEYS.userDailyPrefix);
}

// ---------------------------------------------------------------------------
// 登录模式的历史缓存（按用户分键）`huedle:history:user:<userId>`
// ---------------------------------------------------------------------------
//
// ⚠️ **与 `huedle:daily:user:<userId>` 的耦合（最容易忘了的那种 bug）**
//
// 历史每天新增一条，但它**在同一天内也会变**：玩家先打开「我的」看到历史，
// 回到今日页抽了今天的颜色，历史就多了一条。如果今日结果落盘（写
// `huedle:daily:user:<userId>`）时不清掉历史缓存，就会出现
// 「我明明抽了今天的，历史页却没有」——这种 bug 最容易被用户发现、
// 却最难复现（要先看历史再抽色）。因此写入今日结果缓存的**那条路径**
// 必须同时调用 {@link clearUserHistory}（见 `composables/useDailyColor.ts`）。

/** 缓存内容：`{ day, items }`，`day` 是写入当天的 `utcDate()`。 */
export interface UserHistoryRecord {
  day: string;
  items: HistoryItem[];
}

/**
 * 读取某账户的历史缓存。
 *
 * 命中条件：key 存在、结构合法、且 `day === 传入的 day`（**跨天自然失效**，
 * 不用时间戳 TTL——历史只按 UTC 天分组，天数对不上就必须回服务端）。
 * 未命中 / 脏数据一律返回 `null`，绝不抛。
 *
 * 逐条校验与 `loadHistory()` 同口径：一条坏记录只丢它自己。
 * 返回 `null` 表示"缓存不可用"，返回 `[]` 表示"缓存可用，服务端当时就是空历史"。
 */
export function loadUserHistory(userId: string, day: string): HistoryItem[] | null {
  if (!userId) return null;

  const parsed = parseJson(safeGet(userHistoryKey(userId)));
  if (!isRecord(parsed)) return null;

  const { v, day: cachedDay, items } = parsed;
  if (v !== undefined && v !== STORAGE_VERSION) return null;
  if (typeof cachedDay !== 'string' || !DATE_RE.test(cachedDay)) return null;
  if (cachedDay !== day) return null;
  if (!Array.isArray(items)) return null;

  const seen = new Set<string>();
  const valid: HistoryItem[] = [];
  for (const entry of items) {
    if (!isHistoryItem(entry)) continue;
    if (seen.has(entry.date)) continue;
    seen.add(entry.date);
    valid.push(normalize(entry));
  }

  return valid.sort(compareDateDesc);
}

/**
 * 写入某账户的历史缓存（覆盖式，只存这一份快照）。
 *
 * 与 `saveUserDaily` 一样是登录模式专属的 key，本地模式的 `huedle:history`
 * 一个字节都不会被碰。
 */
export function saveUserHistory(userId: string, day: string, items: HistoryItem[]): void {
  if (!userId || !DATE_RE.test(day) || !Array.isArray(items)) return;

  const record = {
    v: STORAGE_VERSION,
    day,
    items: items.filter(isHistoryItem).map(normalize).sort(compareDateDesc),
  };
  safeSet(userHistoryKey(userId), JSON.stringify(record));
}

/**
 * 删掉某账户的历史缓存。
 *
 * **调用时机**：① `saveUserDaily` 的那条路径（今日结果一落盘，历史就多了一条，
 * 缓存必须作废——见上方耦合说明）；② 登出 / 401 回退（与 `clearUserDaily` 一起）。
 */
export function clearUserHistory(userId: string): void {
  if (!userId) return;
  safeRemove(userHistoryKey(userId));
}

/** 删掉**所有**账户的历史缓存（`clearLocalData` 用）。 */
function clearAllUserHistory(): void {
  clearKeysWithPrefix(STORAGE_KEYS.userHistoryPrefix);
}

// ---------------------------------------------------------------------------
// 登录模式的身份缓存 `huedle:identity`
// ---------------------------------------------------------------------------

/**
 * `{ userId, userName }`：**只用于首屏显示**的登录身份缓存。
 *
 * 它让「已登录用户重复访问」可以立刻按登录模式渲染，不必等 `GET /api/auth/me`
 * 落地；但 token 是否有效**永远由服务端判定**，本缓存不参与授权决策。
 */
export interface CachedIdentity {
  userId: string;
  userName: string;
}

function isCachedIdentity(value: unknown): value is CachedIdentity {
  if (!isRecord(value)) return false;
  const { userId, userName } = value;
  return typeof userId === 'string' && userId.length > 0 && typeof userName === 'string';
}

/** 读取身份缓存；结构不符（缺字段 / 类型不对 / 空 userId）一律视为 null。 */
export function loadIdentity(): CachedIdentity | null {
  const parsed = parseJson(safeGet(STORAGE_KEYS.identity));
  if (!isCachedIdentity(parsed)) return null;
  return { userId: parsed.userId, userName: parsed.userName };
}

/** 写入身份缓存（登录 / 注册成功、以及 `hydrate()` 用服务端结果覆盖时调用）。 */
export function saveIdentity(userId: string, userName: string): void {
  if (!userId) return;
  safeSet(STORAGE_KEYS.identity, JSON.stringify({ userId, userName } satisfies CachedIdentity));
}

/** 清掉身份缓存（登出 / 401 回退时调用）。 */
export function clearIdentity(): void {
  safeRemove(STORAGE_KEYS.identity);
}

// ---------------------------------------------------------------------------
// 清空
// ---------------------------------------------------------------------------

/**
 * 清空**记录类**的本地数据：今日存档 / 历史 / 连续天数缓存。
 *
 * 与 `clearLocalData()` 的关键区别：**保留匿名 ID**（以及登录 token）。
 * 匿名 ID 是"这个人是谁"——它是取色的种子的一部分，删掉它等于换了一个人，
 * 同一天会抽到不同颜色。历史页的「清空记录」只想删记录，不能顺手把用户换掉，
 * 也不能把人踢下线，所以这里不碰这两个 key。
 */
export function clearLocalHistory(): void {
  safeRemove(STORAGE_KEYS.daily);
  safeRemove(STORAGE_KEYS.history);
  safeRemove(STORAGE_KEYS.streak);
}

/**
 * 清空全部本地数据（含匿名 ID 与登录态缓存；匿名 ID 被清掉等于换了一个"人"，
 * 会重新抽到今天的颜色）。
 */
export function clearLocalData(): void {
  safeRemove(STORAGE_KEYS.daily);
  safeRemove(STORAGE_KEYS.history);
  safeRemove(STORAGE_KEYS.streak);
  safeRemove(STORAGE_KEYS.token);
  safeRemove(STORAGE_KEYS.anonymousId);
  safeRemove(STORAGE_KEYS.revealed);
  safeRemove(STORAGE_KEYS.identity);
  clearAllUserDaily();
  clearAllUserHistory();
}
