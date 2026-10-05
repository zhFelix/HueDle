/**
 * 加徽章页面（表单 + 状态查看器）。
 *
 * **与只读统计页的关键区别**：
 *   - 统计页（`ui/render.ts`）**一行 JS 都没有**，这条性质没有被本次改动破坏，
 *     现有测试继续断言它（`ui.server.test.ts`「页面本身不引用任何外部资源」只打 `/`）；
 *   - 加徽章页需要「提交表单」与「轮询进度」，因此允许**极少量内联 JS**（用户明确放宽）。
 *     仍然：无外链、无 CDN、无构建步骤——`fetch('/badge/status.json')` 是同源相对路径。
 *
 * 页面**不执行任何东西**：提交只是 POST 给本机服务，服务再拉起 detached 子进程；
 * 进度只是轮询 `status.json`。浏览器关掉，管道照跑。
 */
import type { StatusView } from '../addbadge/state';
import type { TreeBatch } from '../addbadge/tree';
import { FAMILIES } from '../addbadge/spec';
import { UI_CSS } from './render';
import { renderBatchTree } from './batch-tree';
import { escapeHtml } from '../render/html';

export interface BadgePageOptions {
  view: StatusView;
  /** 树形列表模型（待运行批次 + 历史批次 + 归因）。 */
  tree: TreeBatch[];
  /** 表单提交后回显的消息（成功或拒绝原因）。 */
  message?: string | undefined;
  /** 消息是否为错误。 */
  messageIsError?: boolean;
  /**
   * 表单令牌（跨站页面读不到本页，因此拿不到它）。
   *
   * 为什么需要：真 Chrome 会把同源表单 POST 的 `Origin` 发成 `null`，
   * 只靠 Origin 判定会拒掉合法提交。
   */
  token?: string;
}

function statusText(view: StatusView): string {
  const status = view.status;
  if (!status) return '还没有提交过加徽章作业。';
  const lines = [
    `runId      : ${status.runId}`,
    `状态       : ${status.state}（阶段 ${status.phase} ${status.phaseIndex + 1}/${status.phaseCount}）`,
    `徽章       : ${status.spec.id}（${status.spec.family}）`,
    `开始       : ${status.startedAt}`,
    `最近更新   : ${status.updatedAt}`,
  ];
  if (status.hits !== undefined) lines.push(`干跑 hits  : ${status.hits}`);
  if (status.warnings && status.warnings.length > 0) {
    lines.push(`单向蕴含   : ${status.warnings.length} 条⚠（警告，不是错误；${status.state === 'awaiting_confirmation' ? '等待确认' : '已接受'}）`);
  }
  if (status.failureClass) lines.push(`失败分类   : ${status.failureClass}`);
  if (status.snapshotPath) lines.push(`快照       : ${status.snapshotPath}`);
  lines.push(`日志       : ${status.logPath}`);
  if (status.conclusion) lines.push(`结论       : ${status.conclusion}`);
  return lines.join('\n');
}

const BADGE_PAGE_JS = `(function () {
  var body = document.getElementById('status-body');
  var bar = document.getElementById('status-bar');
  if (!body || !bar) return;
  var tree = document.getElementById('batch-tree');
  var sawRunning = false;
  // 待运行批次的左边图标随秒数更新 hover 文案；跑完后重载页面，
  // 让服务端渲染最终图标（绿勾 / 红叉）与条目上的归因 ✕。
  function updateTree(s) {
    if (!tree || !s) return;
    if (s.state === 'running') {
      sawRunning = true;
      var el = tree.querySelector('[data-run-id="' + s.runId + '"]');
      if (el) {
        var secs = Math.max(0, Math.floor((Date.now() - Date.parse(s.startedAt)) / 1000));
        el.setAttribute('title', '正在运行 · 已跑 ' + secs + ' 秒');
      }
    } else if (sawRunning) {
      location.reload();
    }
  }
  function render(d) {
    var s = d.status;
    if (!s) { body.textContent = '还没有提交过加徽章作业。'; return; }
    var lines = [
      'runId      : ' + s.runId,
      '状态       : ' + s.state + '（阶段 ' + s.phase + ' ' + (s.phaseIndex + 1) + '/' + s.phaseCount + '）',
      '徽章       : ' + s.spec.id + '（' + s.spec.family + '）',
      '开始       : ' + s.startedAt,
      '最近更新   : ' + s.updatedAt
    ];
    if (typeof s.hits === 'number') lines.push('干跑 hits  : ' + s.hits);
    if (s.warnings && s.warnings.length > 0) lines.push('单向蕴含   : ' + s.warnings.length + ' 条⚠（警告，不是错误；' + (s.state === 'awaiting_confirmation' ? '等待确认' : '已接受') + '）');
    if (s.failureClass) lines.push('失败分类   : ' + s.failureClass);
    if (s.snapshotPath) lines.push('快照       : ' + s.snapshotPath);
    lines.push('日志       : ' + s.logPath);
    if (s.conclusion) lines.push('结论       : ' + s.conclusion);
    body.textContent = lines.join('\\n');
    updateTree(s);
    if (d.interrupted) {
      bar.textContent = '⚠ ' + (d.interruption || '检出未跑完的管道');
    } else if (s.state === 'running') {
      bar.textContent = '运行中…（本页只读状态文件，关掉浏览器不影响管道）';
    } else if (s.state === 'awaiting_confirmation') {
      bar.textContent = '等待确认：有单向蕴含警告（这不是失败，工作区零改动）——点批次里的「继续」或「修改」';
    } else {
      bar.textContent = '已结束：' + s.state;
    }
    setTimeout(tick, s.state === 'running' ? 1000 : 5000);
  }
  function tick() {
    fetch('/badge/status.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        bar.textContent = '状态读取失败（服务是否还在跑？）';
        setTimeout(tick, 3000);
      });
  }
  tick();
})();`;

