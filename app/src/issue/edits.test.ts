import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { Comment, IssueDetail, IssueEvent, IssueUpdate } from '../api/types';
import type { ToastInput } from '../toast/toastStore';
import { actor } from '../owner/owner';
import { applyPatch, createEditActions, findEvent } from './edits';

function detail(extra: Partial<IssueDetail> = {}): IssueDetail {
  return {
    number: 7,
    identifier: 'NX-7',
    legacy_identifier: 'BOL-77',
    title: '舊標題',
    description: '',
    status: 'In Review',
    position: 0,
    project_id: null,
    sprint_id: 1,
    due_date: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    blocked_by: [],
    blocks: [],
    ...extra,
  };
}

function event(id: number, field: string, from: string | null, to: string | null, extra: Partial<IssueEvent> = {}): IssueEvent {
  return { id, issue_number: 7, field, from_value: from, to_value: to, actor: actor(), revert_of_event_id: null, reverted_by_event_id: null, created_at: '', ...extra };
}

function setup(opts: { issue?: IssueDetail; update?: (body: IssueUpdate) => Promise<IssueDetail>; events?: IssueEvent[]; revert?: (id: number) => Promise<IssueDetail>; comment?: () => Promise<Comment> } = {}) {
  let current = opts.issue ?? detail();
  const history: IssueDetail[] = [];
  const toasts: ToastInput[] = [];
  const comments: Comment[] = [];
  const api = {
    updateIssue: vi.fn((_ref: string, body: IssueUpdate) => (opts.update ? opts.update(body) : Promise.resolve({ ...current, ...body } as IssueDetail))),
    listIssueEvents: vi.fn(() => Promise.resolve({ events: opts.events ?? [] })),
    revertIssueEvent: vi.fn((_ref: string, id: number) =>
      (opts.revert ? opts.revert(id) : Promise.resolve(current)).then((issue) => ({ issue, event: event(99, 'x', null, null, { revert_of_event_id: id }), reverted_event: event(id, 'x', null, null) })),
    ),
    addBlocker: vi.fn(() => Promise.resolve({ blocked_by: [{ number: 3, identifier: 'NX-3', legacy_identifier: null, title: '擋路的票', status: 'Todo' as const }], blocks: [] })),
    removeBlocker: vi.fn(() => Promise.resolve({ blocked_by: [], blocks: [] })),
    createComment: vi.fn((_ref: string, body: { author: string; body: string }) =>
      opts.comment ? opts.comment() : Promise.resolve({ id: 1, issue_number: 7, author: body.author, body: body.body, linear_id: null, created_at: '', updated_at: '' }),
    ),
    getIssue: vi.fn(() => Promise.resolve(current)),
  };
  const refreshEvents = vi.fn();
  const actions = createEditActions({
    api,
    get: () => current,
    set: (i) => { current = i; history.push(i); },
    toast: (t) => { toasts.push(t); },
    refreshEvents,
    addComment: (c) => { comments.push(c); },
  });
  return { api, actions, toasts, comments, history, refreshEvents, now: () => current };
}

