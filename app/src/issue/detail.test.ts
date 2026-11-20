// 票詳細的純邏輯：變更紀錄的文字、blocked by 搜尋、看板與詳細頁同步。
import { describe, expect, it } from 'vitest';
import type { Issue, IssueEvent, Project, Sprint } from '../api/types';
import { searchIssues } from './blockerSearch';
import { canRevert, eventText, newestFirst, revertLabel, valueText } from './events';
import { IssueSync, mergeIssue } from './issueSync';

function issue(number: number, extra: Partial<Issue> = {}): Issue {
  return {
    number,
    identifier: `NX-${String(number)}`,
    legacy_identifier: null,
    title: `票 ${String(number)}`,
    description: '',
    status: 'Todo',
    position: 1024,
    project_id: null,
    sprint_id: 1,
    due_date: null,
    created_at: '',
    updated_at: '',
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    ...extra,
  };
}

function ev(id: number, field: string, from: string | null, to: string | null, extra: Partial<IssueEvent> = {}): IssueEvent {
  return { id, issue_number: 7, field, from_value: from, to_value: to, actor: 'Bolas', revert_of_event_id: null, reverted_by_event_id: null, created_at: '', ...extra };
}

const names = {
  projects: new Map<number, Project>([[2, { id: 2, name: 'Nextline 第二版', description: '', linear_id: null, created_at: '', updated_at: '', pinned_at: null, last_activity_at: '' }]]),
  sprints: new Map<number, Sprint>([[1, { id: 1, number: 12, name: null, starts_at: '', ends_at: '', linear_id: null, created_at: '' }]]),
};

describe('變更紀錄的文字', () => {
  it('狀態、Project、Sprint、到期日用名稱顯示', () => {
    expect(eventText(ev(1, 'status', 'In Review', 'Done'), [], names)).toBe('把狀態從「待驗收」改成「Done」');
    expect(eventText(ev(2, 'project', null, '2'), [], names)).toBe('把 Project 從「沒有 Project」改成「Nextline 第二版」');
    expect(eventText(ev(3, 'sprint', '1', null), [], names)).toBe('把 Sprint 從「Sprint 12」改成「沒有 Sprint」');
    expect(valueText('due_date', null, names)).toBe('沒有到期日');
  });

  it('blocked by 與描述', () => {
    expect(eventText(ev(4, 'blocked_by', null, '3'), [], names)).toBe('加入 blocked by NX-3');
    expect(eventText(ev(5, 'blocked_by', '3', null), [], names)).toBe('移除了 blocked by NX-3');
    expect(eventText(ev(6, 'description', 'a', 'b'), [], names)).toBe('改了描述');
  });

  it('封存與取消封存（NX-160）', () => {
    expect(eventText(ev(7, 'archived', null, '2026-11-04T00:00:00Z'), [], names)).toBe('封存了這張票');
    expect(eventText(ev(8, 'archived', '2026-11-04T00:00:00Z', null), [], names)).toBe('取消封存');
    const original = ev(7, 'archived', null, '2026-11-04T00:00:00Z', { reverted_by_event_id: 9 });
    expect(eventText(ev(9, 'archived', '2026-11-04T00:00:00Z', null, { revert_of_event_id: 7 }), [original], names)).toBe('還原了 Bolas 的封存變更（取消封存）');
    expect(revertLabel(ev(7, 'archived', null, '2026-11-04T00:00:00Z'), names)).toBe('還原：取消封存');
  });

  it('還原的那筆寫出還原了誰的變更', () => {
    const original = ev(1, 'status', 'In Review', 'Done', { actor: 'claude-nextline', reverted_by_event_id: 2 });
    const revert = ev(2, 'status', 'Done', 'In Review', { revert_of_event_id: 1 });
    expect(eventText(revert, [original, revert], names)).toBe('還原了 claude-nextline 的狀態變更（改回「待驗收」）');
    expect(canRevert(original)).toBe(false);
    expect(canRevert(revert)).toBe(false);
    expect(canRevert(ev(3, 'title', 'a', 'b'))).toBe(true);
  });

  it('還原按鈕的說明寫清楚改回什麼；新的排在上面', () => {
    expect(revertLabel(ev(1, 'status', 'In Progress', 'In Review'), names)).toBe('還原：狀態改回 In Progress');
    expect(revertLabel(ev(2, 'blocked_by', null, '3'), names)).toBe('還原：移除 blocked by NX-3');
    expect(newestFirst([ev(1, 'title', 'a', 'b'), ev(3, 'title', 'b', 'c')]).map((e) => e.id)).toEqual([3, 1]);
  });
});

describe('blocked by 搜尋', () => {
  const list = [issue(3, { title: '看板卡片' }), issue(12, { title: '設計系統' }), issue(120, { title: '看板拖拉', legacy_identifier: 'BOL-150' }), issue(7)];

  it('票號：NX-12、12 完全相符排第一；也能用舊編號', () => {
    expect(searchIssues(list, 'NX-12', new Set())[0]?.number).toBe(12);
    expect(searchIssues(list, '12', new Set()).map((i) => i.number)).toEqual([12, 120]);
    expect(searchIssues(list, 'bol-150', new Set())[0]?.number).toBe(120);
  });

  it('標題關鍵字，排除自己和已經加過的', () => {
    expect(searchIssues(list, '看板', new Set([3])).map((i) => i.number)).toEqual([120]);
    expect(searchIssues(list, '', new Set([7])).map((i) => i.number)).not.toContain(7);
  });
});

describe('看板與詳細頁同步', () => {
  it('列表裡有就換掉，保留看板的順序', () => {
    const list = [issue(1), issue(2)];
    const next = mergeIssue(list, { ...issue(2), status: 'Done', title: '改過' }, () => true);
    expect(next.map((i) => [i.number, i.status, i.title])).toEqual([[1, 'Todo', '票 1'], [2, 'Done', '改過']]);
  });

  it('移出這個範圍（例如換了 Sprint）就拿掉；新進來的加上', () => {
    const inSprint = (i: Issue) => i.sprint_id === 1;
    expect(mergeIssue([issue(1), issue(2)], issue(2, { sprint_id: 5 }), inSprint).map((i) => i.number)).toEqual([1]);
    expect(mergeIssue([issue(1)], issue(9), inSprint).map((i) => i.number)).toEqual([1, 9]);
  });

  it('詳細頁多的欄位（blocked_by）不帶進看板', () => {
    const next = mergeIssue([issue(1)], { ...issue(1), blocked_by: [], blocks: [] } as Issue, () => true);
    expect(Object.keys(next[0] ?? {})).not.toContain('blocked_by');
  });

  it('publish 通知所有訂閱者，取消訂閱後收不到', () => {
    const sync = new IssueSync();
    const got: number[] = [];
    const off = sync.subscribe((i) => { got.push(i.number); });
    sync.publish(issue(4));
    off();
    sync.publish(issue(5));
    expect(got).toEqual([4]);
  });
});
