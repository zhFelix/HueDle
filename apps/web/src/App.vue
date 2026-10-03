<script setup lang="ts">
/** 应用外壳：顶部导航 + 路由出口。 */
import { computed, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useSessionStore } from './stores/session';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const links = [
  { to: '/', label: '今日' },
  { to: '/history', label: '历史' },
  { to: '/badges', label: '图鉴' },
  { to: '/about', label: '关于' },
];

const isLoggedIn = computed(() => session.isLoggedIn);
const modeLabel = computed(() => (isLoggedIn.value ? '登录模式' : '本地模式'));
const currentTitle = computed(() => String(route.meta.title ?? 'HueDle'));

/**
 * 后台核对登录态（规则 2）。
 *
 * 首屏**不再等它**：有 `huedle:identity` 缓存时 store 初始化就用缓存身份按登录模式
 * 渲染，路由内容立即挂载；这里只负责在后台调 `GET /api/auth/me` 核对，
 * 成功后用服务端结果覆盖缓存（用户名可能改过），401 则清 token + 身份缓存回本地。
 * 身份变化会通过下方 RouterView 的 key 重建页面，页面数据随之切到正确的账户。
 */
onMounted(() => {
  void session.hydrate();
});

async function handleLogout(): Promise<void> {
  await session.logout();
  if (route.name === 'login') await router.push('/');
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-16">
    <header class="sticky top-0 z-10 -mx-4 border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur">
      <div class="flex items-center justify-between gap-4">
        <RouterLink to="/" class="font-mono text-lg font-bold tracking-tight text-neutral-50">
          Hue<span class="text-amber-400">Dle</span>
        </RouterLink>
        <div class="flex items-center gap-3">
          <span class="rounded-full border border-ink-700 px-3 py-1 text-xs text-neutral-400">
            {{ modeLabel }}
          </span>

          <!-- 已登录：用户名 + 登出；未登录：登录链接 -->
          <template v-if="isLoggedIn">
            <span class="font-mono text-xs text-neutral-300">
              {{ session.userName ?? session.userId }}
            </span>
            <button
              type="button"
              class="text-xs text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline"
              @click="handleLogout"
            >
              登出
            </button>
          </template>
          <RouterLink
            v-else
            to="/login"
            class="text-xs text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline"
          >
            登录
          </RouterLink>
        </div>
      </div>

      <nav class="mt-3 flex gap-1 text-sm">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="rounded-lg px-3 py-1.5 text-neutral-400 transition-colors hover:bg-ink-800 hover:text-neutral-100"
          active-class="bg-ink-800 text-neutral-50"
          :exact-active-class="link.to === '/' ? 'bg-ink-800 text-neutral-50' : undefined"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </header>

    <main class="flex-1 py-6">
      <h2 class="sr-only">{{ currentTitle }}</h2>

      <!-- 全局一次性提示（如 401 回退本地模式）。放在这里是因为它必须跨过按模式重建的路由内容。 -->
      <p
        v-if="session.notice"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300"
        role="status"
      >
        <span>{{ session.notice }}</span>
        <button
          type="button"
          class="rounded-lg border border-amber-900/60 px-3 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-950/50"
          @click="session.clearNotice()"
        >
          知道了
        </button>
      </p>

      <!--
        key 绑在登录态 + userId 上：登录 / 登出 / 换账户后重建页面组件，页面数据源随之切换。
        有身份缓存时不挡渲染——先用缓存身份挂载路由内容（0 请求），后台 `hydrate()` 核对；
        核对结果若换了 userId（或 401 回退本地），key 变化会重建页面并重读正确的数据源。
      -->
      <RouterView :key="session.isLoggedIn ? `user:${session.userId}` : 'local'" />
    </main>
  </div>
</template>
