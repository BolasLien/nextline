// 圖示（品牌方向 A：24px 格、線寬 1.5px（icon.css 的 --icon-stroke）、轉角 2px、圓頭端點、currentColor）。路徑照 早期設計原型（未收進公開版） 的 symbol。
import type { ReactNode } from 'react';
import './icon.css';

const PATHS = {
  board: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4V20M15 4V20" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13l2.5-7.5h11L20 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <path d="M4 13h4.5l1.2 2.2h4.6L15.5 13H20" />
    </>
  ),
  list: (
    <>
      <path d="M9 6H20M9 12H20M9 18H20" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="3" />
    </>
  ),
  sprint: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M5 3.5V7.5H9" />
    </>
  ),
  folder: <path d="M3.5 7.5a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />,
  agent: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 4V8M9 13V14.5M15 13V14.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16L20 20" />
    </>
  ),
  plus: <path d="M12 5V19M5 12H19" />,
  x: <path d="M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5" />,
  check: <path d="M4.5 12.5l5 5L19.5 6.5" />,
  undo: (
    <>
      <path d="M9 5L4 10l5 5" />
      <path d="M4 10h10a5.5 5.5 0 010 11h-3" />
    </>
  ),
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="3.2" />,
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />,
  'chev-left': <path d="M15 6l-6 6 6 6" />,
  edit: <path d="M5 19h4L19.5 8.5a2.1 2.1 0 00-3-3L6 16v3zM14.5 7.5l2 2" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
  'chev-down': <path d="M6 9l6 6 6-6" />,
  'chev-right': <path d="M9 6l6 6-6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  // 票狀態（components.md 第 5 節：顏色＋形狀，色盲也分得出）
  'status-backlog': <circle cx="12" cy="12" r="8" strokeDasharray="3.2 3" />,
  'status-todo': <circle cx="12" cy="12" r="8" />,
  'status-in-progress': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5a4.5 4.5 0 010 9z" fill="currentColor" stroke="none" />
    </>
  ),
  'status-in-review': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5a4.5 4.5 0 11-4.5 4.5H12z" fill="currentColor" stroke="none" />
    </>
  ),
  'status-done': (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="M8.2 12.3l2.6 2.6 5-5.4" style={{ stroke: 'var(--check-stroke, var(--color-surface))' }} />
    </>
  ),
  'status-canceled': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  // 圖釘（NX-162 釘選 Project）
  pin: <path d="M9 3.5h6M10 3.5v5.5l-3.5 4h11L14 9V3.5M12 13v7.5" />,
  // 合併 Project
  merge: (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="17.5" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M6.5 8.2v2.3a3 3 0 003 3h5a3 3 0 003-3V8.2M12 13.5v2.3" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="2" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
  zones: (
    <>
      <rect x="3" y="3.5" width="18" height="5" rx="2" />
      <rect x="3" y="10" width="18" height="5" rx="2" />
      <rect x="3" y="16.5" width="11" height="4" rx="2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: 'sm' }) {
  return (
    <svg className={size === 'sm' ? 'nl-icon nl-icon--sm' : 'nl-icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

// 品牌 logo（方向 A「定線」，directions.html 的 MARK.a）：方角容器裡兩條橫線，上面短的是人，下面往右縮排、比較長的是 agent。
export function Logo() {
  return (
    <svg className="nl-logo" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" className="box" />
      <rect x="6" y="9" width="13" height="5" rx="1.5" className="human" />
      <rect x="12" y="18" width="14" height="5" rx="1.5" className="agent" />
    </svg>
  );
}
