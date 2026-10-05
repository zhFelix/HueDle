<script setup lang="ts">
/**
 * 颜色时间线（设计见 docs/NEW-FEATURES.md 第 3 节）。
 *
 * 一条色带：**每天一格**，按日期升序，最近的在最后。悬停 / 键盘聚焦看到
 * `日期 · HEX`。没抽的那天是一个虚线灰块（缺口占位），所以「连续 3 天」和
 * 「3 天散在一个月里」在视觉上完全不同——详见 `lib/timeline.ts`。
 *
 * ── 相邻两天用渐变连起来，但渐变**不许跨过缺口、不许跨过换行** ──────────────
 *
 * 渐变表达的是「这两天是连着的」。时间线里的缺口（没抽的日子，虚线灰块）一旦被
 * 渐变跨过去，视觉上就在撒谎：把「断了两天」画成「连在一起」，正好抹掉这条时间线
 * 存在的意义。折行同理——行尾和下一行行首在空间上根本不相邻，那里画渐变一样误导。
 *
 * 实现上这两条规则由 `layoutTimeline()` 保证，而不是靠 CSS 巧合：
 *
 *   - 折行**在纯函数层**算（`layoutTimeline(days, perRow)`），每行一个 `<ol>`，
 *     行与行之间有垂直间距。所以「行尾」和「下一行行首」是两个不同的 `<ol>`，
 *     物理上没有相邻关系。
 *   - 渐变**就是有记录那格自己的背景**（`link`），只有当「同一行内、日历上相邻、
 *     且两天都有记录」时才存在。缺口那格不会产生 `link`，链条在缺口处天然断开；
 *     行首那格的 `link` 恒为 `null`，所以每行都从一块实心当天色开始，**不继承
 *     上一行的颜色**。
 *
 * 渐变画在**较晚那格**身上（`link` 正属于它）：它的左端是前一天的颜色、右端是
 * 当天颜色。因为格子相邻（没有填缝、没有间距），一格右端 == 下一格左端，整条
 * 于是是一条连续色带，而不是「色块 + 接缝」。代价是：一天的颜色只在它与前一天的
 * **交界处**是精确的（精确值在悬停提示和下面的颜色历史里，时间线表达的是流动）。
 *
 * ── 每行放几格：按容器宽度实测 ──────────────────────────────────────────────
 *
 * 固定天数（比如每行 30 天）在窄屏上照样溢出，等于没解决「一条放不下」；所以
 * 容量由 `ResizeObserver` 实测容器宽度算出：每格 12px（格子相邻，不再有填缝），
 * 容量 = `floor(宽 / 12)`。
 * 每格宽度相同，因此各行的列是对齐的、行长可比（只有最后一行是残行）。
 * 宽度未知时（未挂载 / jsdom / 隐藏）退回 `DEFAULT_DAYS_PER_ROW`；
 * `perRow` prop 可以固定容量，供测试与嵌入方使用。
 *
 * ── 默认看到最新 ────────────────────────────────────────────────────────────
 *
 * 行按**时间升序自上而下**排（第 1 行最早），所以最新的一天在最后一行的最右。
 * 容器限高（约 4 行）并默认滚到底部 + 最右，保证一进来看到的就是最新那几天，
 * 而不是把整条历史铺满页面。
 *
 * ── 「今天」：一个下方的 ▲，不是描边 ────────────────────────────────────────
 *
 * 今天那格**不描边**（曾经是琥珀 ring）：`ring` 会改变格子的外轮廓，在一条连续
 * 色带上看起来像「这一格坏了 / 被选中了」，而不是「这是今天」。改用格子**正下方**
 * 一个 8×4px 的琥珀 ▲：
 *
 *   - 指向正上方那格（它的指代对象），是标注（caret）的常规方向；▼ 会指向下面的
 *     空白 / 下一行，那里没有任何东西。
 *   - 颜色沿用被去掉的 ring 的 `amber-400`，于是「今天」的视觉联想不变；
 *     8×4px 是最小可辨尺寸，不参与色带的抢眼程度。
 *   - **不占布局**：`absolute top-full`，落在 64px 色带下方的留白里，不挤动任何格子。
 *
 * 空间从哪来：滚动容器给 `pb-2`（8px）的底部留白，▲ 只有 4px 高，正好落在留白里，
 * 离下一行 / 容器边缘还有 4px。容器默认滚到底（`scrollToLatest`），留白与 ▲ 都在
 * 可视区内，不会被 `max-h-72` 裁掉。
 *
 * 为什么不会压到下一行：`today` 是**最后一天**（历史记录不会晚于今天），所以它一定
 * 落在最后一行的末尾，下方只有容器底部留白。若存档里出现「未来日期」（脏数据），
 * 今天会排在中间，▲ 会与下一行有 2px 重叠——这是已知的、只可能由脏数据触发的边界，
 * 不为它增加布局复杂度。
 *
 * ── 纯展示 ──────────────────────────────────────────────────────────────────
 *
 * 数据**全部由 props 传入**（`entries`），组件内部**不调 `useHistory()`**、
 * 不读存储、不发请求。这样它可以脱离 `Profile.vue` 独立开发与测试，
 * 也让页面里只有一份 `useHistory()` 实例（见设计文档 4.3）。
 *
 * 色块是 `<button>` 而不是 `<div>`（与 `HistoryList.vue` 同约定，键盘可达）；
 * v1 点击没有副作用，`title` 就是唯一的浮层。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { utcDate } from '@huedle/shared';
import type { HistoryItem } from '../lib/storage';
import {
  DEFAULT_DAYS_PER_ROW,
  buildTimeline,
  countRecordedDays,
  layoutTimeline,
  timelineAriaLabel,
  timelineTitle,
  type TimelineCell,
  type TimelineDay,
} from '../lib/timeline';

const props = defineProps<{
  /** 历史记录（`useHistory().entries`，降序或任意顺序都行——内部会排序）。 */
  entries: HistoryItem[];
  /** `YYYY-MM-DD`，用于标出「今天」那格（见下方 ▲ 标记）。省略则取当前 UTC 日期。 */
  today?: string;
  /**
   * 每行放几格。省略时按容器实测宽度自适应（推荐）；
   * 显式传入用于固定容量（测试 / 嵌进已知宽度的容器）。
   */
  perRow?: number;
}>();

