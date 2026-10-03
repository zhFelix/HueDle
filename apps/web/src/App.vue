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
 * 启动时用 token 补回 userId（规则 2）。
 *
 * 有 token 时 `session.hydrated` 初始为 false，路由内容延后到身份补回之后再渲染，
 * 避免子组件在「看似未登录」时读成本地模式；`/api/auth/me` 返回 401 则清 token 回本地。
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

      <!-- 身份未恢复前不渲染路由内容：避免子组件先把登录态读成本地模式 -->
      <p v-if="!session.hydrated" class="text-sm text-neutral-500">正在恢复登录状态…</p>
      <!--
        key 绑在登录态上：登录 / 登出后重建页面组件，页面数据源随之切换。
        否则登出后历史页会继续显示账户数据（本页 composable 不会自己重读）。
      -->
      <RouterView v-else :key="session.isLoggedIn ? 'user' : 'local'" />
    </main>
  </div>
</template>
