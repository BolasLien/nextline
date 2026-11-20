// 前端（app/）的 Vite 設定。測試用的設定在 vite.config.ts（vitest）。
//
// npm run build：建置到 dist/client，wrangler.jsonc 的 assets 從那裡提供。
// npm run dev：Node :3000 + Vite :5173；dev:cloudflare：Worker :8787 + Vite :5173。
// 只有 Cloudflare 開發代理改寫 Origin；Node 保留原始 Host/Origin 驗 CSRF。
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const WORKER = 'http://localhost:8787';

// 本機轉發時把 Origin 改成 Worker 的網址，/app-api 的 CSRF 檢查（Origin 要等於本站）才會過；只在 dev server 生效。
const toWorker = { target: WORKER, changeOrigin: true, headers: { Origin: WORKER } };
const nodeDev = process.env.NEXTLINE_NODE_DEV === '1';
// Preserve Origin/Host in Node mode; rewriting Origin would bypass the CSRF boundary.
const toBackend = nodeDev ? { target: 'http://127.0.0.1:3000', changeOrigin: false } : toWorker;

export default defineConfig({
  root: 'app',
  plugins: [react(), ...(nodeDev ? [{ name: 'local-auth', transformIndexHtml: (html: string) => html.replace('<html ', '<html data-auth="local" ') }] : [])],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // tokens.css 在 docs/design/system/，不在 app/ 底下
    fs: { allow: ['..'] },
    proxy: {
      '/app-api': toBackend,
      '/api': toBackend,
      '/mcp': toBackend,
      '/health': toBackend,
      '/legacy': toBackend,
      ...(nodeDev ? { '/auth': toBackend } : {}),
    },
  },
});
