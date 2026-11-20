// 新網頁（app/ 的 React App）：/api、/app-api、/mcp、/health、/legacy（轉址）以外的所有路徑。
// wrangler.jsonc 設 assets.run_worker_first = true，所以靜態檔也先經過這裡：先驗 Access JWT（跟 /app-api 同一套），
// 過了才交給 env.ASSETS；找不到的路徑由 not_found_handling = single-page-application 回 index.html。
// https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
import { type AccessEnv, checkAccess } from './access';

export interface SpaEnv extends AccessEnv {
  ASSETS?: Fetcher;
}

// React App 的 CSP：只載入本站的 script／style；React 的 style 屬性（例如倒數條寬度）要 style-src-attr。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

// 沒過 Access 時的 403 頁：純文字內容，不載入任何東西。
const FORBIDDEN = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>沒有權限 · Nextline</title></head><body><h1>需要先透過 Cloudflare Access 登入</h1></body></html>';

function forbidden(): Response {
  return new Response(FORBIDDEN, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
  });
}

export async function handleSpa(request: Request, env: SpaEnv, url: URL): Promise<Response> {
  const access = await checkAccess(request, env, url);
  if (!access.ok) {
    return forbidden();
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('不支援這個方法', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (env.ASSETS === undefined) {
    return new Response('前端還沒建置（npm run build）', { status: 503 });
  }
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'same-origin');
  if ((out.headers.get('Content-Type') ?? '').includes('text/html')) {
    out.headers.set('Content-Security-Policy', CSP);
    // index.html 不快取，部署後馬上拿到新版；/assets/* 檔名有 hash，交給 ASSETS 的預設快取。
    out.headers.set('Cache-Control', 'no-store');
  }
  return out;
}
