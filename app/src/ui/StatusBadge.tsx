// 票狀態徽章（components.md 第 5 節）：狀態圖示＋名稱，顏色用 --status-<狀態>-fg／solid／soft。
import type { IssueStatus } from '../api/types';
import { Icon } from './Icon';
import { STATUS_ICON, STATUS_LABEL, STATUS_TOKEN } from './status';
import './input.css';

export function StatusBadge({ status, bare }: { status: IssueStatus; bare?: boolean }) {
  const t = STATUS_TOKEN[status];
  return (
    <span
      className={bare === true ? 'nl-badge nl-badge--bare' : 'nl-badge'}
      data-status={t}
      style={{ '--b-soft': `var(--status-${t}-soft)`, '--b-fg': `var(--status-${t}-fg)`, '--b-solid': `var(--status-${t}-solid)` } as React.CSSProperties}
    >
      <Icon name={STATUS_ICON[status]} size="sm" />
      {STATUS_LABEL[status]}
    </span>
  );
}
