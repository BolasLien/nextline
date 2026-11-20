// 側欄與手機「更多」共用的導覽：Project 清單。2026-11-04 Bolas：產品不放 Sprint、不做 view（NX-160）。
import { Link, useLocation } from 'react-router';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/states';
import { PinButton } from '../projects/PinButton';
import { sidebarProjects } from '../projects/projects';
import { useProjects } from '../projects/ProjectsProvider';
import { projectColorClass } from './sprints';

// 目前頁：路徑相同，而且 match 裡指定的網址參數都一樣（「等你」和「全部的票」同是 /issues，差在 status=in_review）。
export function useIsCurrent(): (to: string) => boolean {
  const location = useLocation();
  return (to: string) => {
    const target = new URL(to, 'http://x');
    if (target.pathname !== location.pathname) return false;
    const here = new URLSearchParams(location.search);
    if (target.search === '') return !isWaiting(here);
    return [...target.searchParams].every(([k, v]) => here.get(k) === v);
  };
}

// 網址是不是「等你」（/issues?status=in_review）
export function isWaiting(params: URLSearchParams): boolean {
  return params.get('status') === new URL(WAITING_PATH, 'http://x').searchParams.get('status');
}

export function NavItem({ to, icon, dot, children, count, quiet = false, countKey, onNavigate }: {
  to: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  dot?: string;
  children: React.ReactNode;
  count?: number | undefined;
  // 次要的張數（灰色），不像「等你」那樣用主色
  quiet?: boolean;
  // e2e 用來找張數的 data-nav-count
  countKey?: string;
  onNavigate?: () => void;
}) {
  const isCurrent = useIsCurrent()(to);
  return (
    <Link className="nl-nav-item" to={to} aria-current={isCurrent ? 'page' : undefined} onClick={onNavigate}>
      {icon !== undefined && <Icon name={icon} />}
      {dot !== undefined && <span className={`nl-pdot ${dot}`} aria-hidden="true" />}
      <span className="lbl">{children}</span>
      {count !== undefined && count > 0 && (
        <span className={quiet ? 'count quiet' : 'count'} aria-label={`${String(count)} 張`} data-nav-count={countKey}>
          {count}
        </span>
      )}
    </Link>
  );
}

function LoadingItems({ label }: { label: string }) {
  return (
    <div className="nl-nav-loading" aria-busy="true" aria-label={label}>
      <Skeleton width="title" />
      <Skeleton width="short" />
    </div>
  );
}

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p className="nl-nav-note">
      {what}載入失敗。
      <button type="button" className="linkish" onClick={onRetry}>
        再試一次
      </button>
    </p>
  );
}

export function ProjectSection({ onNavigate }: { onNavigate?: () => void }) {
  const projects = useProjects();
  const nav = onNavigate ? { onNavigate } : {};
  // 全部 Project 照順序排，最多列 SIDEBAR_LIMIT（7）個，其餘在「全部 Project」；不看票的狀態（NX-165）。
  const shown = projects.projects === null ? null : sidebarProjects(projects.projects);
  return (
    <>
      <div className="nl-nav-group">Project</div>
      {projects.status === 'loading' && <LoadingItems label="Project 載入中" />}
      {projects.status === 'error' && <LoadError what="Project " onRetry={projects.reload} />}
      {/* 釘選的在最上面，其餘照最近有更新（NX-162）；每列右邊的圖釘 hover 才出現，已釘選一直顯示 */}
      {shown !== null &&
        shown.map((p) => (
          <div key={p.id} className="nl-nav-row" data-nav-project={p.id}>
            <NavItem to={`/projects/${String(p.id)}`} dot={projectColorClass(p.id)} {...nav}>
              {p.name}
            </NavItem>
            <PinButton project={p} />
          </div>
        ))}
      <NavItem to="/projects" icon="folder" {...nav}>
        全部 Project
      </NavItem>
    </>
  );
}

// 「等你」＝ 待驗收（In Review）的票。階段二加上「指派給我」後再擴大（docs/design/ia/README.md）。
// 「我的 view」整個拿掉（2026-11-04 Bolas：不做 view 功能）。
export const WAITING_PATH = '/issues?status=in_review';
