// NX-151：React App 上線後的路由與驗證。
// - /app-api：瀏覽器用的同一套 API，驗 Access JWT（header），寫入防 CSRF，不接受 Bearer token。
// - /api、/mcp：agent 的 Bearer token 行為不變。
// - /legacy：舊的伺服器端網頁 NX-158 移除，只轉址到新網頁。
// - 其他路徑：SPA（ASSETS），先驗 Access JWT；SPA fallback 不會蓋到 /api、/mcp、/health。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import { resetAccessCache } from './web/access';
import { AUD, generateKeys, signJwt, stubCerts, TEAM } from './test/access';
import { createTestDb } from './test/d1';

const TOKEN = 'test-token';
const SITE = 'https://nextline.example.com';
const SPA_HTML = '<!doctype html><div id="root"></div>';

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let env: Env;
let assetRequests: string[];

beforeAll(async () => {
  keys = await generateKeys();
  otherKeys = await generateKeys();
});

beforeEach(async () => {
  resetAccessCache();
  await stubCerts(keys);
  assetRequests = [];
  const assets = {
    fetch: (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assetRequests.push(url.pathname);
      if (url.pathname.startsWith('/assets/')) {
        return Promise.resolve(new Response('console.log(1)', { headers: { 'Content-Type': 'text/javascript' } }));
      }
      // not_found_handling = single-page-application：其他路徑都回 index.html
      return Promise.resolve(new Response(SPA_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    },
  } as unknown as Fetcher;
  env = { DB: createTestDb(), ASSETS: assets, API_TOKEN: TOKEN, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(path: string, init: RequestInit = {}, base = SITE): Promise<Response> {
  return worker.fetch(new Request(`${base}${path}`, init) as Request<unknown, IncomingRequestCfProperties>, env);
}

async function browser(method: string, path: string, opts: { jwt?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.jwt !== undefined) headers['Cf-Access-Jwt-Assertion'] = opts.jwt;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return call(path, init);
}

const sameOrigin = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };

describe('/app-api：瀏覽器帶 Access JWT', () => {
  it('有效的 JWT：讀寫都跟 /api 同一套', async () => {
    const jwt = await signJwt(keys.privateKey);
    const created = await browser('POST', '/app-api/issues', { jwt, headers: sameOrigin, body: { title: '從網頁開的票' } });
    expect(created.status).toBe(201);
    const issue: { identifier: string } = await created.json();
    expect(issue.identifier).toBe('NX-1');

    const list = await browser('GET', '/app-api/issues', { jwt });
    expect(list.status).toBe(200);
    expect(list.headers.get('Cache-Control')).toBe('no-store');
    const body: { issues: { title: string }[] } = await list.json();
    expect(body.issues.map((i) => i.title)).toEqual(['從網頁開的票']);

    // agent 用 /api 看得到同一張票
    const viaToken = await call('/api/issues/NX-1', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(viaToken.status).toBe(200);
  });

  it('沒有 JWT、簽章不符、過期、aud 不符：一律 401 JSON，不寫入', async () => {
    const cases: [string, string | undefined][] = [
      ['沒有 JWT', undefined],
      ['簽章不符', await signJwt(otherKeys.privateKey)],
      ['過期', await signJwt(keys.privateKey, { exp: Math.floor(Date.now() / 1000) - 3600 })],
      ['aud 不符', await signJwt(keys.privateKey, { aud: ['other'] })],
      ['格式錯誤', 'not-a-jwt'],
    ];
    for (const [name, jwt] of cases) {
      const get = await browser('GET', '/app-api/issues', jwt === undefined ? {} : { jwt });
      expect(get.status, name).toBe(401);
      expect(get.headers.get('Content-Type'), name).toContain('application/json');
      const body: { error: string } = await get.json();
      expect(body.error, name).toContain('登入過期');
      const post = await browser('POST', '/app-api/issues', { ...(jwt === undefined ? {} : { jwt }), headers: sameOrigin, body: { title: 'x' } });
      expect(post.status, name).toBe(401);
    }
    const viaToken = await call('/api/issues', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect((await viaToken.json<{ issues: unknown[] }>()).issues).toHaveLength(0);
  });

  it('過期的 JWT 會被擋，換一張新的 JWT 就能用', async () => {
    const expired = await signJwt(keys.privateKey, { exp: Math.floor(Date.now() / 1000) - 120 });
    expect((await browser('GET', '/app-api/projects', { jwt: expired })).status).toBe(401);
    expect((await browser('GET', '/app-api/projects', { jwt: await signJwt(keys.privateKey) })).status).toBe(200);
  });

  it('/app-api 不接受 Bearer token（token 只給 /api、/mcp）', async () => {
    const res = await call('/app-api/issues', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(401);
  });

  it('找不到的路徑回 404 JSON，跟 /api 一樣', async () => {
    const res = await browser('GET', '/app-api/nope', { jwt: await signJwt(keys.privateKey) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '找不到這個 API 路徑' });
  });
});

describe('/app-api：寫入防 CSRF', () => {
  it('沒有 Origin、別站 Origin、Sec-Fetch-Site 不是 same-origin：403 且不寫入', async () => {
    const jwt = await signJwt(keys.privateKey);
    const cases: Record<string, string>[] = [
      {},
      { Origin: 'https://evil.example' },
      { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: SITE, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: SITE, 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const headers of cases) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const res = await browser(method, '/app-api/issues', { jwt, headers, body: { title: 'csrf' } });
        expect(res.status, `${method} ${JSON.stringify(headers)}`).toBe(403);
      }
    }
    const list = await browser('GET', '/app-api/issues', { jwt });
    expect((await list.json<{ issues: unknown[] }>()).issues).toHaveLength(0);
  });

  it('同源寫入可以；沒帶 Sec-Fetch-Site 的舊瀏覽器只看 Origin', async () => {
    const jwt = await signJwt(keys.privateKey);
    expect((await browser('POST', '/app-api/issues', { jwt, headers: sameOrigin, body: { title: 'a' } })).status).toBe(201);
    expect((await browser('POST', '/app-api/issues', { jwt, headers: { Origin: SITE }, body: { title: 'b' } })).status).toBe(201);
    const patch = await browser('PATCH', '/app-api/issues/NX-1', { jwt, headers: sameOrigin, body: { status: 'Todo', actor: 'Bolas' } });
    expect(patch.status).toBe(200);
  });

  it('網頁寫 comment（你）在待驗收的票 → 移到 In Progress（NX-221）', async () => {
    const jwt = await signJwt(keys.privateKey);
    await browser('POST', '/app-api/issues', { jwt, headers: sameOrigin, body: { title: '待驗收', status: 'In Review' } });
    const posted = await browser('POST', '/app-api/issues/NX-1/comments', { jwt, headers: sameOrigin, body: { author: '你', body: '好' } });
    expect(posted.status).toBe(201);
    const issue: { status: string } = await (await browser('GET', '/app-api/issues/NX-1', { jwt })).json();
    expect(issue.status).toBe('In Progress');
  });

  it('GET /app-api/owner 回 OWNER_NAME；網頁用這個名字回覆待驗收的票 → In Progress（NX-244）', async () => {
    const jwt = await signJwt(keys.privateKey);
    expect(await (await browser('GET', '/app-api/owner', { jwt })).json()).toEqual({ name: '你' });
    env = { ...env, OWNER_NAME: 'Alice' };
    expect(await (await browser('GET', '/app-api/owner', { jwt })).json()).toEqual({ name: 'Alice' });
    await browser('POST', '/app-api/issues', { jwt, headers: sameOrigin, body: { title: '待驗收', status: 'In Review' } });
    await browser('POST', '/app-api/issues/NX-1/comments', { jwt, headers: sameOrigin, body: { author: 'Bolas', body: '舊名字' } });
    expect((await (await browser('GET', '/app-api/issues/NX-1', { jwt })).json<{ status: string }>()).status).toBe('In Review');
    await browser('POST', '/app-api/issues/NX-1/comments', { jwt, headers: sameOrigin, body: { author: 'Alice', body: '好' } });
    expect((await (await browser('GET', '/app-api/issues/NX-1', { jwt })).json<{ status: string }>()).status).toBe('In Progress');
  });

  it('讀取（GET）不需要 Origin', async () => {
    const res = await browser('GET', '/app-api/sprints', { jwt: await signJwt(keys.privateKey), headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect(res.status).toBe(200);
  });
});

describe('agent 的 Bearer token 照舊', () => {
  it('/api 帶 token 200、不帶 401、只帶 Access JWT 也 401', async () => {
    expect((await call('/api/issues', { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await call('/api/issues')).status).toBe(401);
    expect((await call('/api/issues', { headers: { 'Cf-Access-Jwt-Assertion': await signJwt(keys.privateKey) } })).status).toBe(401);
  });

  it('/api 寫入不檢查 Origin（agent 不是瀏覽器）', async () => {
    const res = await call('/api/issues', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'agent 開的票' }),
    });
    expect(res.status).toBe(201);
  });

  it('/mcp 帶 token 能 initialize，不帶 401', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } },
    });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    expect((await call('/mcp', { method: 'POST', headers, body })).status).toBe(401);
    expect((await call('/mcp', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${TOKEN}` }, body })).status).toBe(200);
  });
});

describe('/legacy：舊網頁已移除，轉到新網頁（NX-158）', () => {
  it('舊網址 301 轉到新網頁對應的路徑，沒有對應就回首頁', async () => {
    const cases: [string, string][] = [
      ['/legacy', '/'],
      ['/legacy/', '/'],
      ['/legacy/issues/NX-1', '/issues/NX-1'],
      ['/legacy/issues/bol-150', '/issues/BOL-150'],
      ['/legacy/issues/NX-1/status', '/issues/NX-1'],
      ['/legacy/projects/3', '/projects/3'],
      ['/legacy/projects/abc', '/'],
      ['/legacy/nope', '/'],
    ];
    for (const [from, to] of cases) {
      const res = await call(from, { redirect: 'manual' });
      expect(res.status, from).toBe(301);
      expect(res.headers.get('Location'), from).toBe(to);
    }
    expect(assetRequests).toEqual([]);
  });

  it('舊表單的 POST 回 405，不寫入', async () => {
    const res = await call('/legacy/issues/NX-1/status', {
      method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': await signJwt(keys.privateKey), Origin: SITE, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'status=Done',
      redirect: 'manual',
    });
    expect(res.status).toBe(405);
  });

  it('/legacyx 不算舊網址，照常交給 SPA', async () => {
    expect((await call('/legacyx')).status).toBe(403);
  });
});

describe('SPA（React App 的靜態檔）', () => {
  it('帶 JWT：任何網頁路徑都交給 ASSETS，回 index.html 並加上 CSP', async () => {
    const jwt = await signJwt(keys.privateKey);
    for (const path of ['/', '/issues', '/issues/NX-12', '/projects/3', '/sprints/12', '/some/deep/path']) {
      const res = await browser('GET', path, { jwt });
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(SPA_HTML);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp, path).toContain("script-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
    }
    const js = await browser('GET', '/assets/index-abc.js', { jwt });
    expect(js.headers.get('Content-Type')).toBe('text/javascript');
    expect(js.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('沒有 JWT：403，不碰 ASSETS（靜態檔也一樣）', async () => {
    for (const path of ['/', '/issues', '/assets/index-abc.js', '/theme-init.js']) {
      expect((await browser('GET', path)).status, path).toBe(403);
    }
    expect(assetRequests).toEqual([]);
  });

  it('SPA fallback 不會蓋到 /api、/app-api、/mcp、/health', async () => {
    const jwt = await signJwt(keys.privateKey);
    // 不存在的 API 子路徑也是 Worker 回 JSON 404，不是 index.html
    const api404 = await call('/api/nope', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(api404.status).toBe(404);
    expect(api404.headers.get('Content-Type')).toContain('application/json');
    expect((await call('/api/issues')).status).toBe(401);
    expect((await call('/api')).status).toBe(401);
    expect((await browser('GET', '/app-api/nope', { jwt })).headers.get('Content-Type')).toContain('application/json');
    expect((await call('/mcp', { method: 'POST' })).status).toBe(401);
    const health = await call('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, db: 'ok' });
    expect(assetRequests).toEqual([]);
  });

  it('網頁路徑不接受 POST', async () => {
    const res = await browser('POST', '/issues', { jwt: await signJwt(keys.privateKey), headers: sameOrigin });
    expect(res.status).toBe(405);
  });

  it('DEV_SKIP_ACCESS 只在 localhost：SPA 與 /app-api 跳過 Access；正式網址照樣擋', async () => {
    env = { ...env, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', DEV_SKIP_ACCESS: '1' };
    expect((await call('/', {}, 'http://localhost:8787')).status).toBe(200);
    expect((await call('/app-api/issues', {}, 'http://localhost:8787')).status).toBe(200);
    expect((await call('/app-api/issues', {}, 'http://127.0.0.1:8787')).status).toBe(200);
    expect((await call('/', {}, SITE)).status).toBe(403);
    expect((await call('/app-api/issues', {}, SITE)).status).toBe(401);
    // 本機寫入一樣要同源
    const post = await call('/app-api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    }, 'http://localhost:8787');
    expect(post.status).toBe(403);
  });
});
