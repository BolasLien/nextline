// 「已封存」列表上的「取消封存」（NX-160）：列表只有 Issue，沒有票詳細的寫入流程，這裡直接打 API。
// 先改畫面（issueSync：從已封存列表拿掉、放回看板與列表），API 失敗再換回來；toast 附「復原」（再封存回去）。
import type { ApiClient } from '../api/client';
import type { Issue } from '../api/types';
import { ACTOR } from '../board/moves';
import { errorText, findEvent } from '../issue/edits';
import type { IssueSync } from '../issue/issueSync';
import type { ToastInput } from '../toast/toastStore';

export async function unarchiveFromList(
  api: Pick<ApiClient, 'updateIssue' | 'listIssueEvents' | 'revertIssueEvent'>,
  sync: Pick<IssueSync, 'publish'>,
  toast: (input: ToastInput) => void,
  issue: Issue,
): Promise<boolean> {
  const id = issue.identifier;
  const from = issue.archived_at;
  sync.publish({ ...issue, archived_at: null });
  try {
    const saved = await api.updateIssue(id, { archived: false, actor: ACTOR });
    sync.publish(saved);
    toast({
      message: `已取消封存 ${id}`,
      onUndo: async () => {
        sync.publish({ ...saved, archived_at: from });
        try {
          const { events } = await api.listIssueEvents(id);
          const event = findEvent(events, 'archived', from, null);
          sync.publish(event === undefined ? await api.updateIssue(id, { archived: true, actor: ACTOR }) : (await api.revertIssueEvent(id, event.id, ACTOR)).issue);
        } catch (e) {
          sync.publish(saved);
          throw e;
        }
      },
    });
    return true;
  } catch (e) {
    sync.publish(issue);
    toast({ kind: 'error', message: `取消封存失敗：${errorText(e)}` });
    return false;
  }
}
