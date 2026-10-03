<script setup lang="ts">
/**
 * 今日取色（垂直切片）。
 *
 * 三段式流程：
 *   - `closed`  今天还没点 → 只有标题 / 连续天数 / 按钮，不透露颜色、CP、稀有度、徽章；
 *   - `rolling` 点了 → 播放老虎机揭晓动画，背景跟随滚动中的 HEX；
 *   - `done`    动画停稳 / 今天已抽过（刷新）→ 淡入完整结果。
 *
 * 关键：颜色与结果全部来自 `useDailyColor()`（本地模式由纯函数决定 + 本地冻结存档，
 * 登录模式由服务端 `GET /api/daily` 下发），页面本身不掷骰子、不取时、不碰 localStorage。
 * `closed` 阶段 UI 虽然不显示，但 `color` 已经在内存里算好了——它就是动画的 `target`，
 * 点不点都是同一个值。
 */
import { computed, onMounted, ref } from 'vue';
import AmbientBackdrop from '../components/AmbientBackdrop.vue';
import BadgeList from '../components/BadgeList.vue';
import ColorCard from '../components/ColorCard.vue';
import DrawButton from '../components/DrawButton.vue';
import HexRoller from '../components/HexRoller.vue';
import RarityBadge from '../components/RarityBadge.vue';
import { useDailyColor } from '../composables/useDailyColor';
import { formatCp } from '../lib/format';

type Phase = 'closed' | 'rolling' | 'done';

const { result, color, historyItem, streak, isLoading, revealed, error, load, reveal } =
  useDailyColor();

const phase = ref<Phase>('closed');
/** 滚动中的 HEX（由 HexRoller 通过 v-model 抛出），仅用于背景跟随。 */
const rollingHex = ref<string | null>(null);
/**
 * 落定后只播报一次的状态文本。
 *
 * HexRoller 自己也有 aria-live，但它一 `settled` 就被卸载，播报可能来不及；
 * 揭晓结果这么重要的事交给页面里这份常驻区域更稳。**只在落定时写一次**，
 * 不随滚动更新。
 */
const revealedAnnouncement = ref('');

const ambientHex = computed(() => {
  if (phase.value === 'rolling') return rollingHex.value;
  if (phase.value === 'done') return color.value?.hex ?? null;
  return null;
});

onMounted(async () => {
  await load();
  // 存档存在 / 已揭晓标记命中 → 今天已经抽过，直接看结果、不重播动画（「每天一次」的体感）。
  if (revealed.value) phase.value = 'done';
});

/** 读取失败（网络 / 服务端）后的重试：重新 load，成功且已揭晓则直接进结果态。 */
async function retry(): Promise<void> {
  await load();
  if (revealed.value && color.value) phase.value = 'done';
}

function startReveal(): void {
  if (phase.value !== 'closed' || !color.value) return;
  phase.value = 'rolling';
}

async function handleSettled(): Promise<void> {
  if (phase.value !== 'rolling') return;
  await reveal();
  phase.value = 'done';
  const hex = color.value?.hex ?? '';
  revealedAnnouncement.value = `今日颜色已揭晓：${hex}，共 ${formatCp(result.value?.cp ?? 0)} CP。`;
}
</script>

<template>
  <!-- 背景层是 fixed，放在 space-y 容器外面，免得 space-y 给它后面的 header 加多余外边距 -->
  <AmbientBackdrop :hex="ambientHex" />

  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-neutral-50">今日一色</h1>
        <p class="mt-1 text-sm text-neutral-500">每天 00:00 UTC 换新色。</p>
      </div>
      <div class="text-right">
        <p class="text-xs uppercase tracking-widest text-neutral-500">连续天数</p>
        <p class="font-mono text-2xl text-neutral-100">{{ streak }}</p>
      </div>
    </header>

    <!-- 揭晓完成时播报一次（滚动期间不更新，避免刷屏） -->
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ revealedAnnouncement }}</p>

    <!-- 读取失败：可重试的错误态，绝不白屏。一次性提示由 App.vue 统一展示。 -->
    <p
      v-if="error"
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300"
      role="alert"
    >
      <span>{{ error }}</span>
      <button
        type="button"
        class="rounded-lg border border-red-900/60 px-3 py-1 text-xs text-red-200 transition-colors hover:bg-red-950/60"
        :disabled="isLoading"
        @click="retry"
      >
        {{ isLoading ? '重试中…' : '重试' }}
      </button>
    </p>

    <!-- ① 还没抽：只给按钮，不泄露任何结果 -->
    <section
      v-if="phase === 'closed'"
      class="rounded-2xl border border-ink-700 bg-ink-900 p-8 text-center"
    >
      <p class="text-sm text-neutral-400">今天的一色早就定好了，点一下揭晓它。</p>
      <div class="mt-6 flex justify-center">
        <DrawButton :disabled="isLoading || !color" @click="startReveal">开启今日颜色</DrawButton>
      </div>
      <p v-if="isLoading" class="mt-4 text-xs text-neutral-500">正在取色…</p>
      <p v-else-if="!color && !error" class="mt-4 text-xs text-neutral-500">
        颜色暂时不可用，请稍后重试。
      </p>
    </section>

    <!-- ② 揭晓中：老虎机滚动，背景跟随 -->
    <section
      v-else-if="phase === 'rolling' && color"
      class="rounded-2xl border border-ink-700 bg-ink-900 p-8"
    >
      <HexRoller :target="color" v-model="rollingHex" @settled="handleSettled" />
    </section>

    <!-- ③ 已揭晓：完整结果淡入 -->
    <div v-else-if="phase === 'done' && result && color && historyItem" class="fade-in space-y-6">
      <ColorCard :color="color" :cp="formatCp(result.cp)" />

      <section class="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-700 bg-ink-900 p-4">
        <div>
          <p class="text-xs uppercase tracking-widest text-neutral-500">总 CP</p>
          <p class="font-mono text-3xl font-bold text-neutral-50">{{ formatCp(result.cp) }}</p>
        </div>
        <RarityBadge :rarity="result.rarity" />
        <p class="ml-auto text-xs text-neutral-500">
          {{ historyItem.date }} UTC · {{ result.badges.length }} 条徽章
        </p>
      </section>

      <BadgeList :badges="result.scoringBadges" :superseded="result.supersededBadges" />
    </div>
  </div>
</template>

<style scoped>
@keyframes huedle-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.fade-in {
  animation: huedle-fade-in 420ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .fade-in {
    animation: none;
  }
}
</style>
