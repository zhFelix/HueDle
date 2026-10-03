<script setup lang="ts">
/**
 * 历史列表：每条一行，默认折叠；点整行展开当天命中的徽章。
 *
 * 展开内容与今日页**完全同源**：把存档里的 `badgeIds` / `cp` / `rarity`
 * 交给 `restoreScore(...)` 还原展示结构（不重跑 `check`、不重算分数），
 * 再交给现成的 `BadgeList`，所以「同类更强」的降级展示两边一致。
 *
 * 整行是一个 `<button>`（键盘可达 + `aria-expanded`），不是 `div @click`。
 * 只为**已展开**的行调用 `restoreScore`：历史可能有一年 365 条，不预先全部还原。
 */
import { computed, ref } from 'vue';
import { restoreScore, utcDate, type ScoreResult } from '@huedle/shared';
import type { HistoryItem } from '../lib/storage';
import { formatCp } from '../lib/format';
import BadgeList from './BadgeList.vue';
import RarityBadge from './RarityBadge.vue';

interface HistoryRow {
  item: HistoryItem;
  isToday: boolean;
  expanded: boolean;
  score: ScoreResult | null;
}

const props = defineProps<{ entries: HistoryItem[] }>();

/** 已展开的日期集合，默认空（全折叠）。 */
const expandedDates = ref<ReadonlySet<string>>(new Set());
/** 今天的 UTC 日期，用于给当天那行打标记。 */
const today = utcDate();

const rows = computed<HistoryRow[]>(() =>
  props.entries.map(item => {
    const expanded = expandedDates.value.has(item.date);
    return {
      item,
      isToday: item.date === today,
      expanded,
      score: expanded ? restoreScore(item.badgeIds, item.cp, item.rarity) : null,
    };
  }),
);

function toggle(date: string): void {
  const next = new Set(expandedDates.value);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  expandedDates.value = next;
}
</script>

<template>
  <ul class="space-y-2">
    <li
      v-for="row in rows"
      :key="row.item.date"
      class="overflow-hidden rounded-2xl border border-ink-700 bg-ink-900"
    >
      <button
        type="button"
        class="flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left transition-colors hover:bg-ink-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-400"
        :aria-expanded="row.expanded"
        @click="toggle(row.item.date)"
      >
        <span
          class="h-6 w-6 shrink-0 rounded-md border border-white/10"
          :style="{ backgroundColor: row.item.hex }"
          aria-hidden="true"
        ></span>

        <span class="font-mono text-sm text-neutral-100">{{ row.item.date }}</span>

        <span
          v-if="row.isToday"
          class="rounded-full border border-amber-400/50 bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300"
        >
          今天
        </span>

        <span class="ml-auto font-mono text-xs text-neutral-400 sm:text-sm">{{ row.item.hex }}</span>

        <span class="font-mono text-sm text-neutral-200">
          {{ formatCp(row.item.cp) }}<span class="ml-1 text-xs text-neutral-500">CP</span>
        </span>

        <RarityBadge :rarity="row.item.rarity" size="sm" />

        <span class="w-3 text-center text-xs text-neutral-500" aria-hidden="true">
          {{ row.expanded ? '▾' : '▸' }}
        </span>
      </button>

      <div v-if="row.expanded" class="border-t border-ink-700 p-4">
        <p class="mb-4 font-mono text-xs text-neutral-500">
          {{ row.item.hex }} · {{ row.item.date }} UTC
        </p>
        <BadgeList :badges="row.score?.scoringBadges ?? []" :superseded="row.score?.supersededBadges" />
      </div>
    </li>
  </ul>
</template>
