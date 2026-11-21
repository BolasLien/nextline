import { handleBrowserApi } from './api/browser';
import { D1Adapter } from './adapters/d1';
import { routeRequest } from './core/router';
import { handleSpa } from './web/spa';

export interface Env {
  DB: D1Database;
  // 靜態檔（app/ 建置到 dist/client，wrangler.jsonc 的 assets）。測試裡可以不給。
  ASSETS?: Fetcher;
  // wrangler secret（本機放 .dev.vars）。沒設定時 /api 一律回 401。
  API_TOKEN?: string;
  // wrangler vars：Cloudflare Access 的 team domain（例如 https://<team>.cloudflareaccess.com）與 application AUD。
  // 沒設定時網頁路徑與 /app-api 一律拒絕。
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // 只放 .dev.vars：設成 1 時，localhost 的網頁與 /app-api 請求跳過 Access 檢查（見 docs/auth.md）。
  DEV_SKIP_ACCESS?: string;
  // wrangler vars：「人」的名字（worker/api/owner.ts，NX-244），沒設定是「你」。
  OWNER_NAME?: string;
}

// 路徑與驗證方式的對照見 docs/auth.md：/api、/mcp 驗 token；/app-api 與其他網頁路徑驗 Cloudflare Access JWT；/legacy 只轉址到新網頁（NX-158）。
export default {
  async fetch(request, env): Promise<Response> {
    const core = { ...env, DB: new D1Adapter(env.DB) };
    return routeRequest(request, core, {
      browserApi: (req, url) => handleBrowserApi(req, core, url),
      page: (req, url) => handleSpa(req, env, url),
    });
  },
} satisfies ExportedHandler<Env>;
