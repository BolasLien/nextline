import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_OWNER_NAME } from '../../../worker/api/owner';
import { actor, loadOwner, resetOwner } from './owner';

afterEach(resetOwner);

describe('網頁上的人（NX-244）', () => {
  it('還沒抓到時用預設值', () => {
    expect(actor()).toBe(DEFAULT_OWNER_NAME);
  });

  it('抓到伺服器設定的名字後，comment 作者與 actor 都用它', async () => {
    await loadOwner({ getOwner: () => Promise.resolve({ name: ' Alice ' }) });
    expect(actor()).toBe('Alice');
  });

  it('抓失敗或是空字串就沿用預設值', async () => {
    await loadOwner({ getOwner: () => Promise.reject(new Error('連不上')) });
    expect(actor()).toBe(DEFAULT_OWNER_NAME);
    await loadOwner({ getOwner: () => Promise.resolve({ name: '  ' }) });
    expect(actor()).toBe(DEFAULT_OWNER_NAME);
  });
});
