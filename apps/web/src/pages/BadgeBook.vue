<script setup lang="ts">
/**
 * 徽章图鉴（路由 `/badges`，DESIGN 第 12.2 节）。
 *
 * ── 展示口径：全部徽章都出现，未获得的**只显示名称** ───────────────────────
 *
 * 未获得的徽章只显示名称，保留「发现」的乐趣——玩家知道还有多少没集齐
 * （家族分组与 `n / m` 进度照常展示，那是收集驱动力的来源），但不知道具体要
 * 满足什么条件，抽到的时候才有惊喜。已获得的则完整展示（名称 + 稀有度胶囊 +
 * 判定条件 + CP），方便回看「我当时为什么拿到它」。
 *
 * 「只显示名称」≠ 不渲染：未获得的条目仍然占位，否则家族进度就无从谈起。
 *
 * ── 三段 ────────────────────────────────────────────────────────────────────
 *   ① 总进度：`已收集 N / totalCount`（= `allBadges.length`）+ 进度条；
 *   ② 家族分组：按固定家族顺序（gray→…→casino）每家族一节，标题含中文名与 `n / m`，
 *      节内列出该家族全部徽章（含未收集的占位）；
 *   ③ 每条徽章：已收集正常展示，未收集降饱和 / 降透明度 + 「未获得」轻量标记。
 *      不显示 `group`——那是计分内部概念（取代关系），图鉴不解释。
 *
 * ④ 空状态：一条都没收集时给一句话 + 去今日页的入口；此时图鉴主体照常渲染，
 *    让玩家看到「还有多少条没收集」而不是一片空白。
 *
 * ⑤ 详情：点任意一条（已获得或未获得）就地展开，再点收起，允许多条同时展开。
 *    展开内容见 `BadgeDetailPanel`——已获得才显示概率 / 判定条件 / 命中日期；
 *    **未获得只显示名称与「未获得」**（概率比稀有度胶囊泄露得更多）。
 *
 * 数据全部来自 `useBadges()`（已收集口径）与 `useBadgeDetail()`（命中明细，
 * 它复用 `useHistory()`），本地 / 登录双模式同源。
 */
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import BadgeDetailPanel from '../components/BadgeDetailPanel.vue';
import RarityBadge from '../components/RarityBadge.vue';
import { useBadgeDetail } from '../composables/useBadgeDetail';
import { useBadges } from '../composables/useBadges';
import { FAMILY_META } from '../lib/families';
import { formatCp } from '../lib/format';

const { families, totalCollected, totalCount, isCollected, badgesByFamily, isLoading } = useBadges();
const { detailOf } = useBadgeDetail();

/**
 * 已展开的徽章 id 集合（与 `HistoryList` 同款：整条是按钮、就地展开、允许多条同时展开）。
 * 状态只活在页面内，不进 URL、不持久化；刷新回到全折叠。
 */
const expandedIds = ref<ReadonlySet<string>>(new Set());

function toggleBadge(id: string): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

