// 防 CSRF（OWASP「Verifying Origin With Standard Headers」＋ Fetch Metadata）：
// Origin 必須等於本站；有帶 Sec-Fetch-Site 時必須是 same-origin。/app-api 的寫入用。
export function isSameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site !== 'same-origin') return false;
  return request.headers.get('Origin') === url.origin;
}

// 不會改資料的方法不檢查 Origin（瀏覽器的同源 GET 不一定帶 Origin）。
export function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}
