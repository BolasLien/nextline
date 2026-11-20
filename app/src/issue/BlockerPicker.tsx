// 加入 blocked by 的 combobox（components.md 第 4 節）：打票號或標題篩選，↑↓ 選、Enter 加入、Esc 關閉。
// 浮層掛在 body（position: fixed），不會被預覽面板的捲動框裁掉。照 WAI-ARIA combobox：焦點留在搜尋框。
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApiContext } from '../api/ApiProvider';
import type { Issue, IssueSummary } from '../api/types';
import { Icon } from '../ui/Icon';
import { STATUS_ICON, STATUS_TOKEN } from '../ui/status';
import { searchIssues } from './blockerSearch';

const EDGE = 8;

export function BlockerPicker({ anchor, exclude, onPick, onClose }: {
  anchor: HTMLElement;
  exclude: ReadonlySet<number>;
  onPick: (issue: IssueSummary) => void;
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}) {
  const { api } = useApiContext();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Issue[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    let alive = true;
    api.listIssues({ limit: 200 }).then(
      (res) => { if (alive) setAll(res.issues); },
      (e: unknown) => { if (alive) setFailed(e instanceof Error ? e.message : String(e)); },
    );
    return () => { alive = false; };
  }, [api]);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const width = Math.min(340, vw - 2 * EDGE);
    const left = Math.max(EDGE, Math.min(a.left, vw - width - EDGE));
    setPos({ top: a.bottom + 6, left, width });
  }, [anchor]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose({ restoreFocus: false });
    }
    document.addEventListener('pointerdown', onPointer, true);
    return () => { document.removeEventListener('pointerdown', onPointer, true); };
  }, [anchor, onClose]);

  const results = all === null ? [] : searchIssues(all, query, exclude);
  const current = results[Math.min(active, results.length - 1)];

  function pick(issue: Issue) {
    onClose();
    onPick({ number: issue.number, identifier: issue.identifier, legacy_identifier: issue.legacy_identifier, title: issue.title, status: issue.status });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break;
      case 'Enter': e.preventDefault(); if (current !== undefined) pick(current); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); onClose(); break;
      case 'Tab': onClose({ restoreFocus: false }); break;
      default: break;
    }
  }

  const listId = `${id}-list`;
  return createPortal(
    <div
      ref={ref}
      className="nl-menu nl-combo"
      style={pos === null ? { visibility: 'hidden', top: 0, left: 0 } : { top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="search">
        <Icon name="search" size="sm" />
        <input
          role="combobox"
          aria-label="找要加入 blocked by 的票（票號或標題）"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current === undefined ? undefined : `${id}-o-${String(current.number)}`}
          aria-busy={all === null && failed === null}
          placeholder="票號或標題…"
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div role="listbox" id={listId} aria-label="符合的票" className="opts">
        {failed !== null && <p className="nl-empty-inline">票清單載入失敗：{failed}</p>}
        {failed === null && all === null && <p className="nl-empty-inline">載入中…</p>}
        {all !== null && results.length === 0 && <p className="nl-empty-inline">沒有符合「{query}」的票。</p>}
        {results.map((issue) => (
          <div
            key={issue.number}
            id={`${id}-o-${String(issue.number)}`}
            role="option"
            aria-selected={issue === current}
            className="nl-menu-item"
            onPointerDown={(e) => { e.preventDefault(); }}
            onClick={() => { pick(issue); }}
          >
            <span className="ic" style={{ color: `var(--status-${STATUS_TOKEN[issue.status]}-solid)` }}>
              <Icon name={STATUS_ICON[issue.status]} size="sm" />
            </span>
            <span className="right id">{issue.identifier}</span>
            <span className="lbl">{issue.title}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
