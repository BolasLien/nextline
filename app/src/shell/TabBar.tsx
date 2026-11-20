// 手機底部分頁列＋開票 FAB（components.md 第 11 節）；「更多」打開底部 sheet，放 Project 與外觀。
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Icon } from '../ui/Icon';
import { useShellActions } from './actions';
import { ProjectSection, useIsCurrent, WAITING_PATH } from './NavSections';
import { LogoutButton } from '../auth/Login';

export function TabBar() {
  const { openSearch, newIssue } = useShellActions();
  const isCurrent = useIsCurrent();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const tab = (to: string) => ({ to, className: 'nl-tab', 'aria-current': isCurrent(to) ? ('page' as const) : undefined });
  return (
    <>
      <nav className="nl-tabbar app-tabbar" aria-label="主要（手機）">
        <Link {...tab('/')}>
          <Icon name="board" />
          看板
        </Link>
        <Link {...tab(WAITING_PATH)}>
          <Icon name="inbox" />
          等你
        </Link>
        <Link {...tab('/issues')}>
          <Icon name="list" />
          全部
        </Link>
        <button type="button" className="nl-tab" onClick={openSearch}>
          <Icon name="search" />
          搜尋
        </button>
        <button
          ref={moreButton}
          type="button"
          className="nl-tab"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => { setMoreOpen(true); }}
        >
          <Icon name="more" />
          更多
        </button>
      </nav>
      <button type="button" className="nl-fab" aria-label="建立票" onClick={() => { newIssue(); }}>
        <Icon name="plus" />
      </button>
      {moreOpen && (
        <MoreSheet
          onClose={() => {
            setMoreOpen(false);
            moreButton.current?.focus();
          }}
        />
      )}
    </>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="nl-sheet-scrim" onClick={onClose}>
      <div
        ref={panel}
        className="nl-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-title"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="hd">
          <h2 id="more-title">更多</h2>
          <button type="button" className="nl-btn nl-btn--icon" aria-label="關閉" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <ProjectSection onNavigate={onClose} />
        <LogoutButton />
        <div className="nl-nav-group">外觀</div>
        <div className="theme">
          <ThemeSwitch />
        </div>
      </div>
    </div>
  );
}
