<script setup lang="ts">
/** 规则说明。只讲玩家需要知道的，机制细节留给 docs/。 */
import { RARITY_ORDER, rarityStyle } from '../lib/rarity';
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold text-neutral-50">关于 HueDle</h1>

    <section class="space-y-2 rounded-2xl border border-ink-700 bg-ink-900 p-5 text-sm text-neutral-300">
      <h2 class="font-semibold text-neutral-100">每日一色</h2>
      <p>每天 00:00 UTC，每位玩家独立获得一种 24 位真彩色。</p>
      <p>本地模式跟随这台设备，登录后跟随账户——所以换个设备，今天的颜色就换了。</p>
    </section>

    <section class="space-y-2 rounded-2xl border border-ink-700 bg-ink-900 p-5 text-sm text-neutral-300">
      <h2 class="font-semibold text-neutral-100">徽章与分值</h2>
      <p>每种颜色都有机会命中一堆规则，每条规则就是一枚徽章。越难命中的规则，分值越高。</p>
      <p>命中的徽章都会加分；同一条规则的不同强度档位只算最强的那一条。</p>
    </section>

    <section class="space-y-3 rounded-2xl border border-ink-700 bg-ink-900 p-5">
      <h2 class="text-sm font-semibold text-neutral-100">稀有度</h2>
      <ul class="flex flex-wrap gap-2">
        <li v-for="rarity in RARITY_ORDER" :key="rarity">
          <span
            class="inline-flex items-center gap-2 rounded-full border border-ink-700 px-3 py-1 text-sm"
          >
            <span class="h-3 w-3 rounded-full" :class="rarityStyle(rarity).swatch" />
            {{ rarityStyle(rarity).label }}
          </span>
        </li>
      </ul>
      <p class="text-xs text-neutral-500">
        由分数在全部 1677 万种颜色中的位置决定——神话只占其中最高的 1%。
      </p>
    </section>
  </div>
</template>
