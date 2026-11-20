import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, MESSAGES } from './client';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: input instanceof Request ? input.url : input.toString(), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('沒有丟出錯誤');
}

describe('API client', () => {
  it('打 /app-api，路徑與參數照 docs/api.md；狀態用逗號分隔', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ issues: [], limit: 50, offset: 0, has_more: false }));
    const api = createApiClient({ fetch });
    await api.listIssues({ status: ['Todo', 'In Progress'], project: 'none', limit: 20 });
    expect(calls[0]?.url).toBe('/app-api/issues?status=Todo%2CIn+Progress&project=none&limit=20');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('每個請求帶 X-Requested-With（Access 過期時才會回 401）、同源 cookie、不自動跟轉址', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ sprints: [] }));
    await createApiClient({ fetch }).listSprints();
    const init = calls[0]?.init;
    expect(init?.headers).toMatchObject({ 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' });
    expect(init?.credentials).toBe('same-origin');
    expect(init?.redirect).toBe('manual');
  });

  it('寫入送 JSON；票號與 id 會做網址編碼', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ number: 1 }));
    const api = createApiClient({ fetch });
    await api.updateIssue('NX-12', { status: 'Done', actor: 'Bolas' });
    await api.removeBlocker('NX 1', 'BOL/2');
    expect(calls[0]).toMatchObject({ url: '/app-api/issues/NX-12', init: { method: 'PATCH', body: '{"status":"Done","actor":"Bolas"}' } });
    expect((calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(calls[1]?.url).toBe('/app-api/issues/NX%201/blockers/BOL%2F2');
  });

  it('NX-152 的 API：看板排序、還原變更、移除 blocked by 帶 actor', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const api = createApiClient({ fetch });
    await api.listIssues({ status: ['In Review'], sort: 'position' });
    await api.revertIssueEvent('NX-3', 7, 'Bolas');
    await api.removeBlocker('NX-3', 'NX-1', 'Bolas');
    expect(calls.map((c) => c.url)).toEqual([
      '/app-api/issues?status=In+Review&sort=position',
      '/app-api/issues/NX-3/events/7/revert',
      '/app-api/issues/NX-3/blockers/NX-1?actor=Bolas',
    ]);
    expect(calls[1]?.init).toMatchObject({ method: 'POST', body: '{"actor":"Bolas"}' });
  });

  it('401：丟 ApiError（isUnauthorized）並通知畫面顯示重新登入', async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeFetch(() => Response.json({ error: '登入過期了，重新整理頁面再登入一次。' }, { status: 401 }));
    const err = await caught(createApiClient({ fetch, onUnauthorized }).listProjects());
    expect(err.isUnauthorized).toBe(true);
    expect(err.message).toBe('登入過期了，重新整理頁面再登入一次。');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('被 Access 轉址（opaqueredirect）也當成 401', async () => {
    const onUnauthorized = vi.fn();
    const redirected = { type: 'opaqueredirect', status: 0, ok: false } as unknown as Response;
    const { fetch } = fakeFetch(() => redirected);
    const err = await caught(createApiClient({ fetch, onUnauthorized }).getIssue('NX-1'));
    expect(err.status).toBe(401);
    expect(err.message).toBe(MESSAGES.unauthorized);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('API 的錯誤訊息原樣給畫面；409 的額外欄位放在 extra', async () => {
    const { fetch } = fakeFetch(() => Response.json({ error: '資料重複', number: 3, identifier: 'NX-3' }, { status: 409 }));
    const err = await caught(createApiClient({ fetch }).createIssue({ title: 'x' }));
    expect(err).toMatchObject({ status: 409, message: '資料重複', extra: { number: 3, identifier: 'NX-3' } });
  });

  it('不是 JSON 的錯誤（例如邊緣回 HTML）用預設訊息', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>502</html>', { status: 502 }));
    const err = await caught(createApiClient({ fetch }).listSprints());
    expect(err).toMatchObject({ status: 502, message: MESSAGES.unknown });
  });

  it('連不上：status 0、說是網路的問題，不呼叫 onUnauthorized', async () => {
    const onUnauthorized = vi.fn();
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof globalThis.fetch;
    const err = await caught(createApiClient({ fetch, onUnauthorized }).listSprints());
    expect(err.isNetwork).toBe(true);
    expect(err.message).toBe(MESSAGES.network);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
