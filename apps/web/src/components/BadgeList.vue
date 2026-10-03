<script setup lang="ts">
/**
 * 命中徽章列表。
 *
 * 两组分开渲染：
 *  - `badges`：**计分保留**的徽章，正常展示；
 *  - `superseded`：命中但被同 group 更高分取代的徽章——**它们确实被获得了**，
 *    只是不重复加分，所以视觉上降级（虚线框 + 降饱和 + 分值加删除线），
 *    但**不给徽章名加删除线**（那会读成"没拿到"，是错的）。
 *
 * 机制解释只在标题上留一个 `title` 提示，不在页面上长篇讲解（DESIGN 6.2.1）。
 */
import type { Badge } from '@huedle/shared';
import { formatCp } from '../lib/format';
import RarityBadge from './RarityBadge.vue';

withDefaults(defineProps<{ badges: Badge[]; superseded?: Badge[] }>(), { superseded: () => [] });
</script>

<template>
  <div class="space-y-6">
    <div>
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-neutral-400">徽章</h2>
        <span class="text-xs text-neutral-500">{{ badges.length }} 条</span>
      </div>

      <p v-if="badges.length === 0" class="rounded-xl border border-dashed border-ink-700 p-4 text-sm text-neutral-500">
        没有命中任何徽章。
      </p>

      <ul v-else class="space-y-2">
        <li
          v-for="badge in badges"
          :key="badge.id"
          class="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-neutral-100">{{ badge.name }}</span>
              <RarityBadge :rarity="badge.rarity" size="sm" />
            </div>
            <p class="mt-1 text-sm text-neutral-400">{{ badge.description }}</p>
          </div>
          <span class="shrink-0 font-mono text-sm text-neutral-300">{{ formatCp(badge.cp) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="superseded.length > 0">
      <div
        class="mb-3 flex items-baseline justify-between"
        title="同一条规则的不同强度档位只取最强的一条计分，其余仍然收入图鉴。"
      >
        <h2 class="text-sm font-semibold uppercase tracking-widest text-neutral-500">同类更强</h2>
        <span class="text-xs text-neutral-500">{{ superseded.length }} 条 · 未加分</span>
      </div>

      <ul class="space-y-2">
        <li
          v-for="badge in superseded"
          :key="badge.id"
          class="flex items-start gap-3 rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-3 opacity-60"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-neutral-400">{{ badge.name }}</span>
            </div>
            <p class="mt-1 text-sm text-neutral-500">{{ badge.description }}</p>
          </div>
          <span class="shrink-0 font-mono text-sm text-neutral-600 line-through">
            {{ formatCp(badge.cp) }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
