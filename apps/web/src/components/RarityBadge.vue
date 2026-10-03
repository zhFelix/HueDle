<script setup lang="ts">
/** 稀有度胶囊。7 档样式集中在 lib/rarity.ts，未知档位退到 common。 */
import type { BadgeRarity, ScoreRarity } from '@huedle/shared';
import { computed } from 'vue';
import { rarityStyle } from '../lib/rarity';

const props = withDefaults(
  defineProps<{ rarity: ScoreRarity | BadgeRarity; size?: 'sm' | 'md' }>(),
  { size: 'md' },
);

const style = computed(() => rarityStyle(props.rarity));
const sizeClass = computed(() => (props.size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'));
</script>

<template>
  <span
    class="inline-flex items-center rounded-full font-semibold tracking-wide"
    :class="[style.badge, sizeClass]"
  >
    {{ style.label }}
  </span>
</template>
