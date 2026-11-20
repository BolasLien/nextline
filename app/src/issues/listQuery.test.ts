import { describe, expect, it } from 'vitest';
import type { Issue, IssueStatus, Project } from '../api/types';
import {
  apiQuery,
  clearFilters,
  DEFAULT_QUERY,
  groupIssues,
  hasFilter,
  type ListQuery,
  matchesQuery,
  matchesText,
  parseListQuery,
  sortIssues,
  toggleStatus,
  writeListQuery,
} from './listQuery';

function issue(number: number, extra: Partial<Issue> = {}): Issue {
  return {
    number,
    identifier: `NX-${String(number)}`,
    legacy_identifier: null,
    title: `票 ${String(number)}`,
    description: '',
    status: 'Todo',
    position: number,
    project_id: null,
    sprint_id: null,
    due_date: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    ...extra,
  };
}

function project(id: number, name: string): Project {
  return { id, name, description: '', linear_id: null, created_at: '', updated_at: '', pinned_at: null, last_activity_at: '' };
}

const q = (s: string) => parseListQuery(new URLSearchParams(s));

describe('網址 → 篩選', () => {
  it('沒帶參數是預設：沒做完的四種狀態、依狀態分組、依更新時間排序', () => {
    expect(q('')).toEqual(DEFAULT_QUERY);
    expect(DEFAULT_QUERY.statuses).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review']);
  });

  it('讀得懂每個參數', () => {
    expect(q('status=in_progress,in_review&project=3&archived=1&q=%E7%9C%8B%E6%9D%BF&group=project&sort=number')).toEqual({
      statuses: ['In Progress', 'In Review'],
      project: 3,
      archived: true,
      q: '看板',
      group: 'project',
      sort: 'number',
    });
    expect(q('project=none')).toMatchObject({ project: 'none', archived: false });
    // 產品不放 Sprint（NX-160）：舊網址的 sprint 參數忽略
    expect(q('sprint=current')).toEqual(DEFAULT_QUERY);
  });

  it('看不懂的值當成沒帶，不讓壞網址弄壞頁面', () => {
    expect(q('status=nope&project=abc&archived=yes&group=agent&sort=due')).toEqual(DEFAULT_QUERY);
    // 狀態一個看得懂、一個看不懂：只留看得懂的
    expect(q('status=done,nope').statuses).toEqual(['Done']);
  });
});

describe('篩選 → 網址', () => {
  it('預設值不寫進網址', () => {
    expect(writeListQuery(new URLSearchParams(), DEFAULT_QUERY).toString()).toBe('');
  });

  it('寫進去再讀回來一樣（重新整理後篩選還在）', () => {
    const query: ListQuery = { statuses: ['Todo', 'Done'], project: 5, archived: true, q: 'NX-12', group: 'none', sort: 'number' };
    const url = writeListQuery(new URLSearchParams(), query);
    expect(url.toString()).toBe('status=todo%2Cdone&project=5&archived=1&q=NX-12&group=none&sort=number');
    expect(parseListQuery(new URLSearchParams(url.toString()))).toEqual(query);
  });

  it('其他參數（peek、tab）原樣保留；改回預設就從網址拿掉', () => {
    const start = new URLSearchParams('peek=NX-3&tab=list&project=2&sort=number');
    const out = writeListQuery(start, { ...q(start.toString()), project: null, sort: 'updated' });
    expect(out.toString()).toBe('peek=NX-3&tab=list');
  });

  it('狀態順序固定照看板欄，不看勾選的先後', () => {
    expect(writeListQuery(new URLSearchParams(), { ...DEFAULT_QUERY, statuses: ['Done', 'Backlog'] }).get('status')).toBe('backlog,done');
  });
});

describe('篩選操作', () => {
  it('狀態複選：勾、取消；最後一個不能取消', () => {
    expect(toggleStatus(['Todo'], 'Done')).toEqual(['Todo', 'Done']);
    expect(toggleStatus(['Todo', 'Done'], 'Todo')).toEqual(['Done']);
    expect(toggleStatus(['Done'], 'Done')).toEqual(['Done']);
  });

  it('有沒有篩選：分組、排序不算；Project 頁固定的 Project 不算', () => {
    expect(hasFilter(DEFAULT_QUERY)).toBe(false);
    expect(hasFilter({ ...DEFAULT_QUERY, group: 'none', sort: 'number' })).toBe(false);
    expect(hasFilter({ ...DEFAULT_QUERY, q: 'x' })).toBe(true);
    expect(hasFilter({ ...DEFAULT_QUERY, project: 4 })).toBe(true);
    expect(hasFilter({ ...DEFAULT_QUERY, project: 4 }, 4)).toBe(false);
    expect(hasFilter({ ...DEFAULT_QUERY, archived: true })).toBe(true);
  });

  it('清除篩選留下分組與排序', () => {
    expect(clearFilters({ statuses: ['Done'], project: 1, archived: true, q: 'x', group: 'project', sort: 'number' })).toEqual({
      ...DEFAULT_QUERY,
      group: 'project',
      sort: 'number',
    });
  });

  it('換成 API 查詢：狀態、Project；看「已封存」時帶 archived=only', () => {
    expect(apiQuery(DEFAULT_QUERY)).toEqual({ status: DEFAULT_QUERY.statuses });
    expect(apiQuery({ ...DEFAULT_QUERY, project: 'none', archived: true })).toEqual({ status: DEFAULT_QUERY.statuses, project: 'none', archived: 'only' });
  });
});

