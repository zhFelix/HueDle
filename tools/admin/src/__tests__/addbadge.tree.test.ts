/**
 * 树形列表：状态映射 + 条目 ✕ 的正反断言。
 *
 * 用户明确的状态模型（照做）：
 *   - 状态**只**在批次左边；下面每条不加任何东西；
 *   - 唯一例外：失败能归因到某一条时，**只在那一条**加一个 ✕；
 *   - 归因不到单条（分位平衡类，整批一起引起）→ 条目上什么都不加。
 *
 * 本文件既测纯渲染函数，也测 `buildBatchTree` 从真实暂存/历史文件合成的结果。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDraft, clearStaging, type DraftFields } from '../addbadge/staging';
import { recordBatchOutcome, recordBatchSubmitted } from '../addbadge/history';
import { buildBatchTree, itemFailure, secondsBetween, stateFromRaw, type TreeBatch } from '../addbadge/tree';
import { renderBatchIcon, renderBatchTree } from '../ui/batch-tree';

let adminRoot: string;

beforeEach(() => {
  adminRoot = mkdtempSync(join(tmpdir(), 'huedle-tree-'));
});

afterEach(() => {
  rmSync(adminRoot, { recursive: true, force: true });
});

function batch(overrides: Partial<TreeBatch>): TreeBatch {
  return {
    key: 'run-1',
    title: '批次 run-1',
    state: 'pending',
    items: [],
    pending: false,
    ...overrides,
  };
}

describe('测试 3：四种状态的图标与 hover 文本', () => {
  it('待运行：空圈，hover=待运行', () => {
    const html = renderBatchIcon(batch({ state: 'pending' }));
    expect(html).toContain('batch-pending');
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('○');
    expect(html).toContain('title="待运行"');
  });

  it('正在运行：转圈，hover 显示已跑秒数', () => {
    const html = renderBatchIcon(batch({ state: 'running', key: 'run-live', startedAt: '2026-10-05T00:00:00.000Z', seconds: 42 }));
    expect(html).toContain('batch-running');
    expect(html).toContain('batch-spinner');
    expect(html).toContain('title="正在运行 · 已跑 42 秒"');
    expect(html).toContain('data-run-id="run-live"');
  });

  it('成功：绿底白勾，hover=运行成功 + 秒数', () => {
    const html = renderBatchIcon(batch({ state: 'succeeded', seconds: 7 }));
    expect(html).toContain('batch-succeeded');
    expect(html).toContain('✓');
    expect(html).toContain('title="运行成功 · 用时 7 秒"');
  });

  it('失败：红底白叉，hover=运行失败 + 秒数 + 原因', () => {
    const html = renderBatchIcon(batch({ state: 'failed', seconds: 9, reason: 'hits === 0：这条规则永不命中' }));
    expect(html).toContain('batch-failed');
    expect(html).toContain('✗');
    expect(html).toContain('运行失败 · 用时 9 秒 · hits === 0：这条规则永不命中');
  });

  it('stateFromRaw / secondsBetween 的边界', () => {
    expect(stateFromRaw('running')).toBe('running');
    expect(stateFromRaw('succeeded')).toBe('succeeded');
    expect(stateFromRaw('rolled_back')).toBe('failed');
    expect(stateFromRaw('needs_manual')).toBe('failed');
    expect(stateFromRaw(undefined)).toBe('pending');
    expect(secondsBetween('2026-10-05T00:00:00.000Z', '2026-10-05T00:00:12.000Z')).toBe(12);
    expect(secondsBetween(undefined, '2026-10-05T00:00:12.000Z')).toBeUndefined();
  });
});

describe('测试 4/5：条目上的 ✕ 只给能归因的那一条', () => {
  it('成功/待运行的条目上一个 ✕ 都没有（反向断言）', () => {
    const success = batch({ state: 'succeeded', items: [{ id: 'a', name: '甲', family: 'gray', failed: false }] });
    const pending = batch({ state: 'pending', items: [{ id: 'b', name: '乙', family: 'gray', failed: false, draftId: 'd1' }] });
    expect(renderBatchTree([success, pending])).not.toContain('item-fail');
  });

  it('失败可归因：三条里恰好一条带 ✕，且 title 是它自己的原因', () => {
    const failed = batch({
      state: 'failed',
      reason: '批量干跑拒绝',
      items: [
        { id: 'ok-1', name: '甲', family: 'gray', failed: false },
        { id: 'bad-2', name: '乙', family: 'gray', failed: true, failReason: 'hits === 0：永不命中' },
        { id: 'ok-3', name: '丙', family: 'gray', failed: false },
      ],
    });
    const html = renderBatchTree([failed]);
    expect(html.split('class="item-fail"')).toHaveLength(2); // 恰好出现一次
    expect(html).toContain('title="hits === 0：永不命中"');
    expect(html).toContain('✕');
  });

  it('失败归因不到单条（batch）→ 所有条目都没有 ✕', () => {
    expect(itemFailure({ kind: 'batch', reason: '分位平衡类失败' }, 'a')).toEqual({ failed: false });
    expect(itemFailure(undefined, 'a')).toEqual({ failed: false });
    const items = [
      { id: 'a', name: '甲', family: 'gray', failed: false },
      { id: 'b', name: '乙', family: 'gray', failed: false },
    ];
    const html = renderBatchTree([batch({ state: 'failed', reason: '分位平衡类失败', items })]);
    expect(html).not.toContain('item-fail');
  });

  it('失败可归因 + 成功批次混排：只有失败那条有 ✕', () => {
    const success = batch({ key: 'run-ok', state: 'succeeded', items: [{ id: 'a', name: '甲', family: 'gray', failed: false }] });
    const failed = batch({
      key: 'run-bad',
      state: 'failed',
      reason: '干跑',
      items: [{ id: 'b', name: '乙', family: 'gray', failed: true, failReason: '恒真' }],
    });
    const html = renderBatchTree([success, failed]);
    expect(html.split('class="item-fail"')).toHaveLength(2);
  });
});

describe('树形形态：所有批次默认只留标题行（全部折叠）', () => {
  it('待运行 / 成功 / 失败 / 待确认的 details 都不带 open', () => {
    const pending = batch({ key: 'run-pending', state: 'pending', pending: true });
    const success = batch({ key: 'run-ok', state: 'succeeded' });
    const failed = batch({ key: 'run-bad', state: 'failed', reason: 'x' });
    const awaiting = batch({ key: 'run-await', state: 'awaiting', warnings: [] });
    const html = renderBatchTree([pending, success, failed, awaiting]);
    // 渲染出的 <details> 一个都不能带 open（刷新不会回到展开态）。
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toContain(' open>');
    expect(html).not.toContain(' open ');
    expect(html.match(/<details/g)).toHaveLength(4);
  });
});

describe('buildBatchTree：从真实文件合成', () => {
  const fields = (overrides: Partial<DraftFields> = {}): DraftFields => ({
    id: 'gray-tree-draft',
    name: '树草稿',
    description: 'B = 7',
    family: 'gray',
    group: '',
    mode: 'when',
    when: '{"eq":[{"field":"b"},7]}',
    check: '',
    evalHelpers: '',
    ...overrides,
  });

  it('暂存区显示为待运行批次；历史批次按提交时间倒序', () => {
    addDraft(adminRoot, fields({ id: 'gray-tree-draft' }));
    recordBatchSubmitted(adminRoot, {
      runId: 'run-old',
      createdAt: '2026-10-05T01:00:00.000Z',
      startedAt: '2026-10-05T01:00:00.000Z',
      state: 'succeeded',
      specs: [{ id: 'gray-old', name: '旧', family: 'gray' }],
    });
    recordBatchOutcome(adminRoot, 'run-old', { state: 'succeeded', finishedAt: '2026-10-05T01:00:10.000Z' });
    recordBatchSubmitted(adminRoot, {
      runId: 'run-new',
      createdAt: '2026-10-05T02:00:00.000Z',
      startedAt: '2026-10-05T02:00:00.000Z',
      state: 'running',
      specs: [{ id: 'gray-new', name: '新', family: 'gray' }],
    });

    const tree = buildBatchTree(adminRoot, new Date('2026-10-05T02:00:30.000Z'));
    expect(tree[0]?.pending).toBe(true);
    expect(tree[0]?.state).toBe('pending');
    expect(tree[0]?.items.map(item => item.id)).toEqual(['gray-tree-draft']);
    // 历史倒序：新的在前
    expect(tree.slice(1).map(item => item.key)).toEqual(['run-new', 'run-old']);
    expect(tree[1]?.state).toBe('running');
    expect(tree[1]?.seconds).toBe(30);
    expect(tree[2]?.state).toBe('succeeded');
    expect(tree[2]?.seconds).toBe(10);
  });

  it('归因到单条失败：只有那条 failed=true，其余不带 ✕', () => {
    recordBatchSubmitted(adminRoot, {
      runId: 'run-fail',
      createdAt: '2026-10-05T03:00:00.000Z',
      startedAt: '2026-10-05T03:00:00.000Z',
      state: 'running',
      specs: [
        { id: 'gray-f-ok', name: '甲', family: 'gray' },
        { id: 'gray-f-bad', name: '乙', family: 'gray' },
      ],
    });
    recordBatchOutcome(adminRoot, 'run-fail', {
      state: 'rolled_back',
      finishedAt: '2026-10-05T03:00:20.000Z',
      failureClass: 'dryrun',
      failureAttribution: { kind: 'spec', specId: 'gray-f-bad', reason: 'hits === 0' },
    });

    const tree = buildBatchTree(adminRoot, new Date('2026-10-05T03:05:00.000Z'));
    const failed = tree.find(item => item.key === 'run-fail')!;
    expect(failed.state).toBe('failed');
    expect(failed.seconds).toBe(20);
    expect(failed.items.map(item => [item.id, item.failed])).toEqual([
      ['gray-f-ok', false],
      ['gray-f-bad', true],
    ]);
    const html = renderBatchTree([failed]);
    expect(html.split('class="item-fail"')).toHaveLength(2);
  });

  it('归因不到单条：整批 failed，条目上什么都不加', () => {
    recordBatchSubmitted(adminRoot, {
      runId: 'run-balance',
      createdAt: '2026-10-05T04:00:00.000Z',
      startedAt: '2026-10-05T04:00:00.000Z',
      state: 'running',
      specs: [
        { id: 'gray-b-1', name: '甲', family: 'gray' },
        { id: 'gray-b-2', name: '乙', family: 'gray' },
      ],
    });
    recordBatchOutcome(adminRoot, 'run-balance', {
      state: 'needs_manual',
      finishedAt: '2026-10-05T04:00:20.000Z',
      failureClass: 'enumerate-global-balance',
      failureAttribution: { kind: 'batch', reason: '分位平衡类失败（整批共同引起）' },
    });

    const tree = buildBatchTree(adminRoot, new Date('2026-10-05T04:05:00.000Z'));
    const failed = tree.find(item => item.key === 'run-balance')!;
    expect(failed.state).toBe('failed');
    expect(failed.items.every(item => !item.failed)).toBe(true);
    expect(renderBatchTree([failed])).not.toContain('item-fail');
  });

  it('草稿可删：删掉后待运行批次消失，暂存列表同步', () => {
    const draft = addDraft(adminRoot, fields());
    expect(buildBatchTree(adminRoot).some(item => item.pending)).toBe(true);
    clearStaging(adminRoot);
    expect(buildBatchTree(adminRoot).some(item => item.pending)).toBe(false);
    expect(draft.draftId.length).toBeGreaterThan(0);
  });
});
