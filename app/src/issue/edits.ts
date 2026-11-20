// 票詳細（預覽面板與整頁）上的寫入：就地編輯、blocked by、comment（含待驗收的回覆）、變更紀錄還原。
// 跟 React 分開，方便用假的 API 測（edits.test.ts）。
//
// - 欄位編輯用樂觀更新：先改畫面，API 成功換成 API 回的票並出 toast「復原」；
//   失敗把票改回原本、出錯誤 toast（附「重試」）。
// - 「復原」和變更紀錄的「還原」是同一套：找到那一筆變更，用 revert API 改回去（變更紀錄標「已還原」）。
// - 待驗收的票只有回覆（NX-239，沒有通過／退回）：寫 comment 後端直接移到 In Progress（NX-221）；畫面跟著換，toast 附「復原」。
// - 還原遇到 409（已經還原過、之後又改過、值已經不一樣），toast 說明 API 給的原因。
// - 封存／取消封存（NX-160，不做永久刪除）：同樣先改畫面、toast 附「復原」，復原走同一套 revert。
import { ApiError, type ApiClient } from '../api/client';
import type { Comment, IssueDetail, IssueEvent, IssueStatus, IssueSummary, IssueUpdate } from '../api/types';
import { ACTOR } from '../board/moves';
import type { ToastInput } from '../toast/toastStore';
import { STATUS_LABEL } from '../ui/status';

export { ACTOR };

export type FieldPatch =
  | { title: string }
  | { description: string }
  | { status: IssueStatus }
  | { project_id: number | null }
  | { sprint_id: number | null }
  | { due_date: string | null };

type PatchKey = 'title' | 'description' | 'status' | 'project_id' | 'sprint_id' | 'due_date';

// PATCH 的欄位 → 變更紀錄的 field
const EVENT_FIELD: Record<PatchKey, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  project_id: 'project',
  sprint_id: 'sprint',
  due_date: 'due_date',
};

function keyOf(patch: FieldPatch): PatchKey {
  return Object.keys(patch)[0] as PatchKey;
}

function asText(value: string | number | null): string | null {
  return value === null ? null : String(value);
}

// 畫面先套用的樣子（樂觀更新）。狀態改成 Done／Canceled 時順便填完成／取消時間，跟後端一致。
export function applyPatch(issue: IssueDetail, patch: FieldPatch, now = new Date().toISOString()): IssueDetail {
  const next = { ...issue, ...patch, updated_at: now };
  if ('status' in patch && patch.status !== issue.status) {
    next.completed_at = patch.status === 'Done' ? now : null;
    next.canceled_at = patch.status === 'Canceled' ? now : null;
  }
  return next;
}

