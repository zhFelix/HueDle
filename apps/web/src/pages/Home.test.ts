/**
 * 首页（今日一色）组件测试（任务 A 的"顺手"部分）。
 *
 * 只钉一件事：**首页不再显示「连续天数」**——那个累计指标搬到了个人主页。
 * 用组件测试断言**真实渲染结果**里没有这个标签，而不是只 grep 源码
 * （源码注释里出现这个词是允许的）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import Home from './Home.vue';
import HomeSource from './Home.vue?raw';

let app: App | null = null;
let host: HTMLDivElement | null = null;

/** 等一轮宏任务，让 `onMounted` 里的 `load()` 落地。 */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  app?.unmount();
  app = null;
  host?.remove();
  host = null;
});

describe('首页', () => {
  it('不再渲染「连续天数」这个标签（累计统计只在「我的」页）', async () => {
    app = createApp(Home);
    app.use(createPinia());
    host = document.createElement('div');
    document.body.appendChild(host);
    app.mount(host);

    await nextTick();
    await flush();

    const text = host.textContent ?? '';
    expect(text).toContain('今日一色'); // 页面确实渲染出来了
    expect(text).not.toContain('连续天数');
    // 源码里也不该再有这个标签（注释里是允许的，这里只挡模板里的用法）
    expect(HomeSource).not.toContain('连续天数');
  });
});
