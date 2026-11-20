// 釘選／取消釘選一個 Project（NX-162）：側欄每一列（hover 才出現，已釘選一直顯示）、手機「更多」、/projects、Project 頁頁首。
// 按下後 ProjectsProvider 先改畫面再寫 API，失敗退回並跳 toast。
import type { Project } from '../api/types';
import { Icon } from '../ui/Icon';
import { useProjects } from './ProjectsProvider';
import './pin.css';

export function PinButton({ project, className = '' }: { project: Project; className?: string }) {
  const { setPinned } = useProjects();
  const pinned = project.pinned_at !== null;
  const label = pinned ? `取消釘選「${project.name}」` : `釘選「${project.name}」到最上方`;
  return (
    <button
      type="button"
      className={['pin-btn', pinned ? 'is-pinned' : '', className].filter(Boolean).join(' ')}
      aria-pressed={pinned}
      aria-label={label}
      title={pinned ? '取消釘選' : '釘選到最上方'}
      data-pin={project.id}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void setPinned(project, !pinned);
      }}
    >
      <Icon name="pin" size="sm" />
    </button>
  );
}
