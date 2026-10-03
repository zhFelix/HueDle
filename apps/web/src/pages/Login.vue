<script setup lang="ts">
/**
 * 登录 / 注册（DESIGN 第 9.1 / 11.5 节）。
 *
 * 三条约定：
 *  1. 客户端只做**基本**校验（用户名 3–32、密码 ≥ 8，与 `apps/api` 一致），
 *     真正的裁决在后端——后端返回的错误**如实展示**，不翻译、不吞掉。
 *  2. 提交中禁用按钮并显示加载态，避免重复提交（后端还有限流，429 也要能看见）。
 *  3. 成功后 `setSession` 已由 store 完成，这里只负责跳回今日页。
 *
 * §11.5 的说明文案是**界面要求**，不是装饰：本地抽了今天再登录会看到账户身份的
 * 今日颜色，那不是"多抽了一次"，而是两个身份各自的今日颜色。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../lib/api';
import { useSessionStore } from '../stores/session';

type Tab = 'login' | 'register';

const router = useRouter();
const session = useSessionStore();

const tab = ref<Tab>('login');
const name = ref('');
const password = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');

const isLoginTab = computed(() => tab.value === 'login');
const submitLabel = computed(() => (isLoginTab.value ? '登录' : '注册'));

const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'login', label: '登录' },
  { id: 'register', label: '注册' },
];

function switchTab(next: Tab): void {
  if (isSubmitting.value || tab.value === next) return;
  tab.value = next;
  errorMessage.value = '';
}

/** 与后端一致的**基本**校验；不做后端会做、且可能变化的事（如允许的字符集）。 */
function validate(): string {
  const trimmed = name.value.trim();
  if (trimmed.length < 3 || trimmed.length > 32) return '用户名需为 3–32 个字符';
  if (password.value.length < 8) return '密码至少 8 个字符';
  return '';
}

async function submit(): Promise<void> {
  if (isSubmitting.value) return;

  const invalid = validate();
  if (invalid) {
    errorMessage.value = invalid;
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = '';
  try {
    const trimmed = name.value.trim();
    if (isLoginTab.value) await session.login(trimmed, password.value);
    else await session.registerUser(trimmed, password.value);

    password.value = '';
    await router.push('/');
  } catch (error) {
    // 后端的错误如实展示（INVALID_CREDENTIALS / NAME_TAKEN / RATE_LIMITED / 网络…）。
    errorMessage.value =
      error instanceof ApiError ? error.message : '操作失败，请稍后重试。';
  } finally {
    isSubmitting.value = false;
  }
}

async function handleLogout(): Promise<void> {
  await session.logout();
  errorMessage.value = '';
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-neutral-50">登录</h1>
      <p class="mt-1 text-sm text-neutral-500">
        登录后，颜色和历史在任何设备上都能看到。
      </p>
    </header>

    <!-- 已登录：不显示表单，只显示身份与登出 -->
    <section
      v-if="session.isLoggedIn"
      class="rounded-2xl border border-ink-700 bg-ink-900 p-6"
      aria-label="当前登录状态"
    >
      <p class="text-sm text-neutral-300">
        已登录为
        <span class="font-mono text-neutral-50">{{ session.userName ?? session.userId }}</span>
      </p>
      <div class="mt-4">
        <button
          type="button"
          class="rounded-xl border border-ink-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-ink-800"
          @click="handleLogout"
        >
          登出
        </button>
      </div>
    </section>

    <template v-else>
      <!-- 登录 / 注册 切换 -->
      <div class="flex gap-1 rounded-xl border border-ink-800 bg-ink-900/60 p-1" role="tablist">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="tab === item.id"
          class="flex-1 rounded-lg px-4 py-2 text-sm transition-colors"
          :class="
            tab === item.id
              ? 'bg-ink-800 text-neutral-50'
              : 'text-neutral-400 hover:text-neutral-100'
          "
          @click="switchTab(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <form class="space-y-4 rounded-2xl border border-ink-700 bg-ink-900 p-6" @submit.prevent="submit">
        <div>
          <label for="account-name" class="block text-xs uppercase tracking-widest text-neutral-500">
            用户名
          </label>
          <input
            id="account-name"
            v-model="name"
            type="text"
            name="username"
            autocomplete="username"
            :disabled="isSubmitting"
            class="mt-2 w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-60"
            placeholder="3–32 个字符"
          />
        </div>

        <div>
          <label
            for="account-password"
            class="block text-xs uppercase tracking-widest text-neutral-500"
          >
            密码
          </label>
          <input
            id="account-password"
            v-model="password"
            type="password"
            name="password"
            :autocomplete="isLoginTab ? 'current-password' : 'new-password'"
            :disabled="isSubmitting"
            class="mt-2 w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-60"
            placeholder="至少 8 个字符"
          />
        </div>

        <!-- 后端错误如实展示 -->
        <p
          v-if="errorMessage"
          class="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-xl bg-ink-800 px-5 py-2.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? '提交中…' : submitLabel }}
        </button>
      </form>
    </template>
  </div>
</template>
