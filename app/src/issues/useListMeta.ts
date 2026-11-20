// 列表類畫面共用：Project 清單（名稱與顏色），以及點一列怎麼打開。
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { type ApiState, useApi } from '../api/ApiProvider';
import type { Issue, Project } from '../api/types';
import { MOBILE_QUERY, useMediaQuery } from '../ui/useMediaQuery';

export interface ListMeta {
  projects: Project[];
  projectMap: ReadonlyMap<number, Project>;
}

export function useListMeta(): ApiState<ListMeta> & { reload: () => void } {
  const res = useApi(async (api) => {
    const { projects } = await api.listProjects();
    return { projects, projectMap: new Map(projects.map((p) => [p.id, p])) };
  }, []);
  return res;
}

// 點一列：桌面開右側預覽（?peek=NX-n，其他網址參數保留），回傳 true；手機回傳 false，照連結進整頁。
export function usePeekOpener(): { peek: string | null; open: (issue: Issue) => boolean } {
  const [params, setParams] = useSearchParams();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const open = useCallback(
    (issue: Issue) => {
      if (isMobile) return false;
      setParams((p) => {
        const q = new URLSearchParams(p);
        q.set('peek', issue.identifier);
        return q;
      });
      return true;
    },
    [isMobile, setParams],
  );
  const peek = params.get('peek');
  return useMemo(() => ({ peek: peek === null ? null : peek.toUpperCase(), open }), [peek, open]);
}
