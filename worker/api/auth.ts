// /api/*、/mcp 的 token 驗證（docs/auth.md）：Authorization: Bearer <token>，比對 secret API_TOKEN。
// 沒設 API_TOKEN 時一律拒絕，不會變成不驗證。

export async function hasValidToken(request: Request, expected: string | undefined, expectedSha256?: string): Promise<boolean> {
  if (!expected && !expectedSha256) return false;
  const header = request.headers.get('Authorization') ?? '';
  const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
  if (token === undefined) return false;
  // 先各自取 SHA-256 再逐位元比較：長度固定，比較時間不受內容影響。
  const [a, b] = await Promise.all([sha256(token), expectedSha256 === undefined ? sha256(expected ?? '') : Promise.resolve(Uint8Array.from(expectedSha256.match(/.{2}/g) ?? [], (v) => parseInt(v, 16)))]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
