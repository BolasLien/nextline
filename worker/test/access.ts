// 測試用的 Cloudflare Access：產生 RSA 金鑰、簽 JWT，並把 <team>/cdn-cgi/access/certs 換成假的公鑰端點。
import { vi } from 'vitest';

export const TEAM = 'https://bolas.cloudflareaccess.com';
export const AUD = 'test-aud';
export const KID = 'test-kid';

export async function generateKeys(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

export async function stubCerts(keys: CryptoKeyPair): Promise<void> {
  const publicJwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${TEAM}/cdn-cgi/access/certs`) {
        return Promise.resolve(Response.json({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }),
  );
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signJwt(key: CryptoKey, payload: Record<string, unknown> = {}): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ iss: TEAM, aud: [AUD], email: 'bolas@example.com', iat: nowS, nbf: nowS, exp: nowS + 3600, ...payload }),
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}
