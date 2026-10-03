/**
 * 今日取色（见 docs/DESIGN.md 第 8 节与第 11 节）。
 *
 * 三条核心规则的实现要点：
 *
 * 1. **刷新不变（冻结）** —— 当天**首次**抽取时按纯函数算出结果并写盘；
 *    此后一律以存档为准，**不再重算**。因此「刷新不变」是无条件的：
 *    即使之后部署了新徽章、修了某条 `check`、重跑了定价，这一天也不会变。
 *    纯函数只负责"今天还没抽过"时产出那唯一一次的结果。
 * 2. **每天只有一次** —— `saveTodayResult` 对同一日期幂等（同日覆盖而非追加），
 *    所以 `reveal()` 调 N 次历史里也只有 1 条。
 * 3. **跨天自动换新色** —— 日期一律走 `utcDate()`（UTC 口径，见 DESIGN 第 3 节），
 *    绝不用本地时区；`loadTodayResult(day)` 对不上日期就视为没有存档。
 *
 * 注意「冻结」带来的一个必然结果：存档里的 `cp` / 命中集合是**权威值**，
 * 展示用的徽章对象按 id 从当前徽章表解析（`name` / `description` 允许随版本更新），
 * 取代关系由存档的命中集合按 group 规则推出。见 `restoreScore`。
 *
 * 日期通过 `options.date` 注入，跨天测试不需要 mock 系统时钟。
 *
 * ⚠️ **「揭晓」不是「抽取」（DESIGN 第 8 节「抽出即定」）**
 *
 * 颜色在页面加载之前就已经决定了；`(identity, date)` 定了，颜色就定了，
 * 跟用户点不点、怎么点、点了以后动画怎么播**毫无关系**。`HexRoller` 里滚动的
 * 随机 HEX 只是**装饰**，它停在哪儿不参与任何计算。
 *
 * ── 双模式分叉（DESIGN 第 2 / 11 节） ─────────────────────────────────────
 *
 * | | 本地模式 | 登录模式 |
 * |---|---|---|
 * | 结果来源 | 纯函数 + `huedle:daily` 冻结存档 | `huedle:daily:user:<userId>` 缓存，未命中才 `GET /api/daily` |
 * | 连续天数 | `computeStreak(loadHistory(), day)` | `/api/daily` 响应的 `streak` 字段（不再调 `/api/history`） |
 * | 已揭晓标记 | `huedle:daily` 是否存在 | `huedle:revealed` 的 `{ userId, date }` |
 * | `reveal()` 写什么 | `saveTodayResult()`（daily + history + streak） | **只写** `huedle:revealed` |
 *
 * **登录模式一次都不写 `huedle:daily` / `huedle:history` / `huedle:streak`**
 * ——它们是本地模式专属（登录模式的缓存用的是 `huedle:daily:user:<userId>` 这个
 * 完全不同的 key），这样登出后本地历史与今日结果才能原封不动恢复（11.3）。
 *
 * 401 → 清 session、回退本地模式、重新 load，并给一条 `notice`；
 * 其它失败（含后端没起）→ 可重试的 `error` 态，绝不白屏。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  calculateScore,
  colorInfoFromHex,
  getDailyColorInfo,
  restoreScore,
  utcDate,
  type ColorInfo,
  type ScoreResult,
} from '@huedle/shared';
import { getDaily, isApiError } from '../lib/api';
import { getLocalIdentity } from '../lib/identity';
import {
  clearUserDaily,
  computeStreak,
  isHistoryItem,
  isRevealedToday,
  loadHistory,
  loadTodayResult,
  loadUserDaily,
  saveRevealedMarker,
  saveTodayResult,
  saveUserDaily,
  type HistoryItem,
} from '../lib/storage';
import { clearSessionOnUnauthorized, currentNotice, currentSession } from '../stores/session';

export interface UseDailyColorOptions {
  /**
   * 注入日期（默认当前时刻）。
   *
   * 测试用它伪造"跨天"，因此实现里**不允许**出现第二次 `new Date()` 的隐式取时。
   */
  date?: Date;
}

