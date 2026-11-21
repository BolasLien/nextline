// 開票：依畫面預填、草稿判斷（Esc 要不要先問）、送出後看板／列表張數的同步。
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Blockers, Issue, IssueCreate, IssueDetail } from '../api/types';
import { groupColumns } from '../board/columns';
import { IssueSync, mergeIssue } from '../issue/issueSync';
import { createBody, emptyDraft, isDirty, nextDraft, submitDraft } from './draft';
import { prefillFor } from './prefill';

const NOW = new Date('2026-11-03T04:00:00Z');

function issue(number: number, extra: Partial<Issue> = {}): Issue {
  return {
    number,
    identifier: `NX-${String(number)}`,
    legacy_identifier: null,
    title: `票 ${String(number)}`,
    description: '',
    status: 'Todo',
    position: 1024 * number,
    project_id: null,
    sprint_id: 1,
    due_date: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    ...extra,
  };
}

describe('prefillFor：依目前畫面預填', () => {
  it('看板：狀態 Todo，不預填 Sprint（產品不放 Sprint，NX-160）', () => {
    expect(prefillFor('/', '')).toEqual({ status: 'Todo', projectId: null });
    expect(prefillFor('/board', '?scope=open')).toEqual({ status: 'Todo', projectId: null });
  });

  it('看板欄標題的＋：該欄狀態蓋過預設', () => {
    expect(prefillFor('/', '', { status: 'In Progress' })).toEqual({ status: 'In Progress', projectId: null });
  });

  it('Project 頁：該 Project（看板、列表、說明分頁都是）', () => {
    expect(prefillFor('/projects/7', '')).toEqual({ status: 'Todo', projectId: 7 });
    expect(prefillFor('/projects/7', '?tab=about')).toMatchObject({ projectId: 7 });
    expect(prefillFor('/projects/7', '?tab=board', { status: 'In Review' })).toMatchObject({ projectId: 7, status: 'In Review' });
  });

  it('列表：篩選只有一個值時才預填 Project 和狀態', () => {
    expect(prefillFor('/issues', '?project=3&status=in_progress')).toEqual({ status: 'In Progress', projectId: 3 });
    // 兩種狀態、沒有篩 Project：不預填
    expect(prefillFor('/issues', '?status=todo,in_progress')).toEqual({ status: 'Todo', projectId: null });
    // 沒篩選（預設是沒做完的四種）
    expect(prefillFor('/issues', '')).toEqual({ status: 'Todo', projectId: null });
    // 「沒有 Project」不是一個 Project
    expect(prefillFor('/issues', '?project=none')).toMatchObject({ projectId: null });
    // 只有一種狀態，而且是 Backlog
    expect(prefillFor('/issues', '?status=backlog')).toMatchObject({ status: 'Backlog' });
  });

  it('Project 頁的列表分頁：Project 固定，狀態看篩選', () => {
    expect(prefillFor('/projects/7', '?tab=list&status=done&project=9')).toEqual({ status: 'Done', projectId: 7 });
  });

  it('其他畫面不預填', () => {
    expect(prefillFor('/me', '')).toEqual({ status: 'Todo', projectId: null });
    expect(prefillFor('/issues/NX-3', '')).toEqual({ status: 'Todo', projectId: null });
    expect(prefillFor('/projects', '')).toEqual({ status: 'Todo', projectId: null });
  });
});

describe('草稿', () => {
  const initial = emptyDraft({ status: 'Todo', projectId: 3 });

  it('剛打開、只打空白：不算草稿，Esc 直接關', () => {
    expect(isDirty(initial, initial)).toBe(false);
    expect(isDirty({ ...initial, title: '   ', description: '\n' }, initial)).toBe(false);
  });

  it('打了標題、描述、到期日、blocked by，或改了預填的欄位：算草稿，Esc 先問', () => {
    expect(isDirty({ ...initial, title: '新票' }, initial)).toBe(true);
    expect(isDirty({ ...initial, description: '說明' }, initial)).toBe(true);
    expect(isDirty({ ...initial, dueDate: '2026-11-30' }, initial)).toBe(true);
    expect(isDirty({ ...initial, blockers: [{ number: 2, identifier: 'NX-2', legacy_identifier: null, title: 'x', status: 'Todo' }] }, initial)).toBe(true);
    expect(isDirty({ ...initial, status: 'In Progress' }, initial)).toBe(true);
    expect(isDirty({ ...initial, projectId: null }, initial)).toBe(true);
  });

  it('繼續開下一張：清掉標題、描述、到期日、blocked by，留下狀態、Project', () => {
    const d = { ...initial, title: 'a', description: 'b', dueDate: '2026-11-30', status: 'In Progress' as const };
    expect(nextDraft(d)).toEqual({ ...initial, status: 'In Progress' });
  });

  it('createBody：標題去頭尾空白，空的欄位不送', () => {
    expect(createBody({ ...emptyDraft({ status: 'Todo', projectId: null }), title: '  新票  ' })).toEqual({ title: '新票', status: 'Todo' });
    expect(createBody({ ...initial, title: 'x', description: ' 說明 ', dueDate: '2026-11-30' })).toEqual({
      title: 'x',
      status: 'Todo',
      description: '說明',
      project_id: 3,
      due_date: '2026-11-30',
    });
  });
});

