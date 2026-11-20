// 開票對話框（components.md 第 13 節 Modal、早期設計原型（未收進公開版） 的 openCreate／drawCreate）：
//   標題（必填，自動 focus）→ 描述（Markdown，編輯／預覽在描述的標題列右邊，NX-161）→ 欄位晶片（狀態、Project、到期日、blocked by，預填目前畫面的值；產品不放 Sprint，NX-160）
//   → 底列（建立後繼續建立下一張、取消、建立 ⌘↵）。
// 狀態／Project 用票詳細同一個選單（ui/Menu），blocked by 用票詳細的 BlockerPicker。
// Esc：有草稿先在對話框裡問「捨棄這份草稿？」（不用瀏覽器的 confirm）；沒有就直接關。
// 手機（< 760）：整個畫面的頁面，建立按鈕固定在底部。代做 agent、負責人是階段二，這裡不做。
import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApi, useApiContext } from '../api/ApiProvider';
import { ISSUE_STATUSES, type IssueStatus, type IssueSummary, type Project } from '../api/types';
import { BlockerPicker } from '../issue/BlockerPicker';
import { MarkdownEditor } from '../issue/Markdown';
import { useIssueSync } from '../issue/issueSync';
import { isTyping } from '../shell/actions';
import { projectColorClass } from '../shell/sprints';
import { useToast } from '../toast/ToastProvider';
import { Icon } from '../ui/Icon';
import { Menu, type MenuGroup } from '../ui/Menu';
import { STATUS_ICON, STATUS_LABEL, STATUS_TOKEN } from '../ui/status';
import { type CreateDraft, emptyDraft, isDirty, nextDraft, submitDraft } from './draft';
import type { CreatePrefill } from './prefill';
import '../ui/button.css';
import '../ui/input.css';
import '../issue/detail.css';
import './create.css';

interface Meta {
  projects: Project[];
}

interface MenuState {
  anchor: HTMLElement;
  label: string;
  groups: MenuGroup[];
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Check({ on }: { on: boolean }): ReactNode {
  return on ? <Icon name="check" size="sm" /> : undefined;
}

export function CreateIssueDialog({ prefill, onClose, onOpenIssue }: {
  prefill: CreatePrefill;
  // created：剛建立完關掉的（不把焦點還給開啟的按鈕，跟原型一樣）
  onClose: (opts: { created: boolean }) => void;
  onOpenIssue: (identifier: string) => void;
}) {
  const { api } = useApiContext();
  const sync = useIssueSync();
  const { show } = useToast();
  const meta = useApi<Meta>(async (a) => {
    const { projects } = await a.listProjects();
    return { projects };
  }, []);
  const headingId = useId();
  const titleErrorId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);

