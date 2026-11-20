import { describe, expect, it } from 'vitest';
import worker, { type Env } from './index';

function envWithDb(first: () => Promise<unknown>): Env {
  return { DB: { prepare: () => ({ first }) } } as unknown as Env;
}

describe('GET /health', () => {
  it('D1 可用時回 200', async () => {
    const res = await worker.fetch(new Request('https://x/health'), envWithDb(() => Promise.resolve({ 1: 1 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'ok' });
  });

  it('D1 失敗時回 503', async () => {
    const res = await worker.fetch(new Request('https://x/health'), envWithDb(() => Promise.reject(new Error('down'))));
    expect(res.status).toBe(503);
  });

  it('其他路徑是網頁，Access 沒設定時回 403（fail closed）', async () => {
    const res = await worker.fetch(new Request('https://x/nope'), envWithDb(() => Promise.resolve(null)));
    expect(res.status).toBe(403);
  });
});