// 假的 API：開票時照後端規則放到那一欄最上面（position 比那一欄最小的還小）。
function fakeApi(existing: Issue[], opts: { failBlocker?: string } = {}) {
  const calls: { create: IssueCreate[]; blockers: [string, string, string | undefined][] } = { create: [], blockers: [] };
  let next = Math.max(0, ...existing.map((i) => i.number)) + 1;
  const api = {
    createIssue: (body: IssueCreate): Promise<IssueDetail> => {
      calls.create.push(body);
      const status = body.status ?? 'Backlog';
      const top = Math.min(2048, ...existing.filter((i) => i.status === status).map((i) => i.position));
      const n = next++;
      return Promise.resolve({
        ...issue(n, { title: body.title, status, project_id: body.project_id ?? null, sprint_id: body.sprint_id ?? null, position: top - 1024 }),
        blocked_by: [],
        blocks: [],
      });
    },
    addBlocker: (ref: string, blockedBy: string, actor?: string): Promise<Blockers> => {
      calls.blockers.push([ref, blockedBy, actor]);
      if (blockedBy === opts.failBlocker) return Promise.reject(new Error('blocked_by 的票不存在'));
      const b = existing.find((i) => i.identifier === blockedBy);
      return Promise.resolve({ blocked_by: b === undefined ? [] : [{ number: b.number, identifier: b.identifier, legacy_identifier: null, title: b.title, status: b.status }], blocks: [] });
    },
  };
  return { api: api as unknown as ApiClient, calls };
}

describe('送出後的資料同步', () => {
  const board = [issue(1, { position: 1024 }), issue(2, { position: 2048 }), issue(3, { status: 'In Progress', position: 1024 })];

  it('開好的票透過 issueSync 進看板，出現在該欄最上面；列表張數跟著變；不帶 sprint_id', async () => {
    const { api, calls } = fakeApi(board);
    const sync = new IssueSync();
    let boardList: Issue[] = [...board];
    let openList: Issue[] = [...board];
    sync.subscribe((i) => { boardList = mergeIssue(boardList, i, () => true); });
    sync.subscribe((i) => { openList = mergeIssue(openList, i, (x) => ['Backlog', 'Todo', 'In Progress', 'In Review'].includes(x.status)); });

    const draft = { ...emptyDraft({ status: 'Todo', projectId: null }), title: '新的一張' };
    const { issue: created, blockerErrors } = await submitDraft(api, sync, draft);

    expect(calls.create).toEqual([{ title: '新的一張', status: 'Todo' }]);
    expect(blockerErrors).toEqual([]);
    const todo = groupColumns(boardList, NOW.getTime()).Todo;
    expect(todo.map((i) => i.number)).toEqual([created.number, 1, 2]);
    expect(openList).toHaveLength(4);
  });

  it('Project 頁的看板只收這個 Project 的票；封存的票哪裡都不進（除了「已封存」）', async () => {
    const { api } = fakeApi(board);
    const sync = new IssueSync();
    let projectBoard: Issue[] = [...board];
    let openList: Issue[] = [...board];
    let archivedList: Issue[] = [];
    sync.subscribe((i) => { projectBoard = mergeIssue(projectBoard, i, (x) => x.project_id === 5); });
    sync.subscribe((i) => { openList = mergeIssue(openList, i, () => true); });
    sync.subscribe((i) => { archivedList = mergeIssue(archivedList, i, () => true, true); });
    const { issue: created } = await submitDraft(api, sync, { ...emptyDraft({ status: 'Todo', projectId: null }), title: '別的 Project' });
    expect(projectBoard).toHaveLength(3);
    expect(openList).toHaveLength(4);
    expect(archivedList).toHaveLength(0);
    sync.publish({ ...created, archived_at: NOW.toISOString() });
    expect(openList).toHaveLength(3);
    expect(archivedList.map((i) => i.number)).toEqual([created.number]);
  });

  it('blocked by 開票後逐一加上（actor 你）；加失敗不退回票，另外回報', async () => {
    const { api, calls } = fakeApi(board, { failBlocker: 'NX-9' });
    const sync = new IssueSync();
    const published: IssueDetail[] = [];
    sync.subscribe((i) => { published.push(i as IssueDetail); });
    const blockers = [
      { number: 2, identifier: 'NX-2', legacy_identifier: null, title: '票 2', status: 'Todo' as const },
      { number: 9, identifier: 'NX-9', legacy_identifier: null, title: '不見了', status: 'Todo' as const },
    ];
    const { issue: created, blockerErrors } = await submitDraft(api, sync, { ...emptyDraft({ status: 'In Progress', projectId: null }), title: 'x', blockers });
    expect(calls.blockers).toEqual([
      [created.identifier, 'NX-2', '你'],
      [created.identifier, 'NX-9', '你'],
    ]);
    expect(created.blocked_by.map((b) => b.identifier)).toEqual(['NX-2']);
    expect(blockerErrors).toEqual(['NX-9：blocked_by 的票不存在']);
    expect(published).toHaveLength(1);
    expect(published[0]?.blocked_by.map((b) => b.identifier)).toEqual(['NX-2']);
  });

  it('開票失敗：不通知任何畫面，錯誤往外丟（對話框保留內容）', async () => {
    const sync = new IssueSync();
    let count = 0;
    sync.subscribe(() => { count++; });
    const api = { createIssue: () => Promise.reject(new Error('連不上 Nextline')) } as unknown as ApiClient;
    await expect(submitDraft(api, sync, { ...emptyDraft({ status: 'Todo', projectId: null }), title: 'x' })).rejects.toThrow('連不上');
    expect(count).toBe(0);
  });
});
