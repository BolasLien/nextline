// 空狀態、載入中、錯誤（components.md 第 16、17 節與品牌語氣）。
import { type ReactNode, useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';
import './states.css';

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="nl-empty">
      <div className="ic" aria-hidden="true">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      {children !== undefined && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="nl-empty nl-empty--error" role="alert">
      <div className="ic" aria-hidden="true">
        <Icon name="alert" />
      </div>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry !== undefined && (
        <button type="button" className="nl-btn nl-btn--secondary" onClick={onRetry}>
          再試一次
        </button>
      )}
    </div>
  );
}

// 超過 300ms 才顯示 skeleton，避免閃一下（components.md 第 17 節）。
export const SKELETON_DELAY_MS = 300;

export function Delayed({ children, ms = SKELETON_DELAY_MS }: { children: ReactNode; ms?: number }) {
  const [show, setShow] = useState(ms === 0);
  useEffect(() => {
    if (ms === 0) return;
    const t = setTimeout(() => { setShow(true); }, ms);
    return () => { clearTimeout(t); };
  }, [ms]);
  return show ? children : null;
}

export function Skeleton({ width, height }: { width: 'id' | 'title' | 'short' | 'full'; height?: 'sm' | 'md' | 'lg' }) {
  return <span className={`nl-skel nl-skel--${width} nl-skel--h-${height ?? 'md'}`} aria-hidden="true" />;
}

export function LoadingBlock({ label = '載入中', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="nl-loading" aria-busy="true" aria-label={label}>
      <Delayed>
        {Array.from({ length: rows }, (_, i) => (
          <div className="row" key={i}>
            <Skeleton width="id" height="sm" />
            <Skeleton width={i % 2 === 0 ? 'title' : 'short'} />
          </div>
        ))}
      </Delayed>
    </div>
  );
}
