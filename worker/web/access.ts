// 網頁路徑的 Cloudflare Access 檢查（docs/auth.md 第 3 點）：驗 Cf-Access-Jwt-Assertion 的 RS256 簽章、
// iss（team domain）、aud（application AUD）、exp／nbf。公鑰從 <team domain>/cdn-cgi/access/certs 取得。
// 官方說明：https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
//
// fail closed：ACCESS_TEAM_DOMAIN 或 ACCESS_AUD 沒設定時一律拒絕。
// 本機開發的跳過開關 DEV_SKIP_ACCESS=1 只放在 .dev.vars，而且只對 localhost／127.0.0.1 的請求有效；
// 正式網址（*.workers.dev）就算誤設了這個變數也不會放行。

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_SKIP_ACCESS?: string;
}

export type AccessResult = { ok: true; email: string | null } | { ok: false; reason: string };

interface Jwk extends JsonWebKey {
  kid?: string;
}

const CERT_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;
let certCache: { issuer: string; keys: Jwk[]; fetchedAt: number } | null = null;

// 測試用：清掉快取的公鑰。
export function resetAccessCache(): void {
  certCache = null;
}

// 接受「bolas.cloudflareaccess.com」或「https://bolas.cloudflareaccess.com/」，統一成 https://<host>。
export function normalizeTeamDomain(raw: string): string | null {
  const host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}

function isLocalDev(url: URL, env: AccessEnv): boolean {
  return env.DEV_SKIP_ACCESS === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

function base64UrlDecode(part: string): Uint8Array {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function loadKeys(issuer: string, force: boolean): Promise<Jwk[]> {
  if (!force && certCache !== null && certCache.issuer === issuer && Date.now() - certCache.fetchedAt < CERT_TTL_MS) {
    return certCache.keys;
  }
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`取不到 Access 公鑰：HTTP ${String(res.status)}`);
  const body: { keys?: Jwk[] } = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  certCache = { issuer, keys, fetchedAt: Date.now() };
  return keys;
}

async function verifySignature(jwk: Jwk, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}

export async function checkAccess(request: Request, env: AccessEnv, url: URL): Promise<AccessResult> {
  if (isLocalDev(url, env)) return { ok: true, email: null };

  const issuer = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? '');
  const aud = env.ACCESS_AUD?.trim() ?? '';
  if (issuer === null || aud === '') return { ok: false, reason: 'Access 尚未設定' };

  const token = request.headers.get('Cf-Access-Jwt-Assertion')?.trim() ?? '';
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: '沒有 Access JWT' };
  const [headerPart = '', payloadPart = '', signaturePart = ''] = parts;
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);
  if (header === null || payload === null) return { ok: false, reason: 'JWT 格式錯誤' };
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'JWT 演算法不符' };

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(signaturePart);
  } catch {
    return { ok: false, reason: 'JWT 格式錯誤' };
  }
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);

  try {
    let jwk = (await loadKeys(issuer, false)).find((k) => k.kid === header.kid);
    // Access 會輪替金鑰：找不到這個 kid 就重抓一次。
    jwk ??= (await loadKeys(issuer, true)).find((k) => k.kid === header.kid);
    if (jwk === undefined) return { ok: false, reason: '找不到對應的公鑰' };
    if (!(await verifySignature(jwk, data, signature))) return { ok: false, reason: 'JWT 簽章不符' };
  } catch {
    return { ok: false, reason: '無法驗證 JWT' };
  }

  if (payload.iss !== issuer) return { ok: false, reason: 'JWT iss 不符' };
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return { ok: false, reason: 'JWT aud 不符' };
  const nowS = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: 'JWT 已過期' };
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_S > nowS) return { ok: false, reason: 'JWT 尚未生效' };

  return { ok: true, email: typeof payload.email === 'string' ? payload.email : null };
}