describe('比對', () => {
  it('文字搜尋：票號（含純數字、舊 BOL 編號）或標題，不分大小寫', () => {
    const i = issue(12, { title: 'Gem TD 模型', legacy_identifier: 'BOL-150' });
    for (const s of ['nx-12', '12', 'bol-150', 'gem td', '模型', '']) expect(matchesText(i, s), s).toBe(true);
    expect(matchesText(i, '13')).toBe(false);
    expect(matchesText(i, '看板')).toBe(false);
  });

  it('狀態、Project、封存、文字一起篩', () => {
    const base = { ...DEFAULT_QUERY };
    const i = issue(1, { status: 'In Progress', project_id: 3, title: '列表頁' });
    expect(matchesQuery(i, base)).toBe(true);
    expect(matchesQuery(i, { ...base, statuses: ['Todo'] })).toBe(false);
    expect(matchesQuery(i, { ...base, project: 3 })).toBe(true);
    expect(matchesQuery(i, { ...base, project: 4 })).toBe(false);
    expect(matchesQuery(i, { ...base, project: 'none' })).toBe(false);
    expect(matchesQuery(issue(2), { ...base, project: 'none' })).toBe(true);
    expect(matchesQuery(i, { ...base, q: '列表' })).toBe(true);
    expect(matchesQuery(i, { ...base, q: '看板' })).toBe(false);
    // 封存的票只在「已封存」列表
    const archived = issue(3, { archived_at: '2026-11-04T00:00:00Z' });
    expect(matchesQuery(archived, base)).toBe(false);
    expect(matchesQuery(archived, { ...base, archived: true })).toBe(true);
    expect(matchesQuery(i, { ...base, archived: true })).toBe(false);
  });
});

describe('排序與分組', () => {
  const a = issue(1, { status: 'Todo', updated_at: '2026-11-03T00:00:00Z', project_id: 2 });
  const b = issue(2, { status: 'In Review', updated_at: '2026-11-01T00:00:00Z', project_id: 1 });
  const c = issue(3, { status: 'Todo', updated_at: '2026-11-02T00:00:00Z', project_id: null });
  const d = issue(4, { status: 'Backlog', updated_at: '2026-11-02T00:00:00Z', project_id: 99 }); // Project 已不存在
  const projects = new Map([project(1, 'Nextline'), project(2, 'Gem TD')].map((p) => [p.id, p]));

  it('依更新時間（新到舊，同時間票號大的在上）、依票號（大到小）', () => {
    expect(sortIssues([a, b, c, d], 'updated').map((i) => i.number)).toEqual([1, 4, 3, 2]);
    expect(sortIssues([a, b, c, d], 'number').map((i) => i.number)).toEqual([4, 3, 2, 1]);
  });

  it('依狀態分組：照看板欄的順序，空的組不出現', () => {
    const groups = groupIssues([a, b, c, d], 'status', 'updated', projects);
    expect(groups.map((g) => [g.status, g.issues.map((i) => i.number)])).toEqual([
      ['Backlog', [4]],
      ['Todo', [1, 3]],
      ['In Review', [2]],
    ] satisfies [IssueStatus, number[]][]);
  });

  it('依 Project 分組：照名稱，沒有 Project（或 Project 已不存在）放最後', () => {
    const groups = groupIssues([a, b, c, d], 'project', 'number', projects);
    expect(groups.map((g) => [g.label, g.issues.map((i) => i.number)])).toEqual([
      ['Gem TD', [1]],
      ['Nextline', [2]],
      ['沒有 Project', [4, 3]],
    ]);
  });

  it('不分組：一組，照排序', () => {
    expect(groupIssues([a, b, c], 'none', 'number', projects).map((g) => g.issues.map((i) => i.number))).toEqual([[3, 2, 1]]);
    expect(groupIssues([], 'none', 'number', projects)).toEqual([]);
  });
});
