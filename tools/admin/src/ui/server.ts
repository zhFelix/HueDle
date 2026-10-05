/**
 * 本地只读统计 UI 的 HTTP 服务（`node:http`，**零依赖**）。
 *
 * 硬约束的落点：
 *   ① 监听地址是常量 {@link UI_HOST} = `127.0.0.1`，**没有任何参数能把它改成 `0.0.0.0`**；
 *      `listenUiServer()` 里写死 `server.listen(port, UI_HOST)`，测试断言的是
 *      `server.address().address`（真实的监听地址），不是源码里的字符串。
 *   ④ 只读：本文件不 import `node:fs`、不 import `pg`；每个请求只是调用注入的
 *      `loadReport(days)`，而它必须是走 `db.ts`（`BEGIN READ ONLY`）的那条通道。
 *      路由只接受 `GET`/`HEAD`，其余方法一律 405——**根本没有写端点**。
 *   ⑤ 不发任何 CORS 头，不登录，不 daemon 化，不写 pid/文件。
 *
 * 查询参数只有三个：
 *   - `?days=`（1–3650 的整数，非法值 400，绝不做字符串拼接）；
 *   - `?refresh=1`（只表示"绕过本机内存缓存重查"，仍然是 GET、仍然只读）；
 *   - `?m=`（左栏选中项：`overview` 或 M1–M8；**非法值静默回落概览**，不 400——
 *     这里不做校验是因为渲染层本来就只认"报告里存在的 id"，回落语义见 `ui/render.ts`
 *     的 `parseSelection`；原始输入不会被回显，因此注入尝试也没有落点）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { redactSecrets } from '../db';
import type { StatsReport } from '../report';
import { MAX_WINDOW_DAYS, MIN_WINDOW_DAYS } from '../window';
import { SpecError, parseBadgeSpec, type BadgeSpec } from '../addbadge/spec';
import { makeRunId, submitBadgeJob, type SubmitResult } from '../addbadge/submit';
import {
  addDraft,
  continuePendingBatch,
  draftFieldsFromForm,
  readStaging,
  removeDraft,
  replaceDraft,
  restoreBatchDrafts,
  runStagedBatch,
  type ContinueStagedOptions,
  type DraftFields,
  type RestoreResult,
  type RunStagedOptions,
  type StagedDraft,
} from '../addbadge/staging';
import { buildBatchTree, type TreeBatch } from '../addbadge/tree';
import { addBadgePaths, readStatus, type StatusView } from '../addbadge/state';
import { renderBadgePage, renderBadgeStatusJson, type BadgeFormValues } from './badge';
import { renderUiError, renderUiPage } from './render';

/**
 * 监听地址：**常量，不可配置**。
 *
 * `127.0.0.1` 是内核层的不路由——同网段机器在 TCP 层就够不着；这不是应用层过滤，
 * 也不依赖防火墙。改成 `0.0.0.0` 等于把"连着生产库、零认证、含用户名与每日颜色"
 * 的页面交给同一网络里的所有人，因此这里刻意不提供 `--host`。
 */
export const UI_HOST = '127.0.0.1';

/** 默认端口：避开 `apps/api dev`(3001) 与 `vite dev`(5173)，避免撞车或"以为没跑其实在跑"。 */
export const UI_DEFAULT_PORT = 4321;

export const UI_DEFAULT_DAYS = 30;

/**
 * 窗口天数上界（含）。与 `argv.ts` 的 CLI 校验共用 `src/window.ts` 里的同一份常量，
 * 因此"CLI 拒绝的值"与"UI 拒绝的值"不可能漂移。
 */

/**
 * 交给分析层的 M4 上限。UI 想要"默认截断、可展开"，所以先多取一些回来，
 * 再由 `render.ts` 决定默认展示多少行；CLI 不受影响。
 */
export const UI_ANALYZE_TOP_N = 200;

