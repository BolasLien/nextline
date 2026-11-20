import type { Database } from '../core/database';
// /app-api/*：給瀏覽器（app/ 的 React App）用的同一套 API（docs/auth.md）。
//
// 為什麼不直接用 /api：/api/* 在 Cloudflare Access 是 Bypass，Access 不會補 Cf-Access-Jwt-Assertion，
// 而官方建議驗 header、不要靠 CF_Authorization cookie（cookie 不保證會帶）。/app-api 不在 Bypass 裡，
// 由 workers.dev 的 Access application 在邊緣擋住，再由 Worker 驗 header 的 JWT（../web/access.ts）。
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
//
// - 不接受 Bearer token；agent 照舊用 /api。
// - 寫入（GET／HEAD／OPTIONS 以外）防 CSRF：Origin 必須是本站、Sec-Fetch-Site 有帶時必須是 same-origin。
// - 驗證失敗一律回 401 JSON（前端看到就請 Bolas 重新登入），不回 HTML。
import { type AccessEnv, checkAccess } from '../web/access';
import { isSafeMethod, isSameOrigin } from '../web/csrf';
import { errorResponse } from './http';
import { routeApi } from './index';

export const APP_API = '/app-api';

export interface BrowserApiEnv extends AccessEnv {
  DB: Database;
}

export async function handleBrowserApi(request: Request, env: BrowserApiEnv, url: URL): Promise<Response> {
  const access = await checkAccess(request, env, url);
  if (!access.ok) {
    return withNoStore(errorResponse(401, '登入過期了，重新整理頁面再登入一次。', { reason: access.reason }));
  }
  if (!isSafeMethod(request.method) && !isSameOrigin(request, url)) {
    return withNoStore(errorResponse(403, '請從 Nextline 網頁送出（來源不符）'));
  }
  return withNoStore(await routeApi(request, env.DB, url));
}

// 回應帶使用者資料，不給瀏覽器或中間快取存。
function withNoStore(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
