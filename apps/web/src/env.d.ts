/// <reference types="vite/client" />

/** 构建期环境变量（见 apps/web/.env.example）。 */
interface ImportMetaEnv {
  /** 后端 API 根地址；缺省时 `lib/api.ts` 回落到 http://localhost:3001。 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