export interface UseDailyColor {
  /** 今日结果（徽章 / 总分 / 稀有度）。 */
  result: ComputedRef<ScoreResult | null>;
  /** 今日颜色（RGB / HEX / HSL）——`ScoreResult` 里不含颜色，UI 需要它。 */
  color: ComputedRef<ColorInfo | null>;
  /** 今日结果的历史记录形态（存储层结构）。 */
  historyItem: ComputedRef<HistoryItem | null>;
  /** 连续天数。 */
  streak: ComputedRef<number>;
  /** 是否正在读取。 */
  isLoading: Ref<boolean>;
  /** 今日是否已揭示（本地：存档存在；登录：`huedle:revealed` 命中）。 */
  revealed: Ref<boolean>;
  /** 读取失败的可展示文案；`null` 表示没有错误。UI 提供重试。 */
  error: Ref<string | null>;
  /**
   * 一次性提示（如「登录已失效，已回退本地模式」）。
   *
   * 实际存在 session store 里：401 回退会触发按模式重建路由内容，
   * 提示必须活得比这个 composable 实例久。无 Pinia 时为 `null`。
   */
  notice: ComputedRef<string | null>;
  /**
   * 读取：有存档就冻结使用（已揭示），**没有存档只算不写**（未揭示）。
   *
   * 未揭示时 `color` / `result` / `historyItem` 也已经可用——它们就是纯函数
   * 的唯一结果，供揭晓动画拿去做 `target`；写盘要等用户点过之后的 `reveal()`。
   */
  load: () => Promise<void>;
  /** 标记为已揭示并落盘（动画结束后调用）；幂等，且不改变任何颜色数据。 */
  reveal: () => Promise<void>;
}

/** 本次 `load()` 用的是哪种身份——`reveal()` 据此决定"写什么"，不会中途改换。 */
type LoadedIdentity = { mode: 'local' } | { mode: 'user'; token: string; userId: string };

/**
 * 从计分结果派生要落盘的记录。
 *
 * `badgeIds` 记**全部命中**（含被取代的）——取代关系可以从这个集合推出来，
 * 但反向推不回去，所以存档必须留全集（与 DESIGN 9.3 的 `badge_ids` 一致）。
 */
function toHistoryItem(date: string, color: ColorInfo, score: ScoreResult): HistoryItem {
  return {
    date,
    hex: color.hex,
    cp: score.cp,
    rarity: score.rarity,
    badgeIds: score.badges.map(badge => badge.id),
  };
}

