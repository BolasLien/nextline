// 列表列（components.md 第 9 節）：狀態圖示｜票號｜標題｜Project｜下一步（一行，太長截斷）｜更新時間。
// 整列是連到 /issues/NX-n 的連結：桌面點了改開右側預覽（?peek=NX-n），手機與 Cmd/Ctrl/中鍵照連結進整頁。
// 窄的時候（手機、或桌面開著預覽面板）換成三行：票號＋狀態＋Project＋時間／標題／下一步。
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import type { Issue, Project } from '../api/types';
import { projectColorClass } from '../shell/sprints';
import { Icon } from '../ui/Icon';
import { STATUS_ICON, STATUS_LABEL, STATUS_TOKEN } from '../ui/status';
import { fullTime, relativeTime } from '../ui/time';

export function IssueRow({ issue, project, peeked, onOpen, action }: {
  issue: Issue;
  // 列右邊的按鈕（例如「已封存」列表的「取消封存」）
  action?: ReactNode;
  project: Project | undefined;
  peeked: boolean;
  // 回傳 true 代表已經處理（開了預覽），不要照連結換頁
  onOpen: (issue: Issue) => boolean;
}) {
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (onOpen(issue)) e.preventDefault();
  }
  const cls = ['nl-row', issue.status === 'Canceled' ? 'is-canceled' : '', peeked ? 'is-peek' : ''].filter(Boolean).join(' ');
  return (
    <li className={action === undefined ? 'nl-row-li' : 'nl-row-li has-act'}>
      <Link className={cls} to={`/issues/${issue.identifier}`} data-n={issue.number} aria-current={peeked ? 'true' : undefined} onClick={onClick}>
        <span className="st" role="img" aria-label={STATUS_LABEL[issue.status]} style={{ color: `var(--status-${STATUS_TOKEN[issue.status]}-solid)` }}>
          <Icon name={STATUS_ICON[issue.status]} size="sm" />
        </span>
        <span className="id">{issue.identifier}</span>
        <span className="ttl">{issue.title}</span>
        <span className="proj">
          {project === undefined ? (
            <span className="none">—</span>
          ) : (
            <>
              <span className={`nl-pdot ${projectColorClass(project.id)}`} aria-hidden="true" />
              <span className="nm">{project.name}</span>
            </>
          )}
        </span>
        <span className="next">
          {issue.next_step !== null && (
            <>
              <span className="k">下一步</span>
              {issue.next_step}
            </>
          )}
        </span>
        <time className="upd" dateTime={issue.updated_at} title={fullTime(issue.updated_at)}>
          {relativeTime(issue.updated_at)}
        </time>
      </Link>
      {action}
    </li>
  );
}

// 列表的鍵盤：J／K 或 ↑↓ 在列之間移動焦點（Enter 就是點連結）。
export function onListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const key = e.key.toLowerCase();
  const down = key === 'j' || e.key === 'ArrowDown';
  const up = key === 'k' || e.key === 'ArrowUp';
  if ((!down && !up) || e.metaKey || e.ctrlKey || e.altKey) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('a.nl-row')];
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i === -1) return;
  const next = rows[i + (down ? 1 : -1)];
  if (next === undefined) return;
  e.preventDefault();
  next.focus();
}