describe('就地編輯', () => {
  it('樂觀更新：API 回來前畫面已經是新值，成功後出 toast「復原」', async () => {
    let resolve: (v: IssueDetail) => void = () => {};
    const s = setup({ update: () => new Promise((r) => { resolve = r; }) });
    const done = s.actions.edit({ title: '新標題' }, 'NX-7 改了標題');
    expect(s.now().title).toBe('新標題');
    expect(s.api.updateIssue).toHaveBeenCalledWith('NX-7', { title: '新標題', actor: actor() });
    resolve(detail({ title: '新標題', updated_at: '2026-11-03T00:00:00.000Z' }));
    expect(await done).toBe(true);
    expect(s.now().updated_at).toBe('2026-11-03T00:00:00.000Z');
    expect(s.toasts).toHaveLength(1);
    expect(s.toasts[0]?.onUndo).toBeTypeOf('function');
    expect(s.refreshEvents).toHaveBeenCalled();
  });

  it('失敗：退回原本的值，錯誤 toast 寫原因並附「重試」', async () => {
    const s = setup({ update: () => Promise.reject(new ApiError(500, '資料庫暫時忙不過來')) });
    expect(await s.actions.edit({ status: 'Done' }, 'NX-7 完成')).toBe(false);
    expect(s.history[0]?.status).toBe('Done');
    expect(s.now().status).toBe('In Review');
    expect(s.now().completed_at).toBeNull();
    expect(s.toasts[0]).toMatchObject({ kind: 'error', message: '儲存失敗：資料庫暫時忙不過來' });
    expect(s.toasts[0]?.action?.label).toBe('重試');
  });

  it('值沒變就不送 API', async () => {
    const s = setup();
    expect(await s.actions.edit({ title: '舊標題' }, 'x')).toBe(true);
    expect(s.api.updateIssue).not.toHaveBeenCalled();
  });

  it('改到 Done 時樂觀更新也填完成時間', () => {
    const next = applyPatch(detail(), { status: 'Done' }, '2026-11-03T01:00:00.000Z');
    expect(next.completed_at).toBe('2026-11-03T01:00:00.000Z');
    expect(applyPatch(next, { status: 'Todo' }).completed_at).toBeNull();
  });

  it('toast「復原」：用 revert API 還原剛才那一筆（project 的 id 轉成文字比對）', async () => {
    const s = setup({ events: [event(5, 'project', null, '2'), event(6, 'title', '舊標題', '新標題')] });
    await s.actions.edit({ project_id: 2 }, 'NX-7 移到 Project');
    await s.toasts[0]?.onUndo?.();
    expect(s.api.revertIssueEvent).toHaveBeenCalledWith('NX-7', 5, actor());
  });

  it('toast「復原」找不到那筆紀錄時，直接改回舊值', async () => {
    const s = setup({ events: [] });
    await s.actions.edit({ due_date: '2026-11-30' }, 'x');
    await s.toasts[0]?.onUndo?.();
    expect(s.api.revertIssueEvent).not.toHaveBeenCalled();
    expect(s.api.updateIssue).toHaveBeenLastCalledWith('NX-7', { due_date: null, actor: actor() });
  });

  it('findEvent 跳過已還原的和「還原」本身', () => {
    const events = [
      event(1, 'status', 'Todo', 'Done', { reverted_by_event_id: 2 }),
      event(2, 'status', 'Done', 'Todo', { revert_of_event_id: 1 }),
      event(3, 'status', 'Todo', 'Done'),
    ];
    expect(findEvent(events, 'status', 'Todo', 'Done')?.id).toBe(3);
    expect(findEvent(events.slice(0, 2), 'status', 'Todo', 'Done')).toBeUndefined();
  });
});

describe('變更紀錄還原', () => {
  it('成功：換成 API 回的票、toast 說還原了什麼、重抓變更紀錄', async () => {
    const s = setup({ revert: () => Promise.resolve(detail({ title: '更早的標題' })) });
    expect(await s.actions.revert(event(4, 'title', '更早的標題', '舊標題'), '標題改回 更早的標題')).toBe(true);
    expect(s.api.revertIssueEvent).toHaveBeenCalledWith('NX-7', 4, actor());
    expect(s.now().title).toBe('更早的標題');
    expect(s.toasts[0]?.message).toBe('已還原：標題改回 更早的標題');
    expect(s.refreshEvents).toHaveBeenCalled();
  });

  it('409：toast 寫 API 給的原因，票不變', async () => {
    const s = setup({ revert: () => Promise.reject(new ApiError(409, '之後狀態又被改過（第 9 筆），先還原第 9 筆', { conflict_event_id: 9 })) });
    expect(await s.actions.revert(event(4, 'status', 'Todo', 'In Review'), '狀態改回 Todo')).toBe(false);
    expect(s.now().status).toBe('In Review');
    expect(s.toasts[0]).toMatchObject({ kind: 'error', message: '無法還原：之後狀態又被改過（第 9 筆），先還原第 9 筆' });
    expect(s.refreshEvents).toHaveBeenCalled();
  });
});

