import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../index';
import { createTestDb } from '../test/d1';
import { resetAccessCache } from './access';

const TOKEN = 'test-token';
const TEAM = 'https://bolas.cloudflareaccess.com';
const AUD = 'test-aud';
const KID = 'test-kid';
const SITE = 'https://nextline.example.com';

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let publicJwk: JsonWebKey;
let env: Env;

async function generate(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

beforeAll(async () => {
  keys = await generate();
  otherKeys = await generate();
  publicJwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
});

// 網頁路徑（SPA）驗過 Access 才交給 ASSETS；這裡一律回 index.html。
const assets = {
  fetch: () => Promise.resolve(new Response('<!doctype html><div id="root"></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
} as unknown as Fetcher;

let certFetches = 0;
beforeEach(() => {
  env = { DB: createTestDb(), ASSETS: assets, API_TOKEN: TOKEN, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  resetAccessCache();
  certFetches = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${TEAM}/cdn-cgi/access/certs`) {
        certFetches++;
        return Promise.resolve(Response.json({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function jwt(payload: Record<string, unknown> = {}, opts: { kid?: string; key?: CryptoKey; alg?: string } = {}): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ iss: TEAM, aud: [AUD], email: 'bolas@example.com', iat: nowS, nbf: nowS, exp: nowS + 3600, ...payload }),
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

async function fetchWorker(path: string, init: RequestInit = {}, base = SITE): Promise<Response> {
  return worker.fetch(new Request(`${base}${path}`, init) as Request<unknown, IncomingRequestCfProperties>, env);
}

async function get(path: string, token?: string): Promise<Response> {
  return fetchWorker(path, token === undefined ? {} : { headers: { 'Cf-Access-Jwt-Assertion': token } });
}

describe('Access 檢查（網頁路徑）', () => {
  it('沒有 Access JWT 回 403', async () => {
    for (const path of ['/', '/issues/NX-1', '/projects/1', '/nope']) {
      const res = await get(path);
      expect(res.status, path).toBe(403);
      expect(res.headers.get('Content-Security-Policy'), path).toContain("default-src 'none'");
    }
  });

  it('合法的 JWT 放行', async () => {
    const res = await get('/', await jwt());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('JWT 驗證失敗回 403：簽章、aud、iss、過期、尚未生效、演算法、kid、格式', async () => {
    const bad = [
      await jwt({}, { key: otherKeys.privateKey }),
      await jwt({ aud: ['other-aud'] }),
      await jwt({ iss: 'https://evil.cloudflareaccess.com' }),
      await jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }),
      await jwt({ nbf: Math.floor(Date.now() / 1000) + 3600 }),
      await jwt({}, { alg: 'HS256' }),
      await jwt({}, { kid: 'unknown-kid' }),
      'not-a-jwt',
      'a.b.c',
    ];
    for (const token of bad) {
      expect((await get('/', token)).status, token.slice(0, 40)).toBe(403);
    }
  });

  it('公鑰會快取，找不到 kid 才重抓', async () => {
    await get('/', await jwt());
    await get('/', await jwt());
    expect(certFetches).toBe(1);
    await get('/', await jwt({}, { kid: 'rotated' }));
    expect(certFetches).toBe(2);
  });

  it('Access 還沒設定（vars 空的）時一律 403，合法 JWT 也一樣', async () => {
    const token = await jwt();
    env = { ...env, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' };
    expect((await get('/', token)).status).toBe(403);
    env = { DB: env.DB, ASSETS: assets, API_TOKEN: TOKEN };
    expect((await get('/', token)).status).toBe(403);
  });

  it('DEV_SKIP_ACCESS 只對 localhost 有效，正式網址照樣 403', async () => {
    env = { DB: env.DB, ASSETS: assets, API_TOKEN: TOKEN, DEV_SKIP_ACCESS: '1' };
    expect((await fetchWorker('/', {}, 'http://localhost:8787')).status).toBe(200);
    expect((await fetchWorker('/', {}, 'http://127.0.0.1:8787')).status).toBe(200);
    expect((await fetchWorker('/', {}, SITE)).status).toBe(403);
    env = { ...env, DEV_SKIP_ACCESS: 'true' };
    expect((await fetchWorker('/', {}, 'http://localhost:8787')).status).toBe(403);
  });
});

describe('/api、/mcp、/health 不受影響', () => {
  it('Access 沒設定時 /health 照常 200', async () => {
    env = { DB: env.DB, API_TOKEN: TOKEN };
    expect((await fetchWorker('/health')).status).toBe(200);
  });

  it('/api 照舊只看 token：沒 token 回 401，帶 Access JWT 也不行；帶 token 就能用', async () => {
    env = { DB: env.DB, API_TOKEN: TOKEN };
    expect((await fetchWorker('/api/issues')).status).toBe(401);
    expect((await fetchWorker('/api/issues', { headers: { 'Cf-Access-Jwt-Assertion': await jwt() } })).status).toBe(401);
    const ok = await fetchWorker('/api/issues', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);
  });

  it('/mcp 照舊只看 token：沒 token 回 401；帶 token 能 initialize', async () => {
    env = { DB: env.DB, API_TOKEN: TOKEN };
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } },
    });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    expect((await fetchWorker('/mcp', { method: 'POST', headers, body })).status).toBe(401);
    const ok = await fetchWorker('/mcp', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${TOKEN}` }, body });
    expect(ok.status).toBe(200);
  });
});
