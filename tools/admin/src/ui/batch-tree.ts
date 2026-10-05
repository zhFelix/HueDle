/**
 * 树形列表的**渲染**（纯函数，服务端渲染）。
 *
 * 与只读统计页不同，加徽章页允许极少量内联 JS；但树的静态形态（批次标题、
 * 状态图标、条目、条目上的 ✕）全部由这里在服务端渲染好，测试可以直接断言。
 * 轮询只负责更新「正在运行」批次标题里的秒数。
 */
import { escapeHtml } from '../render/html';
import type { TreeBatch, TreeItem } from '../addbadge/tree';

/** 五态 → CSS 类名（测试与页面共用同一份字面量）。 */
export const BATCH_STATE_CLASS: Readonly<Record<TreeBatch['state'], string>> = {
  pending: 'batch-pending',
  running: 'batch-running',
  succeeded: 'batch-succeeded',
  awaiting: 'batch-awaiting',
  failed: 'batch-failed',
};

const GLYPH: Readonly<Record<TreeBatch['state'], string>> = {
  pending: '○',
  running: '◌',
  succeeded: '✓',
  // 「待确认」**不是失败**：琥珀感叹号，与红叉明确区分。
  awaiting: '!',
  failed: '✗',
};

/** 秒数文案：`N 秒`。 */
function secondsText(seconds: number | undefined): string {
  return `${Math.max(0, seconds ?? 0)} 秒`;
}

/**
 * 批次左边的状态图标。
 *
 * hover 文案按任务要求：
 *   - 待运行：`待运行`
 *   - 正在运行：`正在运行 · 已跑 N 秒`
 *   - 成功：`运行成功 · 用时 N 秒`
 *   - **待确认**：`有 N 条单向蕴含警告，等待确认（这不是失败）`
 *   - 失败：`运行失败 · 用时 N 秒 · 原因`
 */
export function renderBatchIcon(batch: TreeBatch): string {
  const cls = BATCH_STATE_CLASS[batch.state];
  let title: string;
  if (batch.state === 'pending') title = '待运行';
  else if (batch.state === 'running') title = `正在运行 · 已跑 ${secondsText(batch.seconds)}`;
  else if (batch.state === 'succeeded') title = `运行成功 · 用时 ${secondsText(batch.seconds)}`;
  else if (batch.state === 'awaiting') {
    const count = batch.warnings?.length ?? 0;
    title = `有 ${count} 条单向蕴含警告，等待确认（这不是失败，工作区零改动）`;
  } else title = `运行失败 · 用时 ${secondsText(batch.seconds)} · ${batch.reason ?? '原因见结论'}`;

  const dataAttrs =
    batch.state === 'running' && batch.key !== 'pending'
      ? ` data-run-id="${escapeHtml(batch.key)}" data-started-at="${escapeHtml(batch.startedAt ?? '')}"`
      : '';
  const inner =
    batch.state === 'running'
      ? `<span class="batch-spinner" aria-hidden="true">${GLYPH.running}</span>`
      : `<span class="batch-glyph" aria-hidden="true">${GLYPH[batch.state]}</span>`;
  return `<span class="batch-status ${cls}" data-state="${batch.state}"${dataAttrs} title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${inner}</span>`;
}

/** 一个条目：id / name / family（待运行时多一个「删除」）。 */
export function renderTreeItem(item: TreeItem, options: { token?: string } = {}): string {
  const failure = item.failed
    ? `<span class="item-fail" title="${escapeHtml(item.failReason ?? '运行失败')}">✕</span>`
    : '';
  // 「编辑」是零 JS 的：只是一条指向 `?edit=<draftId>` 的链接，服务端据此带着值渲染表单。
  const edit =
    item.draftId !== undefined
      ? `<a class="draft-edit" href="/badge?edit=${encodeURIComponent(item.draftId)}" title="把这条草稿载入上方表单，改完「只保存」会替换它">编辑</a>`
      : '';
  const remove =
    item.draftId !== undefined
      ? `<form class="draft-del" method="post" action="/badge/draft/delete">`
        + `<input type="hidden" name="token" value="${escapeHtml(options.token ?? '')}">`
        + `<input type="hidden" name="draftId" value="${escapeHtml(item.draftId)}">`
        + `<button type="submit" title="从暂存区删除这条草稿">删除</button></form>`
      : '';
  // 恢复来源必须能认出来：至少在 hover 里说明它来自哪一批，否则用户分不清
  // 「这是我刚加的」还是「这是从 5 分钟前那个失败批次捞回来的」。
  const restored =
    item.restoredFrom !== undefined
      ? `<span class="item-restored" title="恢复自批次 ${escapeHtml(item.restoredFrom)}（「修改」/「恢复草稿」把该批 spec 放回了暂存区）">↩ 恢复自 ${escapeHtml(item.restoredFrom)}</span>`
      : '';
  return `<li class="batch-item">
<span class="item-id">${escapeHtml(item.id)}</span>
<span class="item-name">${escapeHtml(item.name)}</span>
<span class="item-family">${escapeHtml(item.family)}</span>
${restored}${failure}${edit}${remove}
</li>`;
}

