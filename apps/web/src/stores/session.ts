/**
 * 会话状态（Pinia）。
 *
 * 承载**模式切换**（DESIGN 第 2 / 11 节）：本地模式 vs 登录模式。
 *
 * 两条架构规则在这里落地：
 *
 * 1. **登录模式绝不碰本地模式的存储键**（`huedle:daily` / `huedle:history` /
 *    `huedle:streak`）。本 store 只写 `huedle:token`，登录模式的结果一律走服务端
 *    （见 `composables/useDailyColor.ts` / `useHistory.ts`），因此登出后本地数据
 *    原封不动（DESIGN 11.3）。
 * 2. **启动时必须用 token 补回 userId**（`hydrate()`）。userId 只在内存里，
 *    刷新后 token 还在、userId 没了 → `isLoggedIn` 变 false，已登录用户会被
 *    静默打回本地模式。`hydrate()` 用 `GET /api/auth/me` 补回身份；
 *    401 表示 token 已过期或被撤销 → 清掉 token 回本地模式。
 *    **不存在用 localStorage 存 userId 的捷径**——那会绕过 token 校验。
 */
import { defineStore, getActivePinia } from 'pinia';
import { computed, ref } from 'vue';
import {
  ApiError,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  register as apiRegister,
  type ApiUser,
} from '../lib/api';
import { getAnonymousId } from '../lib/identity';
import { STORAGE_KEYS } from '../lib/storage';

function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEYS.token) ?? null;
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) globalThis.localStorage?.removeItem(STORAGE_KEYS.token);
    else globalThis.localStorage?.setItem(STORAGE_KEYS.token, token);
  } catch {
    /* 存储不可用：仅内存态 */
  }
}

