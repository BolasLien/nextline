// 「全部的票」的篩選、分組、排序與網址同步（docs/design/ia/README.md 第 3 段）。只有資料計算，不碰 React，方便測。
//
// 網址參數（預設值不寫進網址）：
//   status  狀態，可複選，逗號分隔：backlog、todo、in_progress、in_review、done、canceled（預設：沒做完的四種）
//   project Project id、none（沒有 Project）
//   archived 1＝看「已封存」的票（NX-160）；沒帶就是沒封存的
//   q       票號或標題的關鍵字
//   group   status（預設）、project、none
//   sort    updated（預設，更新時間新到舊）、number（票號大到小）
// 其他參數（peek、tab…）原樣保留。產品不放 Sprint（2026-11-04 Bolas），舊網址的 sprint 參數忽略。
import { ISSUE_STATUSES, type Issue, type IssueListQuery, type IssueStatus, OPEN_STATUSES, type Project } from '../api/types';

export const GROUPS = ['status', 'project', 'none'] as const;
export type GroupBy = (typeof GROUPS)[number];
export const SORTS = ['updated', 'number'] as const;
export type SortBy = (typeof SORTS)[number];

export type ProjectFilter = number | 'none' | null;

export interface ListQuery {
  // 一定至少一種；沒選就是預設的沒做完四種
  statuses: IssueStatus[];
  // null＝全部
  project: ProjectFilter;
  // true＝「已封存」列表
  archived: boolean;
  q: string;
  group: GroupBy;
  sort: SortBy;
}

export const DEFAULT_QUERY: ListQuery = {
  statuses: [...OPEN_STATUSES],
  project: null,
  archived: false,
  q: '',
  group: 'status',
  sort: 'updated',
};

// 網址裡的狀態值：小寫、用 _ 連接（API 的狀態名是 In Progress）。
const STATUS_PARAM: Record<IssueStatus, string> = {
  Backlog: 'backlog',
  Todo: 'todo',
  'In Progress': 'in_progress',
  'In Review': 'in_review',
  Done: 'done',
  Canceled: 'canceled',
};

export const LIST_PARAMS = ['status', 'project', 'archived', 'q', 'group', 'sort'] as const;