  const [initial, setInitial] = useState<CreateDraft>(() => emptyDraft({ status: prefill.status, projectId: prefill.projectId }));
  const [draft, setDraft] = useState<CreateDraft>(initial);
  const [keepGoing, setKeepGoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [picker, setPicker] = useState<HTMLElement | null>(null);

  // 背景 inert（components.md：背景不能操作、Tab 不會跑出去）
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.app, .nl-tabbar, .nl-fab')];
    for (const el of els) el.inert = true;
    return () => { for (const el of els) el.inert = false; };
  }, []);

  // 畫面換完（確認列出現或收起、清空成下一張）之後再移焦點，不靠 setTimeout 猜時間
  const focusNext = useRef<'title' | 'keep' | null>('title');
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    (target === 'keep' ? keepButton.current : titleRef.current)?.focus();
  });

  const projects = meta.data?.projects ?? [];
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const project = draft.projectId === null ? undefined : projectMap.get(draft.projectId);
  const canSubmit = draft.title.trim() !== '' && !busy;
  const exclude = useMemo(() => new Set(draft.blockers.map((b) => b.number)), [draft.blockers]);

  const set = (patch: Partial<CreateDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setConfirming(false);
  };

  function tryClose() {
    if (busy) return;
    if (isDirty(draft, initial)) {
      setConfirming(true);
      focusNext.current = 'keep';
      return;
    }
    onClose({ created: false });
  }

  function backToWriting() {
    setConfirming(false);
    focusNext.current = 'title';
  }

  async function submit() {
    if (busy) return;
    if (draft.title.trim() === '') {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setConfirming(false);
    try {
      const { issue, blockerErrors } = await submitDraft(api, sync, draft);
      show({ message: `已建立 ${issue.identifier}`, action: { label: '打開', run: () => { onOpenIssue(issue.identifier); } } });
      if (blockerErrors.length > 0) show({ kind: 'error', message: `${issue.identifier} 已建立，blocked by 加入失敗：${blockerErrors.join('；')}` });
      if (keepGoing) {
        const next = nextDraft(draft);
        setDraft(next);
        setInitial(next);
        setTitleError(false);
        setBusy(false);
        focusNext.current = 'title';
        return;
      }
      onClose({ created: true });
    } catch (e) {
      // 網路錯誤顯示在底列上方，內容保留（components.md 第 13 節）
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // ---- 欄位選單（同票詳細） ----

  const statusMenu = (anchor: HTMLElement) => {
    setMenu({
      anchor,
      label: '狀態',
      groups: [{
        items: ISSUE_STATUSES.map((s) => ({
          key: s,
          label: STATUS_LABEL[s],
          icon: STATUS_ICON[s],
          iconColor: `var(--status-${STATUS_TOKEN[s]}-solid)`,
          right: <Check on={s === draft.status} />,
          onSelect: () => { set({ status: s }); },
        })),
      }],
    });
  };
  const projectMenu = (anchor: HTMLElement) => {
    // Project 沒有狀態了（NX-165），全部 Project 都選得到
    const choices = projects;
    setMenu({
      anchor,
      label: 'Project',
      groups: [
        {
          items: choices.map((p) => ({
            key: String(p.id),
            label: (
              <span className="opt-proj">
                <span className={`nl-pdot ${projectColorClass(p.id)}`} aria-hidden="true" />
                {p.name}
              </span>
            ),
            right: <Check on={p.id === draft.projectId} />,
            onSelect: () => { set({ projectId: p.id }); },
          })),
        },
        { items: [{ key: 'none', label: '沒有 Project', right: <Check on={draft.projectId === null} />, onSelect: () => { set({ projectId: null }); } }] },
      ],
    });
  };

  const metaReady = meta.status === 'success';
  const chipRefs = { status: useRef<HTMLButtonElement>(null), project: useRef<HTMLButtonElement>(null) };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // 描述框自己會處理（已 preventDefault），這裡只擋住外面的快捷鍵
      e.stopPropagation();
      if (!e.defaultPrevented) {
        e.preventDefault();
        void submit();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) backToWriting();
      else tryClose();
      return;
    }
    if (e.key === 'Tab') {
      // 只算畫面上看得到的（手機藏起來的「取消」不算，不然 Tab 會掉到 body）
      const items = [...(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    // 焦點不在輸入框時：S 狀態、P Project（components.md 第 4 節）
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || busy) return;
    const key = e.key.toLowerCase();
    const open = key === 's' ? [chipRefs.status, statusMenu] as const : key === 'p' ? [chipRefs.project, projectMenu] as const : null;
    if (open === null) return;
    const anchor = open[0].current;
    if (anchor === null || anchor.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    open[1](anchor);
  }

  const statusToken = STATUS_TOKEN[draft.status];

  return createPortal(
    <div
      className="nl-modal-scrim create-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}
    >
      <div
        ref={modalRef}
        className="nl-modal create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
      >
        <div className="hd">
          <h2 id={headingId}>建立票</h2>
          <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="關閉（Esc）" title="關閉（Esc）" onClick={tryClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className="bd">
          <label className="vh" htmlFor={`${headingId}-title`}>標題（必填）</label>
          <input
            ref={titleRef}
            id={`${headingId}-title`}
            className="nl-title-input create-title"
            placeholder="標題"
            autoComplete="off"
            aria-required="true"
            aria-invalid={titleError}
            aria-describedby={titleError ? titleErrorId : undefined}
            disabled={busy}
            value={draft.title}
            onChange={(e) => {
              set({ title: e.target.value });
              if (e.target.value.trim() !== '') setTitleError(false);
            }}
          />
          {titleError && (
            <p className="nl-error" id={titleErrorId}>
              <Icon name="alert" size="sm" />
              標題必填
            </p>
          )}
          <MarkdownEditor
            label="描述（Markdown）"
            heading="描述"
            value={draft.description}
            placeholder="描述（選填，支援 Markdown）"
            onChange={(v) => { set({ description: v }); }}
            onSubmit={() => void submit()}
          />
          <div className="chips" role="group" aria-label="欄位">
            <button
              ref={chipRefs.status}
              type="button"
              className="nl-chip create-chip"
              aria-haspopup="menu"
              aria-label={`狀態：${STATUS_LABEL[draft.status]}，按一下修改`}
              aria-keyshortcuts="S"
              disabled={busy}
              onClick={(e) => { statusMenu(e.currentTarget); }}
            >
              <span className="ic" style={{ color: `var(--status-${statusToken}-solid)` }}>
                <Icon name={STATUS_ICON[draft.status]} size="sm" />
              </span>
              {STATUS_LABEL[draft.status]}
              <span className="nl-kbd">S</span>
            </button>
            <button
              ref={chipRefs.project}
              type="button"
              className="nl-chip create-chip"
              aria-haspopup="menu"
              aria-label={`Project：${project?.name ?? '沒有 Project'}，按一下修改`}
              aria-keyshortcuts="P"
              disabled={busy || !metaReady}
              onClick={(e) => { projectMenu(e.currentTarget); }}
            >
              {project === undefined ? <Icon name="folder" size="sm" /> : <span className={`nl-pdot ${projectColorClass(project.id)}`} aria-hidden="true" />}
              <span className="lbl">{project?.name ?? (draft.projectId === null ? '沒有 Project' : '載入中…')}</span>
              <span className="nl-kbd">P</span>
            </button>
            <label className="nl-chip create-chip create-due">
              <span className="vh">到期日</span>
              <input
                type="date"
                aria-label="到期日"
                value={draft.dueDate ?? ''}
                disabled={busy}
                className={draft.dueDate === null ? 'is-empty' : ''}
                onChange={(e) => { set({ dueDate: e.target.value === '' ? null : e.target.value }); }}
              />
            </label>
            <button
              type="button"
              className="nl-chip create-chip"
              aria-haspopup="listbox"
              aria-expanded={picker !== null}
              disabled={busy}
              onClick={(e) => { setPicker(e.currentTarget); }}
            >
              <Icon name="plus" size="sm" />
              blocked by
            </button>
          </div>
          {draft.blockers.length > 0 && (
            <ul className="create-blockers" aria-label="blocked by">
              {draft.blockers.map((b) => (
                <BlockerItem key={b.number} item={b} disabled={busy} onRemove={() => { set({ blockers: draft.blockers.filter((x) => x.number !== b.number) }); }} />
              ))}
            </ul>
          )}
          {confirming && (
            <div className="create-confirm" role="alertdialog" aria-labelledby={`${headingId}-confirm`}>
              <span id={`${headingId}-confirm`}>捨棄這份草稿？</span>
              <span className="sp" />
              <button ref={keepButton} type="button" className="nl-btn nl-btn--secondary nl-btn--sm" onClick={backToWriting}>
                繼續編輯
              </button>
              <button type="button" className="nl-btn nl-btn--danger nl-btn--sm" onClick={() => { onClose({ created: false }); }}>
                捨棄
              </button>
            </div>
          )}
          {error !== null && (
            <p className="nl-error create-error" role="alert">
              <Icon name="alert" size="sm" />
              建立失敗：{error}
            </p>
          )}
        </div>
        <div className="ft">
          <label className="nl-check">
            <input type="checkbox" checked={keepGoing} disabled={busy} onChange={(e) => { setKeepGoing(e.target.checked); }} />
            建立後繼續建立下一張
          </label>
          <span className="sp" />
          <button type="button" className="nl-btn nl-btn--secondary create-cancel" onClick={tryClose} disabled={busy}>
            取消
            <span className="nl-kbd">Esc</span>
          </button>
          <button
            type="button"
            className="nl-btn nl-btn--primary create-submit"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-busy={busy}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? '建立中…' : '建立'}
            <span className="nl-kbd">⌘↵</span>
          </button>
        </div>
      </div>
      {menu !== null && (
        <Menu
          anchor={menu.anchor}
          label={menu.label}
          groups={menu.groups}
          onClose={(opts) => {
            const anchor = menu.anchor;
            setMenu(null);
            if (opts?.restoreFocus !== false && anchor.isConnected) anchor.focus();
          }}
        />
      )}
      {picker !== null && (
        <BlockerPicker
          anchor={picker}
          exclude={exclude}
          onPick={(t: IssueSummary) => { set({ blockers: [...draft.blockers, t] }); }}
          onClose={(opts) => {
            const a = picker;
            setPicker(null);
            if (opts?.restoreFocus !== false && a.isConnected) a.focus();
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function BlockerItem({ item, disabled, onRemove }: { item: IssueSummary; disabled: boolean; onRemove: () => void }) {
  const status: IssueStatus = item.status;
  return (
    <li className="blk">
      <span className="ic" style={{ color: `var(--status-${STATUS_TOKEN[status]}-solid)` }}>
        <Icon name={STATUS_ICON[status]} size="sm" />
      </span>
      <span className="blk-id">{item.identifier}</span>
      <span className="blk-t">{item.title}</span>
      <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label={`移除 blocked by ${item.identifier}`} disabled={disabled} onClick={onRemove}>
        <Icon name="x" size="sm" />
      </button>
    </li>
  );
}
