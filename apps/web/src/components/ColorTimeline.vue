<script setup lang="ts">
/**
 * 颜色时间线（设计见 docs/NEW-FEATURES.md 第 3 节）。
 *
 * 一条横向色带：**每天一个色块**，按日期从左到右，最近的在最右；默认滚到最右
 * （`scrollLeft = scrollWidth`，不引滚动库）。悬停 / 键盘聚焦看到 `日期 · HEX`。
 * 没抽的那天是一个虚线灰块（缺口占位），所以「连续 3 天」和「3 天散在一个月里」
 * 在视觉上完全不同——详见 `lib/timeline.ts`。
 *
 * ── 纯展示 ────────────────────────────────────────────────────────────────
 *
 * 数据**全部由 props 传入**（`entries`），组件内部**不调 `useHistory()`**、
 * 不读存储、不发请求。这样它可以脱离 `Profile.vue` 独立开发与测试，
 * 也让页面里只有一份 `useHistory()` 实例（见设计文档 4.3）。
 *
 * 色块是 `<button>` 而不是 `<div>`（与 `HistoryList.vue` 同约定，键盘可达）；
 * v1 点击没有副作用，`title` 就是唯一的浮层。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { utcDate } from '@huedle/shared';
import type { HistoryItem } from '../lib/storage';
import {
  buildTimeline,
  countRecordedDays,
  timelineAriaLabel,
  timelineTitle,
} from '../lib/timeline';

const props = defineProps<{
  /** 历史记录（`useHistory().entries`，降序或任意顺序都行——内部会排序）。 */
  entries: HistoryItem[];
  /** `YYYY-MM-DD`，用于给「今天」那格加琥珀 ring。省略则取当前 UTC 日期。 */
  today?: string;
}>();

/** 横向滚动容器。 */
const scroller = ref<HTMLElement | null>(null);

/** 注入优先；未注入时取真实 UTC 今天（组件读时钟，纯函数层不读）。 */
const today = computed(() => props.today ?? utcDate());
const days = computed(() => buildTimeline(props.entries, today.value));
const recordedCount = computed(() => countRecordedDays(days.value));

/** 滚到最右 = 最新。`scrollWidth` 在无溢出时也无害。 */
function scrollToLatest(): void {
  const el = scroller.value;
  if (el !== null) el.scrollLeft = el.scrollWidth;
}

onMounted(scrollToLatest);

// 历史变化（抽了今天的颜色 / 切换账户 / 清空后重载）后重新贴到最右。
watch(days, () => {
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
    -->
    <div v-else ref="scroller" class="overflow-x-auto pb-1" data-testid="timeline-scroller">
      <ol class="flex h-16 min-w-min items-stretch gap-0.5">
        <li v-for="day in days" :key="day.date" class="shrink-0">
          <button
            v-if="day.kind === 'entry'"
            type="button"
            class="block h-full w-3 rounded-sm border border-white/10 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            :class="{ 'ring-2 ring-amber-400': day.isToday }"
            :style="{ backgroundColor: day.hex }"
            :title="timelineTitle(day)"
            :aria-label="timelineAriaLabel(day)"
            :data-testid="'timeline-day'"
            :data-date="day.date"
            :data-today="day.isToday ? 'true' : 'false'"
          ></button>

          <!-- 缺口：占位但不上色（虚线灰块）。纯装饰，从无障碍树里摘掉 -->
          <span
            v-else
            class="block h-full w-3 rounded-sm border border-dashed border-ink-700/70 bg-ink-800/50"
            :title="timelineTitle(day)"
            aria-hidden="true"
            :data-testid="'timeline-gap'"
            :data-date="day.date"
          ></span>
        </li>
      </ol>
    </div>
  </section>
</template>
