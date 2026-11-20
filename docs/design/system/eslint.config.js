// 設計系統資料夾自己的 ESLint 設定（ESLint 10 會從檔案所在資料夾往上找最近的設定）。
// tokens.ts 照 repo 的嚴格型別規則檢查；build.mjs、contrast.mjs 是本機用 Node 跑的腳本，比照根目錄 scripts/ 的做法。
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: globals.node },
  },
);
