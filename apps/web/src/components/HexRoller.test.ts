import { colorInfoFromHex, type ColorInfo } from '@huedle/shared';
import { createApp, h, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HexRoller from './HexRoller.vue';

/**
 * HexRoller 的确定性测试。
 *
 * 不假造时间、不用 vitest 假计时器：直接把 `requestAnimationFrame` 换成一个
 * 手动泵，帧回调收到的时间戳也由我们给。因此既没有浮动时序，也**不会泄漏**——
 * 测试结束时 `frames` 必须为空，否则就是组件留下了跑着的循环。
 */

const TARGET: ColorInfo = colorInfoFromHex('#002FA7')!;

let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let cancelledIds: number[];

/** 推进到绝对时刻 `time` 并派发所有已排队的帧。 */
function step(time: number): void {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, callback] of pending) callback(time);
}

function mountRoller() {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const settled = vi.fn();
  const emitted: string[] = [];
  const app = createApp({
    render: () =>
      h(HexRoller, {
        target: TARGET,
        onSettled: settled,
        'onUpdate:modelValue': (value: string) => emitted.push(value),
      }),
  });
  app.mount(host);

  return { app, host, settled, emitted };
}

let mounted: App | null = null;

function mount(): ReturnType<typeof mountRoller> {
  const result = mountRoller();
  mounted = result.app;
  return result;
}

beforeEach(() => {
  frames = new Map();
  nextFrameId = 1;
  cancelledIds = [];

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelledIds.push(id);
    frames.delete(id);
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('HexRoller', () => {
  it('滚动期间排帧，最终精确停在 target，并且只 settled 一次', async () => {
    const { settled, emitted, host } = mount();

    expect(frames.size).toBe(1);
    step(0); // 第一帧只是起点
    expect(settled).not.toHaveBeenCalled();

    step(1_000); // 全速滚动阶段：还没有任何一位停住
    expect(settled).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/#[0-9A-F]{6}/);

    step(2_500); // 越过 settleAt(1980ms)
    await nextTick();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)).toBe('#002FA7');
    expect(host.textContent).toContain('#002FA7');
    // 结束之后不再排帧
    expect(frames.size).toBe(0);
  });

  it('重复派发已结束的循环不会二次 settled', () => {
    const { settled } = mount();
    step(0);
    step(3_000);
    expect(settled).toHaveBeenCalledTimes(1);

    step(4_000);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('卸载会取消未完成的帧，之后不再 settled', () => {
    const { app, settled } = mount();

    step(0);
    const pending = frames.size;
    expect(pending).toBe(1);

    app.unmount();
    mounted = null;

    expect(cancelledIds).toHaveLength(1);
    expect(frames.size).toBe(0);

    step(5_000); // 没有任何挂起的帧可跑
    expect(settled).not.toHaveBeenCalled();
  });

  it('prefers-reduced-motion: reduce → 不排帧，直接给最终 HEX 并立刻 settled', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const { settled, emitted, host } = mount();
    await nextTick();

    expect(frames.size).toBe(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)).toBe('#002FA7');
    expect(host.textContent).toContain('#002FA7');
  });
});