export interface UiServerOptions {
  /** 不带 `?days=` 时用的窗口。 */
  initialDays: number;
  /**
   * 报告来源。生产实现走 `runStats(pool, …)`（`db.ts` 的只读事务），
   * `includeNames` 由该闭包持有；测试注入假实现即可在不起数据库的情况下验证 HTTP 层。
   *
   * `options.refresh` 为真（`?refresh=1`）时表示**绕过本机缓存**重查——
   * 这只是"不省这一次"，取数通道与只读语义完全不变；实现方不支持时可忽略。
   */
  loadReport: (days: number, options?: { refresh?: boolean }) => Promise<StatsReport>;
  /**
   * 加徽章页（`/badge`、`/badge/status.json`、`POST /badge/submit`）。
   *
   * **不传就完全没有这三条路由**（默认 404 / 405）——只读统计路径因此不受影响，
   * 这也是现有 `ui.server.test.ts` 能原样通过的原因。
   */
  badge?: UiBadgeOptions;
}

/** 加徽章页的可注入依赖：HTTP 层**只提交、不执行**管道。 */
export interface UiBadgeOptions {
  /** `tools/admin` 根（状态文件/锁都在这下面）。 */
  adminRoot: string;
  /** 仓库根（提交时做写盘前的静态校验）。 */
  root: string;
  /** 提交实现；默认 {@link submitBadgeJob}（真正的 detached 子进程）。 */
  submit?: (spec: BadgeSpec, options: { force: boolean }) => SubmitResult;
  /** 状态读取；默认 {@link readStatus}。 */
  readStatus?: (adminRoot: string) => StatusView;
  /**
   * 暂存区写操作（只保存，零计算）。默认 {@link addDraft} / {@link removeDraft}。
   * 测试可注入以断言「保存不触发任何计算」。
   */
  stageDraft?: (adminRoot: string, fields: DraftFields) => StagedDraft;
  deleteDraft?: (adminRoot: string, draftId: string) => boolean;
  /**
   * 原地替换一条草稿（`?edit=<id>` 载入表单后「只保存」时走这条路）。
   * 默认 {@link replaceDraft}；返回 `null` 表示该 draftId 已不在暂存区。
   */
  updateDraft?: (adminRoot: string, draftId: string, fields: DraftFields) => StagedDraft | null;
  /** 读取暂存区（`?edit=<id>` 预填表单用）；默认 {@link readStaging}。 */
  readStaging?: (adminRoot: string) => StagedDraft[];
  /**
   * 统一跑：默认 {@link runStagedBatch}（走**现有**批量管道 `submitBadgeBatchJob`）。
   * 测试可注入以断言 HTTP 层只负责转发。
   */
  runStaged?: (options: RunStagedOptions) => SubmitResult;
  /**
   * 「继续」待确认批次：默认 {@link continuePendingBatch}（读回作业文件 + 带上确认哈希，
   * **新起一次运行**）。测试可注入以断言 HTTP 层只负责转发。
   */
  continuePending?: (options: ContinueStagedOptions) => SubmitResult;
  /**
   * 「修改」/「恢复草稿」：把某个批次的 spec 从作业文件放回暂存区（按 id 去重、
   * 幂等、不覆盖已有草稿）。默认 {@link restoreBatchDrafts}。
   */
  restoreDrafts?: (adminRoot: string, runId: string) => RestoreResult;
  /** 树形列表模型；默认 {@link buildBatchTree}。 */
  readTree?: (adminRoot: string) => TreeBatch[];
  /**
   * 表单令牌；不传就每次启动随机生成。
   *
   * **为什么需要它**：真 Chrome 实测会把同源表单 POST 的 `Origin` 发成字面量 `null`
   * （不管响应头里的 Referrer-Policy 是什么），所以只靠 Origin 判断会把合法提交拒掉；
   * 而直接放行 `Origin: null` 又等于放弃这道防线。令牌是标准解法：
   * 跨站页面拿不到它（读不到我们的页面），因此带不带 Origin 都拦得住。
   */
  token?: string;
}

/** POST 体上限：表单只有几个短字段，超过就是异常请求。 */
export const MAX_FORM_BODY_BYTES = 64 * 1024;

/** `?days=` 的解析结果。 */
export type DaysParse = { ok: true; days: number } | { ok: false; error: string };