/** 进度条宽度按百分比；总数为 0 时兜底 0，避免 NaN。 */
function progressPercent(collected: number, total: number): string {
  if (total <= 0) return '0%';
  return `${(collected / total) * 100}%`;
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-neutral-50">徽章图鉴</h1>
      <p class="mt-1 text-sm text-neutral-500">
        每一天的颜色都会命中若干枚徽章，抽到什么就是什么——这里记录你已经拿到了哪些。
      </p>
    </header>

    <p v-if="isLoading && totalCollected === 0" class="text-sm text-neutral-500">正在读取…</p>

    <!-- ① 总进度 -->
    <section
      class="rounded-2xl border border-ink-700 bg-ink-900 p-4"
      aria-label="收集进度"
      data-testid="total-progress"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <p class="text-xs uppercase tracking-widest text-neutral-500">总进度</p>
        <p class="font-mono text-2xl font-bold text-neutral-50">
          {{ totalCollected }}<span class="mx-1 text-neutral-500">/</span>{{ totalCount }}
        </p>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-ink-800" role="presentation">
        <div
          class="h-full rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500 transition-[width] duration-500"
          :style="{ width: progressPercent(totalCollected, totalCount) }"
          data-testid="progress-fill"
        ></div>
      </div>
      <p class="mt-2 text-xs text-neutral-500">
        已收集 {{ totalCollected }} 枚，还有 {{ totalCount - totalCollected }} 枚等你抽到。
      </p>
    </section>

    <!-- ④ 空状态：一条都没收集时额外给一句鼓励 + 去今日页的入口（图鉴主体照常渲染） -->
    <section
      v-if="totalCollected === 0"
      class="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-6 text-center"
      data-testid="empty-state"
    >
      <p class="text-sm text-neutral-400">
        还没有收集到任何徽章。去抽一次今天的颜色，看看它会命中哪些规则。
      </p>
      <RouterLink
        to="/"
        class="mt-4 inline-flex rounded-xl bg-ink-800 px-5 py-2.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-ink-700"
      >
        去今日取色
      </RouterLink>
    </section>

    <!-- ② 家族分组 -->
    <section
      v-for="group in badgesByFamily"
      :key="group.family"
      class="rounded-2xl border border-ink-700 bg-ink-900 p-4"
      :aria-label="`${FAMILY_META[group.family].label}家族`"
      data-testid="family-section"
      :data-family="group.family"
    >
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span
          class="h-3 w-3 shrink-0 rounded-full border border-white/10"
          :style="{ backgroundColor: FAMILY_META[group.family].color }"
          aria-hidden="true"
        ></span>
        <h2 class="text-sm font-semibold uppercase tracking-widest text-neutral-300">
          {{ FAMILY_META[group.family].label }}家族
        </h2>
        <span class="ml-auto font-mono text-xs text-neutral-500" data-testid="family-progress">
          {{
            families.find(progress => progress.family === group.family)?.collected ?? 0
          }}
          /
          {{ group.badges.length }}
        </span>
      </div>

      <ul class="space-y-2">
        <!-- ③ 每条徽章 -->
        <li
          v-for="badge in group.badges"
          :key="badge.id"
          class="overflow-hidden rounded-xl border"
          :class="
            isCollected(badge.id)
              ? 'border-ink-700 bg-ink-900'
              : 'border-dashed border-ink-700/70 bg-ink-900/40 opacity-60 saturate-50'
          "
          data-testid="badge-item"
          :data-badge-id="badge.id"
          :data-collected="isCollected(badge.id) ? 'true' : 'false'"
        >
          <button
            type="button"
            class="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-ink-800/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-400"
            :aria-expanded="expandedIds.has(badge.id)"
            :aria-label="`${expandedIds.has(badge.id) ? '收起' : '展开'} ${badge.name} 详情`"
            @click="toggleBadge(badge.id)"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="font-medium"
                  :class="isCollected(badge.id) ? 'text-neutral-100' : 'text-neutral-400'"
                >
                  {{ badge.name }}
                </span>
                <!-- 未获得：连稀有度都不透露，只留名称 -->
                <template v-if="isCollected(badge.id)">
                  <RarityBadge :rarity="badge.rarity" size="sm" />
                </template>
                <span
                  v-else
                  class="rounded-full border border-ink-700 px-2 py-0.5 text-xs text-neutral-500"
                >
                  未获得
                </span>
              </div>
              <!-- 未获得：判定条件不显示（保留「发现」的乐趣） -->
              <p v-if="isCollected(badge.id)" class="mt-1 text-sm text-neutral-400">
                {{ badge.description }}
              </p>
            </div>
            <!-- 未获得：CP 不显示 -->
            <span
              v-if="isCollected(badge.id)"
              class="shrink-0 font-mono text-sm text-neutral-300"
              data-testid="badge-cp"
            >
              {{ formatCp(badge.cp) }}
            </span>
            <span class="w-3 shrink-0 text-center text-xs text-neutral-500" aria-hidden="true">
              {{ expandedIds.has(badge.id) ? '▾' : '▸' }}
            </span>
          </button>

          <!-- 就地展开的详情；未获得时只有名称与「未获得」（见 BadgeDetailPanel） -->
          <BadgeDetailPanel
            v-if="expandedIds.has(badge.id)"
            :badge="badge"
            :detail="detailOf(badge.id)"
          />
        </li>
      </ul>
    </section>
  </div>
</template>
