import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ApiProvider } from './api/ApiProvider';
import type { ApiClient } from './api/client';
import { BoardPage } from './board/BoardPage';
import { IssuePage } from './issue/IssuePage';
import { IssueSync, IssueSyncContext } from './issue/issueSync';
import { IssuesPage } from './issues/IssueList';
import { NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { ActiveIssueContext, ActiveIssueStore } from './palette/activeIssue';
import { ProjectPage } from './projects/ProjectPage';
import { ProjectsPage } from './projects/ProjectsPage';
import { ProjectsProvider } from './projects/ProjectsProvider';
import { WAITING_PATH } from './shell/NavSections';
import { AppShell } from './shell/AppShell';
import { ThemeProvider } from './theme/ThemeProvider';
import type { ThemeChoice } from './theme/theme';
import { ToastProvider } from './toast/ToastProvider';
import { OpenIssuesProvider } from './issues/OpenIssuesProvider';

// 網址照 docs/design/ia/README.md 第 3 段。router 由外面給（瀏覽器用 BrowserRouter，測試用 MemoryRouter）。
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<BoardPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="issues" element={<IssuesPage />} />
        <Route path="issues/:ref" element={<IssuePage />} />
        {/* 「等你」專屬頁在階段二做（加上「指派給我」）；現在是待驗收的列表。
            NX-160 拿掉三區、Sprint、自訂 view（2026-11-03／11-04 Bolas），舊網址回看板 */}
        <Route path="me" element={<Navigate to={WAITING_PATH} replace />} />
        <Route path="zones" element={<Navigate to="/" replace />} />
        <Route path="sprints/:number" element={<Navigate to="/" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="views/:id" element={<Navigate to="/" replace />} />
        <Route path="settings/*" element={<PlaceholderPage title="設定" icon="settings" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App({ client, theme }: { client?: ApiClient; theme?: ThemeChoice }) {
  // 看板與票詳細共用：一邊改了票，另一邊馬上跟著變（issue/issueSync.ts）
  const [sync] = useState(() => new IssueSync());
  // 目前打開的票（指令面板的「改狀態成…」用）
  const [activeIssues] = useState(() => new ActiveIssueStore());
  return (
    <ThemeProvider {...(theme ? { initial: theme } : {})}>
      <ApiProvider {...(client ? { client } : {})}>
        <IssueSyncContext value={sync}>
          <ActiveIssueContext value={activeIssues}>
            <ToastProvider>
              {/* 全部沒做完的票整個 App 共用一份：側欄「等你」、Project 張數算出來一定一致 */}
              <OpenIssuesProvider>
                {/* Project 清單也共用一份：網頁上新增、改名後側欄馬上更新 */}
                <ProjectsProvider>
                  <AppRoutes />
                </ProjectsProvider>
              </OpenIssuesProvider>
            </ToastProvider>
          </ActiveIssueContext>
        </IssueSyncContext>
      </ApiProvider>
    </ThemeProvider>
  );
}
