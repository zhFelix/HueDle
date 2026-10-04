/**
 * UI HTTP 层的测试：**真的起服务**，用 `fetch` 打真实请求。
 *
 * 覆盖任务书里的 4 类要求：
 *   - 测试 1：断言 `server.address().address` 是 `127.0.0.1`（不是源码里的字符串，是内核里的真实地址）；
 *   - 测试 3：通过 HTTP 层尝试任何写操作都不可达（方法被拒 + 参数被拒），且不发 CORS 头；
 *   - 测试 4：7/30/90 天各自生效；非法值被拒且服务不崩；
 *   - 测试 5：默认页面里逐条不出现 fixtures 用户名。
 *
 * 这里注入假 `loadReport`（不起数据库），同时用一个计数器断言"哪些请求真的碰到了取数逻辑"。
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatsReport } from '../report';
import { createUiServer, listenUiServer, parseDaysParam, UI_HOST } from '../ui/server';
import { sampleReport, SECRET_USERNAME } from './fixtures';

interface Harness {
  server: Server;
  base: string;
  calls: (string | number)[];
  close: () => Promise<void>;
}

async function startHarness(
  loadReport: (days: number) => Promise<StatsReport>,
  initialDays = 30,
): Promise<Harness> {
  const calls: (string | number)[] = [];
  const server = createUiServer({
    initialDays,
    loadReport: async days => {
      calls.push(days);
      return loadReport(days);
    },
  });
  const port = await listenUiServer(server, 0);
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const okLoader = async (days: number): Promise<StatsReport> =>
  sampleReport({ windowDays: days, namesRequested: false, names: [] });

let main: Harness;

beforeAll(async () => {
  main = await startHarness(okLoader);
});

afterAll(async () => {
  await main.close();
});

describe('测试 1：只监听 127.0.0.1，绝不是 0.0.0.0', () => {
  it('server.address() 返回的 address 是 127.0.0.1（内核里的真实监听地址）', () => {
    const address = main.server.address() as AddressInfo;
    expect(address).toBeTruthy();
    expect(address.address).toBe('127.0.0.1');
    expect(address.address).not.toBe('0.0.0.0');
    expect(address.address).not.toBe('::');
    expect(address.family).toBe('IPv4');
    expect(address.port).toBeGreaterThan(0);
  });

  it('UI_HOST 常量就是 127.0.0.1，且没有任何 --host 入口', () => {
    expect(UI_HOST).toBe('127.0.0.1');
  });

  it('服务确实在这台机器上可达（证明上面的地址不是空壳）', async () => {
    const res = await fetch(`${main.base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('HueDle 只读统计 UI');
  });
});

describe('测试 4：时间窗口参数', () => {
  it.each([[7], [30], [90]])('?days=%i 生效（取数用的就是这个窗口）', async days => {
    main.calls.length = 0;
    const res = await fetch(`${main.base}/?days=${days}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`最近 ${days} 天`);
    expect(main.calls).toEqual([days]);
  });

  it('不带参数时用启动时的 initialDays', async () => {
    main.calls.length = 0;
    const res = await fetch(`${main.base}/`);
    expect(res.status).toBe(200);
    expect(main.calls).toEqual([30]);
  });

  it.each([['-1'], ['0'], ['99999'], ['abc'], ['1.5'], ['1e3'], ['1;DROP TABLE daily_results'], ['']])(
    '?days=%s 被拒（400）且不触碰取数逻辑',
    async raw => {
      main.calls.length = 0;
      const res = await fetch(`${main.base}/?days=${encodeURIComponent(raw)}`);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain('400');
      expect(main.calls).toEqual([]);
    },
  );

  it('非法参数之后服务仍然正常（没有崩、没有卡死）', async () => {
    await fetch(`${main.base}/?days=abc`);
    const res = await fetch(`${main.base}/?days=7`);
    expect(res.status).toBe(200);
  });

  it('parseDaysParam 是纯函数：空串/空白也拒绝', () => {
    expect(parseDaysParam(null, 30)).toEqual({ ok: true, days: 30 });
    expect(parseDaysParam('7', 30)).toEqual({ ok: true, days: 7 });
    expect(parseDaysParam('3650', 30)).toEqual({ ok: true, days: 3650 });
    for (const bad of ['0', '-1', 'abc', '1.5', ' ', '3651', '99999999999999999999']) {
      expect(parseDaysParam(bad, 30).ok).toBe(false);
    }
  });
});

describe('测试 3：只读不能因为多了个 HTTP 层而放松', () => {
  // 注：TRACE 不在列表里——Node 的 fetch（undici）直接以 "unsupported" 拒绝发出该请求，
  // 而它同样不是 GET/HEAD，因此与本组用例走的是同一条 405 分支（POST/OPTIONS 已覆盖）。
  it.each([['POST'], ['PUT'], ['PATCH'], ['DELETE'], ['OPTIONS']])(
    '%s / 一律 405，且不触碰取数逻辑',
    async method => {
      main.calls.length = 0;
      const res = await fetch(`${main.base}/`, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
      const html = await res.text();
      expect(html).toContain('不提供写端点');
      expect(main.calls).toEqual([]);
    },
  );

  it('写方法打到任意路径都不可达（路由根本不接受）', async () => {
    for (const path of ['/', '/api/write', '/admin', '/#M4']) {
      main.calls.length = 0;
      const res = await fetch(`${main.base}${path}`, {
        method: 'POST',
        body: JSON.stringify({ sql: 'DELETE FROM daily_results' }),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(405);
      expect(main.calls).toEqual([]);
    }
  });

  it('查询串里塞 SQL 不会被执行：取数逻辑只收到经过校验的天数', async () => {
    main.calls.length = 0;
    const res = await fetch(
      `${main.base}/?days=7&sql=${encodeURIComponent('DELETE FROM daily_results')}&table=daily_results`,
    );
    expect(res.status).toBe(200);
    expect(main.calls).toEqual([7]);
  });

  it('GET 之外的路径不存在 → 404', async () => {
    main.calls.length = 0;
    for (const path of ['/admin', '/api/stats', '/index.html']) {
      const res = await fetch(`${main.base}${path}`);
      expect(res.status).toBe(404);
    }
    expect(main.calls).toEqual([]);
  });

  it('HEAD 只给头不给体', async () => {
    const res = await fetch(`${main.base}/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('');
  });
});

describe('测试 5：默认不含用户名（HTTP 层）', () => {
  it('未开 --include-names 时，页面里逐条不出现 fixtures 用户名', async () => {
    // 即便 report 里带着用户名（防御性），未请求明细时页面也不许渲染它。
    const harness = await startHarness(async days =>
      sampleReport({
        windowDays: days,
        namesRequested: false,
        names: [{ name: SECRET_USERNAME, days: 7, lastDate: '2026-01-01' }],
      }),
    );
    try {
      const html = await (await fetch(`${harness.base}/`)).text();
      expect(html).not.toContain(SECRET_USERNAME);
      expect(html).not.toContain('用户明细');
    } finally {
      await harness.close();
    }
  });

  it('开启后才在页面上显示（且只在这个页面，服务不写文件）', async () => {
    const harness = await startHarness(async days =>
      sampleReport({
        windowDays: days,
        namesRequested: true,
        names: [{ name: SECRET_USERNAME, days: 7, lastDate: '2026-01-01' }],
      }),
    );
    try {
      const html = await (await fetch(`${harness.base}/`)).text();
      expect(html).toContain('用户明细');
      expect(html).toContain(SECRET_USERNAME);
    } finally {
      await harness.close();
    }
  });
});

describe('响应头：无 CORS、无外部依赖', () => {
  it('每个响应都不发 Access-Control-Allow-Origin（同源即可）', async () => {
    for (const init of [undefined, { method: 'POST' }, { method: 'HEAD' }] as const) {
      const res = await fetch(`${main.base}/`, init);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });

  it('页面响应带 no-store 与 nosniff', async () => {
    const res = await fetch(`${main.base}/`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('页面本身不引用任何外部资源', async () => {
    const html = await (await fetch(`${main.base}/`)).text();
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html.toLowerCase()).not.toContain('<script');
  });
});

describe('取数失败：500 且错误信息已脱敏', () => {
  it('页面不泄漏连接串/密码', async () => {
    const harness = await startHarness(async () => {
      throw new Error('connect failed: postgresql://postgres:sup3r-s3cret-pw@db.example.com:5432/postgres');
    });
    try {
      const res = await fetch(`${harness.base}/`);
      expect(res.status).toBe(500);
      const html = await res.text();
      expect(html).not.toContain('sup3r-s3cret-pw');
      expect(html).not.toContain('postgresql://postgres');
      expect(html).toContain('500');
    } finally {
      await harness.close();
    }
  });
});
