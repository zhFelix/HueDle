/**
 * 加徽章 UI 的 HTTP 层测试：**真的起服务**，用 `fetch` 打真实请求。
 *
 * 覆盖：
 *   - `/badge` 表单页（GET）与 `/badge/status.json`（轮询用）；
 *   - `POST /badge/submit`：同源校验、表单体校验、提交结果（成功/被拒）走 PRG；
 *   - **只读统计页仍然零 JS**（即使启用了加徽章路由）——这是硬约束，不能被本次改动破坏；
 *   - 提交只调注入的 `submit`，**绝不在请求处理器里跑管道**。
 */
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatsReport } from '../report';
import type { BadgeSpec } from '../addbadge/spec';
import type { SubmitResult } from '../addbadge/submit';
import { createUiServer, isSameOrigin, listenUiServer, tokenMatches } from '../ui/server';

/** 固定的表单令牌：生产里每个服务实例随机生成，测试里固定下来便于断言。 */
const TEST_TOKEN = 'a'.repeat(32);
import { sampleReport } from './fixtures';

interface Harness {
  server: Server;
  base: string;
  port: number;
  submissions: Array<{ id: string; family: string; force: boolean }>;
  close: () => Promise<void>;
}

let tmpRoot: string;

async function startHarness(
  submit: (spec: BadgeSpec, options: { force: boolean }) => SubmitResult,
): Promise<Harness> {
  const submissions: Harness['submissions'] = [];
  const server = createUiServer({
    initialDays: 30,
    loadReport: async (days): Promise<StatsReport> => sampleReport({ windowDays: days, namesRequested: false, names: [] }),
    badge: {
      adminRoot: tmpRoot,
      root: tmpRoot,
      token: TEST_TOKEN,
      readStatus: () => ({ status: null, interrupted: false, interruption: null, lock: { kind: 'none' } }),
      submit: (spec, options) => {
        submissions.push({ id: spec.id, family: spec.family, force: options.force });
        return submit(spec, options);
      },
    },
  });
  const port = await listenUiServer(server, 0);
  return {
    server,
    port,
    base: `http://127.0.0.1:${port}`,
    submissions,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const okSubmit = (spec: BadgeSpec): SubmitResult => ({
  ok: true,
  runId: `20261004T100000Z-${spec.id}`,
  logPath: '/tmp/log',
  pid: 1234,
});

let main: Harness;

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'huedle-ui-badge-'));
  main = await startHarness(spec => okSubmit(spec));
});

afterAll(async () => {
  await main.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function form(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    id: 'gray-ui-added',
    name: '界面新增',
    description: 'R = 0 且 B = 7',
    family: 'gray',
    group: '',
    mode: 'when',
    when: '{"all":[{"eq":[{"field":"r"},0]},{"eq":[{"field":"b"},7]}]}',
    check: '',
    evalHelpers: '',
    token: TEST_TOKEN,
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
}

function post(body: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${main.base}/badge/submit`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: `http://127.0.0.1:${main.port}`,
      ...(init.headers as Record<string, string> | undefined),
    },
    redirect: 'manual',
    ...init,
  });
}

