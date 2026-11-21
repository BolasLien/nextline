// 對應 docs/api.md 的資料型別。瀏覽器走 /app-api（Access JWT），路徑與欄位跟 agent 用的 /api 完全相同。

export const ISSUE_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

// 沒做完的票（docs/api.md）。
export const OPEN_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review'] as const satisfies readonly IssueStatus[];

export interface Issue {
  number: number;
  identifier: string;
  legacy_identifier: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  // 看板同一欄裡的順序，小的在上
  position: number;
  project_id: number | null;
  sprint_id: number | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  canceled_at: string | null;
  // 封存時間；null＝沒封存（NX-160）。封存的票不出現在看板、列表、Project 頁與側欄張數。
  archived_at: string | null;
  // 最新一則 comment 的「下一步：」；沒寫是 null（docs/api.md）
  next_step: string | null;
}

export interface IssueSummary {
  number: number;
  identifier: string;
  legacy_identifier: string | null;
  title: string;
  status: IssueStatus;
}

export interface IssueDetail extends Issue {
  blocked_by: IssueSummary[];
  blocks: IssueSummary[];
}

export interface IssueList {
  issues: Issue[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface IssueListQuery {
  status?: IssueStatus[];
  // Project／Sprint id，或 'none'（沒有）
  project?: number | 'none';
  sprint?: number | 'none';
  // updated（預設，新到舊）或 position（看板順序）
  sort?: 'updated' | 'position';
  updated_since?: string;
  updated_before?: string;
  // 預設不含已封存；only＝只要已封存的，include＝都要
  archived?: 'only' | 'include';
  limit?: number;
  offset?: number;
}

export interface IssueCreate {
  title: string;
  description?: string;
  status?: IssueStatus;
  project_id?: number | null;
  sprint_id?: number | null;
  due_date?: string | null;
  // 看板位置：一次只能帶一個（docs/api.md「看板排序」）
  position?: number;
  before?: string;
  after?: string;
}

export interface IssueUpdate {
  title?: string;
  description?: string;
  status?: IssueStatus;
  project_id?: number | null;
  sprint_id?: number | null;
  due_date?: string | null;
  // true 封存、false 取消封存（寫進變更紀錄，可還原）
  archived?: boolean;
  position?: number;
  before?: string;
  after?: string;
  // 誰改的，寫進變更紀錄
  actor?: string;
}

export interface IssueEvent {
  id: number;
  issue_number: number;
  field: string;
  from_value: string | null;
  to_value: string | null;
  actor: string;
  // 這筆是「還原了第 N 筆」時的 N
  revert_of_event_id: number | null;
  // 這筆已經被還原時，是還原它的那一筆
  reverted_by_event_id: number | null;
  created_at: string;
}

export interface RevertResult {
  issue: IssueDetail;
  event: IssueEvent;
  reverted_event: IssueEvent;
}

export interface Blockers {
  blocked_by: IssueSummary[];
  blocks: IssueSummary[];
}

// GET /owner：「人」的名字（worker/api/owner.ts，NX-244）
export interface Owner {
  name: string;
}

export interface Comment {
  id: number;
  issue_number: number;
  author: string;
  body: string;
  linear_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  linear_id: string | null;
  created_at: string;
  updated_at: string;
  // 釘選時間；null＝沒釘選（NX-162）
  pinned_at: string | null;
  // Project、底下的票、底下票的 comment 最新時間，後端算（NX-162，docs/api.md）
  last_activity_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  pinned?: boolean;
}

export interface Sprint {
  id: number;
  number: number;
  name: string | null;
  starts_at: string;
  ends_at: string;
  linear_id: string | null;
  created_at: string;
}

export interface SprintCreate {
  number: number;
  starts_at: string;
  ends_at: string;
  name?: string;
}

export interface SprintUpdate {
  name?: string;
  starts_at?: string;
  ends_at?: string;
}
