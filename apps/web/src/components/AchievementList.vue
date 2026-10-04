<script setup lang="ts">
/**
 * 成就区块（功能②，结构见 docs/NEW-FEATURES.md §2.5）。
 *
 * **纯展示组件**：成就状态完全由 `entries` prop 推导，组件内部**不调用**
 * `useHistory()`、不读 localStorage、不发请求。这是刻意的两阶段集成设计——
 * 本组件可以在 `Profile.vue` 一行未改时独立开发与测试，集成时页面只需插入
 * 一个 `<section>` 并把现成的 `entries` 传进来（避免同页出现多个历史数据源）。
 *
 * 空历史不整体隐藏：13 条全部未点亮、总览为 0，另给一句空态文案（§2.7）。
 */
import { computed } from 'vue';
import type { HistoryItem } from '../lib/storage';
import type { AchievementState } from '../lib/achievements';
import { deriveAchievements } from '../lib/achievements';
import AchievementCard from './AchievementCard.vue';

const props = defineProps<{ entries: HistoryItem[] }>();

const achievements = computed<AchievementState[]>(() => deriveAchievements(props.entries));
const unlockedCount = computed(() => achievements.value.filter(item => item.unlocked).length);
const isEmpty = computed(() => props.entries.length === 0);
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between">
      <h2 class="text-sm font-semibold uppercase tracking-widest text-neutral-400">成就</h2>
      <span class="text-xs text-neutral-500">
        已点亮 {{ unlockedCount }} / {{ achievements.length }}
      </span>
    </div>

    <p
      v-if="isEmpty"
      class="rounded-xl border border-dashed border-ink-700 p-4 text-sm text-neutral-500"
    >
      抽到第一天的颜色，这里就会开始记录。
    </p>

    <div class="grid gap-3 sm:grid-cols-2">
      <AchievementCard
        v-for="achievement in achievements"
        :key="achievement.id"
        :achievement="achievement"
      />
    </div>
  </section>
</template>
