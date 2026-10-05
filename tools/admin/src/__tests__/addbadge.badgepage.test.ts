/**
 * 加徽章页的**版面**与两个操作缺口（四项改动）：
 *
 *   ① 「待确认」区块从树里搬出来，放到「当前状态」卡片（含 `日志 :` 行）正下方；
 *   ② [继续] [修改] 移到该区块的**标题行**上，且标题行显示警告条数；
 *   ③ 所有批次的 `<details>` 默认折叠（服务端不写 `open`，也不做展开状态持久化）；
 *   ④ 暂存区草稿可「编辑」：`?edit=<id>` 服务端预填表单 + 隐藏 `replaces`，
 *      提交时替换而不是追加。
 *
 * 断言分两层：渲染层的 DOM 顺序/容器关系用 `renderBadgePage` 直接测；
 * 「编辑」的往返走真实 HTTP（与 `addbadge.staging.ui.test.ts` 同一套 harness）。
 */
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatsReport } from '../report';
import type { StatusView, StatusWarning } from '../addbadge/state';
import type { TreeBatch } from '../addbadge/tree';
import { addDraft, readStaging, type DraftFields } from '../addbadge/staging';
import { renderBadgePage } from '../ui/badge';
import { renderBatchTree } from '../ui/batch-tree';
import { createUiServer, listenUiServer } from '../ui/server';
import { sampleReport } from './fixtures';

const TEST_TOKEN = 'b'.repeat(32);

const EMPTY_VIEW: StatusView = { status: null, interrupted: false, interruption: null, lock: { kind: 'none' } };

function warning(index: number): StatusWarning {
  return {
    otherId: `channel-all-${index}`,
    scope: 'existing',
    direction: 'new-subset-of-old',
    cohits: index,
    jaccard: index / 2097152,
    message: `⚠ 警告，不是错误：与 "channel-all-${index}" 构成单向蕴含。`,
  };
}

function awaitingBatch(count: number): TreeBatch {
  return {
    key: 'run-await-layout',
    title: '批次 run-await-layout',
    state: 'awaiting',
    rawState: 'awaiting_confirmation',
    specHash: 'hash-layout',
    items: [{ id: 'extreme-404', name: '极四零四', family: 'extreme', failed: false }],
    warnings: Array.from({ length: count }, (_, index) => warning(index + 1)),
    pending: false,
  };
}

function failedBatch(): TreeBatch {
  return {
    key: 'run-failed-layout',
    title: '批次 run-failed-layout',
    state: 'failed',
    reason: '干跑拒绝',
    items: [{ id: 'gray-bad', name: '坏', family: 'gray', failed: false }],
    pending: false,
  };
}

function pendingBatch(): TreeBatch {
  return {
    key: 'pending',
    title: '待运行批次 · 1 条',
    state: 'pending',
    items: [{ id: 'gray-draft', name: '草稿', family: 'gray', failed: false, draftId: 'draft-1' }],
    pending: true,
  };
}

const page = (tree: TreeBatch[], overrides: Record<string, unknown> = {}): string =>
  renderBadgePage({ view: EMPTY_VIEW, tree, token: TEST_TOKEN, ...overrides });

// ─────────────────────────────────────────────────────────────────────────────
// ① 待确认块在「当前状态」卡片下方，且不在树里
// ─────────────────────────────────────────────────────────────────────────────

