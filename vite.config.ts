import { defineConfig } from 'vitest/config';

// 測試：Worker（worker/）與前端（app/）一起跑。前端的 Vite 設定在 vite.app.config.ts。
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['worker/**/*.test.ts', 'node/**/*.test.ts', 'app/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
