/**
 * 历史记录的数据源（见 docs/DESIGN.md 第 2 / 11 / 14 节）。
 *
 * 「抽出即定」在历史页同样成立：条目**全部直接来自存档**，这里既不重跑 `check`、
 * 也不重算 `cp` / `rarity`——记录里写的是什么就展示什么。
 * 展示用的徽章列表由 `restoreScore(...)`（在 `HistoryList` 展开时）按存档还原，
 * 与今日页共用同一份取代逻辑，因此历史里「被同类更强取代」的显示不会分叉。
 *
 * ── 双模式分叉 ────────────────────────────────────────────────────────────
 *
 * | | 本地模式 | 登录模式 |
 * |---|---|---|
 * | 数据源 | `loadHistory()`（localStorage） | `huedle:history:user:<userId>` 缓存，未命中才 `GET /api/history` |
 * | 清空 | 有「清空本地记录」（保留匿名 ID） | **没有**本地记录可清，按钮不显示 |
 *
 * 登录模式的历史缓存（任务 C）：数据库在美东，一次 `GET /api/history` 约 740ms，
 * 而历史在同一天内也会变（抽了今天的颜色就多一条）——所以缓存的**有效期是
 * `day === utcDate()`**（跨天自然失效），并且**今日结果缓存一被写入，就由
 * `useDailyColor` 连带清掉它**（见 `lib/storage.ts` 的耦合说明）。
 * 忘记这个耦合就会出现「我明明抽了今天的，历史页却没有」。
 *
 * 统计口径（`totalDays` / `streak` / `bestCp` / `totalCp` / `byRarity`）由**同一个**
 * {@link computeHistoryStats} 计算，两种模式只换数据源，不换算法。
 *
 * 日期一律 UTC 口径：连续天数锚在 `utcDate()` 上（与 `loadStreak()` / 今日页一致）。
 * 日期可通过 `options.date` 注入，连续天数的测试不需要 mock 系统时钟。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { utcDate, type ScoreRarity } from '@huedle/shared';
import { getHistory, isApiError } from '../lib/api';
import {
  SCORE_RARITIES,
  clearLocalHistory,
  computeStreak,
  loadHistory,
  loadUserHistory,
  saveUserHistory,
  type HistoryItem,
} from '../lib/storage';
import { clearSessionOnUnauthorized, currentSession } from '../stores/session';

export interface HistoryStats {
  /** 记录天数。 */
  totalDays: number;
  /** 当前连续（`computeStreak(entries, today)` 的口径）。 */
  streak: number;
  /** 最高单日 CP。 */
  bestCp: number;
  /** 总 CP：历史里**所有**条目 `cp` 之和；空历史为 0（不是 NaN / undefined）。 */
  totalCp: number;
  /** 最高单日 CP 的那条记录；无记录时为 `null`。 */
  bestEntry: HistoryItem | null;
  /** 各档天数。**7 档全有键**（含 `trash`），没有的补 0。 */
  byRarity: Record<ScoreRarity, number>;
}

/**
 * 统计口径的**唯一实现**：本地模式与登录模式共用（DESIGN 第 2 节「共用同一套评分逻辑」）。
 * 纯函数：不读存储、不读时钟，`today` 由调用方注入。
 */
export function computeHistoryStats(entries: HistoryItem[], date?: Date): HistoryStats {
  // 先铺满 7 档再计数：缺档补 0，消费方不必自己兜底。
  const byRarity = Object.fromEntries(
    SCORE_RARITIES.map(rarity => [rarity, 0]),
  ) as Record<ScoreRarity, number>;

  let bestEntry: HistoryItem | null = null;
  // 总 CP 从 0 起累加：空历史天然是 0，不会出现 NaN / undefined。
  let totalCp = 0;
  for (const entry of entries) {
    byRarity[entry.rarity] += 1;
    totalCp += entry.cp;
    if (bestEntry === null || entry.cp > bestEntry.cp) bestEntry = entry;
  }

  return {
    totalDays: entries.length,
    streak: computeStreak(entries, utcDate(date)),
    bestCp: bestEntry?.cp ?? 0,
    totalCp,
    bestEntry,
    byRarity,
  };
}

