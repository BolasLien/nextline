import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { IssueDetail, IssueEvent, IssueUpdate } from '../api/types';
import { ACTOR, saveMove, undoMove } from './moves';

function detail(status: IssueDetail['status']): IssueDetail {
  return {
    number: 7,
    identifier: 'NX-7',
    legacy_identifier: null,
    title: '票',
    description: '',
    status,
    position: 0,
    project_id: null,
    sprint_id: 1,
    due_date: null,
    created_at: '',
    updated_at: '',
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    blocked_by: [],
    blocks: [],
  };
}

function event(id: number, from: string, to: string, extra: Partial<IssueEvent> = {}): IssueEvent {
  return {
    id,
    issue_number: 7,
    field: 'status',
    from_value: from,
    to_value: to,
    actor: ACTOR,
    revert_of_event_id: null,
    reverted_by_event_id: null,
    created_at: '',
    ...extra,
  };
}

function fakeApi(events: IssueEvent[], updateImpl?: (ref: string, body: IssueUpdate) => Promise<IssueDetail>) {
  const updates: IssueUpdate[] = [];
  const api = {
    listIssueEvents: vi.fn(() => Promise.resolve({ events })),
    revertIssueEvent: vi.fn((_ref: string, id: number) =>
      Promise.resolve({ issue: detail('Todo'), event: event(99, 'In Progress', 'Todo', { revert_of_event_id: id }), reverted_event: event(id, 'Todo', 'In Progress') }),
    ),
    updateIssue: vi.fn((ref: string, body: IssueUpdate) => {
      updates.push(body);
      return updateImpl ? updateImpl(ref, body) : Promise.resolve(detail(body.status ?? 'Todo'));
    }),
  };
  return { api, updates };
}

describe('寫回搬移', () => {
  it('換欄：帶 status、位置與 actor', async () => {
    const { api, updates } = fakeApi([]);
    await saveMove(api, 'NX-7', 'Todo', { status: 'In Progress', placement: { before: 'NX-3' } });
    expect(updates).toEqual([{ actor: ACTOR, before: 'NX-3', status: 'In Progress' }]);
  });

  it('同欄調順序：只帶位置，不帶 status', async () => {
    const { api, updates } = fakeApi([]);
    await saveMove(api, 'NX-7', 'Todo', { status: 'Todo', placement: { after: 'NX-2' } });
    expect(updates).toEqual([{ actor: ACTOR, after: 'NX-2' }]);
  });
});

describe('復原', () => {
  const record = { ref: 'NX-7', from: { status: 'Todo' as const, placement: { before: 'NX-2' } }, toStatus: 'In Progress' as const };

  it('用變更紀錄還原最近那筆狀態變更，再把位置放回原本那張的上面', async () => {
    const { api, updates } = fakeApi([
      event(1, 'Todo', 'In Progress', { reverted_by_event_id: 2 }),
      event(2, 'In Progress', 'Todo', { revert_of_event_id: 1 }),
      event(3, 'Todo', 'In Progress'),
    ]);
    await undoMove(api, record);
    expect(api.revertIssueEvent).toHaveBeenCalledWith('NX-7', 3, ACTOR);
    expect(updates).toEqual([{ before: 'NX-2', actor: ACTOR }]);
  });

  it('找不到那筆變更紀錄時，直接把狀態改回去', async () => {
    const { api, updates } = fakeApi([event(1, 'Backlog', 'Todo')]);
    await undoMove(api, record);
    expect(api.revertIssueEvent).not.toHaveBeenCalled();
    expect(updates).toEqual([{ status: 'Todo', actor: ACTOR }, { before: 'NX-2', actor: ACTOR }]);
  });

  it('原本在空欄（沒有鄰居）就只還原狀態', async () => {
    const { api, updates } = fakeApi([event(3, 'Todo', 'In Progress')]);
    await undoMove(api, { ...record, from: { status: 'Todo', placement: undefined } });
    expect(api.revertIssueEvent).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  it('原本的鄰居已經搬走（400）：狀態已經回去，位置留在欄頂，不算失敗', async () => {
    const { api } = fakeApi([event(3, 'Todo', 'In Progress')], () => Promise.reject(new ApiError(400, 'NX-2 在 Done 欄，不在 Todo 欄')));
    await expect(undoMove(api, record)).resolves.toMatchObject({ status: 'Todo' });
  });

  it('其他錯誤（例如網路）照樣丟出，讓 toast 顯示「沒有復原成功」', async () => {
    const { api } = fakeApi([event(3, 'Todo', 'In Progress')], () => Promise.reject(new ApiError(0, '連不上')));
    await expect(undoMove(api, record)).rejects.toThrow('連不上');
  });
});
