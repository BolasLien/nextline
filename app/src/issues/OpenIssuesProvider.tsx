// 全部沒做完的票，整個 App 共用一份：側欄／手機分頁列「等你」的張數（待驗收）、/projects 與 Project 頁的票數都從這裡算，
// 看板或票詳細改了票（issueSync）馬上跟著變。
import { createContext, type ReactNode, useContext } from 'react';
import { type Issue, OPEN_STATUSES } from '../api/types';
import { type IssuesState, useIssues } from './useIssues';

type OpenIssues = IssuesState & { reload: () => void };

const OpenIssuesContext = createContext<OpenIssues | null>(null);

const QUERY = { status: [...OPEN_STATUSES] };
const isOpen = (i: Issue) => (OPEN_STATUSES as readonly string[]).includes(i.status);

export function OpenIssuesProvider({ children }: { children: ReactNode }) {
  const state = useIssues(QUERY, isOpen);
  return <OpenIssuesContext value={state}>{children}</OpenIssuesContext>;
}

export function useOpenIssues(): OpenIssues {
  const ctx = useContext(OpenIssuesContext);
  if (ctx === null) throw new Error('useOpenIssues 要在 OpenIssuesProvider 裡面用');
  return ctx;
}

// 側欄「等你」：待驗收（In Review）的張數。還沒載入是 undefined。
// 階段二加上「指派給我」後再擴大範圍（docs/design/ia/README.md）。
export function useWaitingCount(): number | undefined {
  const { status, issues } = useOpenIssues();
  return status === 'success' ? issues.filter((i) => i.status === 'In Review').length : undefined;
}
