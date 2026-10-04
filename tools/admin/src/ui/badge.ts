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
import { FAMILIES } from '../addbadge/spec';
import { UI_CSS } from './render';
import { escapeHtml } from '../render/html';

export interface BadgePageOptions {
  view: StatusView;
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
    if (s.failureClass) lines.push('失败分类   : ' + s.failureClass);
    if (s.snapshotPath) lines.push('快照       : ' + s.snapshotPath);
    lines.push('日志       : ' + s.logPath);
    if (s.conclusion) lines.push('结论       : ' + s.conclusion);
    body.textContent = lines.join('\\n');
    if (d.interrupted) {
      bar.textContent = '⚠ ' + (d.interruption || '检出未跑完的管道');
    } else if (s.state === 'running') {
      bar.textContent = '运行中…（本页只读状态文件，关掉浏览器不影响管道）';
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
  const { view } = options;
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
  <label for="evalHelpers">evalHelpers（手写路径用；JSON：{ "onRanks": "color =&gt; { … }" }，**只用于写盘前干跑**，不会写进仓库）</label>
  <textarea id="evalHelpers" name="evalHelpers"></textarea>
  <label><input type="checkbox" name="force" value="1"> force：检出未跑完的管道时强制接管锁（默认拒绝并报告）</label>
  <button type="submit">提交（管道在子进程里跑，约 10–15 分钟）</button>
</form>
<p class="mode-note">提交只做三件事：校验 spec → 抢锁（已有管道在跑就拒绝，不排队）→ 拉起子进程。
写盘前的 2²⁴ 干跑会拦下 hits=0 / 恒真 / 与既有徽章必然蕴含。</p>
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