/**
 * 解析 `?days=`（纯函数，便于单测）。`null` 表示参数缺失 → 用 fallback。
 *
 * 只接受纯数字字符串：`-1` / `abc` / `1.5` / `1e3` / 空串全部拒绝，
 * 因此不存在"把用户输入当数字静默转换"的路径。
 */
export function parseDaysParam(raw: string | null, fallback: number): DaysParse {
  if (raw === null) return { ok: true, days: fallback };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: `?days= 必须是 1–${MAX_WINDOW_DAYS} 的整数，收到：${JSON.stringify(raw)}` };
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
    return { ok: false, error: `?days= 必须是 1–${MAX_WINDOW_DAYS} 的整数，收到：${JSON.stringify(raw)}` };
  }
  return { ok: true, days };
}

/**
 * 统一响应出口：显式**不发** `Access-Control-Allow-Origin`（同源即可）。
 *
 * `referrerPolicy` 默认 `no-referrer`（页面自包含、无外链，别再往外带任何东西）。
 * **但加徽章页必须用 `same-origin`**：按 Fetch 规范，`Referrer-Policy: no-referrer`
 * 会让浏览器把表单 POST 的 `Origin` 序列化成字面量 `null`，于是同源提交会被
 * CSRF 守卫拒掉——实测（真 Chrome）踩到过。只读统计页不变，仍然 `no-referrer`。
 */
function send(
  res: ServerResponse,
  status: number,
  body: string,
  extraHeaders: Record<string, string>,
  headOnly: boolean,
  referrerPolicy = 'no-referrer',
): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': referrerPolicy,
    ...extraHeaders,
  });
  res.end(headOnly ? undefined : body);
}

/**
 * 同源检查（**只有 POST 需要**）。
 *
 * 加徽章页是本地零认证的写入口，浏览器允许跨站表单 POST 到 `127.0.0.1`。
 * 因此提交要求：`Host` 必须是 127.0.0.1（挡 DNS rebinding），
 * 且 `Origin`（浏览器对跨源 POST 一定会带）必须就是本机。
 * 这不是认证，是把「任何网页都能让本机跑一次改源码的流水线」这个洞堵掉。
 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  const hostname = host.startsWith('[') ? '' : (host.split(':')[0] ?? '');
  if (hostname !== UI_HOST) return false;
  const origin = req.headers.origin;
  // 没有 Origin（curl 这类非浏览器客户端）或字面量 `null`（真 Chrome 的同源表单 POST
  // 就会这样）都**不构成拒绝理由**——它们由表单令牌兜底（见 UiBadgeOptions.token）。
  if (origin === undefined || origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.hostname === UI_HOST;
  } catch {
    return false;
  }
}

/** 表单令牌比对（定长、恒定时间；长度不同直接判否，不做提前返回的泄露）。 */
export function tokenMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 读取 urlencoded 表单体（带上限，绝不无限缓冲）。 */
export function readFormBody(req: IncomingMessage, limit = MAX_FORM_BODY_BYTES): Promise<string | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/** 从表单字段组装 spec（与 CLI 的 `--spec` 走同一个 `parseBadgeSpec`）。 */
export function specFromForm(fields: URLSearchParams): { raw: unknown; spec: BadgeSpec } {
  const mode = fields.get('mode') === 'handwritten' ? 'handwritten' : 'when';
  const base = {
    id: fields.get('id') ?? '',
    name: fields.get('name') ?? '',
    description: fields.get('description') ?? '',
    family: fields.get('family') ?? '',
    group: (fields.get('group') ?? '').trim() || null,
  };
  if (mode === 'handwritten') {
    const check = (fields.get('check') ?? '').trim();
    const evalRaw = (fields.get('evalHelpers') ?? '').trim();
    let evalHelpers: unknown;
    if (evalRaw) {
      try {
        evalHelpers = JSON.parse(evalRaw);
      } catch (err) {
        throw new SpecError(`evalHelpers 不是合法 JSON：${err instanceof Error ? err.message : err}`, 'handwritten.evalHelpers');
      }
    }
    const raw = { ...base, handwritten: { check, ...(evalHelpers ? { evalHelpers } : {}) } };
    return { raw, spec: parseBadgeSpec(raw) };
  }
  const whenRaw = (fields.get('when') ?? '').trim();
  if (!whenRaw) throw new SpecError('结构化路径必须填 when（JSON 表达式）', 'when');
  let when: unknown;
  try {
    when = JSON.parse(whenRaw);
  } catch (err) {
    throw new SpecError(`when 不是合法 JSON：${err instanceof Error ? err.message : err}`, 'when');
  }
  const raw = { ...base, when };
  return { raw, spec: parseBadgeSpec(raw) };
}