function renderItems(batch: TreeBatch, token?: string): string {
  return `<ul class="batch-items">\n${batch.items.map(item => renderTreeItem(item, { token })).join('\n')}\n</ul>`;
}

/**
 * 「待确认」批次的**独立区块**：标题行（条数 + 继续/修改/删除）+ 折叠的警告清单。
 *
 * 为什么从树里搬出来：状态卡显示的是**当前这次运行**，而待确认正是这次运行要你决定的
 * 事情，两者应当挨着（「待确认的批次放到日志下方」）。树里只留下历史批次的标题行，
 * 不再重复待确认块。
 *
 * 版面要点（对应「[继续] [修改] 提到标题行上」）：
 *   - 标题行左侧是状态图标 + `待确认 · N 条单向蕴含警告`（不展开也知道有几条）；
 *   - 三个按钮放在同一个 `.awaiting-head` 容器里、靠右（`margin-left:auto`），
 *     因此再多条警告也不需要滚到末尾才够得到；
 *   - 警告清单折进一个**默认不展开**的 `<details>`：版面干净，明细随点随看。
 *
 * 警告文案**必须写清这不是错误**（否则用户会以为失败了）；三个按钮都是原生表单 POST，
 * 走与其它写端点完全相同的令牌检查。「删除」是唯一不可逆的动作，因此按钮单独描红，
 * 文案里点明「想保留 spec 请先点修改」。
 */
function renderAwaitingBlock(batch: TreeBatch, token?: string): string {
  const warnings = batch.warnings ?? [];
  const list = warnings.length > 0
    ? `<ul class="batch-warnings">\n${warnings
        .map(
          item =>
            `<li class="batch-warning"><span class="warning-label">警告，不是错误</span>`
            + `<span class="warning-other">对端 ${escapeHtml(item.otherId)}</span>`
            + `<span class="warning-meta">${escapeHtml(item.direction)} · 共命中 ${item.cohits} · Jaccard ${item.jaccard.toFixed(4)}</span>`
            + `<span class="warning-text">${escapeHtml(item.message)}</span></li>`,
        )
        .join('\n')}\n</ul>`
    : '<p class="meta">（没有可显示的警告明细）</p>';
  const hashInput = batch.specHash
    ? `<input type="hidden" name="specHash" value="${escapeHtml(batch.specHash)}">`
    : '';
  return `<div class="awaiting-block" data-run-id="${escapeHtml(batch.key)}">
<div class="awaiting-head">
${renderBatchIcon(batch)}
<span class="awaiting-title">待确认 · ${warnings.length} 条单向蕴含警告</span>
<span class="awaiting-actions">
<form method="post" action="/badge/continue">
<input type="hidden" name="token" value="${escapeHtml(token ?? '')}">
<input type="hidden" name="runId" value="${escapeHtml(batch.key)}">
${hashInput}
<button type="submit" class="btn-continue" title="接受这些警告，带上内容哈希重新提交这一批">继续</button>
</form>
<form method="post" action="/badge/modify">
<input type="hidden" name="token" value="${escapeHtml(token ?? '')}">
<input type="hidden" name="runId" value="${escapeHtml(batch.key)}">
<button type="submit" class="btn-modify" title="把批次 ${escapeHtml(batch.key)} 的 spec 放回暂存区（按 id 去重，不覆盖已有草稿），接着编辑">修改</button>
</form>
<form method="post" action="/badge/discard">
<input type="hidden" name="token" value="${escapeHtml(token ?? '')}">
<input type="hidden" name="runId" value="${escapeHtml(batch.key)}">
<button type="submit" class="btn-discard" title="放弃这一批：从列表移除，冻结的 spec 一并删除（仓库零改动）。想保留 spec 请先点「修改」">删除</button>
</form>
</span>
</div>
<p class="batch-awaiting-note"><strong>待确认</strong>：干跑没有任何硬错误，只有 ${warnings.length} 条<b>单向蕴含警告</b>。
单向蕴含是徽章系统的固有性质（越稀有的徽章必然被更宽的徽章包含），<strong>它不阻止写入，也不是失败</strong>；
工作区仍然零改动。点「继续」才写盘；点「修改」则把这一批的 spec <b>放回暂存区</b>，可以接着改；
点「删除」则<b>放弃这一批</b>——从列表移除，冻结的 spec 一并删除（想留着就先点「修改」）。</p>
<details class="awaiting-warnings">
<summary>展开警告清单（${warnings.length} 条）</summary>
${list}
</details>
</div>`;
}

