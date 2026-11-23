import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.scratch', '.wrangler'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.worker,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  // 搬家腳本（scripts/）是在本機用 Node 跑的 JavaScript，不在 Worker 的 TypeScript 專案裡（.d.mts 是給 node/ 引用的型別宣告）。
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.d.mts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: globals.node },
  },
  // 前端（app/）跑在瀏覽器；型別檢查用 app/tsconfig.json。
  {
    files: ['app/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  // app/public/ 是原樣複製的 JavaScript（例如 theme-init.js），不經過 TypeScript。
  {
    files: ['app/public/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: globals.browser, sourceType: 'script' },
  },
  // 官網與文件站（site/assets/）的小互動，原樣複製到 dist/site/，不經過 TypeScript。
  {
    files: ['site/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: globals.browser, sourceType: 'script' },
  },
);
