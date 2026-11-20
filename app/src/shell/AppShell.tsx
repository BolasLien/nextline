// App 外框：桌面側欄＋主內容＋右側預覽面板（?peek=NX-n）；手機底部分頁列＋FAB。
// 全域快捷鍵（shortcuts.ts）：Cmd/Ctrl+K 指令面板、C 開票、G 接 B／I／M／Z 跳頁、? 快捷鍵說明；Cmd/Ctrl+Z 在 ToastProvider。
// 手機不開預覽：網址帶 ?peek 時直接換成整頁 /issues/NX-n。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useApiContext } from '../api/ApiProvider';
import { CreateIssueDialog } from '../create/CreateIssueDialog';
import { type CreatePrefill, prefillFor } from '../create/prefill';
import { useActiveIssueStore } from '../palette/activeIssue';
import type { ActiveIssue } from '../palette/activeIssue';
import { CommandPalette, type PaletteCache } from '../palette/CommandPalette';
import type { PaletteItem } from '../palette/items';
import { browserStorage, pushRecent, readRecent, saveRecent } from '../palette/recent';
import { ShortcutHelp } from '../palette/ShortcutHelp';
import { useTheme } from '../theme/ThemeProvider';
import { STATUS_LABEL } from '../ui/status';
import { IssuePeek } from '../issue/IssuePeek';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Icon } from '../ui/Icon';
import { MOBILE_QUERY, useMediaQuery } from '../ui/useMediaQuery';
import { isTyping, type ShellActions, ShellActionsContext } from './actions';
import { Sidebar } from './Sidebar';
import { decideShortcut } from './shortcuts';
import { TabBar } from './TabBar';
import { isLocalAuth, loginUrl } from '../auth/Login';
import '../ui/button.css';
import './shell.css';

interface CreateState {
  // 每次打開換一個 key，對話框重新開始
  key: number;
  prefill: CreatePrefill;
  opener: HTMLElement | null;
}

