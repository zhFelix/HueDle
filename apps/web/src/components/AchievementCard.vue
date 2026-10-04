<script setup lang="ts">
/**
 * 单条成就卡（功能②，结构见 docs/NEW-FEATURES.md §2.5）。
 *
 * 纯展示：只接收推导好的 {@link AchievementState}，不读历史、不读存储、不发请求。
 * 两态：
 *  - 已点亮：实线边 + 正常色 + `解锁于 {date}` + 满进度条；
 *  - 未点亮：虚线边 + 降饱和（与 BadgeBook 未获得卡片同款视觉语言）+ 真实进度。
 *
 * 刻意**不用** `animate-pulse`：那是 `anomaly` 稀有度的专属语义，复用到成就上
 * 会让两个系统互相稀释。
 */
import type { AchievementState } from '../lib/achievements';
import { formatProgress, progressPercent } from '../lib/achievements';

defineProps<{ achievement: AchievementState }>();
</script>

<template>
  <div
    class="rounded-xl border p-3"
    :class="
      achievement.unlocked
        ? 'border-ink-700 bg-ink-900'
        : 'border-dashed border-ink-700/70 bg-ink-900/40 opacity-60 saturate-50'
    "
    :data-achievement-id="achievement.id"
    :data-unlocked="achievement.unlocked ? 'true' : 'false'"
  >
    <div class="flex items-center justify-between gap-2">
      <span
        class="font-medium"
        :class="achievement.unlocked ? 'text-neutral-100' : 'text-neutral-400'"
      >
        {{ achievement.name }}
      </span>
      <span v-if="achievement.unlocked" class="text-emerald-400" aria-hidden="true">✓</span>
    </div>

    <p
      class="mt-1 text-xs"
      :class="achievement.unlocked ? 'text-neutral-400' : 'text-neutral-500'"
    >
      <template v-if="achievement.unlockedAt">解锁于 {{ achievement.unlockedAt }}</template>
      <template v-else>{{ formatProgress(achievement) }}</template>
    </p>

    <div
      class="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="progressPercent(achievement)"
      :aria-label="`${achievement.name}进度`"
    >
      <div
        class="h-full rounded-full"
        :class="achievement.unlocked ? 'bg-emerald-400' : 'bg-neutral-500'"
        :style="{ width: `${progressPercent(achievement)}%` }"
      />
    </div>
  </div>
</template>
