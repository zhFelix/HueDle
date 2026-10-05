/**
 * 加徽章页的 HTTP 层：保存 / 删除 / 统一跑三条新路由，以及**统计页仍然零 JS**。
 *
 * 这里的断言重点：
 *   - 保存是纯写入：只落 `staging.json`，不产生 job / 锁 / 快照；
 *   - 统一跑只把请求**转发**给 runStaged（真正跑管道的是它，测试 1 已覆盖）；
 *   - 新增的写端点复用与 `/badge/submit` 完全相同的同源 + 令牌检查；
 *   - 只读统计页一行 `<script>` 都没有（硬约束，不能被本次改动破坏）。
 */
import type { Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatsReport } from '../report';
import type { SubmitResult } from '../addbadge/submit';
import { readStaging, stagingFile } from '../addbadge/staging';
import { addBadgePaths } from '../addbadge/state';
import { createUiServer, listenUiServer } from '../ui/server';
import { sampleReport } from './fixtures';

const TEST_TOKEN = 'c'.repeat(32);

let tmpRoot: string;
let server: Server;
let base: string;
let port: number;
let runCalls: Array<{ adminRoot: string; root: string }>;

const okSubmit = (runId = '20261005T100000Z-batch1-gray-http-a'): SubmitResult => ({
  ok: true,
  runId,
  logPath: '/tmp/log',
  pid: 4321,
});

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'huedle-badge-http-'));
  runCalls = [];
  server = createUiServer({
    initialDays: 30,
    loadReport: async (days): Promise<StatsReport> => sampleReport({ windowDays: days, namesRequested: false, names: [] }),
    badge: {
      adminRoot: tmpRoot,
      root: tmpRoot,
      token: TEST_TOKEN,
      runStaged: options => {
        runCalls.push({ adminRoot: options.adminRoot, root: options.root });
        return okSubmit();
      },
    },
  });
  port = await listenUiServer(server, 0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(tmpRoot, { recursive: true, force: true });
});

function saveBody(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    token: TEST_TOKEN,
    id: 'gray-http-a',
    name: '界面暂存',
    description: 'R = 0 且 B = 7',
    family: 'gray',
    group: '',
    mode: 'when',
    when: '{"all":[{"eq":[{"field":"r"},0]},{"eq":[{"field":"b"},7]}]}',
    check: '',
    evalHelpers: '',
    ...overrides,
  }).toString();
}

function post(path: string, body: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: `http://127.0.0.1:${port}`,
      ...(init.headers as Record<string, string> | undefined),
    },
    redirect: 'manual',
    ...init,
  });
}

describe('POST /badge/save：只保存，零计算', () => {
  it('303 回 /badge?saved=…，并且只写了 staging.json', async () => {
    // 清掉上一条用例可能留下的草稿
    const before = readStaging(tmpRoot).length;
    const res = await post('/badge/save', saveBody({ id: `gray-http-${before}` }));
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('/badge?saved=');
    expect(readStaging(tmpRoot).length).toBe(before + 1);

    // 零管道产物
    const paths = addBadgePaths(tmpRoot);
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(existsSync(paths.statusFile)).toBe(false);
    const jobs = existsSync(paths.jobsDir) ? readdirSync(paths.jobsDir) : [];
    expect(jobs).toEqual([]);
    const snaps = existsSync(paths.snapshotsDir) ? readdirSync(paths.snapshotsDir) : [];
    expect(snaps).toEqual([]);
  });

  it('GET /badge 把暂存区显示成待运行批次（树形列表）', async () => {
    const html = await (await fetch(`${base}/badge`)).text();
    expect(html).toContain('id="batch-tree"');
    expect(html).toContain('batch-pending');
    expect(html).toContain('待运行批次');
    expect(html).toContain('action="/badge/run"');
    expect(html).toContain('formaction="/badge/save"');
    // 待运行批次展开，条目上没有任何失败 ✕
    expect(html).not.toContain('class="item-fail"');
  });

  it('删除草稿：删后列表与暂存文件同步，页面不再有待运行批次', async () => {
    const drafts = readStaging(tmpRoot);
    const target = drafts[0]!;
    const res = await post('/badge/draft/delete', new URLSearchParams({ token: TEST_TOKEN, draftId: target.draftId }).toString());
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('deleted=1');
    expect(readStaging(tmpRoot).some(item => item.draftId === target.draftId)).toBe(false);
    const onDisk = JSON.parse(readFileSync(stagingFile(tmpRoot), 'utf8')) as Array<{ draftId: string }>;
    expect(onDisk.some(item => item.draftId === target.draftId)).toBe(false);
    const html = await (await fetch(`${base}/badge`)).text();
    expect(html).toContain('batch-empty');
  });

  it('新增写端点的安全性质不变：跨源 / 错误令牌 → 403', async () => {
    const crossOrigin = await fetch(`${base}/badge/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: saveBody(),
      redirect: 'manual',
    });
    expect(crossOrigin.status).toBe(403);
    const badToken = await post('/badge/save', saveBody({ token: 'x'.repeat(32) }));
    expect(badToken.status).toBe(403);
    const deleteCross = await fetch(`${base}/badge/draft/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: 'draftId=x',
      redirect: 'manual',
    });
    expect(deleteCross.status).toBe(403);
  });

  it('POST /badge/run 把请求转发给统一跑实现（HTTP 层不自己跑管道）', async () => {
    runCalls.length = 0;
    const res = await post('/badge/run', new URLSearchParams({ token: TEST_TOKEN }).toString());
    expect(res.status).toBe(303);
    expect(runCalls).toEqual([{ adminRoot: tmpRoot, root: tmpRoot }]);
    // 转发失败/成功由实现决定；这里只关心只调用了一次
    expect(runCalls).toHaveLength(1);
  });
});

describe('只读统计页仍然零脚本（硬约束）', () => {
  it('GET / 一行 <script> 都没有，即使服务挂了加徽章路由', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('HueDle 只读统计 UI');
  });

  it('POST / 仍然 405 且 Allow 头不变', async () => {
    const res = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});