/**
 * 所有写端点的公共前置：同源 → content-type → 体积上限 → 表单令牌。
 *
 * 返回 `null` 表示已经发过错误响应（调用方直接 return）。这四道检查与
 * `POST /badge/submit` 完全一致：新增的保存/删除/统一跑没有放宽任何一道。
 */
async function readAuthorizedForm(
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<URLSearchParams | null> {
  if (!isSameOrigin(req)) {
    // 把观察到的东西写进页面：被拒的人需要知道**为什么**（否则只会以为是坏了）。
    const observed = `Host=${JSON.stringify(req.headers.host ?? '')} Origin=${JSON.stringify(req.headers.origin ?? '')}`;
    send(
      res,
      403,
      renderUiError(403, `拒绝跨源提交：Host 必须是 ${UI_HOST}，Origin（若带）必须也是本机。观察到 ${observed}`),
      {},
      false,
    );
    return null;
  }
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    send(res, 400, renderUiError(400, '只接受 application/x-www-form-urlencoded 表单。'), {}, false);
    return null;
  }
  const body = await readFormBody(req);
  if (body === null) {
    send(res, 413, renderUiError(413, '表单体过大。'), {}, false);
    return null;
  }
  const fields = new URLSearchParams(body);
  // 令牌优先：跨站页面读不到本页，因此拿不到这个值。
  if (!tokenMatches(token, fields.get('token'))) {
    send(
      res,
      403,
      renderUiError(403, '表单令牌缺失或错误：请从 /badge 页面提交（跨站页面拿不到本页的表单令牌）。'),
      {},
      false,
    );
    return null;
  }
  return fields;
}

/** `POST /badge/submit`：校验 → 提交（抢锁 + 拉起 detached 子进程）→ 303 回表单页。 */
async function handleBadgeSubmit(
  badge: UiBadgeOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const fields = await readAuthorizedForm(token, req, res);
  if (!fields) return;

  const force = fields.get('force') === '1';
  let built: { raw: unknown; spec: BadgeSpec };
  try {
    built = specFromForm(fields);
  } catch (err) {
    const message = err instanceof SpecError ? err.message : err instanceof Error ? err.message : String(err);
    redirect(res, `/badge?error=${encodeURIComponent(message)}`);
    return;
  }

  const submit =
    badge.submit ??
    ((input: BadgeSpec, options: { force: boolean }): SubmitResult => {
      const runId = makeRunId(input, new Date());
      return submitBadgeJob({
        rawSpec: built.raw,
        spec: input,
        root: badge.root,
        adminRoot: badge.adminRoot,
        runId,
        logPath: join(addBadgePaths(badge.adminRoot).logsDir, `${runId}.log`),
        force: options.force,
      });
    });

  let result: SubmitResult;
  try {
    result = submit(built.spec, { force });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(res, `/badge?error=${encodeURIComponent(`提交失败：${message}`)}`);
    return;
  }
  if (!result.ok) {
    redirect(res, `/badge?error=${encodeURIComponent(result.reason)}`);
    return;
  }
  redirect(res, `/badge?submitted=${encodeURIComponent(result.runId)}`);
}

/**
 * `POST /badge/save`：**只保存**到暂存区。
 *
 * 零计算：不解析 `when`/`evalHelpers`、不校验 spec、不抢锁、不拉子进程、不跑干跑。
 * 因此它瞬间返回；合法性问题推迟到点「统一跑」时才反馈（用户明确接受）。
 *
 * 两种落点（`?edit=<id>` 打开的表单会带 `replaces`）：
 *   - **没有 `replaces`**：照旧**追加**一条新草稿；
 *   - **有 `replaces`**：**原地替换**那条草稿（数量不变）——「编辑」的语义。
 *     若那条草稿已经不在了（另一个标签页删了/已统一跑清空），**退回追加**并明确告知，
 *     免得用户填好的内容凭空丢掉。
 */
