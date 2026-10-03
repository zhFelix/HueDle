<script setup lang="ts">
/**
 * 个人主页（路由 `/me`，导航里的「我的」）。
 *
 * 它就是原来的历史页——**没有重写，而是复用**：数据仍全部来自 `useHistory()`，
 * 徽章列表仍由 `HistoryList` 在展开时按存档还原（不重跑 `check`、不重算分数）。
 * 这里只是把「身份」和「历史」合到了一页，并把统计的主次调了一下。
 *
 * 三段：
 *   ① 身份区——登录模式显示用户名 + 登出；本地模式显示「本地模式」+ 去登录的入口。
 *      并说明两种模式抽到的是**不同的颜色**（DESIGN 第 11.5 节），这是玩家最容易
 *      困惑的点：本地抽了今天再登录，看到的是账户身份的今日颜色，不是"多抽了一次"。
 *   ② 统计区——主指标是**收集天数**（原来的「已记录天数」）；次要指标是当前连续、
 *      最高 CP（含那天的日期）与稀有度分布。首页那个「连续天数」已经从首页移除，
 *      累计天数只在这里出现。
 *   ③ 颜色历史——复用 `HistoryList`（折叠 / 展开徽章 / 「同类更强」降级 / 今天标记）。
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
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
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
      <h1 class="text-2xl font-bold text-neutral-50">我的</h1>
    </header>

    <!-- ① 身份区 -->
    <section
      class="rounded-2xl border border-ink-700 bg-ink-900 p-4"
      aria-label="当前身份"
      data-testid="identity-section"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <template v-if="session.isLoggedIn">
          <div>
            <p class="text-xs uppercase tracking-widest text-neutral-500">登录模式</p>
            <p class="mt-1 font-mono text-lg text-neutral-50">
              {{ session.userName ?? session.userId }}
            </p>
          </div>
          <button
            type="button"
            class="rounded-xl border border-ink-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-ink-800"
            @click="session.logout()"
          >
            登出
          </button>
        </template>

        <template v-else>
          <div>
            <p class="text-xs uppercase tracking-widest text-neutral-500">本地模式</p>
            <p class="mt-1 text-sm text-neutral-300">
              登录后，颜色和历史在任何设备上都能看到。
            </p>
          </div>
          <RouterLink
            to="/login"
            class="rounded-xl bg-ink-800 px-4 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-ink-700"
          >
            登录 / 注册
          </RouterLink>
        </template>
      </div>
    </section>

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
      <!-- ② 统计区：收集天数是主指标（首页已不再显示「连续天数」） -->
      <section class="rounded-2xl border border-ink-700 bg-ink-900 p-4" data-testid="stats-section">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-widest text-neutral-500">收集天数</p>
            <p class="mt-1 font-mono text-4xl font-bold text-neutral-50">
              {{ stats.totalDays }}<span class="ml-1 text-base font-normal text-neutral-500">天</span>
            </p>
          </div>
          <dl class="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt class="text-xs uppercase tracking-widest text-neutral-500">当前连续</dt>
              <dd class="mt-1 font-mono text-xl text-neutral-100">
                {{ stats.streak }}<span class="ml-1 text-sm text-neutral-500">天</span>
              </dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-widest text-neutral-500">最高 CP</dt>
              <dd class="mt-1 font-mono text-xl text-neutral-100">
                {{ formatCp(stats.bestCp) }}
              </dd>
              <p v-if="stats.bestEntry" class="mt-1 font-mono text-xs text-neutral-500">
                {{ stats.bestEntry.date }}
              </p>
            </div>
          </dl>
        </div>

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

      <!-- ③ 颜色历史 -->
      <section class="space-y-3" aria-label="颜色历史">
        <h2 class="text-xs uppercase tracking-widest text-neutral-500">颜色历史</h2>
        <HistoryList :entries="entries" />
      </section>

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
