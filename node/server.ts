import { createServer, type IncomingMessage } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteAdapter } from '../worker/adapters/sqlite';
import { routeRequest } from '../worker/core/router';
import { routeApi } from '../worker/api';
import { isSafeMethod, isSameOrigin } from '../worker/web/csrf';
import { LocalAuth, sessionCookie } from './auth';
import type { Config } from './config';

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const reject = (status: number, error: string) => Response.json({ error }, { status });

export function validPath(raw: string): boolean {
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  try {
    const path = decodeURIComponent(raw.split('?')[0] ?? '');
    return !path.includes('\\') && !path.includes('\0') && !path.split('/').some((part) => part === '.' || part === '..') && !/%2e|%2f|%5c/i.test(path);
  } catch { return false; }
}

// Only exact configured Host/Origin. Forwarded headers never select the public origin.
export function validIngress(req: IncomingMessage, config: Config): boolean {
  if (req.headers.host !== new URL(config.origin).host) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== config.origin) return false;
  if (config.secure) {
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (!peer || !config.trustedProxies.includes(peer)) return false;
    if (req.headers['x-forwarded-proto'] !== 'https') return false;
    if (req.headers['x-forwarded-host'] !== undefined && req.headers['x-forwarded-host'] !== req.headers.host) return false;
  } else if (req.headers.forwarded || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto']) return false;
  return true;
}

export function createNodeServer(config: Config, db: DatabaseSync) {
  const auth = new LocalAuth(db);
  if (!auth.configured()) throw new Error('尚未設定擁有者密碼。請先執行 npm run selfhost:init。');
  const adapter = new SqliteAdapter(db);

  async function staticFile(path: string): Promise<Response> {
    try {
      const root = await realpath(config.clientDir);
      const file = await realpath(resolve(root, `.${path}`));
      if (!file.startsWith(root + sep)) return reject(404, '找不到頁面。');
      const content = await readFile(file);
      return new Response(new Uint8Array(content), { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' } });
    } catch { return reject(404, '找不到檔案，請確認已執行 npm run build。'); }
  }

  async function page(request: Request, url: URL): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) return reject(405, '不支援這個方法。');
    if (/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2|svg)$/.test(url.pathname) || ['/theme-init.js', '/favicon.svg'].includes(url.pathname)) return staticFile(url.pathname);
    const login = url.pathname === '/login';
    const known = /^\/(?:|board|issues(?:\/[^/]+)?|projects(?:\/\d+)?|me|zones|settings(?:\/[^/]+)?|sprints\/\d+|views\/[^/]+)$/.test(url.pathname);
    if (!login && !known) return reject(404, '找不到頁面。');
    if (!login && !auth.authenticated(request)) {
      return new Response(null, { status: 302, headers: { Location: `/login?returnTo=${encodeURIComponent(url.pathname + url.search)}&expired=1` } });
    }
    const index = await staticFile('/index.html');
    if (!index.ok) return index;
    return new Response((await index.text()).replace('<html ', '<html data-auth="local" '), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/auth/')) {
      if (url.pathname === '/auth/session' && request.method === 'GET') return auth.authenticated(request) ? Response.json({ ok: true }) : reject(401, '請先登入。');
      if (request.method !== 'POST') return reject(405, '請使用 POST。');
      if (!isSameOrigin(request, url)) return reject(403, '請從 Nextline 網頁送出。');
      if (url.pathname === '/auth/login') {
        let body: unknown;
        try { body = await request.json(); } catch { return reject(400, '登入資料格式不正確。'); }
        const password = typeof body === 'object' && body !== null && 'password' in body ? body.password : undefined;
        const result = await auth.login(password);
        if (result.status !== 200 || !result.token) return reject(result.status, result.status === 429 ? '嘗試次數太多，請稍等一分鐘再登入。' : '登入失敗：密碼不正確。');
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(result.token, config.secure) } });
      }
      if (url.pathname === '/auth/logout') {
        auth.logout(request);
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', config.secure) } });
      }
      return reject(404, '找不到這個路徑。');
    }
    return routeRequest(request, { DB: adapter, API_TOKEN_SHA256: auth.tokenHash(), OWNER_NAME: config.ownerName }, {
      page,
      browserApi: (req, browserUrl) => {
        if (!auth.authenticated(req)) return Promise.resolve(reject(401, '登入已過期，請重新登入。'));
        if (!isSafeMethod(req.method) && !isSameOrigin(req, browserUrl)) return Promise.resolve(reject(403, '請從 Nextline 網頁送出。'));
        return routeApi(req, adapter, browserUrl, config.ownerName);
      },
    });
  }

  const server = createServer((req, res) => {
    void (async () => {
      let response: Response;
      if (!validIngress(req, config)) response = reject(403, '主機或來源不符。');
      else if (!validPath(req.url ?? '')) response = reject(400, '路徑格式不正確。');
      else {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          size += bytes.length;
          if (size > 1024 * 1024) { res.writeHead(413, { Connection: 'close' }); res.end(); return; }
          chunks.push(bytes);
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const method = req.method ?? 'GET';
        const body = Buffer.concat(chunks);
        response = await handle(new Request(config.origin + (req.url ?? '/'), { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: new Uint8Array(body) } : {}) }));
      }
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('Referrer-Policy', 'same-origin');
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if (config.secure) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: '伺服器處理失敗。' }));
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
