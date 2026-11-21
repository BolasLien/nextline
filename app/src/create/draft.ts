// 開票對話框的草稿：初始值、算不算「有草稿」（Esc 時要不要先問）、轉成 API 的內容、送出與同步。
import type { ApiClient } from '../api/client';
import type { IssueCreate, IssueDetail, IssueStatus, IssueSummary } from '../api/types';
import { actor } from '../owner/owner';
import type { IssueSync } from '../issue/issueSync';

export interface CreateDraft {
  title: string;
  description: string;
  status: IssueStatus;
  projectId: number | null;
  // YYYY-MM-DD；沒填是 null
  dueDate: string | null;
  blockers: IssueSummary[];
}

export function emptyDraft(fields: Pick<CreateDraft, 'status' | 'projectId'>): CreateDraft {
  return { title: '', description: '', dueDate: null, blockers: [], ...fields };
}

// 「建立後繼續建立下一張」：清掉這一張自己的內容，狀態、Project 留著，連續開同一類的票比較快。
export function nextDraft(d: CreateDraft): CreateDraft {
  return emptyDraft({ status: d.status, projectId: d.projectId });
}

// 有沒有使用者自己打的東西：標題、描述、到期日、blocked by，或改過預填的欄位。
// 只是打開又關掉（或只按了空白）不算，Esc 直接關。
export function isDirty(d: CreateDraft, initial: CreateDraft): boolean {
  return (
    d.title.trim() !== '' ||
    d.description.trim() !== '' ||
    d.dueDate !== null ||
    d.blockers.length > 0 ||
    d.status !== initial.status ||
    d.projectId !== initial.projectId
  );
}

export function createBody(d: CreateDraft): IssueCreate {
  const body: IssueCreate = { title: d.title.trim(), status: d.status };
  const description = d.description.trim();
  if (description !== '') body.description = description;
  if (d.projectId !== null) body.project_id = d.projectId;
  if (d.dueDate !== null) body.due_date = d.dueDate;
  return body;
}

export interface CreateResult {
  issue: IssueDetail;
  // 票開好了，但有 blocked by 沒加上去（例如那張票剛好不見了）：票不退回，另外告訴使用者
  blockerErrors: string[];
}

// 送出：開票（API 把新票放在那一欄最上面）→ 逐一加 blocked by → 通知看板、列表、側欄張數（issueSync）。
export async function submitDraft(api: ApiClient, sync: IssueSync, d: CreateDraft): Promise<CreateResult> {
  let issue = await api.createIssue(createBody(d));
  const blockerErrors: string[] = [];
  for (const b of d.blockers) {
    try {
      const res = await api.addBlocker(issue.identifier, b.identifier, actor());
      issue = { ...issue, blocked_by: res.blocked_by, blocks: res.blocks };
    } catch (e) {
      blockerErrors.push(`${b.identifier}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  sync.publish(issue);
  return { issue, blockerErrors };
}