/** 加徽章页：服务端渲染初值 + 极少量内联 JS 轮询。 */
export function renderBadgePage(options: BadgePageOptions): string {
  const { view, tree } = options;
  const message = options.message
    ? `<p class="${options.messageIsError ? 'warning' : 'meta'}">${escapeHtml(options.message)}</p>`
    : '';
  const interruption = view.interrupted
    ? `<p class="warning">⚠ ${escapeHtml(view.interruption ?? '检出未跑完的管道')}</p>`
    : '';
  const lockNote =
    view.lock.kind === 'active'
      ? `<p class="note">当前锁：${escapeHtml(view.lock.lock.runId)}（pid ${view.lock.lock.pid}）——新的提交会被<strong>拒绝</strong>，不排队。</p>`
      : '';
  const familyOptions = FAMILIES.map(family => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join('');
  const hasPending = tree.some(batch => batch.pending);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HueDle 加徽章</title>
<style>${UI_CSS}
  form.badge { border: 1px solid var(--ink-700); border-radius: 1rem; background: var(--ink-900); padding: 1rem 1.1rem 1.2rem; margin: 0 0 1.25rem; }
  form.badge label { display: block; color: var(--neutral-400); font-size: .78rem; margin: .6rem 0 .2rem; }
  form.badge input[type=text], form.badge select, form.badge textarea {
    width: 100%; background: var(--ink-950); color: var(--neutral-200); border: 1px solid var(--ink-700);
    border-radius: .5rem; padding: .35rem .5rem; font-family: var(--font-mono); font-size: .82rem;
  }
  form.badge textarea { min-height: 5rem; }
  form.badge button { margin-top: .9rem; background: var(--amber-400); color: var(--ink-950); border: 0; border-radius: 9999px; padding: .35rem 1.1rem; font-weight: 700; cursor: pointer; }
  form.badge button:hover { background: var(--amber-200); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 .9rem; }
  pre.status { background: var(--ink-950); border: 1px solid var(--ink-700); border-radius: .75rem; padding: .7rem .8rem; font-family: var(--font-mono); font-size: .78rem; white-space: pre-wrap; word-break: break-all; color: var(--neutral-200); margin: .5rem 0; }
  .mode-note { color: var(--neutral-500); font-size: .75rem; }
  form.badge button.save { background: var(--ink-800); color: var(--amber-300); border: 1px solid var(--amber-400); margin-right: .5rem; }
  /* ── 树形批次列表：状态只在批次左边；条目上唯一的例外是失败归因的 ✕ ── */
  .batch { border: 1px solid var(--ink-700); border-radius: .75rem; background: var(--ink-900); margin: .5rem 0; }
  .batch > summary { display: flex; align-items: center; gap: .55rem; padding: .5rem .75rem; cursor: pointer; list-style: none; }
  .batch > summary::-webkit-details-marker { display: none; }
  .batch-status { display: inline-flex; align-items: center; justify-content: center; width: 1.45rem; height: 1.45rem; border-radius: 9999px; font-weight: 700; flex: 0 0 auto; font-size: .9rem; }
  .batch-status.batch-pending { border: 2px dashed var(--neutral-500); color: var(--neutral-400); }
  .batch-status.batch-running { border: 2px solid var(--amber-400); color: var(--amber-300); }
  .batch-status.batch-succeeded { background: var(--emerald-400); color: #fff; }
  .batch-status.batch-failed { background: var(--red-300); color: #fff; }
  /* 「待确认」不是失败：琥珀实心 + 感叹号，与红叉/绿勾都不同 */
  .batch-status.batch-awaiting { background: var(--amber-400); color: var(--ink-950); }
  .batch-spinner { display: inline-block; animation: batch-spin 1.1s linear infinite; }
  @keyframes batch-spin { to { transform: rotate(360deg); } }
  .batch-title { font-family: var(--font-mono); font-size: .85rem; color: var(--neutral-100); }
  .batch-count { color: var(--neutral-500); font-size: .72rem; margin-left: auto; }
  .batch-items { list-style: none; margin: 0; padding: .2rem .75rem .6rem 2.4rem; }
  .batch-item { display: flex; align-items: baseline; gap: .6rem; padding: .15rem 0; font-size: .82rem; }
  .item-id { font-family: var(--font-mono); color: var(--neutral-200); }
  .item-name { color: var(--neutral-400); }
  .item-family { color: var(--neutral-500); font-size: .75rem; }
  .item-fail { color: var(--red-300); font-weight: 700; }
  .draft-del { margin-left: auto; }
  .draft-del button { background: transparent; border: 0; color: var(--neutral-500); cursor: pointer; font-size: .75rem; }
  .draft-del button:hover { color: var(--red-300); }
  .run-bar { margin-top: .6rem; }
  .run-bar button { background: var(--amber-400); color: var(--ink-950); border: 0; border-radius: 9999px; padding: .4rem 1.2rem; font-weight: 700; cursor: pointer; }
  .run-bar button:disabled { background: var(--ink-800); color: var(--neutral-500); cursor: not-allowed; }
  .run-bar .mode-note { margin: .4rem 0 0; }
  /* ── 待确认：警告清单 + 继续/修改 ── */
  .batch-awaiting { margin: 0 .75rem .7rem 2.4rem; border-left: 3px solid var(--amber-400); padding: .5rem .7rem; background: var(--ink-950); border-radius: .4rem; }
  .batch-awaiting-note { color: var(--neutral-300); font-size: .78rem; margin: 0 0 .5rem; line-height: 1.5; }
  .batch-awaiting-note strong { color: var(--amber-300); }
  .batch-warnings { list-style: none; margin: 0 0 .6rem; padding: 0; }
  .batch-warning { display: flex; flex-wrap: wrap; gap: .4rem .6rem; align-items: baseline; padding: .3rem 0; border-top: 1px solid var(--ink-800); font-size: .76rem; }
  .warning-label { background: var(--amber-400); color: var(--ink-950); border-radius: 9999px; padding: 0 .5rem; font-weight: 700; font-size: .68rem; }
  .warning-other { font-family: var(--font-mono); color: var(--neutral-100); }
  .warning-meta { color: var(--neutral-500); font-family: var(--font-mono); font-size: .7rem; }
  .warning-text { flex: 1 1 100%; color: var(--neutral-400); }
  .batch-actions { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
  .batch-actions button { border: 0; border-radius: 9999px; padding: .35rem 1.05rem; font-weight: 700; cursor: pointer; }
  .batch-actions .btn-continue { background: var(--amber-400); color: var(--ink-950); }
  .batch-actions .btn-continue:hover { background: var(--amber-200); }
  .batch-actions .btn-modify { background: var(--ink-800); color: var(--neutral-200); border: 1px solid var(--ink-700); }
  .batch-actions .btn-modify:hover { color: var(--neutral-100); }
  /* ── 恢复来源标记 + 失败批次的恢复入口 ── */
  .item-restored { color: var(--amber-300); font-size: .72rem; }
  .batch-restore { margin: 0 .75rem .7rem 2.4rem; border-left: 3px solid var(--ink-700); padding: .5rem .7rem; background: var(--ink-950); border-radius: .4rem; }
  .batch-restore-note { color: var(--neutral-400); font-size: .78rem; margin: 0 0 .5rem; line-height: 1.5; }
  .batch-restore-note strong { color: var(--neutral-200); }
  .batch-restore button { background: var(--ink-800); color: var(--amber-300); border: 1px solid var(--amber-400); border-radius: 9999px; padding: .35rem 1.05rem; font-weight: 700; cursor: pointer; }
  .batch-restore button:hover { background: var(--ink-700); }
</style>
</head>
<body>
<header>
<h1>HueDle 加徽章</h1>
<p class="meta">本页只提交与<strong>观察</strong>：真正的管道跑在 detached 子进程里，浏览器关掉也照跑。</p>
<p class="meta">只监听 127.0.0.1，无登录、无 CORS、无外部资源；<a href="/">← 只读统计</a></p>
</header>
${message}
${interruption}
${lockNote}

<section class="card">
<h2>当前状态（轮询 /badge/status.json）</h2>
<p class="meta" id="status-bar">${view.status && view.status.state === 'running' ? '运行中…' : '已结束或未开始'}</p>
<pre class="status" id="status-body">${escapeHtml(statusText(view))}</pre>
</section>

<section>
<h2>添加一条徽章</h2>
<p class="question">两条路径都是一等公民：<strong>结构化</strong>（写 when，JSON 表达式，只用 helpers.ts）与
<strong>手写</strong>（写 check 单表达式，可引用家族文件里已有的 private helper）。</p>
<form class="badge" method="post" action="/badge/submit">
  <input type="hidden" name="token" value="${escapeHtml(options.token ?? '')}">
  <div class="grid2">
    <div><label for="id">id（kebab-case，全局唯一）</label><input id="id" name="id" type="text" required placeholder="gray-mid-echo"></div>
    <div><label for="name">name（中文，家族内不重名）</label><input id="name" name="name" type="text" required></div>
  </div>
  <label for="description">description（可判定的条件，读者能据此手算）</label>
  <input id="description" name="description" type="text" required>
  <div class="grid2">
    <div><label for="family">family（必须与目标文件名一致）</label><select id="family" name="family">${familyOptions}</select></div>
    <div><label for="group">group（可选；只有真的有包含链时才用）</label><input id="group" name="group" type="text" placeholder="casino-rank-count"></div>
  </div>
  <label for="mode">路径</label>
  <select id="mode" name="mode">
    <option value="when">结构化：when（JSON 表达式，只用 helpers.ts）</option>
    <option value="handwritten">手写：check（单表达式，可引用文件里已有的 private helper）</option>
  </select>
  <label for="when">when（结构化路径用；例：{"all":[{"le":[{"sub":[{"maxChannel":true},{"minChannel":true}]},2]},{"between":[{"minChannel":true},120,136]}]}）</label>
  <textarea id="when" name="when"></textarea>
  <label for="check">check（手写路径用；例：onRanks(c, counts =&gt; counts.filter(n =&gt; n &gt;= 5).length === 1)）</label>
  <textarea id="check" name="check"></textarea>
  <label for="evalHelpers">evalHelpers（手写路径用；JSON **名字数组**：["onRanks","ranksAtLeast"]。干跑直接 import 目标文件里的真品，不需要实现源码）</label>
  <textarea id="evalHelpers" name="evalHelpers"></textarea>
  <label><input type="checkbox" name="force" value="1"> force：检出未跑完的管道时强制接管锁（默认拒绝并报告）</label>
  <button type="submit" class="save" formaction="/badge/save">只保存到暂存区（零计算、不碰徽章源码）</button>
  <button type="submit">提交（管道在子进程里跑，约 10–15 分钟）</button>
</form>
<p class="mode-note">「只保存」只做一件事：把这条 spec 原子写进本机暂存区文件——不校验、不干跑、不抢锁、不拉子进程。
攒够之后在下面点「统一跑」，那时才走批量管道（一个事务，全有或全无）。</p>
</section>

<section class="card" id="batches">
<h2>批次 / 暂存区</h2>
<p class="question">批次 = 一次「统一跑」的单位。左边是状态：空圈=待运行、转圈=正在运行、绿底白勾=成功、
<b>琥珀 ! = 有单向蕴含警告待确认（这不是失败）</b>、红底白叉=失败；
失败能归因到某一条时，只在那一条上加 ✕（hover 显示它自己的原因）。
「待确认」的批次展开后可以看到警告清单，并选择「继续」或「修改」。</p>
<div id="batch-tree">
${renderBatchTree(tree, { token: options.token })}
</div>
<form class="run-bar" method="post" action="/badge/run">
  <input type="hidden" name="token" value="${escapeHtml(options.token ?? '')}">
  <button type="submit"${hasPending ? '' : ' disabled'}>统一跑（走现有批量管道）</button>
  <p class="mode-note">${hasPending ? '把上面暂存区里的全部草稿作为一个事务提交：锁 + detached 子进程 + 全有或全无，枚举只跑一次。' : '暂存区为空：先加一条草稿再统一跑。'}</p>
</form>
</section>
<script>${BADGE_PAGE_JS}</script>
</body>
</html>
`;
}

/** `/badge/status.json` 的响应体（UI 轮询它，不含任何 HTML）。 */
export function renderBadgeStatusJson(view: StatusView): string {
  return JSON.stringify(
    {
      status: view.status,
      interrupted: view.interrupted,
      interruption: view.interruption,
      lockKind: view.lock.kind,
      lock: view.lock.kind === 'none' ? null : view.lock.lock,
    },
    null,
    2,
  );
}
