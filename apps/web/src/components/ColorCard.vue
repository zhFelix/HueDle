<script setup lang="ts">
/**
 * 大色块 + HEX / RGB / HSL。
 * 色块用内联 style 上色（颜色是运行时数据，不能走 Tailwind 的静态类名）。
 */
import type { ColorInfo } from '@huedle/shared';
import { computed } from 'vue';
import { formatHsl, formatRgb } from '../lib/format';

const props = defineProps<{ color: ColorInfo; cp: string }>();

const swatchStyle = computed(() => ({ backgroundColor: props.color.hex }));
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">
    <div
      class="flex h-56 items-end justify-between p-5 sm:h-72"
      :style="swatchStyle"
      role="img"
      :aria-label="`今日颜色 ${props.color.hex}`"
    >
      <span
        class="rounded-lg bg-black/45 px-3 py-1 font-mono text-xl font-semibold tracking-wider text-white backdrop-blur-sm sm:text-3xl"
      >
        {{ props.color.hex }}
      </span>
      <span
        class="rounded-lg bg-black/45 px-3 py-1 font-mono text-sm text-white/90 backdrop-blur-sm sm:text-base"
      >
        {{ props.cp }} CP
      </span>
    </div>

    <dl class="grid grid-cols-1 gap-px bg-ink-700 sm:grid-cols-3">
      <div class="bg-ink-900 px-4 py-3">
        <dt class="text-xs uppercase tracking-widest text-neutral-500">HEX</dt>
        <dd class="font-mono text-sm text-neutral-100">{{ props.color.hex }}</dd>
      </div>
      <div class="bg-ink-900 px-4 py-3">
        <dt class="text-xs uppercase tracking-widest text-neutral-500">RGB</dt>
        <dd class="font-mono text-sm text-neutral-100">{{ formatRgb(props.color) }}</dd>
      </div>
      <div class="bg-ink-900 px-4 py-3">
        <dt class="text-xs uppercase tracking-widest text-neutral-500">HSL</dt>
        <dd class="font-mono text-sm text-neutral-100">{{ formatHsl(props.color.hsl) }}</dd>
      </div>
    </dl>
  </section>
</template>
