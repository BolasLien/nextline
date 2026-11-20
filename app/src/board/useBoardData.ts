// 看板的資料：全部沒做完的票（加上最近 7 天動過的 Done／Canceled）、Project 名稱與顏色。
// 2026-11-04 Bolas：產品不放 Sprint，首頁看板顯示全部沒做完的票（NX-160）。
// 每 60 秒、以及視窗重新取得焦點時重抓一次；重抓不顯示 skeleton，直接替換（components.md 第 17 節）。
// 拖曳中或還有寫入沒回來時不套用重抓的結果，避免把樂觀更新蓋回舊資料。
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useApiContext } from '../api/ApiProvider';
import { type ApiClient, ApiError, MESSAGES } from '../api/client';
import type { Issue, IssueListQuery, IssueStatus, Project } from '../api/types';
import { DONE_WINDOW_MS } from './columns';

export const REFRESH_MS = 60_000;
// 一次最多 200 張（docs/api.md）；超過就翻頁，最多翻到這麼多頁。
const PAGE = 200;
const MAX_PAGES = 10;

export interface BoardMeta {
  projects: ReadonlyMap<number, Project>;
}

export type BoardLoad =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; meta: BoardMeta };

async function listAll(api: ApiClient, query: IssueListQuery): Promise<Issue[]> {
  const out: Issue[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.listIssues({ ...query, sort: 'position', limit: PAGE, offset: page * PAGE });
    out.push(...res.issues);
    if (!res.has_more) break;
  }
  return out;
}

const OPEN: IssueStatus[] = ['Backlog', 'Todo', 'In Progress', 'In Review'];

// 全部沒做完的票，加上最近 7 天內動過的 Done／Canceled（剛拖過去的票不會消失）。
// project 有給（Project 頁的看板分頁）：只抓這個 Project 的票。
async function loadBoard(api: ApiClient, now: Date, project: number | null): Promise<{ meta: BoardMeta; issues: Issue[] }> {
  const since = new Date(now.getTime() - DONE_WINDOW_MS).toISOString();
  const only = project === null ? {} : { project };
  const [{ projects }, open, closed] = await Promise.all([
    api.listProjects(),
    listAll(api, { status: OPEN, ...only }),
    listAll(api, { status: ['Done', 'Canceled'], updated_since: since, ...only }),
  ]);
  return { meta: { projects: new Map(projects.map((p) => [p.id, p])) }, issues: [...open, ...closed] };
}

export interface BoardData {
  load: BoardLoad;
  issues: Issue[];
  // 本機的修改（樂觀更新、API 回來的結果、失敗退回）都走這裡；會讓進行中的重抓作廢。
  setIssues: Dispatch<SetStateAction<Issue[]>>;
  // 拖曳或寫入期間呼叫，回傳的函式在結束時呼叫；期間不套用重抓結果。
  hold: () => () => void;
  reload: () => void;
}

export function useBoardData(project: number | null = null): BoardData {
  const { api } = useApiContext();
  const [load, setLoad] = useState<BoardLoad>({ status: 'loading' });
  const [issues, setIssuesState] = useState<Issue[]>([]);
  const version = useRef(0);
  const holds = useRef(0);
  const [attempt, setAttempt] = useState(0);

  const setIssues = useCallback<Dispatch<SetStateAction<Issue[]>>>((next) => {
    version.current++;
    setIssuesState(next);
  }, []);

  const hold = useCallback(() => {
    holds.current++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current--;
    };
  }, []);

  // 第一次載入（或換 Project、按再試一次）：顯示載入中。
  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    const started = ++version.current;
    loadBoard(api, new Date(), project).then(
      ({ meta, issues: list }) => {
        if (!alive) return;
        if (version.current === started) setIssuesState(list);
        setLoad({ status: 'success', meta });
      },
      (e: unknown) => {
        if (alive) setLoad({ status: 'error', error: e instanceof ApiError ? e : new ApiError(500, MESSAGES.unknown) });
      },
    );
    return () => { alive = false; };
  }, [api, project, attempt]);

  // 重抓：每 60 秒、視窗回到焦點。失敗就留著目前的畫面，下次再抓。
  useEffect(() => {
    if (load.status !== 'success') return;
    let alive = true;
    let running = false;
    async function refresh() {
      if (running || holds.current > 0 || document.visibilityState === 'hidden') return;
      running = true;
      const started = version.current;
      try {
        const { meta, issues: list } = await loadBoard(api, new Date(), project);
        if (!alive || holds.current > 0 || version.current !== started) return;
        setIssuesState(list);
        setLoad({ status: 'success', meta });
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
  }, [api, project, load.status]);

  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);
  return { load, issues, setIssues, hold, reload };
}
