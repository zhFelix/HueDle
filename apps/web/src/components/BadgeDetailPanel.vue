<script setup lang="ts">
/**
 * 徽章详情面板（功能①）。
 *
 * ── 纯展示 ──────────────────────────────────────────────────────────────────
 *
 * 组件只吃 props（`badge` + `detail`），不调 `useHistory()` / `useBadges()`，
 * 因此可以在没有历史、没有 Pinia 的环境里直接 mount 测试；展开状态与数据都由
 * `BadgeBook.vue` + `useBadgeDetail()` 提供。这也是 §4.3 里「props 传入」的约定。
 *
 * ── 未获得分支：有意做得很短 ────────────────────────────────────────────────
 *
 * 未获得时**只显示名称与「未获得」**：不显示概率、不显示判定条件、不显示命中。
 * 理由与「未获得卡片上连稀有度胶囊都拿掉」是同一条——精确概率（例如 1/1677 万）
 * 比稀有度胶囊泄露得更多，会把「发现」的乐趣提前用掉。这不是缺陷，是拍板决定。
 *
 * 已获得的详情才是完整回看：真实概率（`hits` 派生的占比，不是 `cp`）、判定条件、
 * 命中过哪几天、以及平台徽章 id（给反馈问题用）。
 *
 * `hits === null`（`PRICING` 缺定价，实际不可达）时不渲染概率行，
 * **不 fallback 成 0**——「概率 0」会被读成「永远不可能」。
 */
import { computed } from 'vue';
import { TOTAL_COLORS, type Badge } from '@huedle/shared';
import type { BadgeDetail } from '../composables/useBadgeDetail';
import { formatProbability, formatProbabilityHint } from '../lib/probability';

const props = defineProps<{ badge: Badge; detail: BadgeDetail }>();

/**
 * 命中日期列表最多渲染的天数。命中可能横跨一年（高频徽章几乎每天命中），
 * 全量渲染会把详情撑成一屏列表；超出的折叠成一句「另有 N 天」。
 * v1 不做「展开全部」——详情里再嵌一层展开会让 `aria-expanded` 嵌套两层。
 */
const MAX_HIT_DAYS = 12;

const probability = computed(() =>
  props.detail.hits === null ? null : formatProbability(props.detail.hits, TOTAL_COLORS),
);
const probabilityHint = computed(() =>
  props.detail.hits === null ? '' : formatProbabilityHint(props.detail.hits, TOTAL_COLORS),
);
const visibleHitDays = computed(() => props.detail.hitDays.slice(0, MAX_HIT_DAYS));
const hiddenHitDayCount = computed(() => Math.max(0, props.detail.hitDays.length - MAX_HIT_DAYS));
</script>

<template>
  <div
    class="space-y-4 border-t border-ink-700 p-4"
    data-testid="badge-detail"
    :data-detail-collected="detail.isCollected ? 'true' : 'false'"
  >
    <template v-if="detail.isCollected">
      <!-- 真实概率：hits 是 2²⁴ 全色域的精确命中数，与条目上的 CP 不是同一个量纲 -->
      <div v-if="probability !== null" data-testid="badge-probability">
        <p class="text-xs uppercase tracking-widest text-neutral-500">真实概率</p>
        <p class="mt-1 font-mono text-2xl font-bold text-neutral-50">{{ probability }}</p>
        <p class="mt-1 text-sm text-neutral-400">{{ probabilityHint }}</p>
      </div>

      <div data-testid="badge-condition">
        <p class="text-xs uppercase tracking-widest text-neutral-500">判定条件</p>
        <p class="mt-1 text-sm text-neutral-300">{{ badge.description }}</p>
      </div>

      <div data-testid="badge-hits">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <p class="text-xs uppercase tracking-widest text-neutral-500">你的命中</p>
          <span class="font-mono text-xs text-neutral-400">{{ detail.hitDays.length }} 天</span>
          <span
            v-if="detail.firstDay !== null"
            class="ml-auto font-mono text-xs text-neutral-500"
            data-testid="badge-first-day"
          >
            首次 {{ detail.firstDay }}
          </span>
        </div>

        <p
          v-if="detail.hitDays.length === 0"
          class="mt-2 text-sm text-neutral-500"
          data-testid="badge-hits-empty"
        >
          还没有命中过
        </p>
        <ul v-else class="mt-2 flex flex-wrap gap-2">
          <li
            v-for="day in visibleHitDays"
            :key="day.date"
            class="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800/60 px-2 py-1"
          >
            <span
              class="h-3 w-3 shrink-0 rounded-sm border border-white/10"
              :style="{ backgroundColor: day.hex }"
              aria-hidden="true"
            ></span>
            <span class="font-mono text-xs text-neutral-300">{{ day.date }}</span>
          </li>
        </ul>
        <p v-if="hiddenHitDayCount > 0" class="mt-2 text-xs text-neutral-500">
          另有 {{ hiddenHitDayCount }} 天
        </p>
      </div>

      <!-- 平台徽章 id：kebab-case 英文标识，用于反馈问题时指认是哪一条 -->
      <code class="block font-mono text-xs text-neutral-600" data-testid="badge-platform-id">
        {{ badge.id }}
      </code>
    </template>

    <!-- 未获得：只有名称与「未获得」。概率 / 判定条件 / 命中一律不出现。 -->
    <div v-else class="space-y-1" data-testid="badge-undiscovered">
      <p class="text-sm font-medium text-neutral-300">{{ badge.name }}</p>
      <span class="inline-block rounded-full border border-ink-700 px-2 py-0.5 text-xs text-neutral-500">
        未获得
      </span>
    </div>
  </div>
</template>