export const useSessionStore = defineStore('session', () => {
  const token = ref<string | null>(readToken());
  /**
   * 登录身份。**只在内存里**，只能由 `hydrate()` / `login()` / `registerUser()`
   * 写入——刻意不持久化，见文件头规则 2。
   */
  const userId = ref<string | null>(null);
  const userName = ref<string | null>(null);
  /**
   * 是否已经完成一次启动身份恢复。
   *
   * 无 token 时初始即为 `true`（本地模式无需等待）；有 token 时保持 `false`
   * 直到 `hydrate()` 落地，`App.vue` 据此延后渲染路由内容，避免子组件在
   * 身份还没补回来时读成本地模式。
   */
  const hydrated = ref(token.value === null);
  /**
   * 全局一次性提示（如「登录状态已失效，已切换回本地模式」）。
   *
   * 放在 store 而不是 composable 里：401 回退会让 `App.vue` 按模式重建路由内容，
   * composable 实例随之销毁——提示必须活得比它久。由 `App.vue` 统一展示。
   */
  const notice = ref<string | null>(null);

  const isLoggedIn = computed(() => token.value !== null && userId.value !== null);
  const mode = computed<'local' | 'user'>(() => (isLoggedIn.value ? 'user' : 'local'));
  const anonymousId = computed(() => getAnonymousId());

  function setNotice(message: string): void {
    notice.value = message;
  }

  function clearNotice(): void {
    notice.value = null;
  }

  /** 写入登录态（登录 / 注册成功后调用）。 */
  function setSession(nextToken: string, user: ApiUser): void {
    token.value = nextToken;
    userId.value = user.id;
    userName.value = user.name;
    hydrated.value = true;
    notice.value = null;
    writeToken(nextToken);
  }

  /**
   * 本地清空登录态（**不打后端**）：401 回退、登出都走这里。本地数据一律不动。
   *
   * **不清 `notice`**：401 回退的提示需要跨过"按模式重建路由内容"活下来。
   * 登录成功（`setSession`）与主动登出（`logout`）会清掉它。
   */
  function clearSession(): void {
    token.value = null;
    userId.value = null;
    userName.value = null;
    hydrated.value = true;
    writeToken(null);
  }

  /**
   * 用已有 token 向服务端补回 userId / userName。
   *
   * - 无 token → 本地模式，返回 `false`；
   * - `me` 成功 → 登录模式，返回 `true`；
   * - `me` 返回 401 → token 已失效，清掉并回本地模式，返回 `false`；
   * - 网络错误 → **保留 token**（可能只是后端没起），本次回退本地模式，返回 `false`，
   *   下次启动再试。
   *
   * 幂等：已成功恢复过的会话直接返回，不重复请求。
   */
  async function hydrate(): Promise<boolean> {
    const current = token.value;
    if (current === null) {
      userId.value = null;
      userName.value = null;
      hydrated.value = true;
      return false;
    }
    if (userId.value !== null) {
      hydrated.value = true;
      return true;
    }

    try {
      const user = await apiMe(current);
      if (token.value !== current) return isLoggedIn.value; // 期间被登出 / 换了账户
      userId.value = user.id;
      userName.value = user.name;
      hydrated.value = true;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        return false;
      }
      // 网络 / 服务端错误：保留 token 以便下次重试，本次按本地模式运行。
      hydrated.value = true;
      return false;
    }
  }

  /** 登录：成功后切到登录模式；失败原样抛出 `ApiError` 供页面展示。 */
  async function login(name: string, password: string): Promise<ApiUser> {
    const result = await apiLogin(name, password);
    setSession(result.token, result.user);
    return result.user;
  }

  /** 注册：与登录同构，成功后直接登录。 */
  async function registerUser(name: string, password: string): Promise<ApiUser> {
    const result = await apiRegister(name, password);
    setSession(result.token, result.user);
    return result.user;
  }

  /**
   * 登出：**真的调后端**撤销 token，然后回到本地模式。
   *
   * 顺序刻意为「先清本地、再打后端」：后端登出失败（网络断了、token 已失效）
   * 也不能把用户卡在登录态里。本地模式的 `huedle:daily` / `huedle:history` /
   * `huedle:streak` 全程未被写过，所以登出后本地历史与今日结果原样恢复（11.3）。
   */
  async function logout(): Promise<void> {
    const current = token.value;
    clearSession();
    notice.value = null;
    if (current === null) return;
    try {
      await apiLogout(current);
    } catch {
      /* 后端登出失败也要清本地 —— 见上方注释 */
    }
  }

  return {
    token,
    userId,
    userName,
    hydrated,
    notice,
    isLoggedIn,
    mode,
    anonymousId,
    setSession,
    clearSession,
    setNotice,
    clearNotice,
    hydrate,
    login,
    registerUser,
    logout,
  };
});

/** 只读的会话快照：composable 用它分叉，不持有 store 引用。 */
export interface SessionSnapshot {
  isLoggedIn: boolean;
  token: string | null;
  userId: string | null;
  userName: string | null;
}

const LOCAL_SESSION: SessionSnapshot = {
  isLoggedIn: false,
  token: null,
  userId: null,
  userName: null,
};

/**
 * 当前会话快照。
 *
 * 没有 Pinia 上下文时（纯函数单测、非组件环境）降级为「未登录」，
 * **不抛异常**——取值方因此可以无条件调用它，不必先判断环境。
 * 在组件的 `computed` 里调用它会正常订阅 store 的响应式依赖。
 */
export function currentSession(): SessionSnapshot {
  const pinia = getActivePinia();
  if (!pinia) return LOCAL_SESSION;

  const store = useSessionStore(pinia);
  return {
    isLoggedIn: store.isLoggedIn,
    token: store.token,
    userId: store.userId,
    userName: store.userName,
  };
}

/**
 * 收到 401 时把会话清掉（回退本地模式），并留下一条提示。
 *
 * 与 `logout()` 的区别：**不打后端**——token 已经失效，再发一次登出没有意义。
 */
export function clearSessionOnUnauthorized(): void {
  const pinia = getActivePinia();
  if (!pinia) return;
  const store = useSessionStore(pinia);
  store.clearSession();
  store.setNotice('登录状态已失效，已切换回本地模式。');
}

/** 当前的一次性提示（响应式读取；无 Pinia 时返回 null）。 */
export function currentNotice(): string | null {
  const pinia = getActivePinia();
  if (!pinia) return null;
  return useSessionStore(pinia).notice;
}
