// 看板和票詳細（預覽面板、整頁）共用的「這張票剛變了」通知：
// 任何一邊寫入（含樂觀更新與失敗退回）就 publish，另一邊收到後換掉自己手上那一張，不用等 60 秒重抓。
import { createContext, useContext, useEffect, useRef } from 'react';
import type { Issue } from '../api/types';

export type IssueListener = (issue: Issue) => void;

export class IssueSync {
  private readonly listeners = new Set<IssueListener>();

  publish(issue: Issue): void {
    for (const l of [...this.listeners]) l(issue);
  }

  subscribe(listener: IssueListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export const IssueSyncContext = createContext<IssueSync | null>(null);

export function useIssueSync(): IssueSync {
  const sync = useContext(IssueSyncContext);
  if (sync === null) throw new Error('useIssueSync 要在 IssueSyncContext 裡面用');
  return sync;
}

// 訂閱別處改了哪張票；listener 每次 render 都可以換，不會重新訂閱。
export function useIssueUpdates(listener: IssueListener): void {
  const sync = useIssueSync();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => sync.subscribe((issue) => { ref.current(issue); }), [sync]);
}

// 把收到的票併進列表：已經在列表裡就換掉（保留列表沒有的欄位），不屬於這個範圍了就拿掉，
// 新屬於這個範圍的就加進來。belongs 由看板決定（例如「在這個 Project 裡」）。
// 封存的票只屬於「已封存」列表（archived = true），其他列表一律拿掉（NX-160）。
export function mergeIssue<T extends Issue>(list: readonly T[], issue: Issue, belongs: (issue: Issue) => boolean, archived = false): T[] {
  const index = list.findIndex((i) => i.number === issue.number);
  const keep = (issue.archived_at !== null) === archived && belongs(issue);
  if (index === -1) return keep ? [...list, pickIssue(issue) as T] : [...list];
  if (!keep) return list.filter((i) => i.number !== issue.number);
  const current = list[index] as T;
  const next = [...list];
  next[index] = { ...current, ...pickIssue(issue) };
  return next;
}

// 只取 Issue 的欄位，詳細頁多出來的 blocked_by／blocks 不帶進看板。
function pickIssue(issue: Issue): Issue {
  return {
    number: issue.number,
    identifier: issue.identifier,
    legacy_identifier: issue.legacy_identifier,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    position: issue.position,
    project_id: issue.project_id,
    sprint_id: issue.sprint_id,
    due_date: issue.due_date,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    completed_at: issue.completed_at,
    canceled_at: issue.canceled_at,
    archived_at: issue.archived_at,
    next_step: issue.next_step,
  };
}
