// 桌面側欄（components.md 第 10 節）。寬度 < 760 時隱藏，改用底部分頁列。
import { useWaitingCount } from '../issues/OpenIssuesProvider';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Icon, Logo } from '../ui/Icon';
import { useShellActions } from './actions';
import { NavItem, ProjectSection, WAITING_PATH } from './NavSections';
import { LogoutButton } from '../auth/Login';

export function Sidebar() {
  const { openSearch, newIssue } = useShellActions();
  const waiting = useWaitingCount();
  return (
    <nav className="nl-sidebar app-side" aria-label="主要">
      <div className="brand">
        <Logo />
        Nextline
      </div>
      <div className="acts">
        <button type="button" className="nl-btn nl-btn--secondary nl-btn--sm" onClick={openSearch} aria-keyshortcuts="Meta+K Control+K">
          <Icon name="search" size="sm" />
          搜尋
          <span className="nl-kbd">⌘K</span>
        </button>
        <button type="button" className="nl-btn nl-btn--secondary nl-btn--sm" onClick={() => { newIssue(); }} aria-keyshortcuts="C">
          <Icon name="plus" size="sm" />
          建立票
          <span className="nl-kbd">C</span>
        </button>
      </div>
      <NavItem to={WAITING_PATH} icon="inbox" count={waiting} countKey="waiting">
        等你
      </NavItem>
      <NavItem to="/" icon="board">
        看板
      </NavItem>
      <NavItem to="/issues" icon="list">
        全部的票
      </NavItem>
      <ProjectSection />
      <div className="grow" />
      <LogoutButton />
      <div className="theme">
        <span className="lbl">
          外觀
        </span>
        <ThemeSwitch />
      </div>
    </nav>
  );
}
