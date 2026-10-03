<script setup lang="ts">
/**
 * 「开启今日颜色」按钮。
 *
 * 用真正的 `<button type="button">`，因此天然可 Tab 聚焦、可回车 / 空格触发；
 * focus-visible 才有焦点环（鼠标点击不闪），hover / active 有明确反馈。
 * 按钮**只负责通知用户点击**——它不做任何随机，也不改变结果（见 HexRoller 注释）。
 */
withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="inline-flex items-center gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-6 py-3 text-base font-semibold text-amber-200 transition-colors hover:border-amber-300/70 hover:bg-amber-400/20 active:bg-amber-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-neutral-500"
  >
    <slot>开启今日颜色</slot>
  </button>
</template>
