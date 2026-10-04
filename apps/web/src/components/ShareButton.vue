<script setup lang="ts">
/**
 * 「分享今日结果」按钮。
 *
 * 只负责交互状态，真正的布局 / 绘制 / 降级在 `lib/share-card.ts`：
 * 有系统分享能力就走分享面板，否则下载 PNG；用户取消（AbortError）
 * 由 `shareDailyCard` 吞掉，这里不会进错误分支。
 */
import type { Badge, ScoreRarity } from '@huedle/shared';
import { ref } from 'vue';
import { shareDailyCard } from '../lib/share-card';

const props = defineProps<{
  hex: string;
  cp: number;
  rarity: ScoreRarity;
  badges: Badge[];
  date: string;
}>();

type ShareState = 'idle' | 'working' | 'error';

const state = ref<ShareState>('idle');

async function onShare(): Promise<void> {
  if (state.value === 'working') return;
  state.value = 'working';
  try {
    await shareDailyCard({
      hex: props.hex,
      cp: props.cp,
      rarity: props.rarity,
      badges: props.badges,
      date: props.date,
    });
    state.value = 'idle';
  } catch {
    state.value = 'error';
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      class="rounded-xl border border-amber-400/50 bg-amber-400/10 px-5 py-2.5 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-400/20 disabled:opacity-60"
      :disabled="state === 'working'"
      @click="onShare"
    >
      {{ state === 'working' ? '正在生成卡片…' : '分享今日结果' }}
    </button>
    <p v-if="state === 'error'" role="alert" class="text-xs text-red-300">
      卡片生成失败，请重试。
    </p>
  </div>
</template>