export interface UseHistoryOptions {
  /** 注入日期（默认当前时刻），只作为连续天数的锚点。 */
  date?: Date;
}

export interface UseHistory {
  /** 全部历史，按日期降序（本地模式由存储层排序，登录模式由服务端排序）。 */
  entries: ComputedRef<HistoryItem[]>;
  stats: ComputedRef<HistoryStats>;
  /** 是否还没有任何记录。 */
  isEmpty: ComputedRef<boolean>;
  /** 当前是否登录模式。 */
  isLoggedIn: ComputedRef<boolean>;
  /** 是否允许「清空」——只有本地模式有本地记录可清。 */
  canClear: ComputedRef<boolean>;
  /** 读取中（登录模式的网络请求；本地模式是同步的，恒为 false）。 */
  isLoading: Ref<boolean>;
  /** 读取失败的可展示文案；`null` 表示没有错误。UI 提供重试。 */
  error: Ref<string | null>;
  /** 重新读取：本地同步、登录模式异步（两种模式都返回 Promise 便于 `await`）。 */
  reload: () => Promise<void>;
  /** 清空本地记录（保留匿名 ID，见 `clearLocalHistory`）；登录模式下不做任何事。 */
  clear: () => void;
}

export function useHistory(options: UseHistoryOptions = {}): UseHistory {
  const entries = ref<HistoryItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  /** 在 `computed` 里读取，登出 / 登录后 `canClear` 会跟着变。 */
  const isLoggedIn = computed(() => currentSession().isLoggedIn);
  const canClear = computed(() => !isLoggedIn.value);

  /**
   * 本地分支与**缓存命中的登录分支**都同步赋值：`entries` 在 `reload()` 返回前
   * 就更新完毕，既有调用方（含测试）不需要 `await`，命中缓存时也一个请求都不发。
   */
  function reload(): Promise<void> {
    error.value = null;

    const session = currentSession();
    if (!session.isLoggedIn || session.token === null || session.userId === null) {
      entries.value = loadHistory();
      return Promise.resolve();
    }

    const { token, userId } = session;
    const day = utcDate(options.date);

    // ① 先读本账户本日的历史缓存：命中即渲染（0 请求）。
    const cached = loadUserHistory(userId, day);
    if (cached !== null) {
      entries.value = cached;
      return Promise.resolve();
    }

    // ② 未命中才走服务端，成功后写回缓存（有效期 = 这一天的 utcDate()）。
    isLoading.value = true;
    return (async () => {
      try {
        const items = await getHistory(token);
        entries.value = items;
        saveUserHistory(userId, day, items);
      } catch (err) {
        if (isApiError(err) && err.status === 401) {
          // token 失效：回退本地模式并读回本地历史（本地数据从未被写过）。
          // clearSessionOnUnauthorized 会连带清掉本账户的今日 / 历史缓存。
          clearSessionOnUnauthorized();
          entries.value = loadHistory();
        } else {
          error.value = isApiError(err) ? err.message : '读取历史记录失败，请稍后重试。';
          entries.value = [];
        }
      } finally {
        isLoading.value = false;
      }
    })();
  }

  // 立即读一次：`entries` 在 setup 阶段就可直接用，页面不需要额外的生命周期钩子。
  void reload();

  const stats = computed<HistoryStats>(() => computeHistoryStats(entries.value, options.date));
  const isEmpty = computed(() => entries.value.length === 0);

  function clear(): void {
    if (isLoggedIn.value) return; // 登录模式没有本地记录可清
    clearLocalHistory();
    void reload();
  }

  return {
    entries: computed(() => entries.value),
    stats,
    isEmpty,
    isLoggedIn,
    canClear,
    isLoading,
    error,
    reload,
    clear,
  };
}
