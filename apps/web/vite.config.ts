import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  test: {
    // localStorage 需要 DOM 环境：本地模式的身份与存储层全在这里测。
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
