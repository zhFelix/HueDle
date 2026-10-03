<script setup lang="ts">
/**
 * 老虎机式揭晓（见 docs/DESIGN.md 第 8 节「抽出即定」）。
 *
 * ⚠️ **这不是抽取，只是揭晓**。
 *
 * `target` 是调用方早就用纯函数 `getDailyColorInfo(identity, date)` 算好的颜色，
 * 本组件**只负责把它演出来**：滚动期间那六个随机字符是**纯装饰**，
 * 它们不参与任何计算、不回写任何状态，最终每一位都必须精确落在 `target.hex`
 * 对应的字符上。组件没有任何改变结果的入口——改它之前请先想清楚这一点。
 *
 * 时序（手感参数，总时长约 2.0s，落在要求的 1.8–2.4s 内）：
 *   - `SPIN_MS = 1300`：六位全速滚动；
 *   - `LOCK_STEP_MS = 120`：从第 1300ms 起，从左到右每隔 120ms 停住一位，
 *     最后一位在 1300 + 5×120 = 1900ms 停住；
 *   - `SETTLE_DELAY_MS = 80`：全停后 80ms 发 `settled` → 约 1980ms。
 * 减速感来自"接近自己的停位时翻牌周期变长"：
 *   距停位 > `DECEL_WINDOW_MS(420ms)` 时每 `BASE_FLIP_MS(45ms)` 换一次，
 *   之后线性放慢到 `45 + 130 = 175ms` 一次。
 *
 * 全部由 `requestAnimationFrame` 驱动，**不持有 setTimeout**；
 * `onUnmounted` 会取消未完成的帧，卸载 / 路由切换都不会留下跑着的循环。
 */
import type { ColorInfo } from '@huedle/shared';
import { onMounted, onUnmounted, ref } from 'vue';

const props = withDefaults(defineProps<{ target: ColorInfo; modelValue?: string | null }>(), {
  modelValue: null,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'settled'): void;
}>();

/** 滚动总时长：六位都还在换字符的阶段。 */
const SPIN_MS = 1300;
/** 每秒一位的停止间隔（左 → 右）。 */
const LOCK_STEP_MS = 120;
/** 最后一位停住后再等一小会儿才宣告 settled，避免"最后一帧即结果"的突兀感。 */
const SETTLE_DELAY_MS = 80;
/** 全速阶段每位的换字周期。 */
const BASE_FLIP_MS = 45;
/** 距停位多近开始减速。 */
const DECEL_WINDOW_MS = 420;
/** 减速阶段最多把换字周期拉长多少。 */
const DECEL_EXTRA_MS = 130;

const SLOT_COUNT = 6;
const HEX_CHARS = '0123456789ABCDEF';

/** 目标六位字符（大写、去掉 `#`）；hex 异常时退化为 000000，绝不抛。 */
const targetChars: string[] = (() => {
  const raw = props.target.hex.replace('#', '').toUpperCase();
  const chars = raw.split('').filter(ch => HEX_CHARS.includes(ch));
  if (chars.length !== SLOT_COUNT) return Array.from({ length: SLOT_COUNT }, () => '0');
  return chars;
})();

function randomChar(): string {
  return HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)]!;
}

/** 屏幕上的六位字符。滚动时是装饰性随机值，停住后是 `targetChars` 的对应位。 */
const chars = ref<string[]>(Array.from({ length: SLOT_COUNT }, () => randomChar()));
const locked = ref<boolean[]>(Array.from({ length: SLOT_COUNT }, () => false));
/** 只播报"开始 / 结束"两次状态，滚动期间不逐帧更新，避免屏幕阅读器刷屏。 */
const announcement = ref('');

let rafId: number | null = null;
let startTime: number | null = null;
let settled = false;

/** 每一位的解锁时刻：1300ms 起每 120ms 停一位。 */
function lockAt(index: number): number {
  return SPIN_MS + index * LOCK_STEP_MS;
}

/** 最后一位停住 + 缓冲：超过它就可以宣告结束。 */
const settleAt = lockAt(SLOT_COUNT - 1) + SETTLE_DELAY_MS;

/** 每位自己的下一次换字时刻（减速用）。 */
const nextFlipAt = Array.from({ length: SLOT_COUNT }, () => 0);

function currentHex(): string {
  return `#${chars.value.join('')}`;
}

function emitHex(): void {
  emit('update:modelValue', currentHex());
}

/** 落定：六位精确写入 `targetChars`，只在这里发一次 `settled`。 */
function finish(): void {
  if (settled) return;
  settled = true;
  locked.value = Array.from({ length: SLOT_COUNT }, () => true);
  chars.value = [...targetChars];
  emitHex();
  announcement.value = '今日颜色已揭晓';
  emit('settled');
}

function prefersReducedMotion(): boolean {
  const mm = globalThis.matchMedia;
  if (typeof mm !== 'function') return false;
  try {
    return mm.call(globalThis, '(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function frame(now: number): void {
  rafId = null;
  if (startTime === null) startTime = now;
  const elapsed = now - startTime;
  let changed = false;

  for (let i = 0; i < SLOT_COUNT; i += 1) {
    if (locked.value[i]) continue;

    const due = lockAt(i);
    if (elapsed >= due) {
      // 停位：写入的是 target 的对应字符，不是随机值。
      locked.value[i] = true;
      chars.value[i] = targetChars[i]!;
      changed = true;
      continue;
    }

    const timeToLock = due - elapsed;
    const period =
      timeToLock >= DECEL_WINDOW_MS
        ? BASE_FLIP_MS
        : BASE_FLIP_MS + (1 - timeToLock / DECEL_WINDOW_MS) * DECEL_EXTRA_MS;

    if (elapsed >= nextFlipAt[i]!) {
      chars.value[i] = randomChar();
      nextFlipAt[i] = elapsed + period;
      changed = true;
    }
  }

  if (changed) emitHex();

  if (elapsed >= settleAt) {
    finish();
    return;
  }

  rafId = requestAnimationFrame(frame);
}

onMounted(() => {
  if (prefersReducedMotion()) {
    // 尊重系统设置：不播动画，直接给最终 HEX 并立刻 settled。
    announcement.value = '正在揭晓今日颜色';
    finish();
    return;
  }
  announcement.value = '正在揭晓今日颜色';
  emitHex();
  rafId = requestAnimationFrame(frame);
});

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <p class="text-xs uppercase tracking-widest text-neutral-500">正在揭晓</p>

    <!--
      滚动中的字符对辅助技术隐藏：逐帧变化的文本会让屏幕阅读器念一堆乱码。
      真正播报状态的是下面那个 aria-live 区域，且只在开始 / 结束时更新一次。
    -->
    <div class="font-mono text-4xl font-bold tracking-widest text-neutral-50 sm:text-5xl" aria-hidden="true">
      <span class="text-neutral-500">#</span>
      <span
        v-for="(char, index) in chars"
        :key="index"
        class="inline-block w-[0.72em] text-center tabular-nums transition-colors"
        :class="locked[index] ? 'text-neutral-50' : 'text-amber-200/80'"
        >{{ char }}</span
      >
    </div>

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </div>
</template>
