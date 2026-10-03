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
} as const;

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

/** 清空全部本地数据（含匿名 ID；匿名 ID 被清掉等于换了一个"人"，会重新抽到今天的颜色）。 */
export function clearLocalData(): void {
  safeRemove(STORAGE_KEYS.daily);
  safeRemove(STORAGE_KEYS.history);
  safeRemove(STORAGE_KEYS.streak);
  safeRemove(STORAGE_KEYS.token);
  safeRemove(STORAGE_KEYS.anonymousId);
  safeRemove(STORAGE_KEYS.revealed);
}