function sameStatuses(a: readonly IssueStatus[], b: readonly IssueStatus[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

function csv(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function idOrNone(v: string | null): number | 'none' | null {
  if (v === null || v === '') return null;
  if (v === 'none') return 'none';
  return /^\d+$/.test(v) ? Number(v) : null;
}

// 看不懂的值當成沒帶（回到預設），不讓壞掉的網址把頁面弄壞。
export function parseListQuery(params: URLSearchParams): ListQuery {
  const statuses = ISSUE_STATUSES.filter((s) => csv(params, 'status').includes(STATUS_PARAM[s]));
  return {
    statuses: statuses.length > 0 ? statuses : [...DEFAULT_QUERY.statuses],
    project: idOrNone(params.get('project')),
    archived: params.get('archived') === '1',
    q: (params.get('q') ?? '').trim(),
    group: oneOf(params.get('group'), GROUPS, DEFAULT_QUERY.group),
    sort: oneOf(params.get('sort'), SORTS, DEFAULT_QUERY.sort),
  };
}

// 把 query 寫回網址：預設值拿掉，其他參數（peek、tab）保留。
export function writeListQuery(params: URLSearchParams, query: ListQuery): URLSearchParams {
  const out = new URLSearchParams(params);
  for (const k of LIST_PARAMS) out.delete(k);
  if (!sameStatuses(query.statuses, DEFAULT_QUERY.statuses)) {
    out.set('status', ISSUE_STATUSES.filter((s) => query.statuses.includes(s)).map((s) => STATUS_PARAM[s]).join(','));
  }
  if (query.project !== null) out.set('project', String(query.project));
  if (query.archived) out.set('archived', '1');
  if (query.q.trim() !== '') out.set('q', query.q.trim());
  if (query.group !== DEFAULT_QUERY.group) out.set('group', query.group);
  if (query.sort !== DEFAULT_QUERY.sort) out.set('sort', query.sort);
  return out;
}

// 有沒有設任何篩選（分組、排序不算）；有就顯示「清除篩選」。fixedProject 是 Project 頁固定的篩選，不算。
export function hasFilter(query: ListQuery, fixedProject: number | null = null): boolean {
  return (
    !sameStatuses(query.statuses, DEFAULT_QUERY.statuses) ||
    (query.project !== null && query.project !== fixedProject) ||
    query.archived ||
    query.q !== ''
  );
}

// 清除篩選：分組、排序留著。
export function clearFilters(query: ListQuery): ListQuery {
  return { ...DEFAULT_QUERY, group: query.group, sort: query.sort };
}

// 勾／取消一個狀態；最後一個不能取消（至少要有一種）。
export function toggleStatus(statuses: readonly IssueStatus[], s: IssueStatus): IssueStatus[] {
  if (statuses.includes(s)) return statuses.length === 1 ? [...statuses] : statuses.filter((x) => x !== s);
  return ISSUE_STATUSES.filter((x) => x === s || statuses.includes(x));
}

// 換成 API 的查詢條件：狀態、Project、封存（關鍵字在前端篩）。
export function apiQuery(query: ListQuery): IssueListQuery {
  return {
    status: query.statuses,
    ...(query.project === null ? {} : { project: query.project }),
    ...(query.archived ? { archived: 'only' as const } : {}),
  };
}

// 關鍵字：票號（NX-12、12、舊編號 BOL-150）或標題，不分大小寫。
export function matchesText(issue: Issue, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  if (/^\d+$/.test(needle) && String(issue.number) === needle) return true;
  return (
    issue.identifier.toLowerCase().includes(needle) ||
    (issue.legacy_identifier?.toLowerCase().includes(needle) ?? false) ||
    issue.title.toLowerCase().includes(needle)
  );
}

// 一張票符不符合篩選。伺服器已經篩過狀態、Project、封存，
// 這裡再檢查一次，是給「票詳細改了這張票」時判斷它還該不該留在列表上。
export function matchesQuery(issue: Issue, query: ListQuery): boolean {
  if (!query.statuses.includes(issue.status)) return false;
  if (query.project === 'none' ? issue.project_id !== null : query.project !== null && issue.project_id !== query.project) return false;
  if ((issue.archived_at !== null) !== query.archived) return false;
  return matchesText(issue, query.q);
}

export function sortIssues(issues: readonly Issue[], sort: SortBy): Issue[] {
  const list = [...issues];
  if (sort === 'number') return list.sort((a, b) => b.number - a.number);
  return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.number - a.number);
}

export interface IssueGroup {
  key: string;
  kind: 'status' | 'project' | 'none';
  status?: IssueStatus;
  // Project 分組：Project（沒有 Project 是 null）
  project?: Project | null;
  label: string;
  issues: Issue[];
}

// 分組：狀態照看板欄的順序、Project 照名稱（沒有 Project 放最後）；空的組不顯示。組內照 sort。
export function groupIssues(issues: readonly Issue[], group: GroupBy, sort: SortBy, projects: ReadonlyMap<number, Project>): IssueGroup[] {
  const sorted = sortIssues(issues, sort);
  if (group === 'none') return sorted.length === 0 ? [] : [{ key: 'all', kind: 'none', label: '全部', issues: sorted }];
  if (group === 'status') {
    return ISSUE_STATUSES.map((s) => ({ key: `status:${s}`, kind: 'status' as const, status: s, label: s, issues: sorted.filter((i) => i.status === s) })).filter(
      (g) => g.issues.length > 0,
    );
  }
  const byProject = new Map<number | null, Issue[]>();
  for (const i of sorted) {
    const k = i.project_id !== null && projects.has(i.project_id) ? i.project_id : null;
    byProject.set(k, [...(byProject.get(k) ?? []), i]);
  }
  const named = [...byProject.keys()]
    .filter((k): k is number => k !== null)
    .map((k) => projects.get(k) as Project)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const out: IssueGroup[] = named.map((p) => ({ key: `project:${String(p.id)}`, kind: 'project', project: p, label: p.name, issues: byProject.get(p.id) ?? [] }));
  const none = byProject.get(null);
  if (none !== undefined) out.push({ key: 'project:none', kind: 'project', project: null, label: '沒有 Project', issues: none });
  return out;
}
