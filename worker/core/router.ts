import { handleApi, type ApiEnv } from '../api';
import { handleMcp } from '../mcp';
import { handleLegacy, LEGACY } from '../web/legacy';

export interface WebHandlers {
  browserApi(request: Request, url: URL): Promise<Response>;
  page(request: Request, url: URL): Promise<Response>;
}

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Runtime entry points provide authenticated browser/static handlers. No permissive default.
export async function routeRequest(request: Request, env: ApiEnv, web: WebHandlers): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return health(env);
  if (under(url.pathname, '/api')) return handleApi(request, env, url);
  if (url.pathname === '/mcp') return handleMcp(request, env);
  if (under(url.pathname, '/app-api')) return web.browserApi(request, url);
  if (under(url.pathname, LEGACY)) return handleLegacy(request, url);
  return web.page(request, url);
}

export async function health(env: ApiEnv): Promise<Response> {
  try {
    await env.DB.prepare('SELECT 1').first();
    return Response.json({ ok: true, db: 'ok' });
  } catch {
    return Response.json({ ok: false, db: 'error' }, { status: 503 });
  }
}
