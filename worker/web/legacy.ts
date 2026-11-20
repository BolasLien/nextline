// 第一版的伺服器端網頁（/legacy/*）在 NX-158 移除，舊網址一律轉到新網頁對應的路徑。
// 轉址不帶任何資料，所以不驗 Access；目標路徑照常由 spa.ts 驗。
export const LEGACY = '/legacy';

// /legacy → /（舊首頁是三區，NX-160 拿掉三區後回看板）、/legacy/issues/:ref → /issues/:ref、/legacy/projects/:id → /projects/:id；
// 其他（含舊的表單 POST 路徑 /legacy/issues/:ref/status）→ 對應的票，或 /。
export function legacyTarget(pathname: string): string {
  const parts = pathname.slice(LEGACY.length).split('/').filter((p) => p !== '');
  const [first, second] = parts;
  if (parts.length === 0) return '/';
  if (first === 'issues' && second !== undefined && /^[A-Za-z][A-Za-z0-9]*-\d+$|^\d+$/.test(second)) {
    return `/issues/${second.toUpperCase()}`;
  }
  if (first === 'projects' && second !== undefined && /^\d+$/.test(second)) return `/projects/${second}`;
  return '/';
}

export function handleLegacy(request: Request, url: URL): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('舊網頁已移除，請改用新網頁', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return new Response(null, { status: 301, headers: { Location: legacyTarget(url.pathname), 'Cache-Control': 'no-store' } });
}