async function handleBadgeSave(
  badge: UiBadgeOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const fields = await readAuthorizedForm(token, req, res);
  if (!fields) return;
  try {
    const draftFields = draftFieldsFromForm(fields);
    const replaces = (fields.get('replaces') ?? '').trim();
    if (replaces) {
      const update = badge.updateDraft ?? replaceDraft;
      const updated = update(badge.adminRoot, replaces, draftFields);
      if (updated) {
        redirect(res, `/badge?updated=${encodeURIComponent(updated.fields.id || updated.draftId)}`);
        return;
      }
      const stage = badge.stageDraft ?? addDraft;
      const draft = stage(badge.adminRoot, draftFields);
      redirect(
        res,
        `/badge?saved=${encodeURIComponent(draft.fields.id || draft.draftId)}`
        + `&replacesMissing=${encodeURIComponent(replaces)}`,
      );
      return;
    }
    const stage = badge.stageDraft ?? addDraft;
    const draft = stage(badge.adminRoot, draftFields);
    redirect(res, `/badge?saved=${encodeURIComponent(draft.fields.id || draft.draftId)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(res, `/badge?error=${encodeURIComponent(`保存失败：${message}`)}`);
  }
}

/** `POST /badge/draft/delete`：从暂存区删一条草稿（外部世界零改动）。 */
async function handleBadgeDelete(
  badge: UiBadgeOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const fields = await readAuthorizedForm(token, req, res);
  if (!fields) return;
  const draftId = fields.get('draftId') ?? '';
  const remove = badge.deleteDraft ?? removeDraft;
  const removed = remove(badge.adminRoot, draftId);
  redirect(res, removed ? '/badge?deleted=1' : `/badge?error=${encodeURIComponent('要删除的草稿不存在')}`);
}

/** `POST /badge/run`：把暂存区的全部草稿交给现有批量管道统一跑。 */
async function handleBadgeRun(
  badge: UiBadgeOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const fields = await readAuthorizedForm(token, req, res);
  if (!fields) return;
  const run = badge.runStaged ?? runStagedBatch;
  let result: SubmitResult;
  try {
    result = run({ adminRoot: badge.adminRoot, root: badge.root });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(res, `/badge?error=${encodeURIComponent(`统一跑失败：${message}`)}`);
    return;
  }
  if (!result.ok) {
    redirect(res, `/badge?error=${encodeURIComponent(result.reason)}`);
    return;
  }
  redirect(res, `/badge?submitted=${encodeURIComponent(result.runId)}`);
}

/** `POST /badge/continue`：把停在【待确认】的批次带上确认哈希**重新提交**。 */
async function handleBadgeContinue(
  badge: UiBadgeOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const fields = await readAuthorizedForm(token, req, res);
  if (!fields) return;
  const cont = badge.continuePending ?? continuePendingBatch;
  const providedHash = fields.get('specHash');
  let result: SubmitResult;
  try {
    result = cont({
      adminRoot: badge.adminRoot,
      root: badge.root,
      ...(providedHash ? { acceptedSpecHash: providedHash } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(res, `/badge?error=${encodeURIComponent(`继续失败：${message}`)}`);
    return;
  }
  if (!result.ok) {
    redirect(res, `/badge?error=${encodeURIComponent(result.reason)}`);
    return;
  }
  redirect(res, `/badge?continued=${encodeURIComponent(result.runId)}`);
}

/**
 * `POST /badge/modify`：**把该批次的 spec 放回暂存区**，可以接着编辑。
 *
 * 为什么必须做：统一跑会清空暂存区，而「修改」的承诺就是「不接受这些警告，
 * 回去接着改刚刚那几条」。以前它什么都没做，用户得把刚提交的重新打一遍。
 *
 * 恢复的边界（都在 {@link restoreBatchDrafts} 里）：
 *   - 只读**作业文件**（`jobs/<runId>.json` 里冻结的原始 spec），不跑管道、不抢锁、
 *     不写仓库、不产生快照；
 *   - **不覆盖已有草稿**：按 id 去重，只追加缺的；
 *   - **幂等**：没有新增时一个字节都不写；
 *   - 每条带 `restoredFrom`，树里 hover 能看出它来自哪一批。
 */
async function handleBadgeModify(
  badge: UiBadgeOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const fields = await readAuthorizedForm(token, req, res);
  if (!fields) return;
  const runId = fields.get('runId') ?? '';
  const restore = badge.restoreDrafts ?? restoreBatchDrafts;
  let result: RestoreResult;
  try {
    result = restore(badge.adminRoot, runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(res, `/badge?error=${encodeURIComponent(`恢复草稿失败：${message}`)}`);
    return;
  }
  if (!result.ok) {
    redirect(res, `/badge?error=${encodeURIComponent(result.reason ?? '恢复草稿失败')}`);
    return;
  }
  // 没有新增（作业文件不在了 / 草稿都已在暂存区）时保持 location 就是 `?modified=1`。
  const suffix = result.restored > 0
    ? `&restored=${result.restored}&from=${encodeURIComponent(result.runId)}`
    : '';
  redirect(res, `/badge?modified=1${suffix}`);
}

/** 303：POST 之后回到表单页（PRG，避免刷新重复提交）。 */
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, {
    Location: location,
    'Content-Length': 0,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
  });
  res.end();
}

async function handleRequest(
  options: UiServerOptions,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  // base 仅用于解析请求行，不发出任何网络请求。
  const url = new URL(req.url ?? '/', `http://${UI_HOST}`);

  // ④ 只读统计的路由根本不接受写方法；**唯一**的例外是加徽章提交，
  //    而且它只做「抢锁 + 拉起 detached 子进程」，不在请求里跑管道。
  if (method !== 'GET' && method !== 'HEAD') {
    if (method === 'POST' && options.badge) {
      if (url.pathname === '/badge/submit') {
        await handleBadgeSubmit(options.badge, token, req, res);
        return;
      }
      if (url.pathname === '/badge/save') {
        await handleBadgeSave(options.badge, token, req, res);
        return;
      }
      if (url.pathname === '/badge/draft/delete') {
        await handleBadgeDelete(options.badge, token, req, res);
        return;
      }
      if (url.pathname === '/badge/run') {
        await handleBadgeRun(options.badge, token, req, res);
        return;
      }
      if (url.pathname === '/badge/continue') {
        await handleBadgeContinue(options.badge, token, req, res);
        return;
      }
      if (url.pathname === '/badge/modify') {
        await handleBadgeModify(options.badge, token, req, res);
        return;
      }
    }
    send(
      res,
      405,
      renderUiError(405, `本服务不提供写端点，只接受 GET/HEAD（收到 ${method}）。`),
      { Allow: 'GET, HEAD' },
      false,
    );
    return;
  }

  // 加徽章页与状态接口（不传 options.badge 时它们与前缀路径一样是 404）。
  if (options.badge && url.pathname === '/badge/status.json') {
    const view = (options.badge.readStatus ?? readStatus)(options.badge.adminRoot);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(renderBadgeStatusJson(view)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(renderBadgeStatusJson(view));
    return;
  }
  if (options.badge && url.pathname === '/badge') {
    const view = (options.badge.readStatus ?? readStatus)(options.badge.adminRoot);
    const tree = (options.badge.readTree ?? buildBatchTree)(options.badge.adminRoot);
    const error = url.searchParams.get('error');
    const submitted = url.searchParams.get('submitted');
    const saved = url.searchParams.get('saved');
    const deleted = url.searchParams.get('deleted');
    const continued = url.searchParams.get('continued');
    const modified = url.searchParams.get('modified');
    const restoredCount = url.searchParams.get('restored');
    const restoredFrom = url.searchParams.get('from');
    const updated = url.searchParams.get('updated');
    const replacesMissing = url.searchParams.get('replacesMissing');

    // `?edit=<draftId>`：把那条草稿载入表单（零 JS：预填全在服务端）。
    // 找不到时**不报错页**——回落成空白表单 + 一条说明，用户还能继续干活。
    const editId = url.searchParams.get('edit');
    let form: BadgeFormValues | undefined;
    let editMissing: string | undefined;
    if (editId !== null) {
      const drafts = (options.badge.readStaging ?? readStaging)(options.badge.adminRoot);
      const draft = drafts.find(item => item.draftId === editId);
      if (draft) form = { ...draft.fields, replaces: draft.draftId };
      else editMissing = `找不到草稿 ${JSON.stringify(editId)}（可能已被删除，或统一跑已清空暂存区）：已回落为空白表单。`;
    }

    const message = error
      ? `提交被拒绝：${error}`
      : submitted
        ? `已提交：${submitted}。管道在子进程里跑。`
        : continued
          ? `已继续：${continued}（带上了上次的内容哈希，接着往下跑）。`
          : updated
            ? `已更新暂存区草稿：${updated}（原地替换，未新增条目，未跑任何东西）。`
            : saved
              ? `已保存到暂存区：${saved}（未跑任何东西）。`
              + (replacesMissing ? `原草稿 ${replacesMissing} 已不存在，这条改成了新增。` : '')
              : deleted
                ? '已从暂存区删除。'
                : modified
                  ? restoredCount
                    ? `已「修改」：把批次 ${restoredFrom ?? ''} 的 ${restoredCount} 条 spec 放回了暂存区`
                      + '（不覆盖已有草稿、按 id 去重），可以接着改。仓库零改动、无快照。'
                    : '已返回编辑状态：该批次没有可放回暂存区的 spec（作业文件不在或草稿都已在暂存区）。'
                  : editMissing;
    send(
      res,
      200,
      renderBadgePage({
        view,
        tree,
        message,
        messageIsError: Boolean(error) || Boolean(editMissing),
        ...(form ? { form } : {}),
        token,
      }),
      {},
      method === 'HEAD',
      // 见 send() 的说明：no-referrer 会让同源表单 POST 的 Origin 变成 `null`。
      'same-origin',
    );
    return;
  }

  if (url.pathname !== '/') {
    send(res, 404, renderUiError(404, `没有这个路由：${url.pathname}（只有 / 与 /badge）`), {}, method === 'HEAD');
    return;
  }

  const parsed = parseDaysParam(url.searchParams.get('days'), options.initialDays);
  if (!parsed.ok) {
    send(res, 400, renderUiError(400, parsed.error), {}, method === 'HEAD');
    return;
  }

  // `?refresh=1`：只影响"要不要用本机缓存"，不改变路由、不引入写操作。
  const refresh = url.searchParams.get('refresh') === '1';

  try {
    const report = await options.loadReport(parsed.days, { refresh });
    // `?m=` 原样交给渲染层；它只认报告里存在的 id，其余（含注入尝试）一律回落概览。
    const metric = url.searchParams.get('m');
    send(res, 200, renderUiPage(report, { days: parsed.days, metric }), {}, method === 'HEAD');
  } catch (err) {
    // 与 CLI 同口径：错误信息先脱敏，绝不把连接串/密码带进页面。
    const message = err instanceof Error ? err.message : String(err);
    send(res, 500, renderUiError(500, `读取统计数据失败：${redactSecrets(message)}`), {}, false);
  }
}

/** 创建（但**不**监听）UI 服务。监听由 {@link listenUiServer} 负责。 */
export function createUiServer(options: UiServerOptions): Server {
  // 令牌每个服务实例一份（内存里，不落盘、不做身份）。
  const token = options.badge ? (options.badge.token ?? randomBytes(16).toString('hex')) : '';
  return createServer((req, res) => {
    void handleRequest(options, token, req, res);
  });
}

/**
 * 启动监听并返回内核分配的实际端口。
 *
 * 唯一的 `listen` 调用点：地址写死成 {@link UI_HOST}，端口可以传 0 让内核分配。
 */
export function listenUiServer(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, UI_HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('启动后无法取得监听端口'));
    });
  });
}

/** 等待服务被关闭（Ctrl+C / SIGTERM / 测试里显式 close）。 */
export function waitForServerClose(server: Server): Promise<void> {
  return new Promise<void>(resolve => {
    server.once('close', () => resolve());
  });
}
