/**
 * 批次历史：统一跑提交出去的每一批，以及它的最终结论。
 *
 * 为什么需要：树形列表要显示「历史批次（已跑完的）」，而 `status.json` 只保留
 * **最近一次**作业。所以提交时在这里落一条记录，子进程结束时回填结论；UI 读它
 * 渲染历史，并在 `status.json` 指向同一次 runId 时用实时状态覆盖（这样「正在运行」
 * 的进度与秒数也是新的）。
 *
 * 落位：`tools/admin/out/addbadge/batches.json`（同样被 `out/.gitignore` 的 `*` 挡住）。
 * 写操作一律原子（临时文件 + rename）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADD_BADGE_OUT_DIR, ensureOutDirs, type FailureAttribution, type PipelineState } from './state';

export interface BatchSpecMeta {
  id: string;
  name: string;
  family: string;
}

export interface BatchRecord {
  runId: string;
  createdAt: string;
  startedAt: string;
  finishedAt?: string;
  specs: BatchSpecMeta[];
  state: PipelineState;
  failureClass?: string;
  conclusion?: string;
  failureAttribution?: FailureAttribution;
}

export function batchesFile(adminRoot: string): string {
  return join(adminRoot, ADD_BADGE_OUT_DIR, 'batches.json');
}

/** 读历史（文件缺失/损坏一律当空列表；只读，绝不执行东西）。 */
export function readBatches(adminRoot: string): BatchRecord[] {
  const path = batchesFile(adminRoot);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is BatchRecord => {
      if (item === null || typeof item !== 'object') return false;
      const record = item as Partial<BatchRecord>;
      return typeof record.runId === 'string' && Array.isArray(record.specs) && typeof record.state === 'string';
    });
  } catch {
    return [];
  }
}

function writeBatches(adminRoot: string, records: readonly BatchRecord[]): void {
  ensureOutDirs(adminRoot);
  const path = batchesFile(adminRoot);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
  renameSync(tmp, path);
}

/** 提交时落一条（同一 runId 已存在则替换，保证幂等）。 */
export function recordBatchSubmitted(adminRoot: string, record: BatchRecord): void {
  const kept = readBatches(adminRoot).filter(item => item.runId !== record.runId);
  writeBatches(adminRoot, [...kept, record]);
}

/**
 * 子进程结束时回填结论。**找不到对应记录时静默无操作**——CLI 的批量提交不经过
 * UI，不写历史文件，这不是错误。
 */
export function recordBatchOutcome(
  adminRoot: string,
  runId: string,
  patch: Partial<Omit<BatchRecord, 'runId' | 'specs'>>,
): void {
  const records = readBatches(adminRoot);
  const index = records.findIndex(item => item.runId === runId);
  if (index < 0) return;
  const merged: BatchRecord = { ...records[index]!, ...patch, runId, specs: records[index]!.specs };
  const next = [...records];
  next[index] = merged;
  writeBatches(adminRoot, next);
}
