/**
 * 路由与导航测试（任务 B）。
 *
 *   - `/me` 是新主页，「我的」导航项指向它；
 *   - `/history` 保留为**跳转到 `/me` 的重定向**（有人可能存了书签），不是 404；
 *   - 导航高亮：重定向落到 `/me` 之后，「我的」这一项必须是 active 的。
 *
 * 用 `createMemoryHistory` 单独建一个 router，不碰真实地址栏，避免测试间互相影响。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import AppComponent from './App.vue';
import { routes } from './router';

let app: App | null = null;
let host: HTMLDivElement | null = null;

function mountApp(): { router: Router; el: HTMLDivElement } {
  const router = createRouter({ history: createMemoryHistory(), routes });
  const instance = createApp(AppComponent);
  instance.use(createPinia());
  instance.use(router);

  host = document.createElement('div');
  document.body.appendChild(host);
  instance.mount(host);
  app = instance;

  return { router, el: host };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  app?.unmount();
  app = null;
  host?.remove();
  host = null;
});

describe('路由表', () => {
  it('新增 /me（name=me，title=我的），指向个人主页', () => {
    const me = routes.find(route => route.name === 'me');

    expect(me?.path).toBe('/me');
    expect(me?.meta?.title).toBe('我的');
    expect(me?.component).toBeDefined();
  });

  it('/history 是重定向到 /me，不是被删掉的 404', () => {
    const history = routes.find(route => route.path === '/history');

    expect(history).toBeDefined();
    expect(history?.redirect).toEqual({ name: 'me' });
    expect(history?.component).toBeUndefined();
  });

  it('/history 解析后就是 /me（书签不失效）', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/history');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('me');
    expect(router.currentRoute.value.path).toBe('/me');
    expect(router.currentRoute.value.meta.title).toBe('我的');
  });
});

describe('导航', () => {
  it('导航项是 今日 / 我的 / 图鉴 / 关于，「历史」已被「我的」取代', async () => {
    const { router, el } = mountApp();
    await router.push('/me');
    await router.isReady();
    await nextTick();

    const labels = [...el.querySelectorAll('nav a')].map(link => link.textContent?.trim());
    expect(labels).toEqual(['今日', '我的', '图鉴', '关于']);
  });

  it('访问 /history（重定向到 /me）后，「我的」这一项高亮正确', async () => {
    const { router, el } = mountApp();
    await router.push('/history');
    await router.isReady();
    await nextTick();

    expect(router.currentRoute.value.path).toBe('/me');

    const links = [...el.querySelectorAll('nav a')];
    const me = links.find(link => link.getAttribute('href') === '/me');
    const today = links.find(link => link.getAttribute('href') === '/');

    // 用 classList 精确判断：`hover:bg-ink-800` 是另一个 class token，不算高亮
    expect(me).toBeDefined();
    expect(me!.classList.contains('bg-ink-800')).toBe(true);
    expect(today!.classList.contains('bg-ink-800')).toBe(false);
  });

  it('未登录时头部保留一个明显的「登录」入口（去 /login）', async () => {
    const { router, el } = mountApp();
    await router.push('/me');
    await router.isReady();
    await nextTick();

    const login = [...el.querySelectorAll('a')].find(link => link.getAttribute('href') === '/login');
    expect(login).toBeDefined();
    expect(login!.textContent?.trim()).toBe('登录');
  });
});
