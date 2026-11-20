// Cmd+K 指令面板（components.md 第 12 節；視覺與互動照 早期設計原型（未收進公開版） 的 openPalette／palItems）。
// 輸入框＋〔目前這張票〕＋分組結果（最近用過／對這張票／跳到／動作／票）＋底列（↑↓ 移動、↵ 執行、esc 關閉）。
// 焦點一直在輸入框（WAI-ARIA combobox＋aria-activedescendant），Tab 不離開面板。
// 票：打開時抓所有票（含 Done、Canceled），抓到之前先用「全部沒做完的票」。
import { type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApiContext } from '../api/ApiProvider';
import type { Issue, Project } from '../api/types';
import { listAllIssues } from '../issues/useIssues';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../ui/Icon';
import { Delayed } from '../ui/states';
import { StatusBadge } from '../ui/StatusBadge';
import { STATUS_ICON, STATUS_TOKEN } from '../ui/status';
import { useOpenIssues } from '../issues/OpenIssuesProvider';
import type { ActiveIssue } from './activeIssue';
import { buildItems, type PaletteItem, rankItems } from './items';
import { browserStorage, readRecent } from './recent';
import '../ui/menu.css';
import './palette.css';

export interface PaletteCache {
  issues: Issue[];
  projects: Project[];
}

const SPINNER_DELAY_MS = 300;

export function CommandPalette({ active, cache, onRun, onClose }: {
  active: ActiveIssue | null;
  // 上一次打開時抓到的資料，下次打開先用，背景再更新
  cache: RefObject<PaletteCache | null>;
  onRun: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const { api } = useApiContext();
  const { theme } = useTheme();
  const open = useOpenIssues();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<PaletteCache | null>(cache.current);
  const [loading, setLoading] = useState(true);
  const [recent] = useState(() => readRecent(browserStorage()));

  useEffect(() => {
    let alive = true;
    Promise.all([listAllIssues(api, {}), api.listProjects()]).then(
      ([issues, { projects }]) => {
        const next = { issues, projects };
        cache.current = next;
        if (alive) {
          setData(next);
          setLoading(false);
        }
      },
      () => { if (alive) setLoading(false); },
    );
    return () => { alive = false; };
  }, [api, cache]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const issues = data?.issues ?? open.issues;
  const items = useMemo(
    () => buildItems({ issues, projects: data?.projects ?? [], active: active === null ? null : { issue: active.issue, events: active.events }, theme }),
    [issues, data, active, theme],
  );
  const activeId = active?.issue.identifier ?? null;
  const groups = useMemo(() => rankItems(items, query, recent, activeId), [items, query, recent, activeId]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = flat.length === 0 ? -1 : Math.min(index, flat.length - 1);
  const optionId = (k: number) => `${listId}-opt-${String(k)}`;

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  });

  function run(k: number) {
    const item = flat[k];
    if (item !== undefined) onRun(item);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // 中文輸入法選字時的 Enter／方向鍵留給輸入法
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    const n = flat.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n > 0) setIndex((current + 1) % n);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n > 0) setIndex((current - 1 + n) % n);
        break;
      case 'Enter':
        e.preventDefault();
        if (current >= 0) run(current);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        break;
    }
  }

  let k = -1;
  return createPortal(
    <div className="nl-palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nl-palette" role="dialog" aria-modal="true" aria-label="指令面板" onKeyDown={onKeyDown}>
        <div className="in">
          <Icon name="search" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            aria-label="搜尋票、頁面或動作"
            placeholder="搜尋票、頁面或動作"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
          />
          {loading && (
            <Delayed ms={SPINNER_DELAY_MS}>
              <span className="nl-spinner" role="status" aria-label="載入中" />
            </Delayed>
          )}
          {activeId !== null && <span className="ctx" title="目前這張票">{activeId}</span>}
        </div>
        <div className="res" id={listId} role="listbox" aria-label="結果">
          {flat.length === 0 ? (
            <div className="nl-empty-inline" role="presentation">
              {loading && data === null ? '票載入中…' : `找不到「${query.trim()}」。可搜尋票號（例如 148）或頁面名稱。`}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} role="group" aria-label={g.label} data-group={g.key}>
                <div className="nl-menu-group" role="presentation">{g.label}</div>
                {g.items.map((item) => {
                  k += 1;
                  const at = k;
                  return (
                    <div
                      key={item.id}
                      id={optionId(at)}
                      className="nl-menu-item"
                      role="option"
                      aria-selected={at === current}
                      data-item={item.id}
                      onMouseMove={() => { if (at !== current) setIndex(at); }}
                      onMouseDown={(e) => { e.preventDefault(); }}
                      onClick={() => { run(at); }}
                    >
                      <ItemBody item={item} />
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="foot" aria-hidden="true">
          <span><span className="nl-kbd">↑↓</span>移動</span>
          <span><span className="nl-kbd">↵</span>執行</span>
          <span><span className="nl-kbd">esc</span>關閉</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ItemBody({ item }: { item: PaletteItem }) {
  if (item.issue !== undefined) {
    return (
      <>
        <span className="id">{item.issue.identifier}</span>
        <span className="lbl">{item.label}</span>
        {item.issue.legacy_identifier !== null && <span className="legacy">{item.issue.legacy_identifier}</span>}
        <StatusBadge status={item.issue.status} bare />
      </>
    );
  }
  return (
    <>
      {item.status !== undefined ? (
        <span className="ic" style={{ color: `var(--status-${STATUS_TOKEN[item.status]}-solid)` }}>
          <Icon name={STATUS_ICON[item.status]} size="sm" />
        </span>
      ) : item.icon !== undefined ? (
        <span className="ic"><Icon name={item.icon} size="sm" /></span>
      ) : null}
      <span className="lbl">{item.label}</span>
      {item.shortcut !== undefined && (item.group === 'pages' ? <span className="k">{item.shortcut}</span> : <span className="nl-kbd">{item.shortcut}</span>)}
    </>
  );
}