describe('① 待确认块的位置：状态卡正下方，树里没有', () => {
  it('DOM 顺序：status-body → awaiting → batches', () => {
    const html = page([pendingBatch(), awaitingBatch(3), failedBatch()]);
    const statusAt = html.indexOf('id="status-body"');
    const awaitingAt = html.indexOf('id="awaiting"');
    const batchesAt = html.indexOf('id="batches"');
    expect(statusAt).toBeGreaterThan(-1);
    expect(awaitingAt).toBeGreaterThan(statusAt);
    expect(batchesAt).toBeGreaterThan(awaitingAt);
  });

  it('「待确认」在树容器之前，警告清单与两个按钮都不在 #batch-tree 里', async () => {
    const html = page([awaitingBatch(13), failedBatch()]);
    const treeAt = html.indexOf('<div id="batch-tree">');
    expect(treeAt).toBeGreaterThan(-1);
    expect(html.indexOf('id="awaiting"')).toBeLessThan(treeAt);
    // 树容器之后（到 </div> 收尾）不能再出现警告对端或写端点。
    const tail = html.slice(treeAt);
    expect(tail).not.toContain('channel-all-1');
    expect(tail).not.toContain('action="/badge/continue"');
    expect(tail).not.toContain('action="/badge/modify"');
  });

  it('没有待确认批次时，页面里连 #awaiting 区块都不出现', () => {
    const html = page([pendingBatch(), failedBatch()]);
    expect(html).not.toContain('id="awaiting"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 标题行：条数 + [继续] [修改]
// ─────────────────────────────────────────────────────────────────────────────

describe('② [继续] [修改] 在标题行上，标题行显示警告条数', () => {
  it('标题行同时含条数文案与两个按钮（同一个 awaiting-head 容器）', () => {
    const html = page([awaitingBatch(13)]);
    const head = html.match(/<div class="awaiting-head">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(head).not.toBe('');
    expect(head).toContain('待确认 · 13 条单向蕴含警告');
    expect(head).toContain('action="/badge/continue"');
    expect(head).toContain('action="/badge/modify"');
    expect(head).toContain('class="btn-continue"');
    expect(head).toContain('class="btn-modify"');
  });

  it('标题行的条数就是警告条数（0 / 1 / 13）', () => {
    expect(page([awaitingBatch(0)])).toContain('待确认 · 0 条单向蕴含警告');
    expect(page([awaitingBatch(1)])).toContain('待确认 · 1 条单向蕴含警告');
    expect(page([awaitingBatch(13)])).toContain('待确认 · 13 条单向蕴含警告');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 批次默认全部折叠
// ─────────────────────────────────────────────────────────────────────────────

describe('③ 批次默认全部折叠（服务端不写 open，不引入展开状态 JS）', () => {
  it('渲染出的 <details> 一个都不带 open', () => {
    const html = page([pendingBatch(), awaitingBatch(2), failedBatch()]);
    // 3 个批次标题 + 待确认块自己的警告清单。
    expect(html.match(/<details/g)?.length).toBe(4);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('待确认块自身的警告清单也是默认折叠的 <details>', () => {
    const html = page([awaitingBatch(4)]);
    expect(html).toContain('<details class="awaiting-warnings">');
    expect(html).toContain('展开警告清单（4 条）');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('树渲染函数本身不写 open（纯函数层）', () => {
    expect(renderBatchTree([pendingBatch(), awaitingBatch(1), failedBatch()])).not.toMatch(/<details[^>]*\sopen/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 「编辑」草稿：?edit=<id> 预填 + replaces 替换
// ─────────────────────────────────────────────────────────────────────────────

let tmpRoot: string;
let server: Server;
let base: string;
let port: number;

const specFields: DraftFields = {
  id: 'gray-edit-target',
  name: '原名',
  description: 'R = 0 且 B = 7',
  family: 'gray',
  group: '',
  mode: 'when',
  when: '{"eq":[{"field":"b"},7]}',
  check: '',
  evalHelpers: '',
};

const handFields: DraftFields = {
  id: 'casino-edit-hand',
  name: '手写原名',
  description: '手写条件',
  family: 'casino',
  group: 'casino-rank-count',
  mode: 'handwritten',
  when: '',
  check: 'onRanks(c, counts => counts.length === 1)',
  evalHelpers: '["onRanks"]',
};

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'huedle-badge-page-'));
  server = createUiServer({
    initialDays: 30,
    loadReport: async (days): Promise<StatsReport> => sampleReport({ windowDays: days, namesRequested: false, names: [] }),
    badge: { adminRoot: tmpRoot, root: tmpRoot, token: TEST_TOKEN },
  });
  port = await listenUiServer(server, 0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(tmpRoot, { recursive: true, force: true });
});

function post(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    body: new URLSearchParams(body).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${port}` },
    redirect: 'manual',
  });
}

const get = (path: string): Promise<Response> => fetch(`${base}${path}`);

describe('④ 暂存区「编辑」：?edit=<id> 服务端预填', () => {
  it('编辑链接出现在暂存区条目上（零 JS，指向 /badge?edit=<draftId>）', async () => {
    const draft = addDraft(tmpRoot, specFields);
    const html = await (await get('/badge')).text();
    expect(html).toContain(`href="/badge?edit=${encodeURIComponent(draft.draftId)}"`);
    expect(html).toContain('class="draft-edit"');
    expect(html).toContain('>编辑</a>');
  });

  it('?edit=<id> 把 when 路径的各字段带着值渲染出来，并加上隐藏 replaces', async () => {
    const draft = readStaging(tmpRoot).find(item => item.fields.id === specFields.id)!;
    const html = await (await get(`/badge?edit=${encodeURIComponent(draft.draftId)}`)).text();
    expect(html).toContain('value="gray-edit-target"');
    expect(html).toContain('value="原名"');
    expect(html).toContain('value="R = 0 且 B = 7"');
    expect(html).toContain('<option value="gray" selected>gray</option>');
    expect(html).toContain('<option value="when" selected>');
    // textarea 内容按 HTML 转义输出（`"` → `&quot;`），回填的就是那条草稿的原文。
    expect(html).toContain('>{&quot;eq&quot;:[{&quot;field&quot;:&quot;b&quot;},7]}</textarea>');
    expect(html).toContain(`<input type="hidden" name="replaces" value="${draft.draftId}">`);
    expect(html).toContain('只保存到暂存区（替换这条草稿）');
  });

  it('手写路径：check / evalHelpers / mode=handwritten 也原样回填', async () => {
    const draft = addDraft(tmpRoot, handFields);
    const html = await (await get(`/badge?edit=${encodeURIComponent(draft.draftId)}`)).text();
    expect(html).toContain('<option value="handwritten" selected>');
    expect(html).toContain('>onRanks(c, counts =&gt; counts.length === 1)</textarea>');
    expect(html).toContain('>[&quot;onRanks&quot;]</textarea>');
    expect(html).toContain('value="casino-rank-count"');
    expect(html).toContain(`name="replaces" value="${draft.draftId}"`);
  });

  it('?edit=<不存在的 id> 不崩：200 + 空表单 + 明确说明（没有 replaces）', async () => {
    const res = await get('/badge?edit=does-not-exist-123');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('找不到草稿');
    expect(html).toContain('已回落为空白表单');
    expect(html).not.toContain('name="replaces"');
    // 空表单：id 输入框没有 value（只有 placeholder）。
    expect(html).toContain('name="id" type="text" required placeholder="gray-mid-echo" value=""');
  });
});

describe('④ 提交带 replaces → 替换；不带 → 追加', () => {
  it('带 replaces：草稿数量不变、内容已更新、列表顺序不变', async () => {
    const before = readStaging(tmpRoot);
    const target = before.find(item => item.fields.id === specFields.id)!;
    const indexBefore = before.findIndex(item => item.draftId === target.draftId);

    const res = await post('/badge/save', {
      token: TEST_TOKEN,
      replaces: target.draftId,
      id: 'gray-edit-target',
      name: '改过的名字',
      description: 'R = 0 且 B = 8',
      family: 'gray',
      group: '',
      mode: 'when',
      when: '{"eq":[{"field":"b"},8]}',
      check: '',
      evalHelpers: '',
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('/badge?updated=');

    const after = readStaging(tmpRoot);
    expect(after).toHaveLength(before.length);
    const updated = after.find(item => item.draftId === target.draftId)!;
    expect(updated.fields.name).toBe('改过的名字');
    expect(updated.fields.description).toBe('R = 0 且 B = 8');
    expect(updated.fields.when).toBe('{"eq":[{"field":"b"},8]}');
    expect(updated.addedAt).toBe(target.addedAt); // 同一条草稿，不是新的一条
    expect(after.findIndex(item => item.draftId === target.draftId)).toBe(indexBefore);
  });

  it('不带 replaces：照旧追加一条（现有行为不变）', async () => {
    const before = readStaging(tmpRoot);
    const res = await post('/badge/save', {
      token: TEST_TOKEN,
      id: 'gray-appended',
      name: '新加的',
      description: 'B = 9',
      family: 'gray',
      group: '',
      mode: 'when',
      when: '{"eq":[{"field":"b"},9]}',
      check: '',
      evalHelpers: '',
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('/badge?saved=');
    const after = readStaging(tmpRoot);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.fields.id).toBe('gray-appended');
  });

  it('replaces 指向已不存在的草稿：回落成追加，并在页面上说明', async () => {
    const before = readStaging(tmpRoot);
    const res = await post('/badge/save', {
      token: TEST_TOKEN,
      replaces: 'gone-draft-id',
      id: 'gray-fallback',
      name: '回落',
      description: 'B = 10',
      family: 'gray',
      group: '',
      mode: 'when',
      when: '{"eq":[{"field":"b"},10]}',
      check: '',
      evalHelpers: '',
    });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get('location') ?? '');
    expect(location).toContain('/badge?saved=');
    expect(location).toContain('replacesMissing=gone-draft-id');
    expect(readStaging(tmpRoot)).toHaveLength(before.length + 1);
    const html = await (await get(location)).text();
    expect(html).toContain('已不存在，这条改成了新增');
  });

  it('替换走同一道令牌检查（无令牌 → 403，草稿不动）', async () => {
    const target = readStaging(tmpRoot)[0]!;
    const res = await post('/badge/save', {
      replaces: target.draftId,
      id: 'gray-hacked',
      name: 'hack',
      description: 'x',
      family: 'gray',
      mode: 'when',
      when: 'null',
    });
    expect(res.status).toBe(403);
    expect(readStaging(tmpRoot).find(item => item.draftId === target.draftId)?.fields.name).not.toBe('hack');
  });
});
