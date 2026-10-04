/**
 * 报告缓存：**只在内存里**，按 `(days, includeNames, topN)` 分键，带 TTL。
 *
 * 为什么值得缓存：本工具的库在悉尼，一次完整统计要 10+ 次跨洋往返；
 * 而窗口口径是"最近 N 天 + 日期粒度"，数据不会秒级变化——同一个窗口被反复访问时
 * 没有任何理由重跑（UI 的 7/30/90 切换尤其明显）。
 *
 * 三条硬约束的落点：
 *   ① **不落盘**：本文件只 import 类型，不 import `node:fs`；缓存就是进程里的 Map。
 *      （`cache.test.ts` 有一条源码级回归，防止以后有人往里加 fs。）
 *   ② **不串味**：键必须同时包含 `days` 与 `includeNames`——后者决定报告里是否带
 *      **用户名**，两种报告绝不能互相命中；`topN` 也进键（UI 与 CLI 的 M4 上限不同）。
 *   ③ **只读不受影响**：缓存只存已经生成的 `StatsReport`，取数通道仍然只有 `db.ts` 一条。
 *
 * 失效策略选 **TTL + 手动刷新**：
 *   - TTL（默认 {@link REPORT_CACHE_TTL_MS} = 60s）：数据是"每天几条"的量级，
 *     1 分钟内的重复访问不可能得出不同结论；同时保证"刚抽完刷新页面"最多等 1 分钟。
 *   - 手动刷新：`?refresh=1` 绕过缓存重查（见 `ui/server.ts`），
 *     这样"我就是要现在看"不必重启服务。
 */
import type { StatsReport } from './report';

/** 默认存活时间：60 秒。数据是日期粒度，分钟级陈旧不可能改变任何结论。 */
export const REPORT_CACHE_TTL_MS = 60_000;

/** 缓存键的全部维度。少一个维度就可能把一份报告喂给另一个问题。 */
export interface ReportCacheKey {
  days: number;
  includeNames: boolean;
  topN: number;
}

/** 语义化的键字符串（只用于 Map 索引，不参与展示）。 */
export function reportCacheKey(key: ReportCacheKey): string {
  return `${key.days}|${key.includeNames ? 'names' : 'anon'}|${key.topN}`;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/** 极小的 TTL Map 缓存。`now` 可注入，便于测试确定性过期。 */
export class TtlCache<V> {
  private readonly entries = new Map<string, CacheEntry<V>>();

  constructor(
    private readonly ttlMs: number = REPORT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('TtlCache 需要正的 ttlMs');
  }

  /** 命中且未过期才返回值；过期条目顺手删除（不会无限增长）。 */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** 请求级选项：`refresh` 为真时忽略缓存，重跑取数（不改变结果，只是不省这一次）。 */
export interface LoadReportOptions {
  refresh?: boolean;
}

export interface CachedReportLoaderOptions {
  /** 存活时间（毫秒），默认 {@link REPORT_CACHE_TTL_MS}。 */
  ttlMs?: number;
  /** 时钟注入点，默认 `Date.now`。 */
  now?: () => number;
}

export interface CachedReportLoader {
  loadReport(key: ReportCacheKey, options?: LoadReportOptions): Promise<StatsReport>;
  /** 手动失效（测试与运维用），下次请求重跑。 */
  invalidate(): void;
  readonly cache: TtlCache<StatsReport>;
}

/**
 * 把一个"按窗口取数"的函数包成带 TTL 缓存的加载器。
 *
 * 并发同一窗口时共享同一个 in-flight Promise，避免缓存穿透时同时轰库；
 * 失败**不写缓存**（下一次请求会重试）。
 */
export function createCachedReportLoader(
  load: (key: ReportCacheKey) => Promise<StatsReport>,
  options: CachedReportLoaderOptions = {},
): CachedReportLoader {
  const cache = new TtlCache<StatsReport>(options.ttlMs ?? REPORT_CACHE_TTL_MS, options.now ?? Date.now);
  const inFlight = new Map<string, Promise<StatsReport>>();

  return {
    cache,
    invalidate(): void {
      cache.clear();
    },
    async loadReport(key: ReportCacheKey, loadOptions: LoadReportOptions = {}): Promise<StatsReport> {
      const cacheKey = reportCacheKey(key);
      if (loadOptions.refresh !== true) {
        const hit = cache.get(cacheKey);
        if (hit) return hit;
        const pending = inFlight.get(cacheKey);
        if (pending) return pending;
      }
      const promise = load(key)
        .then(report => {
          cache.set(cacheKey, report);
          return report;
        })
        .finally(() => {
          inFlight.delete(cacheKey);
        });
      inFlight.set(cacheKey, promise);
      return promise;
    },
  };
}
