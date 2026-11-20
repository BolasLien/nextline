// 全部 Project，整個 App 共用一份：側欄 Project 清單、/projects、Project 頁。
// 網頁上新增或修改 Project 後呼叫 upsert，側欄馬上跟著變，不用重新整理。
// 排序（NX-162）：釘選的在最上面，其餘照最近有更新（last_activity_at）。票改了（issueSync）或寫了 comment（touch）
// 就把那個 Project 往上推；另外每 60 秒、視窗回到焦點時重抓一次（不顯示 skeleton），別人（agent）改的也會跟上。
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApiContext } from '../api/ApiProvider';
import { ApiError, MESSAGES } from '../api/client';
import type { Project } from '../api/types';
import { useIssueUpdates } from '../issue/issueSync';
import { REFRESH_MS } from '../issues/useIssues';
import { useToast } from '../toast/ToastProvider';
import { touchProject, upsertProject, withPinned } from './projects';

export type ProjectsState =
  | { status: 'loading'; projects: null; error: null }
  | { status: 'success'; projects: Project[]; error: null }
  | { status: 'error'; projects: null; error: ApiError };

type ProjectsValue = ProjectsState & {
  reload: () => void;
  upsert: (project: Project) => void;
  // 這個 Project 底下有新動靜（例如寫了 comment），at 是那個時間
  touch: (projectId: number, at: string) => void;
  // 釘選或取消：畫面先變，API 失敗退回並跳 toast
  setPinned: (project: Project, pinned: boolean) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { api } = useApiContext();
  const { show } = useToast();
  const [state, setState] = useState<ProjectsState>({ status: 'loading', projects: null, error: null });
  const [attempt, setAttempt] = useState(0);
  // 本機改過清單就 +1；重抓途中本機有改，就不拿舊的結果蓋掉
  const version = useRef(0);

  useEffect(() => {
    let alive = true;
    api.listProjects().then(
      ({ projects }) => { if (alive) setState({ status: 'success', projects, error: null }); },
      (e: unknown) => {
        if (alive) setState({ status: 'error', projects: null, error: e instanceof ApiError ? e : new ApiError(500, MESSAGES.unknown) });
      },
    );
    return () => { alive = false; };
  }, [api, attempt]);

  useEffect(() => {
    if (state.status !== 'success') return;
    let alive = true;
    let running = false;
    async function refresh() {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      const started = version.current;
      try {
        const { projects } = await api.listProjects();
        if (alive && version.current === started) setState({ status: 'success', projects, error: null });
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
  }, [api, state.status]);

  const update = useCallback((fn: (list: Project[]) => readonly Project[]) => {
    version.current++;
    setState((s) => {
      if (s.status !== 'success') return s;
      const projects = fn(s.projects);
      return projects === s.projects ? s : { ...s, projects: [...projects] };
    });
  }, []);

  const reload = useCallback(() => {
    setState({ status: 'loading', projects: null, error: null });
    setAttempt((n) => n + 1);
  }, []);
  const upsert = useCallback((project: Project) => { update((list) => upsertProject(list, project)); }, [update]);
  const touch = useCallback((projectId: number, at: string) => { update((list) => touchProject(list, projectId, at)); }, [update]);

  // 票改了（看板、票詳細、開票都會 publish）：那個 Project 往上推
  useIssueUpdates((issue) => {
    if (issue.project_id !== null) touch(issue.project_id, issue.updated_at);
  });

  const setPinned = useCallback(
    async (project: Project, pinned: boolean) => {
      upsert(withPinned(project, pinned));
      try {
        upsert(await api.updateProject(project.id, { pinned }));
      } catch (e) {
        upsert(project);
        show({ kind: 'error', message: `「${project.name}」${pinned ? '釘選' : '取消釘選'}失敗：${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [api, show, upsert],
  );

  const value = useMemo<ProjectsValue>(() => ({ ...state, reload, upsert, touch, setPinned }), [state, reload, upsert, touch, setPinned]);
  return <ProjectsContext value={value}>{children}</ProjectsContext>;
}

export function useProjects(): ProjectsValue {
  const ctx = useContext(ProjectsContext);
  if (ctx === null) throw new Error('useProjects 要在 ProjectsProvider 裡面用');
  return ctx;
}

// 票詳細寫了 comment 時通知側欄；沒有 ProjectsProvider（單獨測票詳細）時什麼都不做。
export function useTouchProject(): (projectId: number, at: string) => void {
  return useContext(ProjectsContext)?.touch ?? noop;
}

function noop() {
  // 沒有 ProjectsProvider
}