/** 滚动容器（横竖都滚：横向兜底，纵向是「多行 + 限高」）。 */
const scroller = ref<HTMLElement | null>(null);

/** 色块宽度 `w-3`，单位 px；改 class 时这里要同步。格子相邻，没有填缝。 */
const CELL_PX = 12;

/** 容器实测出来的每行容量；宽度未知时保持 `null`，由 `DEFAULT_DAYS_PER_ROW` 兜底。 */
const measuredPerRow = ref<number | null>(null);

let observer: ResizeObserver | null = null;

/** 注入优先；未注入时取真实 UTC 今天（组件读时钟，纯函数层不读）。 */
const today = computed(() => props.today ?? utcDate());
const days = computed(() => buildTimeline(props.entries, today.value));
const recordedCount = computed(() => countRecordedDays(days.value));

/** 每行容量：显式 prop > 实测宽度 > 兜底常量。 */
const perRow = computed(() => props.perRow ?? measuredPerRow.value ?? DEFAULT_DAYS_PER_ROW);
const rows = computed(() => layoutTimeline(days.value, perRow.value));

/**
 * 一格有记录那天的背景。
 *
 *   - 有 `link`（同一行内、日历上相邻、且前面一天也有记录）→ 整格就是从
 *     `link.from`（前一天）到 `link.to`（当天）的渐变。格子的右端正好是当天色，
 *     也就是下一格渐变（或实心当天色）的左端 ⇒ 整条连续，没有实心块。
 *   - 没有 `link`（行首 / 缺口之后 / 单天）→ **实心当天色**，硬边。没有可以
 *     过渡的对象，就不该假装有。
 *
 * 缺口那格根本不走这里（模板里是另一个 `<span>`，且 `link` 恒为 `null`）。
 */
function entryStyle(cell: TimelineCell): Record<string, string> {
  if (cell.day.kind !== 'entry') return {};
  return cell.link === null
    ? { backgroundColor: cell.day.hex }
    : { backgroundImage: `linear-gradient(to right, ${cell.link.from}, ${cell.link.to})` };
}

/**
 * 「今天」只能从**颜色之外**的第二条通道读出来。
 *
 * 去掉 ring 之后，今天与其它格子在视觉上完全一致（只靠下方 ▲ 区分），而 ▲ 是
 * `aria-hidden` 的纯装饰——所以「今天」这件事必须写进色块的 `title` / `aria-label`，
 * 否则屏幕阅读器与键盘用户会**彻底丢失**这个信息（这是无障碍退化，不是简化）。
 *
 * 格式仍由 `lib/timeline.ts` 的纯函数决定（`{date} · {hex}` / `{date} {hex}`），
 * 这里只按渲染上下文追加一个不含内部术语的后缀。
 */
function dayTitle(day: TimelineDay): string {
  const base = timelineTitle(day);
  return day.isToday ? `${base} · 今天` : base;
}

/** 与 {@link dayTitle} 同信息，只换分隔符（沿用 `timelineAriaLabel` 的约定）。 */
function dayLabel(day: TimelineDay): string {
  const base = timelineAriaLabel(day);
  return day.isToday ? `${base} 今天` : base;
}

/**
 * 按容器实测宽度算「一行放几格」。
 *
 * 每格 12px、格子相邻 ⇒ 容量是 `floor(宽 / 12)`——**不留余量会把整行撑出
 * 2px 横向溢出**，那会凭空多出一条横滚动条。宽度为 0（未挂载 / jsdom / 隐藏容器）
 * 时不动手，留给兜底值——绝不算出 0 或 NaN。
 */
function measurePerRow(): void {
  if (props.perRow !== undefined) return;

  const el = scroller.value;
  if (el === null) return;

  const width = el.clientWidth;
  measuredPerRow.value =
    Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width / CELL_PX)) : null;
}

