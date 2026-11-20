// 開票對話框依目前畫面預填（docs/design/ia/flows.md 第 1 步、components.md 第 13 節）。只有資料計算，不碰 React，方便測。
//   Project 頁（/projects/:id） → 該 Project
//   列表（/issues、Project 頁的列表分頁）→ 篩選中的 Project、狀態（只有一個值時才預填）
//   看板欄標題的＋              → 該欄狀態（蓋過上面的）
// 其他都不預填；狀態預設 Todo（開了就是要做的事，跟原型一樣）。產品不放 Sprint（NX-160），不預填 Sprint。
import type { IssueStatus } from '../api/types';
import { parseListQuery } from '../issues/listQuery';

export const DEFAULT_STATUS: IssueStatus = 'Todo';

export interface CreatePrefill {
  status: IssueStatus;
  projectId: number | null;
}

export interface CreateOverride {
  status?: IssueStatus;
}

function projectIdFromPath(pathname: string): number | null {
  const m = /^\/projects\/(\d+)\/?$/.exec(pathname);
  return m?.[1] === undefined ? null : Number(m[1]);
}

export function prefillFor(pathname: string, search: string, override: CreateOverride = {}): CreatePrefill {
  const params = new URLSearchParams(search);
  const out: CreatePrefill = { status: DEFAULT_STATUS, projectId: null };

  const pagedProject = projectIdFromPath(pathname);
  if (pagedProject !== null) out.projectId = pagedProject;

  const isList = pathname === '/issues' || pathname === '/issues/' || (pagedProject !== null && params.get('tab') === 'list');
  if (isList) {
    const q = parseListQuery(params);
    if (pagedProject === null && typeof q.project === 'number') out.projectId = q.project;
    const only = q.statuses.length === 1 ? q.statuses[0] : undefined;
    // 沒帶 status 時 parseListQuery 回預設的四種，不會只有一個，所以不會誤填
    if (only !== undefined && params.has('status')) out.status = only;
  }

  if (override.status !== undefined) out.status = override.status;
  return out;
}
