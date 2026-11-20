// 看板的欄位分組與排序（components.md 第 8 節、docs/api.md「看板排序」）。只有資料計算，不碰 React，方便測。
import { ISSUE_STATUSES, type Issue, type IssueStatus } from '../api/types';

// 看板上一直展開的四欄；Backlog、Canceled 收在標題列，點了才展開。
export const BOARD_COLUMNS = ['Todo', 'In Progress', 'In Review', 'Done'] as const satisfies readonly IssueStatus[];
export const FOLDED_COLUMNS = ['Backlog', 'Canceled'] as const satisfies readonly IssueStatus[];

// Done 欄只顯示最近 7 天完成的票。
export const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// 跟後端一樣的間隔（worker/api/issues.ts 的 POSITION_STEP）。
export const POSITION_STEP = 1024;

export type Columns = Record<IssueStatus, Issue[]>;

// 欄內順序跟後端一樣：position 小的在上，同位置時票號大的在上。
export function compareInColumn(a: Issue, b: Issue): number {
  return a.position - b.position || b.number - a.number;
}

// Done 的票只留最近 7 天完成的（沒有完成時間的舊資料用更新時間）。
export function isOnBoard(issue: Issue, now: number): boolean {
  if (issue.status !== 'Done') return true;
  const done = Date.parse(issue.completed_at ?? issue.updated_at);
  return Number.isFinite(done) && now - done < DONE_WINDOW_MS;
}

export function groupColumns(issues: readonly Issue[], now: number): Columns {
  const columns = Object.fromEntries(ISSUE_STATUSES.map((s) => [s, [] as Issue[]])) as Columns;
  for (const issue of issues) {
    if (isOnBoard(issue, now)) columns[issue.status].push(issue);
  }
  for (const s of ISSUE_STATUSES) columns[s].sort(compareInColumn);
  return columns;
}

// 桌面上要畫出來的欄：固定四欄，加上展開的 Backlog／Canceled，照狀態順序。
export function shownColumns(expanded: ReadonlySet<IssueStatus>): IssueStatus[] {
  return ISSUE_STATUSES.filter((s) => (BOARD_COLUMNS as readonly IssueStatus[]).includes(s) || expanded.has(s));
}

// 寫回 API 的位置：放在某張的上面（before）或下面（after）。空欄不用指定，後端放到最上面。
export type Placement = { before: string } | { after: string } | undefined;

// column 是目標欄、不含要移動的那張；index 是放下後它在這一欄的第幾個。
export function placementAt(column: readonly Issue[], index: number): Placement {
  if (column.length === 0) return undefined;
  const below = column[index];
  if (below !== undefined) return { before: below.identifier };
  const last = column[column.length - 1];
  return last === undefined ? undefined : { after: last.identifier };
}

// 樂觀更新時先在本機算一個 position，讓排序馬上對；API 回來後換成後端算的值。
export function positionAt(column: readonly Issue[], index: number): number {
  const first = column[0];
  const last = column[column.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (index <= 0) return first.position - POSITION_STEP;
  if (index >= column.length) return last.position + POSITION_STEP;
  const above = column[index - 1];
  const below = column[index];
  if (above === undefined || below === undefined) return last.position + POSITION_STEP;
  return (above.position + below.position) / 2;
}

// 這張票現在在自己那一欄的位置（給「復原」用：放回原本那張的上面或下面）。
export function currentPlacement(columns: Columns, issue: Issue): Placement {
  const column = columns[issue.status];
  const index = column.findIndex((i) => i.number === issue.number);
  if (index === -1) return undefined;
  return placementAt(without(column, issue.number), index);
}

export function without(column: readonly Issue[], number: number): Issue[] {
  return column.filter((i) => i.number !== number);
}

// 本機先把票移到 status 欄的第 index 個（樂觀更新）。完成／取消時間跟後端規則一樣：
// 移到 Done 填完成時間、移到 Canceled 填取消時間，移到其他欄就清掉。
export function moveLocally(issues: readonly Issue[], columns: Columns, number: number, status: IssueStatus, index: number, nowIso: string): Issue[] {
  return issues.map((issue) => {
    if (issue.number !== number) return issue;
    const target = without(columns[status], number);
    const changed = issue.status !== status;
    return {
      ...issue,
      status,
      position: positionAt(target, index),
      completed_at: changed ? (status === 'Done' ? nowIso : null) : issue.completed_at,
      canceled_at: changed ? (status === 'Canceled' ? nowIso : null) : issue.canceled_at,
    };
  });
}

// 用 API 回來的票取代本機那張；找不到（例如刷新後已不在範圍）就不動。
export function replaceIssue(issues: readonly Issue[], next: Issue): Issue[] {
  return issues.map((issue) => (issue.number === next.number ? next : issue));
}
