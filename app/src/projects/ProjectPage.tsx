// /projects/:id：單一 Project。頁首是名稱、顏色、沒做完的張數；三個分頁照網址 ?tab=（board 預設／list／about）：
// - 看板：沿用首頁看板元件，只放這個 Project 的票
// - 列表：「全部的票」的列表，Project 篩選固定是這個 Project
// - 說明：Project 的長篇說明（Markdown；原文的 HTML 一律跳脫，見 issue/Markdown.tsx）
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import type { Project } from '../api/types';
import { BoardPage } from '../board/BoardPage';
import { Markdown } from '../issue/Markdown';
import { IssueListView } from '../issues/IssueList';
import { PageHeader } from '../shell/AppShell';
import { projectColorClass } from '../shell/sprints';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states';
import { useOpenIssues } from '../issues/OpenIssuesProvider';
import { useToast } from '../toast/ToastProvider';
import { Icon } from '../ui/Icon';
import { PinButton } from './PinButton';
import { ProjectDialog } from './ProjectDialog';
import { openCountByProject, PROJECT_TABS, parseTab, TAB_LABEL } from './projects';
import { useProjects } from './ProjectsProvider';
import './projects.css';

export function ProjectPage() {
  const { id = '' } = useParams();
  const projectId = /^\d+$/.test(id) ? Number(id) : null;
  const [params] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const project = useApi(
    (api) => (projectId === null ? Promise.reject(new ApiError(404, '找不到這個 Project')) : api.getProject(projectId)),
    [projectId],
  );
  const open = useOpenIssues();
  const shared = useProjects();
  const { show } = useToast();
  // 在這頁改過的 Project（編輯對話框存好的），蓋過一開始抓的
  const [edited, setEdited] = useState<Project | null>(null);
  const [editing, setEditing] = useState(false);
  const current = edited !== null && edited.id === projectId ? edited : project.data;
  const name = current?.name;

  useEffect(() => {
    if (name === undefined) return;
    const prev = document.title;
    document.title = `${name} · Nextline`;
    return () => { document.title = prev; };
  }, [name]);

  if (projectId === null || (project.status === 'error' && project.error.status === 404)) {
    return (
      <>
        <PageHeader title="Project" />
        <div className="view">
          <EmptyState icon="folder" title="找不到這個 Project" action={<Link className="nl-btn nl-btn--secondary" to="/projects">看全部 Project</Link>} />
        </div>
      </>
    );
  }
  if (project.status === 'error') {
    return (
      <>
        <PageHeader title="Project" />
        <div className="view">
          <ErrorState title="Project 載入失敗" message={project.error.message} {...(project.error.isUnauthorized ? {} : { onRetry: project.reload })} />
        </div>
      </>
    );
  }
  if (project.status === 'loading') {
    return (
      <>
        <PageHeader title="Project" />
        <div className="view">
          <LoadingBlock label="Project 載入中" rows={4} />
        </div>
      </>
    );
  }
  const p = current ?? project.data;
  // 釘選狀態看共用的 Project 清單（側欄同一份），按了兩邊一起變（NX-162）
  const listed = shared.projects?.find((x) => x.id === p.id);
  const openCount = open.status === 'success' ? (openCountByProject(open.issues).get(p.id) ?? 0) : null;

  return (
    <>
      <header className="topbar proj-head">
        <h1>
          <span className={`nl-pdot ${projectColorClass(p.id)}`} aria-hidden="true" />
          <span className="nm">{p.name}</span>
        </h1>
        {openCount !== null && (
          <span className="list-count" data-count="project-open">
            {openCount} 張沒做完
          </span>
        )}
        <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="編輯 Project（名稱、說明）" title="編輯 Project" data-edit-project onClick={() => { setEditing(true); }}>
          <Icon name="edit" size="sm" />
        </button>
        {listed !== undefined && <PinButton project={listed} />}
        <span className="sp" />
        <nav className="proj-tabs" aria-label="Project 分頁">
          {PROJECT_TABS.map((t) => (
            <Link key={t} to={{ search: t === 'board' ? '' : `?tab=${t}` }} aria-current={tab === t ? 'page' : undefined} data-tab={t}>
              {TAB_LABEL[t]}
            </Link>
          ))}
        </nav>
      </header>
      {tab === 'board' && <BoardPage project={p.id} />}
      {tab === 'list' && <IssueListView fixedProject={p.id} />}
      {tab === 'about' && <ProjectAbout description={p.description} />}
      {editing && (
        <ProjectDialog
          project={p}
          onClose={() => { setEditing(false); }}
          onSaved={(saved) => {
            setEditing(false);
            setEdited(saved);
            show({ message: `已更新 Project「${saved.name}」` });
          }}
        />
      )}
    </>
  );
}

export function ProjectAbout({ description }: { description: string }) {
  return (
    <div className="view">
      <article className="proj-about">
        <Markdown source={description} empty="沒有說明。" />
      </article>
    </div>
  );
}
