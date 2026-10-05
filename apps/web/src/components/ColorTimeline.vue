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
 *   - 渐变是**每一格自己的左侧填缝**（`link`），只有当「同一行内、日历上相邻、
 *     且两天都有记录」时才存在。缺口那格不会产生 `link`，链条在缺口处天然断开；
 *     行首那格的 `link` 恒为 `null`，所以**行尾收在当天颜色**，不向下一行发散。
 *
 * `link` 只描述「左边」，没有对应的「右边」——行尾不需要任何特判，它本来就不带
 * 指向下一行的东西。
 *
 * ── 每行放几格：按容器宽度实测 ──────────────────────────────────────────────
 *
 * 固定天数（比如每行 30 天）在窄屏上照样溢出，等于没解决「一条放不下」；所以
 * 容量由 `ResizeObserver` 实测容器宽度算出：每格 18px（6px 填缝 + 12px 色块），
 * 容量 = `floor(宽 / 18)`。
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
} from '../lib/timeline';

const props = defineProps<{
  /** 历史记录（`useHistory().entries`，降序或任意顺序都行——内部会排序）。 */
  entries: HistoryItem[];
  /** `YYYY-MM-DD`，用于给「今天」那格加琥珀 ring。省略则取当前 UTC 日期。 */
  today?: string;
  /**
   * 每行放几格。省略时按容器实测宽度自适应（推荐）；
   * 显式传入用于固定容量（测试 / 嵌进已知宽度的容器）。
   */
  perRow?: number;
}>();

/** 滚动容器（横竖都滚：横向兜底，纵向是「多行 + 限高」）。 */
const scroller = ref<HTMLElement | null>(null);

/** 色块宽度 `w-3` 与填缝（渐变）宽度 `w-1.5`，单位 px；改 class 时这里要同步。 */
const CELL_PX = 12;
const LINK_PX = 6;

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
 * 按容器实测宽度算「一行放几格」。
 *
 * 每格占「6px 左填缝 + 12px 色块」= 18px（行首那格也带填缝，各行才对齐），
 * 所以容量是 `floor(宽 / 18)`——**不留余量会把整行撑出 2px 横向溢出**，
 * 那会凭空多出一条横滚动条。宽度为 0（未挂载 / jsdom / 隐藏容器）时不动手，
 * 留给兜底值——绝不算出 0 或 NaN。
 */
function measurePerRow(): void {
  if (props.perRow !== undefined) return;

  const el = scroller.value;
  if (el === null) return;

  const width = el.clientWidth;
  measuredPerRow.value =
    Number.isFinite(width) && width > 0
      ? Math.max(1, Math.floor(width / (CELL_PX + LINK_PX)))
      : null;
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

      `max-h-72`（≈4 行）+ 默认滚到底：行是升序自上而下的，最新在最后一行，
      所以「看到最新」= 滚到底部 + 最右。
      `[scrollbar-gutter:stable]` 让纵向滚动条**恒占位**：否则滚动条出现 / 消失会
      改变 `clientWidth`，进而改变每行容量，造成容量抖动。
    -->
    <div
      v-else
      ref="scroller"
      class="max-h-72 overflow-auto pb-1 [scrollbar-gutter:stable]"
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
            每格带 6px 左填缝（`ml-1.5`），所以各行的列是对齐的：行首也多这 6px，
            但它不画渐变（`link === null`），行尾则根本没有指向下一行的元素。
          -->
          <li
            v-for="cell in row.cells"
            :key="cell.day.date"
            class="relative ml-1.5 w-3 shrink-0"
            :data-testid="'timeline-cell'"
            :data-cell-date="cell.day.date"
            :data-row-start="cell.isRowStart ? 'true' : 'false'"
          >
            <!--
              渐变填缝：只连「同一行内、相邻且都有记录」的两天。
              纯装饰，从无障碍树里摘掉（信息由两侧色块的 title / aria-label 给出）。
            -->
            <span
              v-if="cell.link"
              class="absolute inset-y-0 right-full w-1.5"
              aria-hidden="true"
              data-testid="timeline-link"
              :data-from="cell.link.from"
              :data-to="cell.link.to"
              :style="{
                backgroundImage: `linear-gradient(to right, ${cell.link.from}, ${cell.link.to})`,
              }"
            ></span>

            <button
              v-if="cell.day.kind === 'entry'"
              type="button"
              class="block h-full w-3 rounded-sm border border-white/10 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              :class="{ 'ring-2 ring-amber-400': cell.day.isToday }"
              :style="{ backgroundColor: cell.day.hex }"
              :title="timelineTitle(cell.day)"
              :aria-label="timelineAriaLabel(cell.day)"
              :data-testid="'timeline-day'"
              :data-date="cell.day.date"
              :data-today="cell.day.isToday ? 'true' : 'false'"
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
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>
