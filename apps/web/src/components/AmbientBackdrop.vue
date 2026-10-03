<script setup lang="ts">
/**
 * 跟随 HEX 的页面环境光（只在「今日」页使用，见 Home.vue）。
 *
 * 实现方式是 **CSS 变量式的 `background-color` + 静态径向遮罩**，
 * 而不是拼 Tailwind 动态类名（v4 扫不到运行时字符串），也不是直接换
 * `background-image` 渐变（渐变之间无法平滑过渡）。
 *
 * 可读性保障：
 *  - 底色仍是 `body` 的 `#08090c`，这里只叠一层 **低透明度（0.22）** 的色彩；
 *  - 用径向 / 线性遮罩把光晕压在视口边缘，越往内容区越透明；
 *  - 页面所有正文都包在 `bg-ink-900`（不透明）的卡片里，不受背景影响。
 */
import { parseHex } from '@huedle/shared';
import { computed } from 'vue';

const props = withDefaults(defineProps<{ hex?: string | null }>(), { hex: null });

/** 当前 hex 的低透明度着色；hex 为 null / 非法时完全透明。 */
const tint = computed(() => {
  const rgb = props.hex ? parseHex(props.hex) : null;
  if (!rgb) return 'rgba(0, 0, 0, 0)';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`;
});
</script>

<template>
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <!-- 顶部柔光：径向，最亮处也只有 0.22 alpha -->
    <div
      class="ambient-glow absolute inset-0 transition-[background-color] duration-700 ease-out"
      :style="{ backgroundColor: tint }"
    />
    <!-- 极淡的整体氛围：更低的不透明度 + 线性遮罩，避免整体提亮 -->
    <div
      class="ambient-wash absolute inset-0 transition-[background-color] duration-700 ease-out"
      :style="{ backgroundColor: tint }"
    />
  </div>
</template>

<style scoped>
.ambient-glow {
  -webkit-mask-image: radial-gradient(120% 80% at 50% 0%, #000 0%, rgba(0, 0, 0, 0.5) 45%, transparent 76%);
  mask-image: radial-gradient(120% 80% at 50% 0%, #000 0%, rgba(0, 0, 0, 0.5) 45%, transparent 76%);
}

.ambient-wash {
  opacity: 0.3;
  -webkit-mask-image: linear-gradient(to bottom, transparent 35%, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 35%, #000 100%);
}

@media (prefers-reduced-motion: reduce) {
  .ambient-glow,
  .ambient-wash {
    transition: none;
  }
}
</style>