describe('加徽章页', () => {
  it('GET /badge 渲染表单与状态查看器，且不引用任何外部资源', async () => {
    const res = await fetch(`${main.base}/badge`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/badge/submit"');
    expect(html).toContain('method="post"');
    expect(html).toContain('<option value="gray">gray</option>');
    expect(html).toContain('id="status-body"');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('src="http');
    // 提交按钮在无 JS 时也能用（表单是原生 POST）
    expect(html).toContain('<button type="submit">');
  });

  it('加徽章页用 Referrer-Policy: same-origin（no-referrer 会让表单 POST 的 Origin 变成 "null"）', async () => {
    const res = await fetch(`${main.base}/badge`);
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('只读统计页仍然 no-referrer（这一条没有被本次改动放松）', async () => {
    const res = await fetch(`${main.base}/`);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('进度查看器只用同源 fetch 轮询 status.json（不用 SSE/WebSocket）', async () => {
    const html = await (await fetch(`${main.base}/badge`)).text();
    expect(html).toContain("fetch('/badge/status.json'");
    expect(html).not.toContain('EventSource');
    expect(html).not.toContain('WebSocket');
  });

  it('GET /badge/status.json 返回 JSON（浏览器轮询的接口）', async () => {
    const res = await fetch(`${main.base}/badge/status.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('interrupted');
    expect(body).toHaveProperty('lockKind');
  });

  it('HEAD /badge 只给头不给体', async () => {
    const res = await fetch(`${main.base}/badge`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('POST /badge/submit：提交（PRG）', () => {
  it('结构化 spec：303 回 /badge?submitted=…，且只调用了一次注入的 submit', async () => {
    main.submissions.length = 0;
    const res = await post(form());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/badge?submitted=');
    expect(main.submissions).toEqual([{ id: 'gray-ui-added', family: 'gray', force: false }]);
  });

  it('手写 spec：check + evalHelpers 被组装进 handwritten', async () => {
    const harness = await startHarness(spec => okSubmit(spec));
    try {
      const res = await fetch(`${harness.base}/badge/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${harness.port}` },
        redirect: 'manual',
        body: new URLSearchParams({
          token: TEST_TOKEN,
          id: 'casino-ui-straight',
          name: '界面顺子',
          description: '手写路径',
          family: 'casino',
          mode: 'handwritten',
          check: 'onRanks(c)',
          evalHelpers: '["onRanks"]',
        }).toString(),
      });
      expect(res.status).toBe(303);
      expect(harness.submissions[0]).toMatchObject({ id: 'casino-ui-straight', family: 'casino' });
    } finally {
      await harness.close();
    }
  });

  it('force 勾选会传下去', async () => {
    main.submissions.length = 0;
    await post(form({ force: '1' }));
    expect(main.submissions[0]?.force).toBe(true);
  });

  it('spec 非法（id 不是 kebab-case）→ 303 带 error，且没有提交', async () => {
    main.submissions.length = 0;
    const res = await post(form({ id: 'Bad_ID' }));
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('kebab-case');
    expect(main.submissions).toEqual([]);
  });

  it('when 不是合法 JSON → 303 带 error，且没有提交', async () => {
    main.submissions.length = 0;
    const res = await post(form({ when: '{不是 JSON' }));
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('JSON');
    expect(main.submissions).toEqual([]);
  });

  it('提交被拒（已有管道在跑）→ 303 带原因', async () => {
    const harness = await startHarness(() => ({ ok: false, exitCode: 6, reason: '已有管道在跑：runId=x（pid 1）' }));
    try {
      const res = await fetch(`${harness.base}/badge/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${harness.port}` },
        redirect: 'manual',
        body: form(),
      });
      expect(res.status).toBe(303);
      expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('已有管道在跑');
    } finally {
      await harness.close();
    }
  });

  it('跨源 Origin → 403（本地零认证写入口不允许被任意网页驱动）', async () => {
    const res = await fetch(`${main.base}/badge/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: form(),
      redirect: 'manual',
    });
    expect(res.status).toBe(403);
  });

  it('令牌缺失/错误 → 403（跨站页面拿不到本页的令牌）', async () => {
    main.submissions.length = 0;
    const missing = await fetch(`${main.base}/badge/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({ id: 'a-b', name: '甲乙', description: 'd', family: 'gray', mode: 'when', when: '{"isGray":true}' }).toString(),
    });
    expect(missing.status).toBe(403);
    const wrong = await post(form({ token: 'b'.repeat(32) }));
    expect(wrong.status).toBe(403);
    expect(main.submissions).toEqual([]);
  });

  it('Origin 是字面量 null（真 Chrome 的同源表单 POST 就是这样）+ 正确令牌 → 放行', async () => {
    main.submissions.length = 0;
    const res = await fetch(`${main.base}/badge/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null' },
      body: form(),
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(main.submissions).toHaveLength(1);
  });

  it('页面里带隐藏的表单令牌字段', async () => {
    const html = await (await fetch(`${main.base}/badge`)).text();
    expect(html).toContain(`<input type="hidden" name="token" value="${TEST_TOKEN}">`);
    expect(tokenMatches(TEST_TOKEN, TEST_TOKEN)).toBe(true);
    expect(tokenMatches(TEST_TOKEN, 'x')).toBe(false);
    expect(tokenMatches(TEST_TOKEN, null)).toBe(false);
  });

  it('Host 不是 127.0.0.1 时也拒绝（DNS rebinding 兜底）', () => {
    // undici 会强制自己的 Host，所以这条用纯函数断言（判定逻辑与 HTTP 层共用一份）。
    const request = (headers: Record<string, string>) => ({ headers }) as unknown as Parameters<typeof isSameOrigin>[0];
    expect(isSameOrigin(request({ host: 'evil.example' }))).toBe(false);
    expect(isSameOrigin(request({ host: '127.0.0.1:4321' }))).toBe(true);
    expect(isSameOrigin(request({ host: '127.0.0.1:4321', origin: 'http://evil.example' }))).toBe(false);
    expect(isSameOrigin(request({ host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' }))).toBe(true);
    // `null` 不构成拒绝理由：它由表单令牌兜底（真 Chrome 同源表单 POST 就是 null）
    expect(isSameOrigin(request({ host: '127.0.0.1:4321', origin: 'null' }))).toBe(true);
    // 非浏览器客户端不带 Origin：本地工具里允许（curl 已经在你这台机器上了）
    expect(isSameOrigin(request({ host: '127.0.0.1:4321' }))).toBe(true);
  });

  it('非表单 content-type → 400', async () => {
    const res = await fetch(`${main.base}/badge/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${main.port}` },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

describe('只读统计路径没有被加徽章改动影响', () => {
  it('统计页仍然一行 JS 都没有（即使服务同时挂了加徽章路由）', async () => {
    const html = await (await fetch(`${main.base}/`)).text();
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('HueDle 只读统计 UI');
  });

  it('POST / 仍然 405 且 Allow 头不变', async () => {
    const res = await fetch(`${main.base}/`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('GET /admin 仍然 404（加徽章用的是 /badge，不是 /admin）', async () => {
    expect((await fetch(`${main.base}/admin`)).status).toBe(404);
  });
});
