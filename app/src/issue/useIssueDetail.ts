// 票詳細的資料：票（含 blocked by）、變更紀錄、comment、Project 與 Sprint 名稱。
// 寫入都走 edits.ts；畫面上的票每次換掉都通知看板（issueSync），看板改了也會更新這裡。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiContext } from '../api/ApiProvider';
import { ApiError, MESSAGES } from '../api/client';
import type { Comment, IssueDetail, IssueEvent, Project, Sprint } from '../api/types';
import { useTouchProject } from '../projects/ProjectsProvider';
import { useToast } from '../toast/ToastProvider';
import { createEditActions, type EditActions } from './edits';
import { useIssueSync, useIssueUpdates } from './issueSync';

export interface DetailData {
  issue: IssueDetail;
  events: IssueEvent[];
  comments: Comment[];
  projects: Project[];
  sprints: Sprint[];
}

export type DetailState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; data: DetailData };

export function useIssueDetail(ref: string): { state: DetailState; actions: EditActions; reload: () => void } {
  const { api } = useApiContext();
  const { show } = useToast();
  const sync = useIssueSync();
  const touchProject = useTouchProject();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const dataRef = useRef<DetailData | null>(null);
  dataRef.current = state.status === 'success' ? state.data : null;

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([api.getIssue(ref), api.listIssueEvents(ref), api.listComments(ref), api.listProjects(), api.listSprints()]).then(
      ([issue, { events }, { comments }, { projects }, { sprints }]) => {
        if (alive) setState({ status: 'success', data: { issue, events, comments, projects, sprints } });
      },
      (e: unknown) => {
        if (alive) setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError(500, MESSAGES.unknown) });
      },
    );
    return () => { alive = false; };
  }, [api, ref, attempt]);

  const patchData = useCallback((fn: (d: DetailData) => DetailData) => {
    setState((s) => (s.status === 'success' ? { status: 'success', data: fn(s.data) } : s));
  }, []);

  // 看板（或別的地方）改了同一張票：換掉看得到的欄位，blocked by 這些詳細頁才有的留著。
  useIssueUpdates((issue) => {
    const cur = dataRef.current;
    if (cur?.issue.number !== issue.number) return;
    const merged = { ...cur.issue, ...issue };
    if (dataRef.current !== null) dataRef.current = { ...cur, issue: merged };
    patchData((d) => ({ ...d, issue: merged }));
  });

  const actions = useMemo(() => {
    const get = (): IssueDetail => {
      const cur = dataRef.current;
      if (cur === null) throw new Error('票還沒載入');
      return cur.issue;
    };
    return createEditActions({
      api,
      get,
      set: (issue) => {
        const cur = dataRef.current;
        if (cur !== null) dataRef.current = { ...cur, issue };
        patchData((d) => ({ ...d, issue }));
        sync.publish(issue);
      },
      toast: show,
      refreshEvents: () => {
        const n = dataRef.current?.issue.identifier;
        if (n === undefined) return;
        api.listIssueEvents(n).then(
          ({ events }) => { patchData((d) => (d.issue.identifier === n ? { ...d, events } : d)); },
          () => { /* 下次再抓 */ },
        );
      },
      addComment: (comment) => {
        patchData((d) => ({ ...d, comments: [...d.comments, comment] }));
        // 側欄的 Project 照最近有更新排序，comment 也算（NX-162）
        const projectId = dataRef.current?.issue.project_id;
        if (projectId !== undefined && projectId !== null) touchProject(projectId, comment.created_at);
      },
    });
  }, [api, patchData, show, sync, touchProject]);

  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);
  return { state, actions, reload };
}
