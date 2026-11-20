// /projects：全部 Project（含票都做完、不在側欄的），每個顯示沒做完的票數（跟側欄「等你」用同一份沒做完的票）
// 與最後更新時間（last_activity_at，「3 小時前」，滑過看完整時間；NX-165）。
// 順序跟側欄一樣：釘選的在最上面，其餘照最近有更新；每列右邊有釘選按鈕（NX-162）。
// 頁首「新增 Project」打開 ProjectDialog；建好後加進共用清單（ProjectsProvider），並進到那個 Project；還沒有票的 Project 也馬上出現在側欄（NX-165）。
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOpenIssues } from '../issues/OpenIssuesProvider';
import { PageHeader } from '../shell/AppShell';
import { projectColorClass } from '../shell/sprints';
import { useToast } from '../toast/ToastProvider';
import { Icon } from '../ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states';
import { PinButton } from './PinButton';
import { ProjectDialog } from './ProjectDialog';
import { fullTime, relativeTime } from '../ui/time';
import { openCountByProject, sortProjects } from './projects';
import { useProjects } from './ProjectsProvider';
import './projects.css';

export function ProjectsPage() {
  const projects = useProjects();
  const open = useOpenIssues();
  const navigate = useNavigate();
  const { show } = useToast();
  const [creating, setCreating] = useState(false);
  const counts = open.status === 'success' ? openCountByProject(open.issues) : null;
  const addButton = (
    <button type="button" className="nl-btn nl-btn--primary nl-btn--sm" data-new-project onClick={() => { setCreating(true); }}>
      <Icon name="plus" size="sm" />
      新增 Project
    </button>
  );

  let body;
  if (projects.status === 'error') {
    body = <ErrorState title="Project 載入失敗" message={projects.error.message} {...(projects.error.isUnauthorized ? {} : { onRetry: projects.reload })} />;
  } else if (projects.status === 'loading') {
    body = <LoadingBlock label="Project 載入中" rows={5} />;
  } else if (projects.projects.length === 0) {
    body = <EmptyState icon="folder" title="沒有 Project" action={addButton}>每個 feature 或一件事建立一個 Project，集中相關的票。</EmptyState>;
  } else {
    body = (
      <ul className="proj-list">
        {sortProjects(projects.projects).map((p) => (
          <li key={p.id} className="proj-li">
            <Link className="proj-row" to={`/projects/${String(p.id)}`} data-project={p.id}>
              <span className={`nl-pdot ${projectColorClass(p.id)}`} aria-hidden="true" />
              <span className="nm">{p.name}</span>
              <time className="upd" dateTime={p.last_activity_at} title={fullTime(p.last_activity_at)} data-updated={p.id}>
                {relativeTime(p.last_activity_at)}
              </time>
              <span className="n" data-open-count={p.id}>
                {counts === null ? '…' : `${String(counts.get(p.id) ?? 0)} 張沒做完`}
              </span>
              <Icon name="chev-right" size="sm" />
            </Link>
            <PinButton project={p} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <PageHeader title="全部 Project">{projects.status === 'success' && projects.projects.length > 0 && addButton}</PageHeader>
      <div className="view">{body}</div>
      {creating && (
        <ProjectDialog
          onClose={() => { setCreating(false); }}
          onSaved={(p) => {
            setCreating(false);
            show({ message: `已新增 Project「${p.name}」` });
            void navigate(`/projects/${String(p.id)}`);
          }}
        />
      )}
    </>
  );
}
