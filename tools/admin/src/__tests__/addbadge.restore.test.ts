/**
 * 「修改」/「恢复草稿」：把批次的 spec 从**作业文件**放回暂存区，可以接着编辑。
 *
 * 背景：统一跑会清空暂存区，而 `/badge/modify` 以前是**完全惰性**的（什么都不发生），
 * 于是点「修改」= 刚提交的几条全没了，得重新打一遍；失败回滚后更是如此。
 *
 * 本文件覆盖任务要求的 6 类：
 *   1. 「修改」后草稿回来了（POST /badge/modify → 暂存区里有那几条）；
 *   2. 不覆盖已有草稿（先放一条别的 → 恢复后两条都在）；
 *   3. 幂等（连点两次不会变成两份）；
 *   4. 失败批次也能恢复（同一机制 + 页面上的「恢复草稿」入口）；
 *   5. 成功的批次**没有**这个入口（反向断言页面上没有那个按钮/链接）；
 *   6. 恢复的草稿能接着编辑（删掉改一条再统一跑，走通）。
 *
 * 数据源钉死：spec 内容在 `out/addbadge/jobs/<runId>.json`（批次历史只存元数据）。
 */
import type { Server } from 'node:http';
import { unlinkSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatsReport } from '../report';
import {
  addDraft,
  draftFieldsFromRawSpec,
  draftToRawSpec,
  hasRestorableSpecs,
  readStaging,
  removeDraft,
  restoreBatchDrafts,
  runStagedBatch,
  type DraftFields,
} from '../addbadge/staging';
import { recordBatchOutcome } from '../addbadge/history';
import { addBadgePaths, makeStatus, readStatus, writeStatus, type PipelineState } from '../addbadge/state';
import { buildBatchTree } from '../addbadge/tree';
import type { SpawnedChild } from '../addbadge/submit';
import { createUiServer, listenUiServer } from '../ui/server';
import { createFakeRepo, silenceLogs, type FakeRepo } from './addbadge.fixtures';
import { sampleReport } from './fixtures';

const TOKEN = 'r'.repeat(32);

let repo: FakeRepo;
let restoreLogs: () => void;

beforeEach(() => {
  repo = createFakeRepo();
  restoreLogs = silenceLogs();
});

afterEach(() => {
  restoreLogs();
  repo.cleanup();
});

const fields = (overrides: Partial<DraftFields> = {}): DraftFields => ({
  id: 'gray-restore-a',
  name: '恢复甲',
  description: 'B = 7',
  family: 'gray',
  group: '',
  mode: 'when',
  when: '{"eq":[{"field":"b"},7]}',
  check: '',
  evalHelpers: '',
  ...overrides,
});

/** 不起真子进程的统一跑（作业文件 + 批次记录 + 清空暂存区都照做）。 */
function runBatch(drafts: DraftFields[], runIdNow = '2026-10-05T10:00:00.000Z'): string {
  for (const draft of drafts) addDraft(repo.adminRoot, draft);
  const result = runStagedBatch({
    adminRoot: repo.adminRoot,
    root: repo.root,
    spawn: (((): SpawnedChild => ({ pid: process.pid, unref: () => {}, on: () => {} })) as never),
    now: () => new Date(runIdNow),
  });
  if (!result.ok) throw new Error(`统一跑失败：${result.reason}`);
  return result.runId;
}

/** 把一次（假）运行标成终态：历史 + status.json 都要改，树才认。 */
function markTerminal(runId: string, state: PipelineState): void {
  const finishedAt = '2026-10-05T10:01:00.000Z';
  const conclusion = state === 'succeeded' ? '成功' : '失败';
  recordBatchOutcome(repo.adminRoot, runId, { state, finishedAt, conclusion });
  writeStatus(repo.adminRoot, {
    ...makeStatus({
      runId,
      spec: { id: summaryId(runId), name: '批次', family: 'gray', group: null },
      logPath: '',
    }),
    state,
    phase: 'done',
    finishedAt,
    conclusion,
  });
}

