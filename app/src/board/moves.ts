// 看板上搬票寫回 API、以及「復原」（components.md「Done 與復原」、flows.md「做錯了移回來」）。
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { IssueDetail, IssueStatus, IssueUpdate } from '../api/types';
import type { Placement } from './columns';

// 網頁上的變更都記在 Bolas 名下（變更紀錄的 actor）。
export const ACTOR = 'Bolas';

export interface MoveTarget {
  status: IssueStatus;
  placement: Placement;
}

// 搬到 status 欄、放在 placement 指的位置。狀態沒變就只改位置（後端不寫變更紀錄）。
export function saveMove(api: Pick<ApiClient, 'updateIssue'>, ref: string, fromStatus: IssueStatus, to: MoveTarget): Promise<IssueDetail> {
  const body: IssueUpdate = { actor: ACTOR, ...(to.placement ?? {}) };
  if (to.status !== fromStatus) body.status = to.status;
  return api.updateIssue(ref, body);
}

export interface UndoRecord {
  ref: string;
  from: MoveTarget;
  toStatus: IssueStatus;
}

// 復原一次換欄：
// 1. 狀態用變更紀錄的「還原」改回去（變更紀錄標「已還原」，跟票詳細頁的還原同一套）；
//    找不到那筆（例如紀錄還沒寫進去）就直接改回原狀態。
// 2. 還原會把票放到那一欄最上面，所以再把位置放回原本那張的上面或下面。
//    原本的鄰居已經搬走（400）時，狀態已經回去了，位置就留在欄頂，不算失敗。
export async function undoMove(
  api: Pick<ApiClient, 'listIssueEvents' | 'revertIssueEvent' | 'updateIssue'>,
  record: UndoRecord,
): Promise<IssueDetail> {
  const { events } = await api.listIssueEvents(record.ref);
  const event = [...events]
    .reverse()
    .find(
      (e) =>
        e.field === 'status' &&
        e.from_value === record.from.status &&
        e.to_value === record.toStatus &&
        e.reverted_by_event_id === null &&
        e.revert_of_event_id === null,
    );
  let issue = event === undefined
    ? await api.updateIssue(record.ref, { status: record.from.status, actor: ACTOR })
    : (await api.revertIssueEvent(record.ref, event.id, ACTOR)).issue;
  if (record.from.placement !== undefined) {
    try {
      issue = await api.updateIssue(record.ref, { ...record.from.placement, actor: ACTOR });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 400)) throw e;
    }
  }
  return issue;
}
