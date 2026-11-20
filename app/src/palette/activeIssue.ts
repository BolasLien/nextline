// 目前打開著的那張票（右側預覽或整頁）：票詳細載入後登記，指令面板開的時候讀，
// 「改狀態成…」「移回…」直接用票詳細的寫入流程（issue/edits.ts：樂觀更新、toast「復原」、看板同步）。
import { createContext, useContext, useEffect } from 'react';
import type { IssueDetail, IssueEvent } from '../api/types';
import type { EditActions } from '../issue/edits';

export interface ActiveIssue {
  issue: IssueDetail;
  events: readonly IssueEvent[];
  actions: EditActions;
}

export class ActiveIssueStore {
  private entry: { owner: symbol; value: ActiveIssue } | null = null;

  get current(): ActiveIssue | null {
    return this.entry?.value ?? null;
  }

  set(owner: symbol, value: ActiveIssue): void {
    this.entry = { owner, value };
  }

  clear(owner: symbol): void {
    if (this.entry?.owner === owner) this.entry = null;
  }
}

export const ActiveIssueContext = createContext<ActiveIssueStore | null>(null);

export function useActiveIssueStore(): ActiveIssueStore | null {
  return useContext(ActiveIssueContext);
}

// 票詳細呼叫：每次票、變更紀錄換了就更新；離開畫面時拿掉（只拿掉自己登記的）。
export function useRegisterActiveIssue(value: ActiveIssue): void {
  const store = useContext(ActiveIssueContext);
  const { issue, events, actions } = value;
  useEffect(() => {
    if (store === null) return;
    const owner = Symbol('active-issue');
    store.set(owner, { issue, events, actions });
    return () => { store.clear(owner); };
  }, [store, issue, events, actions]);
}
