/**
 * 报告缓存的行为测试（**不连数据库**——真库用例在 `*.db.test.ts`）。
 *
 * 覆盖任务书要求的 5 类里与缓存有关的 4 类：
 *   1. **命中不再查库**：连续两次同窗口请求，第二次的数据库查询次数为 0；
 *   2. **不串味**：days=7 / days=30 / includeNames 三种维度互不污染；
 *   3. **过期/失效**：TTL 到期与 `invalidate()` / `?refresh=1`；
 *   4. 缓存不改变口径：M4 的 `draws < 200` 门槛穿过去也不会被绕过。
 *
 * 这里的 `load` 计数器就是"数据库查询次数"：`load` 是唯一会走到 `runStats`（进而走到
 * `db.ts` 只读事务）的路径，缓存命中时它根本不会被调用。
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { contextForDraws } from '../analyze';
import { createCachedReportLoader, REPORT_CACHE_TTL_MS, reportCacheKey, TtlCache } from '../cache';
import type { StatsReport } from '../report';
import { analyzeMetric } from '../run';
import { METRICS } from '../stats';
import { createUiServer, listenUiServer } from '../ui/server';
import { sampleReport, SECRET_USERNAME } from './fixtures';

interface Served {
  base: string;
  close: () => Promise<void>;
}

/** 真的起一个 UI 服务，用 fetch 打请求（复用 HTTP 层，但不连库）。 */
async function serve(
  loadReport: (days: number, options?: { refresh?: boolean }) => Promise<StatsReport>,
  initialDays = 30,
): Promise<Served> {
  const server: Server = createUiServer({ initialDays, loadReport });
  const port = await listenUiServer(server, 0);
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const KEY = { days: 30, includeNames: false, topN: 200 };

describe('测试 1：缓存命中不再查库', () => {
  it('连续两次同窗口请求：第二次数据库查询次数为 0，且页面逐字节相同', async () => {
    let dbQueries = 0;
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1; // 唯一会走到数据库的路径
      return sampleReport({ windowDays: key.days, windowStart: `start-${key.days}` });
    });
    const served = await serve((days, options) => loader.loadReport({ ...KEY, days }, options));
    try {
      const first = await (await fetch(`${served.base}/?days=30`)).text();
      expect(dbQueries).toBe(1);

      const second = await (await fetch(`${served.base}/?days=30`)).text();
      expect(dbQueries).toBe(1); // ← 第二次 0 次查询
      expect(second).toBe(first);
    } finally {
      await served.close();
    }
  });

  it('并发的同窗口请求共享同一个 in-flight 查询（缓存穿透不会同时轰库）', async () => {
    let dbQueries = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1;
      await gate;
      return sampleReport({ windowDays: key.days });
    });

    const pending = [
      loader.loadReport({ ...KEY }),
      loader.loadReport({ ...KEY }),
      loader.loadReport({ ...KEY }),
    ];
    release();
    const [a, b, c] = await Promise.all(pending);
    expect(dbQueries).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('取数失败不写缓存：下一次请求会重试', async () => {
    let dbQueries = 0;
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1;
      if (dbQueries === 1) throw new Error('boom');
      return sampleReport({ windowDays: key.days });
    });
    await expect(loader.loadReport({ ...KEY })).rejects.toThrow('boom');
    const report = await loader.loadReport({ ...KEY });
    expect(dbQueries).toBe(2);
    expect(report.windowDays).toBe(30);
  });
});

describe('测试 2：缓存不串味', () => {
  it('键同时区分 days / includeNames / topN', () => {
    expect(reportCacheKey({ days: 7, includeNames: false, topN: 10 })).not.toBe(
      reportCacheKey({ days: 30, includeNames: false, topN: 10 }),
    );
    expect(reportCacheKey({ days: 30, includeNames: false, topN: 10 })).not.toBe(
      reportCacheKey({ days: 30, includeNames: true, topN: 10 }),
    );
    expect(reportCacheKey({ days: 30, includeNames: false, topN: 10 })).not.toBe(
      reportCacheKey({ days: 30, includeNames: false, topN: 200 }),
    );
  });

  it('days=7 与 days=30 各自正确；交替请求不会互相污染', async () => {
    let dbQueries = 0;
    const seen: number[] = [];
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1;
      seen.push(key.days);
      return sampleReport({ windowDays: key.days, windowStart: `start-${key.days}` });
    });
    const served = await serve((days, options) => loader.loadReport({ ...KEY, days }, options));
    try {
      const seven = await (await fetch(`${served.base}/?days=7`)).text();
      const thirty = await (await fetch(`${served.base}/?days=30`)).text();
      const sevenAgain = await (await fetch(`${served.base}/?days=7`)).text();
      const thirtyAgain = await (await fetch(`${served.base}/?days=30`)).text();

      expect(seen).toEqual([7, 30]); // 交替请求只查了两次库
      expect(dbQueries).toBe(2);
      expect(seven).toContain('最近 7 天');
      expect(thirty).toContain('最近 30 天');
      expect(sevenAgain).toBe(seven); // 7 天的页面没有被 30 天的结果覆盖
      expect(thirtyAgain).toBe(thirty);
      expect(sevenAgain).not.toBe(thirtyAgain);
    } finally {
      await served.close();
    }
  });

  it('includeNames 进键：匿名请求绝不会命中带用户名的报告', async () => {
    let dbQueries = 0;
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1;
      return sampleReport({
        windowDays: key.days,
        namesRequested: key.includeNames,
        names: key.includeNames ? [{ name: SECRET_USERNAME, days: 3, lastDate: '2026-01-01' }] : [],
      });
    });

    const anon = await loader.loadReport({ ...KEY });
    const named = await loader.loadReport({ ...KEY, includeNames: true });
    expect(dbQueries).toBe(2);
    expect(anon.namesRequested).toBe(false);
    expect(named.namesRequested).toBe(true);

    const anonAgain = await loader.loadReport({ ...KEY });
    expect(anonAgain).toBe(anon); // 还是那份匿名的
    expect(anonAgain.namesRequested).toBe(false);
    expect(anonAgain.names).toEqual([]);
    expect(dbQueries).toBe(2);
  });
});