export function useDailyColor(options: UseDailyColorOptions = {}): UseDailyColor {
  const result = ref<ScoreResult | null>(null);
  const color = ref<ColorInfo | null>(null);
  const historyItem = ref<HistoryItem | null>(null);
  const streak = ref(0);
  const isLoading = ref(false);
  const revealed = ref(false);
  const error = ref<string | null>(null);
  /** 提示来自 store（见 `UseDailyColor.notice` 的说明），这里只做响应式转发。 */
  const notice = computed<string | null>(() => currentNotice());

  /** `load()` 解析出的当天日期，供 `reveal()` 重算连续天数时复用。 */
  let loadedDay: string | null = null;
  let loadedIdentity: LoadedIdentity | null = null;

  /** 唯一的取时入口：注入日期优先，保证同一次 load 内日期一致。 */
  const resolveDate = (): Date => options.date ?? new Date();

  /** 本地模式分支：与登录功能引入前**逐行一致**（纯函数 + 冻结存档 + 点击揭晓）。 */
  function loadFromLocal(date: Date, day: string): void {
    const archived = loadTodayResult(day);
    const archivedColor = archived ? colorInfoFromHex(archived.hex) : null;

    if (archived && archivedColor) {
      // ── 冻结分支：今天已经抽过，存档就是权威，绝不重算 ──────────────
      color.value = archivedColor;
      result.value = restoreScore(archived.badgeIds, archived.cp, archived.rarity);
      historyItem.value = archived;
      // 幂等重写：修复「daily 在、history 里却缺这一天」的半损坏状态
      saveTodayResult(archived);
      // 存档存在 = 今天已经揭示过（刷新页面直接看结果，不重播动画）
      revealed.value = true;
    } else {
      // ── 首次抽取分支：纯函数决定这唯一一次的结果 ────────────────────
      const dailyColor = getDailyColorInfo(getLocalIdentity(), date);
      const score = calculateScore(dailyColor);
      const item = toHistoryItem(day, dailyColor, score);

      color.value = dailyColor;
      result.value = score;
      historyItem.value = item;
      // 关键：**不写盘**。用户还没点，今天还不算"抽过"。
      revealed.value = false;
    }

    // 连续天数以历史为准重算（锚在注入的这一天，而不是系统时钟）
    streak.value = computeStreak(loadHistory(), day);
  }

  /**
   * 把一条今日结果（服务端响应或缓存）落到内存状态。
   *
   * 颜色 / 分数一律按存档还原，不重算；`streak` 直接采用随结果下发的值。
   * `historyItem` 只保留 `HistoryItem` 的 5 个字段（`streak` 不属于它）。
   */
  function applyResult(
    item: HistoryItem,
    itemColor: ColorInfo,
    streakValue: number,
    userId: string,
    day: string,
  ): void {
    color.value = itemColor;
    result.value = restoreScore(item.badgeIds, item.cp, item.rarity);
    historyItem.value = {
      date: item.date,
      hex: item.hex.toUpperCase(),
      cp: item.cp,
      rarity: item.rarity,
      badgeIds: [...item.badgeIds],
    };
    // 登录模式的"已揭示"由 huedle:revealed 决定，与 huedle:daily 无关。
    revealed.value = isRevealedToday(userId, day);
    streak.value = streakValue;
  }

  /** 从 `/api/daily` 响应里读连续天数；缺失 / 脏值一律按 0，不让页面崩。 */
  function readStreak(value: { streak?: unknown }): number {
    const raw = value.streak;
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
  }

  /**
   * 登录模式分支。
   *
   * A：**先读 `huedle:daily:user:<userId>` 缓存**，命中即渲染（0 请求）；
   *    未命中才 `GET /api/daily`，拿到后连同 `streak` 写回缓存。有效期由响应的
   *    `date` 字段判定（跨天自然失效），不用时间戳 TTL——服务端的今日结果当天冻结，
   *    所以「同一天」就是正确的有效期。
   * C：`streak` 直接取自 `/api/daily` 响应，不再额外调一次 `/api/history`。
   *
   * 缓存只影响「少发一次数据请求」，**不影响授权**：token 是否有效仍由
   * `hydrate()` 的 `GET /api/auth/me` 每次核对；这里的 401 也照旧回退本地模式。
   */
  async function loadFromServer(token: string, userId: string, day: string): Promise<void> {
    const cached = loadUserDaily(userId, day);
    if (cached) {
      const cachedColor = colorInfoFromHex(cached.hex);
      if (cachedColor) {
        applyResult(cached, cachedColor, cached.streak, userId, day);
        return;
      }
      // 缓存颜色解析不出来（脏数据 / 旧版本）：删掉它，改走服务端。
      clearUserDaily(userId);
    }

    let item: { streak?: unknown };
    try {
      item = await getDaily(token);
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        // token 过期 / 被撤销：清 session（并留下提示）、回退本地模式、重新 load。
        clearSessionOnUnauthorized();
        loadedIdentity = { mode: 'local' };
        loadFromLocal(resolveDate(), day);
        return;
      }
      error.value = isApiError(err) ? err.message : '读取今日颜色失败，请稍后重试。';
      return;
    }

    // 服务端响应同样视为不可信输入：结构不符就报可重试错误，而不是白屏。
    if (!isHistoryItem(item)) {
      error.value = '服务器返回的今日结果不完整。';
      return;
    }

    const itemColor = colorInfoFromHex(item.hex);
    if (!itemColor) {
      error.value = '服务器返回的颜色无法解析。';
      return;
    }

    const streakValue = readStreak(item);
    applyResult(item, itemColor, streakValue, userId, day);
    saveUserDaily(userId, item, streakValue);
  }

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const date = resolveDate();
      const day = utcDate(date);
      loadedDay = day;

      const session = currentSession();
      if (session.isLoggedIn && session.token !== null && session.userId !== null) {
        loadedIdentity = { mode: 'user', token: session.token, userId: session.userId };
        await loadFromServer(session.token, session.userId, day);
      } else {
        loadedIdentity = { mode: 'local' };
        loadFromLocal(date, day);
      }
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 揭晓：把**内存里已经算好的**结果落盘，并置 `revealed`。
   *
   * 幂等——已揭示时直接返回，历史里该日期永远只有 1 条。
   * 这里没有任何"重新算颜色"的路径：写的就是 `load()` 产出的那一条，
   * 所以动画播成什么样都不可能影响结果。
   *
   * 登录模式**只写 `huedle:revealed` 标记**，不碰任何本地记录键。
   */
  async function reveal(): Promise<void> {
    if (revealed.value) return;
    if (!historyItem.value) {
      // 还没 load（或 load 失败）时补一次读取，仍然由纯函数 / 服务端决定结果。
      await load();
      if (revealed.value) return;
    }

    const item = historyItem.value;
    if (!item) return;

    if (loadedIdentity?.mode === 'user') {
      saveRevealedMarker(loadedIdentity.userId, item.date);
      revealed.value = true;
      return;
    }

    saveTodayResult(item);
    revealed.value = true;

    // 今天落盘后连续天数才会含今天，重算一次（锚在注入日期上）。
    const day = loadedDay ?? utcDate(resolveDate());
    streak.value = computeStreak(loadHistory(), day);
  }

  return {
    result: computed(() => result.value),
    color: computed(() => color.value),
    historyItem: computed(() => historyItem.value),
    streak: computed(() => streak.value),
    isLoading,
    revealed,
    error,
    notice,
    load,
    reveal,
  };}