export function isNoop(issue: IssueDetail, patch: FieldPatch): boolean {
  const key = keyOf(patch);
  return (issue[key] as unknown) === (patch as Record<string, unknown>)[key];
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface EditDeps {
  api: Pick<ApiClient, 'updateIssue' | 'listIssueEvents' | 'revertIssueEvent' | 'addBlocker' | 'removeBlocker' | 'createComment' | 'getIssue'>;
  // 目前畫面上的票
  get: () => IssueDetail;
  // 換掉畫面上的票（同時通知看板）
  set: (issue: IssueDetail) => void;
  toast: (input: ToastInput) => void;
  // 寫入成功後重抓變更紀錄
  refreshEvents: () => void;
  // 新的 comment 加進時間軸
  addComment: (comment: Comment) => void;
}

// 找最近一筆符合的變更（還沒還原、也不是「還原」本身）。
export function findEvent(events: readonly IssueEvent[], field: string, from: string | null, to: string | null): IssueEvent | undefined {
  return [...events]
    .sort((a, b) => b.id - a.id)
    .find((e) => e.field === field && e.from_value === from && e.to_value === to && e.reverted_by_event_id === null && e.revert_of_event_id === null);
}

export function createEditActions(deps: EditDeps) {
  const { api, get, set, toast, refreshEvents } = deps;
  const ref = () => get().identifier;

  // 復原剛才那次欄位修改：畫面先改回舊值（toast 同時變「已復原」），再用 revert API 改回去；
  // 找不到那筆紀錄就直接改回舊值。寫入失敗把畫面換回復原前的樣子，丟出錯誤讓 toast 提示。
  async function undoField(patch: FieldPatch, original: IssueDetail): Promise<void> {
    const key = keyOf(patch);
    const from = asText(original[key]);
    const to = asText((patch as Record<PatchKey, string | number | null>)[key]);
    const back = { [key]: original[key] } as FieldPatch;
    const before = get();
    set({ ...applyPatch(before, back), ...('status' in back ? { completed_at: original.completed_at, canceled_at: original.canceled_at } : {}) });
    try {
      const { events } = await api.listIssueEvents(ref());
      const event = findEvent(events, EVENT_FIELD[key], from, to);
      const issue = event === undefined
        ? await api.updateIssue(ref(), { ...(back as IssueUpdate), actor: ACTOR })
        : (await api.revertIssueEvent(ref(), event.id, ACTOR)).issue;
      set({ ...get(), ...issue });
    } catch (e) {
      set({ ...get(), ...pickPatch(before, key), updated_at: before.updated_at, completed_at: before.completed_at, canceled_at: before.canceled_at });
      throw e;
    } finally {
      refreshEvents();
    }
  }

  // 封存或取消封存。畫面先換（看板、列表透過 issueSync 馬上拿掉或放回），API 失敗再換回來。
  async function setArchived(on: boolean): Promise<boolean> {
    const original = get();
    if ((original.archived_at !== null) === on) return true;
    const id = original.identifier;
    set({ ...original, archived_at: on ? new Date().toISOString() : null });
    try {
      const saved = await api.updateIssue(id, { archived: on, actor: ACTOR });
      set({ ...get(), ...saved });
      toast({ message: on ? `已封存 ${id}` : `已取消封存 ${id}`, onUndo: () => undoArchived(original.archived_at, saved.archived_at) });
      refreshEvents();
      return true;
    } catch (e) {
      set({ ...get(), archived_at: original.archived_at });
      toast({ kind: 'error', message: `${on ? '封存' : '取消封存'}失敗：${errorText(e)}`, action: { label: '重試', run: async () => { await setArchived(on); } } });
      return false;
    }
  }

  // 復原封存／取消封存：畫面先改回去，再用 revert API（找不到那筆紀錄就直接 PATCH）。
  async function undoArchived(from: string | null, to: string | null): Promise<void> {
    const before = get().archived_at;
    set({ ...get(), archived_at: from });
    try {
      const { events } = await api.listIssueEvents(ref());
      const event = findEvent(events, 'archived', from, to);
      const issue = event === undefined
        ? await api.updateIssue(ref(), { archived: from !== null, actor: ACTOR })
        : (await api.revertIssueEvent(ref(), event.id, ACTOR)).issue;
      set({ ...get(), ...issue });
    } catch (e) {
      set({ ...get(), archived_at: before });
      throw e;
    } finally {
      refreshEvents();
    }
  }

  async function edit(patch: FieldPatch, message: string): Promise<boolean> {
    const original = get();
    if (isNoop(original, patch)) return true;
    set(applyPatch(original, patch));
    try {
      const saved = await api.updateIssue(original.identifier, { ...(patch as IssueUpdate), actor: ACTOR });
      set({ ...get(), ...saved });
      toast({ message, onUndo: () => undoField(patch, original) });
      refreshEvents();
      return true;
    } catch (e) {
      set({ ...get(), ...pickPatch(original, keyOf(patch)), updated_at: original.updated_at, completed_at: original.completed_at, canceled_at: original.canceled_at });
      toast({ kind: 'error', message: `儲存失敗：${errorText(e)}`, action: { label: '重試', run: async () => { await edit(patch, message); } } });
      return false;
    }
  }

  async function addBlocker(target: IssueSummary): Promise<boolean> {
    const original = get();
    if (original.blocked_by.some((b) => b.number === target.number)) return true;
    set({ ...original, blocked_by: [...original.blocked_by, target].sort((a, b) => a.number - b.number) });
    try {
      const res = await api.addBlocker(original.identifier, target.identifier, ACTOR);
      set({ ...get(), blocked_by: res.blocked_by, blocks: res.blocks });
      toast({ message: `${original.identifier} 已加入 blocked by ${target.identifier}`, onUndo: () => removeBlockerNow(target) });
      refreshEvents();
      return true;
    } catch (e) {
      set({ ...get(), blocked_by: original.blocked_by });
      toast({ kind: 'error', message: `加入失敗：${errorText(e)}`, action: { label: '重試', run: async () => { await addBlocker(target); } } });
      return false;
    }
  }

  // 復原「加入 blocked by」：畫面先拿掉，寫入失敗再放回去。
  async function removeBlockerNow(target: IssueSummary): Promise<void> {
    const before = get().blocked_by;
    set({ ...get(), blocked_by: before.filter((b) => b.number !== target.number) });
    try {
      const res = await api.removeBlocker(ref(), target.identifier, ACTOR);
      set({ ...get(), blocked_by: res.blocked_by, blocks: res.blocks });
      refreshEvents();
    } catch (e) {
      set({ ...get(), blocked_by: before });
      throw e;
    }
  }

  async function removeBlocker(target: IssueSummary): Promise<boolean> {
    const original = get();
    set({ ...original, blocked_by: original.blocked_by.filter((b) => b.number !== target.number) });
    try {
      const res = await api.removeBlocker(original.identifier, target.identifier, ACTOR);
      set({ ...get(), blocked_by: res.blocked_by, blocks: res.blocks });
      toast({
        message: `${original.identifier} 已移除 blocked by ${target.identifier}`,
        onUndo: async () => {
          const before = get().blocked_by;
          set({ ...get(), blocked_by: [...before, target].sort((a, b) => a.number - b.number) });
          try {
            const back = await api.addBlocker(ref(), target.identifier, ACTOR);
            set({ ...get(), blocked_by: back.blocked_by, blocks: back.blocks });
            refreshEvents();
          } catch (e) {
            set({ ...get(), blocked_by: before });
            throw e;
          }
        },
      });
      refreshEvents();
      return true;
    } catch (e) {
      set({ ...get(), blocked_by: original.blocked_by });
      toast({ kind: 'error', message: `移除失敗：${errorText(e)}`, action: { label: '重試', run: async () => { await removeBlocker(target); } } });
      return false;
    }
  }

  // 送 comment 並重抓票（最新的「下一步」可能變了）。
  // 待驗收的票寫 comment，後端會把票移到 In Progress（NX-221）；回傳移動前的票，讓呼叫端出可復原的 toast。
  async function postComment(text: string): Promise<{ ok: false } | { ok: true; handedBack: IssueDetail | null }> {
    const original = get();
    try {
      const created = await api.createComment(ref(), { author: ACTOR, body: text });
      deps.addComment(created);
      try {
        set({ ...get(), ...(await api.getIssue(ref())) });
      } catch {
        // comment 已經存好；下一步晚一點重抓再更新
      }
      const handedBack = original.status === 'In Review' && get().status === 'In Progress';
      if (handedBack) refreshEvents();
      return { ok: true, handedBack: handedBack ? original : null };
    } catch (e) {
      toast({ kind: 'error', message: `comment 送出失敗：${errorText(e)}。內容已保留。` });
      return { ok: false };
    }
  }

  // 寫 comment。空白不送。
  async function comment(body: string): Promise<boolean> {
    const text = body.trim();
    if (text === '') return false;
    const res = await postComment(text);
    if (!res.ok) return false;
    const from = res.handedBack;
    if (from !== null) {
      toast({ message: `${from.identifier} 已交回 agent，移到「${STATUS_LABEL['In Progress']}」`, onUndo: () => undoField({ status: 'In Progress' }, from) });
    }
    return true;
  }

  // 變更紀錄的「還原」。409 時 toast 說明原因（API 的 error 已經是中文）。
  async function revert(event: IssueEvent, describe: string): Promise<boolean> {
    try {
      const res = await api.revertIssueEvent(ref(), event.id, ACTOR);
      set({ ...get(), ...res.issue });
      toast({ message: `已還原：${describe}` });
      refreshEvents();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast({ kind: 'error', message: `無法還原：${e.message}` });
        refreshEvents();
      } else {
        toast({ kind: 'error', message: `還原失敗：${errorText(e)}` });
      }
      return false;
    }
  }

  return { edit, addBlocker, removeBlocker, comment, revert, archive: () => setArchived(true), unarchive: () => setArchived(false) };
}

export type EditActions = ReturnType<typeof createEditActions>;

function pickPatch(issue: IssueDetail, key: PatchKey): Partial<IssueDetail> {
  return { [key]: issue[key] };
}