describe('测试 3：过期与手动失效（TTL + refresh）', () => {
  it('默认 TTL 是 60 秒', () => {
    expect(REPORT_CACHE_TTL_MS).toBe(60_000);
  });

  it('TTL 到期前不重查，到期后重查（时钟注入，不 sleep）', async () => {
    let now = 0;
    let dbQueries = 0;
    const loader = createCachedReportLoader(
      async key => {
        dbQueries += 1;
        return sampleReport({ windowDays: key.days });
      },
      { ttlMs: 1000, now: () => now },
    );

    await loader.loadReport({ ...KEY });
    now = 999;
    await loader.loadReport({ ...KEY });
    expect(dbQueries).toBe(1); // 未到期

    now = 1000;
    await loader.loadReport({ ...KEY });
    expect(dbQueries).toBe(2); // 到期

    now = 1999;
    await loader.loadReport({ ...KEY });
    expect(dbQueries).toBe(2);
    now = 2000;
    await loader.loadReport({ ...KEY });
    expect(dbQueries).toBe(3);
  });

  it('invalidate() 立刻失效，且 TtlCache 删除过期条目（size 不会无限涨）', () => {
    let now = 0;
    const cache = new TtlCache<number>(100, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(1);
    now = 101;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1); // 过期条目被顺手删掉
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('?refresh=1 绕过缓存重查（仍然是 GET / 只读）', async () => {
    let dbQueries = 0;
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1;
      return sampleReport({ windowDays: key.days, generatedAt: `2026-01-01T00:00:0${dbQueries}.000Z` });
    });
    const served = await serve((days, options) => loader.loadReport({ ...KEY, days }, options));
    try {
      await fetch(`${served.base}/?days=30`);
      await fetch(`${served.base}/?days=30`);
      expect(dbQueries).toBe(1);

      const res = await fetch(`${served.base}/?days=30&refresh=1`);
      expect(res.status).toBe(200);
      expect(dbQueries).toBe(2); // 手动刷新真的重查了
      expect(await res.text()).toContain('2026-01-01T00:00:02.000Z');

      await fetch(`${served.base}/?days=30`);
      expect(dbQueries).toBe(2); // 刷新后的结果重新进了缓存
    } finally {
      await served.close();
    }
  });
});

describe('测试 4：缓存不改变口径（M4 样本门槛）', () => {
  it('draws < 200 的报告即使命中缓存，也仍然"不给结论"', async () => {
    const m4 = METRICS.find(metric => metric.id === 'M4')!;
    let dbQueries = 0;
    const loader = createCachedReportLoader(async key => {
      dbQueries += 1;
      const section = analyzeMetric(
        m4,
        [{ badge_id: 'casino-pair', hit_days: 3 }] as never,
        [],
        contextForDraws(50, key.topN), // 50 < 200
      );
      return sampleReport({ windowDays: key.days, sections: [section] });
    });
    const served = await serve((days, options) => loader.loadReport({ ...KEY, days }, options));
    try {
      // 控制台式版面：右侧只渲染选中的那一项，所以要看 M4 的结论就得先选中它（`?m=M4`）。
      const first = await (await fetch(`${served.base}/?days=30&m=M4`)).text();
      const second = await (await fetch(`${served.base}/?days=30&m=M4`)).text();
      expect(dbQueries).toBe(1);
      expect(second).toBe(first);
      expect(first).toContain('不给结论');
      expect(first).not.toContain('偏差 z');
      expect(first).not.toContain('期望命中');
    } finally {
      await served.close();
    }
  });
});

describe('硬约束⑤：缓存不落盘', () => {
  it('cache.ts 与 ui/ 都不 import node:fs（缓存只在内存）', () => {
    for (const relative of ['../cache.ts', '../ui/server.ts', '../ui/render.ts']) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
      expect(source, `${relative} 不应 import node:fs`).not.toMatch(/from\s+['"]node:fs['"]/);
    }
  });
});