describe('comment 與 blocked by', () => {
  it('comment：空白不送；送出後加進時間軸並重抓票（下一步）', async () => {
    const s = setup();
    expect(await s.actions.comment('  ')).toBe(false);
    expect(s.api.createComment).not.toHaveBeenCalled();
    expect(await s.actions.comment('下一步：Bolas 看截圖')).toBe(true);
    expect(s.comments[0]?.body).toBe('下一步：Bolas 看截圖');
    expect(s.api.getIssue).toHaveBeenCalledWith('NX-7');
  });

  it('待驗收的票寫 comment：後端移到 In Progress（NX-221），畫面跟著換，toast「復原」走變更紀錄還原', async () => {
    const s = setup({ events: [event(5, 'status', 'In Review', 'In Progress')], revert: () => Promise.resolve(detail({ status: 'In Review' })) });
    s.api.getIssue.mockImplementation(() => Promise.resolve({ ...s.now(), status: 'In Progress' as const }));
    expect(await s.actions.comment('1.1 2.1 3.1')).toBe(true);
    expect(s.now().status).toBe('In Progress');
    expect(s.refreshEvents).toHaveBeenCalled();
    expect(s.toasts[0]?.message).toBe('NX-7 已交回 agent，移到「In Progress」');
    await s.toasts[0]?.onUndo?.();
    expect(s.api.revertIssueEvent).toHaveBeenCalledWith('NX-7', 5, actor());
    expect(s.now().status).toBe('In Review');
  });

  it('不是待驗收的票寫 comment：狀態不變、不出 toast', async () => {
    const s = setup({ issue: detail({ status: 'Todo' }) });
    expect(await s.actions.comment('看一下')).toBe(true);
    expect(s.now().status).toBe('Todo');
    expect(s.toasts).toHaveLength(0);
  });

  it('加入 blocked by：先出現在畫面，API 回來換成正式清單；toast 可復原（移除）', async () => {
    const s = setup();
    const target = { number: 3, identifier: 'NX-3', legacy_identifier: null, title: '擋路的票', status: 'Todo' as const };
    const p = s.actions.addBlocker(target);
    expect(s.now().blocked_by.map((b) => b.number)).toEqual([3]);
    expect(await p).toBe(true);
    expect(s.api.addBlocker).toHaveBeenCalledWith('NX-7', 'NX-3', actor());
    await s.toasts[0]?.onUndo?.();
    expect(s.api.removeBlocker).toHaveBeenCalledWith('NX-7', 'NX-3', actor());
    expect(s.now().blocked_by).toEqual([]);
  });

  it('移除 blocked by 失敗：退回原本的清單', async () => {
    const blocker = { number: 3, identifier: 'NX-3', legacy_identifier: null, title: '擋路的票', status: 'Todo' as const };
    const s = setup({ issue: detail({ blocked_by: [blocker] }) });
    s.api.removeBlocker.mockImplementationOnce(() => Promise.reject(new ApiError(404, 'NX-7 沒有被 NX-3 擋住')));
    expect(await s.actions.removeBlocker(blocker)).toBe(false);
    expect(s.now().blocked_by).toEqual([blocker]);
    expect(s.toasts[0]?.kind).toBe('error');
  });
});

describe('封存（NX-160）', () => {
  it('封存：畫面先標成已封存，送 archived: true，toast「已封存」附復原', async () => {
    const s = setup({ update: (body) => Promise.resolve(detail({ archived_at: body.archived ? '2026-11-04T01:00:00.000Z' : null })) });
    const done = s.actions.archive();
    expect(s.now().archived_at).not.toBeNull();
    expect(await done).toBe(true);
    expect(s.api.updateIssue).toHaveBeenCalledWith('NX-7', { archived: true, actor: actor() });
    expect(s.now().archived_at).toBe('2026-11-04T01:00:00.000Z');
    expect(s.toasts[0]?.message).toBe('已封存 NX-7');
    expect(s.toasts[0]?.onUndo).toBeTypeOf('function');
  });

  it('復原封存：畫面馬上改回沒封存，用 revert API 還原那一筆', async () => {
    const archivedAt = '2026-11-04T01:00:00.000Z';
    const s = setup({
      update: () => Promise.resolve(detail({ archived_at: archivedAt })),
      events: [event(5, 'archived', null, archivedAt)],
      revert: () => Promise.resolve(detail({ archived_at: null })),
    });
    await s.actions.archive();
    const undo = s.toasts[0]?.onUndo?.();
    expect(s.now().archived_at).toBeNull();
    await undo;
    expect(s.api.revertIssueEvent).toHaveBeenCalledWith('NX-7', 5, actor());
    expect(s.now().archived_at).toBeNull();
  });

  it('封存失敗：換回沒封存，錯誤 toast 附重試；已封存的再封存不送 API', async () => {
    const s = setup({ update: () => Promise.reject(new Error('連不上')) });
    expect(await s.actions.archive()).toBe(false);
    expect(s.now().archived_at).toBeNull();
    expect(s.toasts[0]).toMatchObject({ kind: 'error', message: '封存失敗：連不上' });
    const t = setup({ issue: detail({ archived_at: '2026-11-04T01:00:00.000Z' }) });
    expect(await t.actions.archive()).toBe(true);
    expect(t.api.updateIssue).not.toHaveBeenCalled();
  });

  it('取消封存：送 archived: false，toast「已取消封存」', async () => {
    const s = setup({ issue: detail({ archived_at: '2026-11-04T01:00:00.000Z' }), update: () => Promise.resolve(detail({ archived_at: null })) });
    expect(await s.actions.unarchive()).toBe(true);
    expect(s.api.updateIssue).toHaveBeenCalledWith('NX-7', { archived: false, actor: actor() });
    expect(s.toasts[0]?.message).toBe('已取消封存 NX-7');
  });
});