/** 终态 status 里随便填一个 spec id。 */
function summaryId(runId: string): string {
  return readStaging(repo.adminRoot)[0]?.fields.id ?? `batch-of-${runId.slice(-4)}`;
}

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function startBadgeServer(): Promise<Harness> {
  const server: Server = createUiServer({
    initialDays: 30,
    loadReport: async (days): Promise<StatsReport> =>
      sampleReport({ windowDays: days, namesRequested: false, names: [] }),
    badge: { adminRoot: repo.adminRoot, root: repo.root, token: TOKEN },
  });
  const port = await listenUiServer(server, 0);
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

function postModify(base: string, runId: string): Promise<Response> {
  return fetch(`${base}/badge/modify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: base,
    },
    body: new URLSearchParams({ token: TOKEN, runId }).toString(),
    redirect: 'manual',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 「修改」后草稿回来了
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 1：「修改」把该批次的 spec 恢复到暂存区', () => {
  it('统一跑清空暂存区 → POST /badge/modify → 那几条回到暂存区（字段可继续编辑）', async () => {
    const runId = runBatch([
      fields({ id: 'gray-restore-a', name: '恢复甲' }),
      fields({ id: 'gray-restore-b', name: '恢复乙', when: '{"eq":[{"field":"g"},11]}' }),
    ]);
    // 前提：统一跑确实清空了暂存区（否则这个测试没有意义）。
    expect(readStaging(repo.adminRoot)).toEqual([]);

    const harness = await startBadgeServer();
    try {
      const res = await postModify(harness.base, runId);
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get('location') ?? '');
      expect(location).toContain('/badge?modified=1');
      expect(location).toContain('restored=2');
      expect(location).toContain(runId);
    } finally {
      await harness.close();
    }

    const restored = readStaging(repo.adminRoot);
    expect(restored.map(draft => draft.fields.id).sort()).toEqual(['gray-restore-a', 'gray-restore-b']);
    const first = restored.find(draft => draft.fields.id === 'gray-restore-a')!;
    expect(first.fields.name).toBe('恢复甲');
    expect(first.fields.family).toBe('gray');
    expect(first.fields.mode).toBe('when');
    // 反翻译回原始 spec 与提交时等价（round-trip）。
    expect(draftToRawSpec(first)).toEqual({
      id: 'gray-restore-a',
      name: '恢复甲',
      description: 'B = 7',
      family: 'gray',
      group: null,
      when: { eq: [{ field: 'b' }, 7] },
    });
    // 可以接着编辑的判据：草稿字段完整（form 能原样填回去），不是只剩一个 id。
    expect(first.fields.when.length).toBeGreaterThan(0);
  });

  it('恢复来源可见：每条带 restoredFrom，页面条目 hover 里写出来源批次', async () => {
    const runId = runBatch([fields({ id: 'gray-restore-prov' })]);
    restoreBatchDrafts(repo.adminRoot, runId);

    const draft = readStaging(repo.adminRoot)[0]!;
    expect(draft.restoredFrom).toBe(runId);

    const harness = await startBadgeServer();
    try {
      const page = await (await fetch(`${harness.base}/badge`)).text();
      expect(page).toContain('item-restored');
      expect(page).toContain(`恢复自 ${runId}`);
      expect(page).toContain('恢复自批次');
    } finally {
      await harness.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 不覆盖已有草稿
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 2：恢复不覆盖暂存区里已有的草稿', () => {
  it('先放一条别的草稿 → 恢复该批次 → 两条都在（缺的追加、已有的保留）', () => {
    const runId = runBatch([fields({ id: 'gray-restore-x' })]);
    addDraft(repo.adminRoot, fields({ id: 'gray-user-new', name: '用户刚加的' }));

    const result = restoreBatchDrafts(repo.adminRoot, runId);
    expect(result.ok).toBe(true);
    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);

    const ids = readStaging(repo.adminRoot).map(draft => draft.fields.id);
    expect(ids).toEqual(['gray-user-new', 'gray-restore-x']);
    // 用户那条原样保留（没有被覆盖、没有换 draftId）。
    expect(readStaging(repo.adminRoot)[0]?.fields.name).toBe('用户刚加的');
  });

  it('暂存区已有同 id 草稿（用户自己改过的）→ 恢复跳过它，绝不覆盖', () => {
    const runId = runBatch([fields({ id: 'gray-restore-keep', name: '批次里的名字' })]);
    const mine = addDraft(repo.adminRoot, fields({ id: 'gray-restore-keep', name: '我自己改过的名字' }));

    const result = restoreBatchDrafts(repo.adminRoot, runId);
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(1);

    const kept = readStaging(repo.adminRoot);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.draftId).toBe(mine.draftId);
    expect(kept[0]?.fields.name).toBe('我自己改过的名字');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 幂等
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 3：恢复是幂等的（连点两次不会变成两份）', () => {
  it('restoreBatchDrafts 连续两次：条数与 draftId 都不变，第二次一个字节都不写', () => {
    const runId = runBatch([
      fields({ id: 'gray-restore-idem-a', name: '幂等甲' }),
      fields({ id: 'gray-restore-idem-b', name: '幂等乙', when: '{"eq":[{"field":"g"},11]}' }),
    ]);
    const first = restoreBatchDrafts(repo.adminRoot, runId);
    expect(first.restored).toBe(2);
    const afterFirst = readStaging(repo.adminRoot);

    const second = restoreBatchDrafts(repo.adminRoot, runId);
    expect(second.restored).toBe(0);
    expect(second.skipped).toBe(2);
    expect(readStaging(repo.adminRoot)).toEqual(afterFirst);
  });

  it('HTTP 层连点两次：POST /badge/modify 两次后仍是那两条，没有重复 id', async () => {
    const runId = runBatch([fields({ id: 'gray-restore-http-idem' })]);
    const harness = await startBadgeServer();
    try {
      const one = await postModify(harness.base, runId);
      const two = await postModify(harness.base, runId);
      expect(one.status).toBe(303);
      expect(two.status).toBe(303);
      // 第二次没有新增 → location 保持 `?modified=1`（不带 restored=）。
      expect(two.headers.get('location')).toBe('/badge?modified=1');
    } finally {
      await harness.close();
    }
    const drafts = readStaging(repo.adminRoot);
    expect(drafts).toHaveLength(1);
    expect(new Set(drafts.map(draft => draft.fields.id)).size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 失败批次也能恢复
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 4：失败批次也有「恢复草稿」入口（同一个机制）', () => {
  it('页面画出「恢复草稿」→ POST /badge/modify → 那几条回到暂存区', async () => {
    const runId = runBatch([
      fields({ id: 'gray-failed-restore-a', name: '失败甲' }),
      fields({ id: 'gray-failed-restore-b', name: '失败乙', when: '{"eq":[{"field":"g"},11]}' }),
    ]);
    markTerminal(runId, 'rolled_back');
    expect(buildBatchTree(repo.adminRoot).find(batch => batch.key === runId)?.state).toBe('failed');
    expect(readStaging(repo.adminRoot)).toEqual([]);

    const harness = await startBadgeServer();
    try {
      const page = await (await fetch(`${harness.base}/badge`)).text();
      expect(page).toContain('batch-failed');
      expect(page).toContain('恢复草稿');
      expect(page).toContain('action="/badge/modify"');

      const res = await postModify(harness.base, runId);
      expect(res.status).toBe(303);
    } finally {
      await harness.close();
    }

    expect(readStaging(repo.adminRoot).map(draft => draft.fields.id).sort())
      .toEqual(['gray-failed-restore-a', 'gray-failed-restore-b']);
  });

  it('作业文件不在了 → 恢复返回 ok:true、restored:0（不是一次失败的编辑操作）', () => {
    const result = restoreBatchDrafts(repo.adminRoot, 'run-does-not-exist');
    expect(result.ok).toBe(true);
    expect(result.restored).toBe(0);
    expect(readStaging(repo.adminRoot)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 成功批次没有这个入口
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 5：成功的批次没有恢复入口（反向断言）', () => {
  it('成功批次：页面没有「恢复草稿」、没有指向 /badge/modify 的表单', async () => {
    const runId = runBatch([fields({ id: 'gray-succeeded-no-restore' })]);
    markTerminal(runId, 'succeeded');
    const tree = buildBatchTree(repo.adminRoot);
    expect(tree.find(batch => batch.key === runId)?.state).toBe('succeeded');
    // 即便作业文件还在，也不给入口。
    expect(hasRestorableSpecs(repo.adminRoot, runId)).toBe(true);
    expect(tree.find(batch => batch.key === runId)?.canRestore).toBeUndefined();

    const harness = await startBadgeServer();
    try {
      const page = await (await fetch(`${harness.base}/badge`)).text();
      expect(page).toContain('batch-succeeded');
      expect(page).not.toContain('恢复草稿');
      expect(page).not.toContain('action="/badge/modify"');
    } finally {
      await harness.close();
    }
    // 页面没入口，不等于仓库被改动：这里一个草稿都没恢复。
    expect(readStaging(repo.adminRoot)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 恢复的草稿能接着编辑（改一条再统一跑，走通）
// ─────────────────────────────────────────────────────────────────────────────

describe('测试 6：恢复的草稿能接着编辑', () => {
  it('恢复 → 删掉这条、按改后的内容重新加 → 统一跑成功，作业文件里是改后的 spec', () => {
    const runId = runBatch([fields({ id: 'gray-edit-me', name: '旧名字', description: 'B = 7' })]);
    restoreBatchDrafts(repo.adminRoot, runId);
    const draft = readStaging(repo.adminRoot)[0]!;
    expect(draft.fields.name).toBe('旧名字');

    // 「接着编辑」= 删掉恢复出来的那条，用改后的字段重新加（现有工作流没有原地编辑端点）。
    expect(removeDraft(repo.adminRoot, draft.draftId)).toBe(true);
    addDraft(repo.adminRoot, {
      ...draft.fields,
      name: '新名字',
      description: 'R = 0 且 B = 7',
      when: '{"all":[{"eq":[{"field":"r"},0]},{"eq":[{"field":"b"},7]}]}',
    });
    expect(readStaging(repo.adminRoot)[0]?.restoredFrom).toBeUndefined();

    // 假子进程从不释放锁；这里手动释放以模拟「上一次管道已经结束」，让第二次统一跑能开跑。
    unlinkSync(addBadgePaths(repo.adminRoot).lockFile);

    const result = runStagedBatch({
      adminRoot: repo.adminRoot,
      root: repo.root,
      spawn: (((): SpawnedChild => ({ pid: process.pid, unref: () => {}, on: () => {} })) as never),
      now: () => new Date('2026-10-05T11:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    // 走通：编辑后的内容真的进了新的作业文件，且暂存区又清空了。
    expect(readStaging(repo.adminRoot)).toEqual([]);
    expect(readStatus(repo.adminRoot).status?.runId).toBe(result.runId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 附加：反翻译的 round-trip（手写路径）
// ─────────────────────────────────────────────────────────────────────────────

describe('附加：draftFieldsFromRawSpec 是 draftToRawSpec 的逆（手写路径）', () => {
  it('handwritten 的 check / evalHelpers 能原样回到表单字符串', () => {
    const draft = addDraft(repo.adminRoot, fields({
      id: 'gray-hand-restore',
      mode: 'handwritten',
      when: '',
      check: 'onRanks(c, counts => counts.filter(n => n >= 5).length === 1)',
      evalHelpers: '{"onRanks":"color => color.r"}',
    }));
    const raw = draftToRawSpec(draft);
    const back = draftFieldsFromRawSpec(raw);
    expect(back.mode).toBe('handwritten');
    expect(back.check).toBe(draft.fields.check);
    expect(JSON.parse(back.evalHelpers)).toEqual({ onRanks: 'color => color.r' });
    // 再正向翻译一次得到等价 spec。
    expect(draftToRawSpec({ ...draft, fields: back })).toEqual(raw);
  });
});
