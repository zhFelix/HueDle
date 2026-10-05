/**
 * 「待确认」批次的**删除**（放弃）：`POST /badge/discard` + `discardBatch`。
 *
 * 这一组断言回答两件事：
 *   ① **删得干净**：批次历史、实时状态、冻结的作业文件三处落点都没了，
 *      `buildBatchTree` 里不再出现它，待确认区块随之消失；
 *   ② **不该删的绝不删**：不是【待确认】（运行中/成功/已回滚）不删、进程还活着不删、
 *      `status.json` 指向别的 runId 时不删别人的状态、批次号非法不删——
 *      每一条失败都必须**一个字节都不动**（失败时删一半比不删更糟）。
 *
 * 与「修改」的分工也在这里钉住：「修改」把 spec 放回暂存区（作业文件仍在），
 * 「删除」则连作业文件一起丢掉（想留 spec 就别点删除）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discardBatch } from '../addbadge/discard';
import { readBatches, recordBatchSubmitted } from '../addbadge/history';
import { batchJobFile, readStaging } from '../addbadge/staging';
import { addBadgePaths, ensureOutDirs, makeStatus, readStatus, writeStatus, type StatusWarning } from '../addbadge/state';
import { buildBatchTree } from '../addbadge/tree';
import { renderBadgePage } from '../ui/badge';
import { createUiServer, listenUiServer } from '../ui/server';
import type { StatsReport } from '../report';
import { sampleReport } from './fixtures';

const RUN_ID = '20261005T120000000-batch-discard';

const WARNINGS: StatusWarning[] = [
  {
    otherId: 'channel-all-low',
    scope: 'existing',
    direction: 'new-subset-of-old',
    cohits: 1,
    jaccard: 1 / 2097152,
    message: '⚠ 警告，不是错误：与 "channel-all-low" 构成单向蕴含。',
  },
];

let adminRoot: string;

beforeEach(() => {
  adminRoot = mkdtempSync(join(tmpdir(), 'huedle-discard-'));
});

afterEach(() => {
  rmSync(adminRoot, { recursive: true, force: true });
});

/** 造一个真的停在【待确认】的批次：历史记录 + status.json + 作业文件 + 日志。 */
function seedAwaitingBatch(runId = RUN_ID): void {
  const paths = ensureOutDirs(adminRoot);
  recordBatchSubmitted(adminRoot, {
    runId,
    createdAt: '2026-10-05T12:00:00.000Z',
    startedAt: '2026-10-05T12:00:00.000Z',
    finishedAt: '2026-10-05T12:00:05.000Z',
    state: 'awaiting_confirmation',
    specs: [{ id: 'gray-discard-one', name: '待放弃', family: 'gray' }],
    warnings: WARNINGS,
    specHash: 'hash-discard',
  });
  writeStatus(adminRoot, {
    ...makeStatus({
      runId,
      spec: { id: 'gray-discard-one', name: '待放弃', family: 'gray', group: null },
      logPath: join(paths.logsDir, `${runId}.log`),
      pid: 999_999,
    }),
    state: 'awaiting_confirmation',
    phase: 'done',
    warnings: WARNINGS,
    specHash: 'hash-discard',
    conclusion: '干跑通过：没有任何硬错误；但有 1 条单向蕴含警告，停在【待确认】',
  });
  writeFileSync(
    batchJobFile(adminRoot, runId),
    JSON.stringify({ runId, spec: { id: 'gray-discard-one', name: '待放弃', family: 'gray', group: null, when: { eq: [{ field: 'b' }, 7] } }, logPath: join(paths.logsDir, `${runId}.log`) }),
    'utf8',
  );
  writeFileSync(join(paths.logsDir, `${runId}.log`), '干跑：hits=1\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 删得干净
// ─────────────────────────────────────────────────────────────────────────────

describe('① discardBatch：三处落点都删掉', () => {
  it('批次历史 / status.json / 作业文件 全部移除，日志保留', () => {
    seedAwaitingBatch();
    const paths = addBadgePaths(adminRoot);
    expect(buildBatchTree(adminRoot).map(batch => batch.key)).toContain(RUN_ID);

    const result = discardBatch(adminRoot, RUN_ID);
    expect(result.ok).toBe(true);
    expect(result.removed.sort()).toEqual(['实时状态', '批次历史', '冻结的 spec'].sort());

    expect(readBatches(adminRoot)).toEqual([]);
    expect(existsSync(paths.statusFile)).toBe(false);
    expect(existsSync(batchJobFile(adminRoot, RUN_ID))).toBe(false);
    // 日志是「这一批跑过什么」的唯一证据，删批次不连带抹掉证据。
    expect(existsSync(join(paths.logsDir, `${RUN_ID}.log`))).toBe(true);
  });

  it('删完之后：树里没有它，页面上待确认区块也消失', () => {
    seedAwaitingBatch();
    discardBatch(adminRoot, RUN_ID);

    const tree = buildBatchTree(adminRoot);
    expect(tree.map(batch => batch.key)).not.toContain(RUN_ID);
    expect(tree.filter(batch => batch.state === 'awaiting')).toEqual([]);

    const view = readStatus(adminRoot);
    const html = renderBadgePage({ view, tree, token: 'x'.repeat(32) });
    expect(html).not.toContain('id="awaiting"');
    expect(html).not.toContain(`action="/badge/discard"`);
  });

  it('二次调用：找不到批次 → 失败且什么都不写（不是「删了两次」）', () => {
    seedAwaitingBatch();
    expect(discardBatch(adminRoot, RUN_ID).ok).toBe(true);
    // 先记下删除后的字节，再确认第二次没有改动任何东西。
    const after = {
      batches: readFileSync(`${addBadgePaths(adminRoot).dir}/batches.json`, 'utf8'),
      staging: readStaging(adminRoot),
    };
    const second = discardBatch(adminRoot, RUN_ID);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('找不到批次');
    expect(readFileSync(`${addBadgePaths(adminRoot).dir}/batches.json`, 'utf8')).toBe(after.batches);
    expect(readStaging(adminRoot)).toEqual(after.staging);
  });

  it('不动暂存区：删除是放弃，不是「修改」（草稿一条不多一条不少）', () => {
    seedAwaitingBatch();
    const stagingBefore = readStaging(adminRoot);
    discardBatch(adminRoot, RUN_ID);
    expect(readStaging(adminRoot)).toEqual(stagingBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 不该删的绝不删
// ─────────────────────────────────────────────────────────────────────────────

/** 三次落点是否还在（用于断言「失败时一个字节都不动」）。 */
function stillThere(runId = RUN_ID): { record: boolean; status: boolean; job: boolean } {
  return {
    record: readBatches(adminRoot).some(item => item.runId === runId),
    status: readStatus(adminRoot).status?.runId === runId,
    job: existsSync(batchJobFile(adminRoot, runId)),
  };
}

describe('② 守卫：不是【待确认】的批次不删', () => {
  it('成功批次 → 拒绝，三处落点原样', () => {
    seedAwaitingBatch();
    writeStatus(adminRoot, { ...readStatus(adminRoot).status!, state: 'succeeded', finishedAt: '2026-10-05T12:00:09.000Z' });
    const result = discardBatch(adminRoot, RUN_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('succeeded');
    expect(result.reason).toContain('待确认');
    expect(stillThere()).toEqual({ record: true, status: true, job: true });
  });

  it('运行中的批次 → 拒绝（状态还是 running）', () => {
    seedAwaitingBatch();
    writeStatus(adminRoot, { ...readStatus(adminRoot).status!, state: 'running', pid: 999_999 });
    const result = discardBatch(adminRoot, RUN_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('running');
    expect(stillThere()).toEqual({ record: true, status: true, job: true });
  });

  it('状态说待确认、但锁里进程还活着 → 仍然拒绝（第二道防线）', () => {
    seedAwaitingBatch();
    writeFileSync(
      addBadgePaths(adminRoot).lockFile,
      JSON.stringify({
        runId: RUN_ID,
        pid: process.pid,
        startedAt: '2026-10-05T12:00:00.000Z',
        spec: { id: 'gray-discard-one', name: '待放弃', family: 'gray', group: null },
        logPath: '',
      }),
      'utf8',
    );
    const result = discardBatch(adminRoot, RUN_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('仍在运行');
    expect(stillThere()).toEqual({ record: true, status: true, job: true });
  });

  it('批次号非法（路径穿越）→ 拒绝，不读也不删任何文件', () => {
    seedAwaitingBatch();
    const result = discardBatch(adminRoot, '../../etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不合法');
    expect(stillThere()).toEqual({ record: true, status: true, job: true });
  });
});

describe('② 守卫：只删属于这一批的状态文件', () => {
  it('status.json 指向别的 runId → 删本批历史与作业文件，但不动 status.json', () => {
    seedAwaitingBatch();
    writeStatus(adminRoot, {
      ...makeStatus({ runId: 'other-run', spec: { id: 'other', name: '别人', family: 'gray', group: null }, logPath: '', pid: 999_999 }),
      state: 'succeeded',
      phase: 'done',
      conclusion: '别人跑完了',
    });

    // 本批的状态靠历史记录（awaiting_confirmation）判定，仍可放弃。
    const result = discardBatch(adminRoot, RUN_ID);
    expect(result.ok).toBe(true);
    expect(result.removed).not.toContain('实时状态');
    expect(readStatus(adminRoot).status?.runId).toBe('other-run');
    expect(existsSync(batchJobFile(adminRoot, RUN_ID))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ HTTP 层：按钮 + POST /badge/discard
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = 'd'.repeat(32);

describe('③ HTTP 层', () => {
  let server: Server;
  let base: string;
  let port: number;

  beforeEach(async () => {
    seedAwaitingBatch();
    server = createUiServer({
      initialDays: 30,
      loadReport: async (days): Promise<StatsReport> => sampleReport({ windowDays: days, namesRequested: false, names: [] }),
      badge: { adminRoot, root: adminRoot, token: TOKEN },
    });
    port = await listenUiServer(server, 0);
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const post = (body: Record<string, string>): Promise<Response> =>
    fetch(`${base}/badge/discard`, {
      method: 'POST',
      body: new URLSearchParams(body).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${port}` },
      redirect: 'manual',
    });

  it('待确认区块里有「删除」表单：同一道令牌 + runId，指向 /badge/discard', async () => {
    const html = await (await fetch(`${base}/badge`)).text();
    expect(html).toContain('action="/badge/discard"');
    expect(html).toContain('class="btn-discard"');
    const form = html.match(/<form method="post" action="\/badge\/discard">([\s\S]*?)<\/form>/)?.[1] ?? '';
    expect(form).toContain(`name="token" value="${TOKEN}"`);
    expect(form).toContain(`name="runId" value="${RUN_ID}"`);
    expect(form).toContain('>删除</button>');
    // 三个动作同处标题行。
    const head = html.match(/<div class="awaiting-head">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(head).toContain('action="/badge/continue"');
    expect(head).toContain('action="/badge/modify"');
    expect(head).toContain('action="/badge/discard"');
  });

  it('POST 带令牌 → 303 discarded=<runId>；随后页面没有这一批、也没有待确认区块', async () => {
    const res = await post({ token: TOKEN, runId: RUN_ID });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/badge?discarded=${encodeURIComponent(RUN_ID)}`);

    expect(readBatches(adminRoot)).toEqual([]);
    expect(existsSync(addBadgePaths(adminRoot).statusFile)).toBe(false);

    // 页面（跟着 303 的 location）给出反馈，并且这一批已经彻底消失。
    const page = await (await fetch(`${base}${res.headers.get('location')}`)).text();
    expect(page).toContain('已放弃待确认批次');
    expect(page).not.toContain('id="awaiting"');
    // RUN_ID 仍会出现在反馈文案里，但列表/树里不能再有这个批次。
    expect(page).not.toContain(`id="batch-${RUN_ID}"`);
    expect(page).not.toContain(`data-run-id="${RUN_ID}"`);
  });

  it('没有令牌 → 403，一个字节都不删', async () => {
    const res = await post({ runId: RUN_ID });
    expect(res.status).toBe(403);
    expect(stillThere()).toEqual({ record: true, status: true, job: true });
  });

  it('目标不是【待确认】→ 303 带 error，页面说明原因，数据不动', async () => {
    writeStatus(adminRoot, { ...readStatus(adminRoot).status!, state: 'succeeded' });
    const res = await post({ token: TOKEN, runId: RUN_ID });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get('location') ?? '');
    expect(location).toContain('/badge?error=');
    expect(location).toContain('只有【待确认】的批次可以放弃');
    expect(stillThere()).toEqual({ record: true, status: true, job: true });
  });
});
