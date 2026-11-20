// 列表類畫面（全部的票、Project）的資料：照 API 篩選把所有頁一次抓完，
// 每 60 秒、視窗回到焦點時重抓（不顯示 skeleton，直接替換）；票詳細改了某張票，馬上併進來（issueSync）。
// 一個人和幾個 agent 的票大約幾百張，一次抓完再在前端搜尋、分組、排序，比每換條件就分頁打 API 簡單，也不會打斷分組。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiContext } from '../api/ApiProvider';
import { type ApiClient, ApiError, MESSAGES } from '../api/client';
import type { Issue, IssueListQuery } from '../api/types';
import { mergeIssue, useIssueUpdates } from '../issue/issueSync';

export const REFRESH_MS = 60_000;
// 一次最多 200 張（docs/api.md）；最多翻 10 頁。
const PAGE = 200;
const MAX_PAGES = 10;

export async function listAllIssues(api: ApiClient, query: IssueListQuery): Promise<Issue[]> {
  const out: Issue[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.listIssues({ ...query, limit: PAGE, offset: page * PAGE });
    out.push(...res.issues);
    if (!res.has_more) break;
  }
  return out;
}

export type IssuesState =
  | { status: 'loading'; issues: Issue[]; error: null }
  | { status: 'success'; issues: Issue[]; error: null }
  | { status: 'error'; issues: Issue[]; error: ApiError };

// query 是 null 時先不抓。belongs：別處改過的票還屬不屬於這個列表。
// query.archived 是 only（「已封存」列表）時，封存的票才屬於這裡；其他列表封存的票一律拿掉。
export function useIssues(query: IssueListQuery | null, belongs: (issue: Issue) => boolean): IssuesState & { reload: () => void } {
  const { api } = useApiContext();
  const [state, setState] = useState<IssuesState>({ status: 'loading', issues: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const key = query === null ? null : JSON.stringify(query);
  const queryRef = useRef(query);
  queryRef.current = query;
  // 本機併進來的修改會讓進行中的重抓作廢，避免舊資料蓋掉新的。
  const version = useRef(0);

  useEffect(() => {
    const q = queryRef.current;
    if (q === null) return;
    let alive = true;
    const started = ++version.current;
    setState((s) => ({ status: 'loading', issues: s.issues, error: null }));
    listAllIssues(api, q).then(
      (issues) => { if (alive && version.current === started) setState({ status: 'success', issues, error: null }); },
      (e: unknown) => {
        if (alive) setState({ status: 'error', issues: [], error: e instanceof ApiError ? e : new ApiError(500, MESSAGES.unknown) });
      },
    );
    return () => { alive = false; };
  }, [api, key, attempt]);

  useEffect(() => {
    if (state.status !== 'success' || key === null) return;
    let alive = true;
    let running = false;
    async function refresh() {
      const q = queryRef.current;
      if (running || q === null || document.visibilityState === 'hidden') return;
      running = true;
      const started = version.current;
      try {
        const issues = await listAllIssues(api, q);
        if (alive && version.current === started) setState({ status: 'success', issues, error: null });
      } catch {
        // 下一次再抓
      } finally {
        running = false;
      }
    }
    const tick = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    const timer = setInterval(tick, REFRESH_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [api, key, state.status]);

  useIssueUpdates((issue) => {
    version.current++;
    setState((s) => (s.status === 'success' ? { ...s, issues: mergeIssue(s.issues, issue, belongs, queryRef.current?.archived === 'only') } : s));
  });

  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);
  return { ...state, reload };
}