function restoreFocus(el: HTMLElement | null) {
  if (el?.isConnected === true) el.focus({ preventScroll: true });
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const peek = location.pathname.startsWith('/issues/') ? null : params.get('peek');
  const [create, setCreate] = useState<CreateState | null>(null);
  // 動作本身不跟著網址重建（側欄、看板拿到的函式固定），開的時候才讀目前畫面
  const here = useRef({ pathname: location.pathname, search: location.search, isMobile });
  here.current = { pathname: location.pathname, search: location.search, isMobile };
  const createOpen = useRef(false);
  createOpen.current = create !== null;
  const { setTheme } = useTheme();
  const activeIssues = useActiveIssueStore();
  // 指令面板：開的時候記下目前打開的票（預覽或整頁）與開啟前的焦點
  const [palette, setPalette] = useState<{ active: ActiveIssue | null; opener: HTMLElement | null } | null>(null);
  const paletteOpen = useRef(false);
  paletteOpen.current = palette !== null;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const paletteCache = useRef<PaletteCache | null>(null);
  const [help, setHelp] = useState<{ opener: HTMLElement | null } | null>(null);
  const helpOpen = useRef(false);
  helpOpen.current = help !== null;
  const gAt = useRef<number | null>(null);

  const actions = useMemo<ShellActions>(
    () => ({
      openSearch: () => {
        if (paletteOpen.current) {
          const opener = paletteRef.current?.opener ?? null;
          setPalette(null);
          paletteOpen.current = false;
          setTimeout(() => { restoreFocus(opener); }, 0);
          return;
        }
        if (createOpen.current || helpOpen.current) return;
        paletteOpen.current = true;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPalette({ active: activeIssues?.current ?? null, opener });
      },
      newIssue: (override) => {
        if (createOpen.current) return;
        createOpen.current = true;
        const { pathname, search } = here.current;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setCreate({ key: Date.now(), prefill: prefillFor(pathname, search, override), opener });
      },
    }),
    [activeIssues],
  );

  // toast「打開」：桌面開右側預覽，手機（或正在整頁看別張票）進整頁
  const openIssue = useCallback(
    (identifier: string) => {
      const { pathname, isMobile: mobile } = here.current;
      if (mobile || pathname.startsWith('/issues/')) {
        void navigate(`/issues/${identifier}`);
        return;
      }
      setParams((p) => {
        const q = new URLSearchParams(p);
        q.set('peek', identifier);
        return q;
      });
    },
    [navigate, setParams],
  );

  const opener = useRef<HTMLElement | null>(null);
  opener.current = create?.opener ?? null;
  const closeCreate = useCallback(({ created }: { created: boolean }) => {
    // 關閉後焦點回到開啟它的按鈕（剛建立完的不回，跟原型一樣）
    const el = opener.current;
    setCreate(null);
    if (!created && el?.isConnected === true) setTimeout(() => { el.focus(); }, 0);
  }, []);

  const closePalette = useCallback(() => {
    const opener = paletteRef.current?.opener ?? null;
    setPalette(null);
    paletteOpen.current = false;
    setTimeout(() => { restoreFocus(opener); }, 0);
  }, []);

  const openHelp = useCallback(() => {
    if (helpOpen.current || createOpen.current) return;
    helpOpen.current = true;
    setHelp({ opener: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }, []);

  // 指令面板選了一項：先關面板、焦點回原處，再執行（跳頁、開票、改狀態…），結果跟用滑鼠做的一樣用 toast 回報。
  const runItem = useCallback(
    (item: PaletteItem) => {
      const target = palette?.active ?? null;
      const opener = palette?.opener ?? null;
      setPalette(null);
      paletteOpen.current = false;
      const { command } = item;
      if (command.type !== 'status' && command.type !== 'archive') {
        const storage = browserStorage();
        saveRecent(storage, pushRecent(readRecent(storage), item.id));
      }
      restoreFocus(opener);
      switch (command.type) {
        case 'go': void navigate(command.path); break;
        case 'open-issue': openIssue(command.identifier); break;
        case 'new-issue': actions.newIssue(); break;
        case 'help': openHelp(); break;
        case 'theme': setTheme(command.theme); break;
        case 'status': {
          if (target === null) break;
          const id = target.issue.identifier;
          const label = STATUS_LABEL[command.status];
          const message = command.back ? `${id} 已移回「${label}」` : command.status === 'Done' ? `${id} 已完成` : `${id} 已移到「${label}」`;
          void target.actions.edit({ status: command.status }, message);
          break;
        }
        case 'archive': {
          if (target === null) break;
          void (command.on ? target.actions.archive() : target.actions.unarchive());
          break;
        }
      }
    },
    [palette, navigate, openIssue, actions, openHelp, setTheme],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const now = Date.now();
      const shortcut = decideShortcut(e, {
        typing: isTyping(e.target),
        modalOpen: createOpen.current || helpOpen.current,
        paletteOpen: paletteOpen.current,
        gAt: gAt.current,
        now,
      });
      gAt.current = shortcut?.type === 'g' ? now : null;
      if (shortcut === null) return;
      if (shortcut.type === 'g') return;
      e.preventDefault();
      switch (shortcut.type) {
        case 'palette': actions.openSearch(); break;
        case 'create': actions.newIssue(); break;
        case 'help': openHelp(); break;
        case 'go': void navigate(shortcut.path); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [actions, navigate, openHelp]);

  return (
    <ShellActionsContext value={actions}>
      <div className="app">
        <Sidebar />
        <main className="main" id="main">
          <SessionExpiredBar />
          {/* 畫面拋錯時只換掉主內容，側欄還能用；換頁就重來 */}
          <ErrorBoundary key={location.pathname} area="這一頁">
            <Outlet />
          </ErrorBoundary>
        </main>
        {peek !== null && !isMobile && <IssuePeek issueRef={peek} />}
      </div>
      {peek !== null && isMobile && <Navigate to={`/issues/${encodeURIComponent(peek)}`} replace />}
      <TabBar />
      {palette !== null && <CommandPalette active={palette.active} cache={paletteCache} onRun={runItem} onClose={closePalette} />}
      {help !== null && (
        <ShortcutHelp
          onClose={() => {
            const opener = help.opener;
            setHelp(null);
            helpOpen.current = false;
            setTimeout(() => { restoreFocus(opener); }, 0);
          }}
        />
      )}
      {create !== null && <CreateIssueDialog key={create.key} prefill={create.prefill} onClose={closeCreate} onOpenIssue={openIssue} />}
    </ShellActionsContext>
  );
}

// 任何請求拿到 401（Access 登入過期）就出現；重新整理會被 Access 帶去登入，再回到同一頁。
function SessionExpiredBar() {
  const { sessionExpired } = useApiContext();
  if (!sessionExpired) return null;
  return (
    <div className="session-bar" role="alert">
      <Icon name="alert" />
      <span className="msg">登入已過期。重新整理並登入後會回到此頁。</span>
      <button type="button" className="nl-btn nl-btn--primary nl-btn--sm" onClick={() => { if (isLocalAuth()) window.location.assign(loginUrl()); else window.location.reload(); }}>
        重新登入
      </button>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <span className="sp" />
      {children}
    </header>
  );
}
