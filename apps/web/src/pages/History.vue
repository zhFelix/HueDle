<script setup lang="ts">
/**
 * 历史记录页。
 *
 * 数据来自 `useHistory()`：本地模式读 `huedle:history`，登录模式读服务端
 * `GET /api/history`，这里**不重算**任何分数——每条记录的日期 / 颜色 / CP / 稀有度
 * 都是抽到当天写下的原值，徽章列表由 `HistoryList` 在展开时按存档还原。
 *
 * 「清空本地记录」**只在本地模式显示**：登录模式没有本地记录可清（数据在服务端）。
 * 清空是两步：先在原地展开确认条，确认后才真的清（不用 `window.confirm`）。
 * 清空只删记录，不动身份——所以颜色不会变（`clearLocalHistory`）。
 */
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import HistoryList from '../components/HistoryList.vue';
import RarityBadge from '../components/RarityBadge.vue';
import { useHistory } from '../composables/useHistory';
import { RARITY_ORDER } from '../lib/rarity';
import { formatCp } from '../lib/format';

const { entries, stats, isEmpty, canClear, isLoading, error, reload, clear } = useHistory();

const isConfirmingClear = ref(false);
const clearedNotice = ref('');

/** 稀有度分布：只保留有记录的天数，不摆一排 0。 */
const distribution = computed(() =>
  RARITY_ORDER.map(rarity => ({ rarity, count: stats.value.byRarity[rarity] })).filter(
    entry => entry.count > 0,
  ),
);

function confirmClear(): void {
  clear();
  isConfirmingClear.value = false;
  clearedNotice.value = '本地记录已清空。';
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-neutral-50">历史记录</h1>
      <p class="mt-1 text-sm text-neutral-500">每一天抽到的颜色与得分，都按当天的结果原样保存。</p>
    </header>

    <!-- 读取失败：可重试的错误态，绝不白屏 -->
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
        @click="reload"
      >
        {{ isLoading ? '重试中…' : '重试' }}
      </button>
    </p>

    <p v-if="isLoading && entries.length === 0" class="text-sm text-neutral-500">正在读取…</p>

    <!-- 空态：说清楚现在没记录，并给一条回到今日页的路 -->
    <section
      v-if="isEmpty"
      class="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center"
    >
      <p class="text-sm text-neutral-400">还没有任何记录，去抽一次今天的颜色吧。</p>
      <RouterLink
        to="/"
        class="mt-5 inline-flex rounded-xl bg-ink-800 px-5 py-2.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-ink-700"
      >
        回到今日
      </RouterLink>
      <p v-if="clearedNotice" class="mt-4 text-xs text-neutral-500" role="status">
        {{ clearedNotice }}
      </p>
    </section>

    <template v-else>
      <!-- 统计条 -->
      <section class="rounded-2xl border border-ink-700 bg-ink-900 p-4">
        <dl class="grid grid-cols-3 gap-4">
          <div>
            <dt class="text-xs uppercase tracking-widest text-neutral-500">已记录天数</dt>
            <dd class="mt-1 font-mono text-2xl text-neutral-100">{{ stats.totalDays }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-widest text-neutral-500">当前连续</dt>
            <dd class="mt-1 font-mono text-2xl text-neutral-100">
              {{ stats.streak }}<span class="ml-1 text-sm text-neutral-500">天</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-widest text-neutral-500">最高 CP</dt>
            <dd class="mt-1 font-mono text-2xl text-neutral-100">{{ formatCp(stats.bestCp) }}</dd>
            <p v-if="stats.bestEntry" class="mt-1 font-mono text-xs text-neutral-500">
              {{ stats.bestEntry.date }}
            </p>
          </div>
        </dl>

        <div
          v-if="distribution.length > 0"
          class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-800 pt-4"
        >
          <span class="text-xs uppercase tracking-widest text-neutral-500">稀有度分布</span>
          <span
            v-for="entry in distribution"
            :key="entry.rarity"
            class="inline-flex items-center gap-2"
          >
            <RarityBadge :rarity="entry.rarity" size="sm" />
            <span class="text-xs text-neutral-400">{{ entry.count }} 天</span>
          </span>
        </div>
      </section>

      <HistoryList :entries="entries" />

      <!-- 底部：低强调的清空入口 + 就地二次确认（登录模式没有本地记录可清，整块不显示） -->
      <section v-if="canClear" class="border-t border-ink-800 pt-4">
        <div v-if="!isConfirmingClear" class="flex justify-end">
          <button
            type="button"
            class="text-xs text-neutral-600 underline-offset-4 transition-colors hover:text-neutral-300 hover:underline"
            @click="isConfirmingClear = true"
          >
            清空本地记录
          </button>
        </div>

        <div
          v-else
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3"
          role="group"
          aria-label="确认清空本地记录"
        >
          <p class="text-sm text-neutral-300">确定清空全部本地记录吗？清空后无法恢复。</p>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-ink-800"
              @click="isConfirmingClear = false"
            >
              取消
            </button>
            <button
              type="button"
              class="rounded-lg bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
              @click="confirmClear"
            >
              确认清空
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