/** 滚到最右下 = 最新。无溢出时也无害（`scrollTop` 会被夹到 0）。 */
function scrollToLatest(): void {
  const el = scroller.value;
  if (el === null) return;
  el.scrollLeft = el.scrollWidth;
  el.scrollTop = el.scrollHeight;
}

function handleResize(): void {
  measurePerRow();
}

onMounted(() => {
  measurePerRow();

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => measurePerRow());
    if (scroller.value !== null) observer.observe(scroller.value);
  }
  // 没有 ResizeObserver（老浏览器 / jsdom）时，退化成窗口尺寸变化。
  if (typeof window !== 'undefined') window.addEventListener('resize', handleResize);

  void nextTick(scrollToLatest);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (typeof window !== 'undefined') window.removeEventListener('resize', handleResize);
});

// 历史变化（抽了今天的颜色 / 切换账户 / 清空后重载）或折行变化后重新贴到最新。
watch(rows, () => {
  void nextTick(scrollToLatest);
});
</script>

<template>
  <section class="space-y-3" aria-label="颜色时间线" data-testid="timeline">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-xs uppercase tracking-widest text-neutral-500">颜色时间线</h2>
      <span
        v-if="days.length > 0"
        class="font-mono text-xs text-neutral-500"
        data-testid="timeline-count"
      >
        {{ recordedCount }} 天
      </span>
    </div>

    <p v-if="days.length === 0" class="text-sm text-neutral-400" data-testid="timeline-empty">
      还没有颜色记录。
    </p>

    <!--
      空历史时刻意**不渲染滚动容器**：空的滚动容器会显示成一条灰色横条，
      看起来像个 bug（设计文档 §3.6）。

      `pb-2`（8px）不只是呼吸感：它是**今天那个 ▲ 的落点**。▲ 只有 4px 高，
      绝对定位在 64px 色带的正下方（`top-full`），整好落在这段留白里，不占任何
      格子的高度、不挤动折行。容器默认滚到底，所以留白和 ▲ 都在可视区内。

      `max-h-72`（≈4 行）+ 默认滚到底：行是升序自上而下的，最新在最后一行，
      所以「看到最新」= 滚到底部 + 最右。
      `[scrollbar-gutter:stable]` 让纵向滚动条**恒占位**：否则滚动条出现 / 消失会
      改变 `clientWidth`，进而改变每行容量，造成容量抖动。
    -->
    <div
      v-else
      ref="scroller"
      class="max-h-72 overflow-auto pb-2 [scrollbar-gutter:stable]"
      data-testid="timeline-scroller"
    >
      <div class="space-y-0.5" data-testid="timeline-rows">
        <ol
          v-for="row in rows"
          :key="row.index"
          class="flex h-16 min-w-min items-stretch"
          :data-row="row.index"
          :data-testid="'timeline-row'"
        >
          <!--
            格子相邻（没有 `ml-1.5` 填缝）：格 N 的右端就是格 N+1 的左端，
            所以有 link 的格子整格是渐变时，整条是一条连续色带。
            行首那格 `link === null`，是实心当天色，不继承上一行的颜色。
          -->
          <li
            v-for="cell in row.cells"
            :key="cell.day.date"
            class="relative w-3 shrink-0"
            :data-testid="'timeline-cell'"
            :data-cell-date="cell.day.date"
            :data-row-start="cell.isRowStart ? 'true' : 'false'"
          >
            <button
              v-if="cell.day.kind === 'entry'"
              type="button"
              class="block h-full w-3 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              :style="entryStyle(cell)"
              :title="dayTitle(cell.day)"
              :aria-label="dayLabel(cell.day)"
              :data-testid="'timeline-day'"
              :data-date="cell.day.date"
              :data-today="cell.day.isToday ? 'true' : 'false'"
              :data-from="cell.link?.from"
              :data-to="cell.link?.to"
            ></button>

            <!-- 缺口：占位但不上色（虚线灰块）。纯装饰，从无障碍树里摘掉 -->
            <span
              v-else
              class="block h-full w-3 rounded-sm border border-dashed border-ink-700/70 bg-ink-800/50"
              :title="timelineTitle(cell.day)"
              aria-hidden="true"
              :data-testid="'timeline-gap'"
              :data-date="cell.day.date"
            ></span>

            <!--
              「今天」的 ▲：8px 宽 × 4px 高，横向居中在 12px 的格子上，紧贴色带
              下沿（`top-full` = 那一行 64px 的底边）。零尺寸盒 + 透明左右边框 +
              琥珀下边框 = 一个指向上方的三角形（▼ 会指向下方的留白，没有指代对象）。

              绝对定位 ⇒ **完全不参与布局**：不改变格子的高度、不改变折行位置、
              不推挤任何相邻格子；琥珀色沿用被去掉的 ring，尺寸刻意最小，
              标记不该抢色带的注意力。

              `aria-hidden`：这是纯视觉标记，「今天」已经写进色块的 `aria-label`
              （见 `dayLabel`），读两遍只会更吵。
            -->
            <span
              v-if="cell.day.isToday"
              class="pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-4 border-b-4 border-x-transparent border-b-amber-400"
              aria-hidden="true"
              data-testid="timeline-today-marker"
            ></span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>