/**
 * 「待确认」独立区块（`id="awaiting"`）：当前这次运行需要你决定的事，紧挨状态卡。
 *
 * 没有待确认批次时返回空串——页面里连这个 section 都不出现。
 */
export function renderAwaitingSection(batches: readonly TreeBatch[], options: { token?: string } = {}): string {
  const awaiting = batches.filter(batch => batch.state === 'awaiting');
  if (awaiting.length === 0) return '';
  const blocks = awaiting.map(batch => renderAwaitingBlock(batch, options.token)).join('\n');
  return `<section class="card" id="awaiting">\n${blocks}\n</section>`;
}

/**
 * **失败批次**的「恢复草稿」入口。
 *
 * 失败正是最想回去改的时候，而回滚后暂存区已经被统一跑清空了——所以失败批次
 * 也要有同一个恢复机制。**成功批次不画这个入口**（徽章已经进仓库了，恢复草稿
 * 只会造成困惑）；树模型里 `canRestore` 只对失败批次为真。
 */
function renderRestore(batch: TreeBatch, token?: string): string {
  return `<div class="batch-restore">
<p class="batch-restore-note">这一批的 spec 还冻结在作业文件里。点「恢复草稿」把它<strong>放回暂存区</strong>，
<strong>不覆盖</strong>已有草稿（按 id 去重），可以接着改再统一跑。</p>
<form method="post" action="/badge/modify">
<input type="hidden" name="token" value="${escapeHtml(token ?? '')}">
<input type="hidden" name="runId" value="${escapeHtml(batch.key)}">
<button type="submit" class="btn-restore" title="把批次 ${escapeHtml(batch.key)} 的 spec 放回暂存区（按 id 去重，不覆盖已有草稿）">恢复草稿</button>
</form>
</div>`;
}

/**
 * 整棵树（**只含历史批次与待运行批次**）。
 *
 * 形态：**全部默认折叠**——只留标题行，明细要点开才看。理由：服务端每次渲染都是初值，
 * 而「默认展开」意味着刷新就回到一屏警告；待确认块已经搬到状态卡下方、按钮也上了标题行，
 * 因此折叠不会让任何操作变难（这是折叠与「按钮上标题行」能同时成立的前提）。
 *
 * 折叠状态由服务端决定、**不做持久化**：`<details>` 不带 `open`，页面里没有为它准备的 JS。
 */
export function renderBatchTree(batches: readonly TreeBatch[], options: { token?: string } = {}): string {
  if (batches.length === 0) {
    return '<p class="meta" id="batch-empty">暂存区为空，也还没有跑过批次。</p>';
  }
  return batches
    .map(batch => {
      const header = `<summary>${renderBatchIcon(batch)}<span class="batch-title">${escapeHtml(batch.title)}</span>`
        + `<span class="batch-count">${batch.items.length} 条</span></summary>`;
      const restore = batch.state === 'failed' && batch.canRestore ? `\n${renderRestore(batch, options.token)}` : '';
      // 待确认块**不在这里**：它渲染在状态卡下方（见 renderAwaitingSection）。
      const body = `${renderItems(batch, options.token)}${restore}`;
      return `<details class="batch batch-${batch.pending ? 'pending' : batch.state}" id="batch-${escapeHtml(batch.key)}">\n`
        + `${header}\n${body}\n</details>`;
    })
    .join('\n');
}
