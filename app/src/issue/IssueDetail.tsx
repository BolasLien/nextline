// 票詳細：右側預覽面板（layout="peek"）與整頁 /issues/NX-n（layout="page"）共用。
// 版面與互動照 早期設計原型（未收進公開版） 的 renderPeek／renderDetailPage、components.md 第 14 節：
//   標題列 → 驗收列（只在待驗收，摘要＝最新的下一步）→ 狀態／Project／票號 → 標題（就地編輯）→ 最新的下一步（待驗收時不顯示，NX-161）→ 描述（Markdown）
//   → 欄位（狀態、Project、到期日、blocked by；整頁放右欄。產品不放 Sprint，NX-160）→ 變更紀錄（每筆可還原）→ comment。
// 負責人、代做 agent、session 是階段二，這裡不做。
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ISSUE_STATUSES, type IssueDetail, type IssueEvent, type IssueSummary, type Project } from '../api/types';
import { useRegisterActiveIssue } from '../palette/activeIssue';
import { projectColorClass } from '../shell/sprints';
import { isTyping } from '../shell/actions';
import { Icon } from '../ui/Icon';
import { Menu, type MenuGroup } from '../ui/Menu';
import { StatusBadge } from '../ui/StatusBadge';
import { EmptyState, ErrorState, Skeleton, Delayed } from '../ui/states';
import { STATUS_ICON, STATUS_LABEL, STATUS_TOKEN } from '../ui/status';
import { fullTime, relativeTime } from '../ui/time';
import { BlockerPicker } from './BlockerPicker';
import type { EditActions } from './edits';
import { canRevert, type EventNames, eventText, newestFirst, revertLabel } from './events';
import { Markdown, MarkdownEditor } from './Markdown';
import { type DetailData, useIssueDetail } from './useIssueDetail';
import '../ui/button.css';
import '../ui/input.css';
import './detail.css';

export type DetailLayout = 'peek' | 'page';

export interface DetailLinks {
  // 別張票（blocked by）要連到哪裡：預覽面板裡換成那張的預覽，整頁就到那張的整頁。
  issue: (identifier: string) => string;
  // 預覽面板右上角「展開成整頁」
  expand?: string;
}

export function IssueDetailView({ issueRef, layout, links, headingId, onClose, onLoaded }: {
  issueRef: string;
  layout: DetailLayout;
  links: DetailLinks;
  headingId: string;
  onClose?: () => void;
  onLoaded?: (issue: IssueDetail) => void;
}) {
  const { state, actions, reload } = useIssueDetail(issueRef);
  const loadedRef = useRef<string | null>(null);
  const loadedIssue = state.status === 'success' ? state.data.issue : null;
  useEffect(() => {
    if (loadedIssue === null || loadedRef.current === loadedIssue.identifier) return;
    loadedRef.current = loadedIssue.identifier;
    onLoaded?.(loadedIssue);
  }, [loadedIssue, onLoaded]);

  if (state.status === 'loading') {
    return (
      <>
        <DetailHeader layout={layout} issue={null} label={issueRef} links={links} onClose={onClose} />
        <div className={layout === 'peek' ? 'bd' : 'view'} aria-busy="true" aria-label="票載入中">
          <Delayed>
            <div className="detail-skel">
              <Skeleton width="short" height="sm" />
              <Skeleton width="title" height="lg" />
              <Skeleton width="full" />
              <Skeleton width="full" />
              <Skeleton width="short" />
            </div>
          </Delayed>
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    const notFound = state.error.status === 404;
    return (
      <>
        <DetailHeader layout={layout} issue={null} label={issueRef} links={links} onClose={onClose} />
        <div className={layout === 'peek' ? 'bd' : 'view'}>
          {notFound ? (
            <EmptyState icon="board" title={`${issueRef} 不存在或已刪除`}>
              請確認票號，或回到看板。
            </EmptyState>
          ) : (
            <ErrorState title="票載入失敗" message={state.error.message} {...(state.error.isUnauthorized ? {} : { onRetry: reload })} />
          )}
        </div>
      </>
    );
  }
  return <DetailBody data={state.data} actions={actions} layout={layout} links={links} headingId={headingId} onClose={onClose} />;
}

function DetailHeader({ layout, issue, label, links, onClose, project, onMore }: {
  layout: DetailLayout;
  issue: IssueDetail | null;
  label: string;
  links: DetailLinks;
  onClose: (() => void) | undefined;
  project?: Project | undefined;
  // 「⋯」更多動作（封存）；票還沒載入時沒有
  onMore?: ((anchor: HTMLElement) => void) | undefined;
}) {
  const more = onMore === undefined ? null : (
    <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-haspopup="menu" aria-label="更多動作" title="更多動作" data-more onClick={(e) => { onMore(e.currentTarget); }}>
      <Icon name="more" size="sm" />
    </button>
  );
  if (layout === 'peek') {
    return (
      <div className="hd">
        {project !== undefined && (
          <>
            <span className={`nl-pdot ${projectColorClass(project.id)}`} aria-hidden="true" />
            <span className="pname">{project.name}</span>
            <span aria-hidden="true">／</span>
          </>
        )}
        <span>{issue?.identifier ?? label}</span>
        <span className="sp" />
        {more}
        {links.expand !== undefined && (
          <Link className="nl-btn nl-btn--icon nl-btn--sm" to={links.expand} aria-label="展開成整頁" title="展開成整頁">
            <Icon name="expand" size="sm" />
          </Link>
        )}
        <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="關閉預覽（Esc）" title="關閉預覽（Esc）" onClick={onClose}>
          <Icon name="x" size="sm" />
        </button>
      </div>
    );
  }
  return (
    <header className="topbar detail-topbar">
      <Link className="nl-btn nl-btn--icon m-only" to="/" aria-label="回看板">
        <Icon name="chev-left" />
      </Link>
      <nav className="crumb" aria-label="位置">
        <Link to="/">看板</Link>
        <span aria-hidden="true">／</span>
        {project !== undefined && (
          <>
            <span className="pname">{project.name}</span>
            <span aria-hidden="true">／</span>
          </>
        )}
        <span aria-current="page">{issue?.identifier ?? label}</span>
      </nav>
      <span className="sp" />
      {issue !== null && <StatusBadge status={issue.status} />}
      {more}
    </header>
  );
}

interface MenuState {
  anchor: HTMLElement;
  label: string;
  groups: MenuGroup[];
}

function DetailBody({ data, actions, layout, links, headingId, onClose }: {
  data: DetailData;
  actions: EditActions;
  layout: DetailLayout;
  links: DetailLinks;
  headingId: string;
  onClose: (() => void) | undefined;
}) {
  const { issue, events, comments, projects, sprints } = data;
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const sprintMap = useMemo(() => new Map(sprints.map((s) => [s.id, s])), [sprints]);
  const names: EventNames = useMemo(() => ({ projects: projectMap, sprints: sprintMap }), [projectMap, sprintMap]);
  const project = issue.project_id === null ? undefined : projectMap.get(issue.project_id);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const rejectRef = useRef<HTMLDivElement>(null);
  const inReview = issue.status === 'In Review';
  const archived = issue.archived_at !== null;
  const moreMenu = (anchor: HTMLElement) => {
    setMenu({
      anchor,
      label: '更多動作',
      groups: [{
        items: [archived
          ? { key: 'unarchive', label: '取消封存', icon: 'archive', onSelect: () => { void actions.unarchive(); } }
          : { key: 'archive', label: '封存這張票', icon: 'archive', onSelect: () => { void actions.archive(); } }],
      }],
    });
  };

  // 指令面板的「改狀態成…」「移回…」用這張票的寫入流程
  useRegisterActiveIssue({ issue, events, actions });

  // 換票時收起退回表單
  useEffect(() => { setRejectOpen(false); }, [issue.number]);

  // Cmd/Ctrl+Enter＝通過（只在待驗收、焦點不在輸入框時；輸入框裡的 Cmd+Enter 是送出那一格）
  useEffect(() => {
    if (!inReview) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || isTyping(e.target)) return;
      e.preventDefault();
      void actions.approve();
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [inReview, actions]);

  const openReject = () => {
    setRejectOpen(true);
    setTimeout(() => {
      rejectRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      rejectRef.current?.querySelector('textarea')?.focus();
    }, 0);
  };

  const review = inReview ? (
    <ReviewBar issue={issue} actions={actions} open={rejectOpen} onOpen={openReject} onCancel={() => { setRejectOpen(false); }} containerRef={rejectRef} />
  ) : null;

  const fields = (
    <Fields
      issue={issue}
      projects={projects}
      projectMap={projectMap}
      actions={actions}
      links={links}
      openMenu={setMenu}
    />
  );

  const main = (
    <>
      {archived && (
        <div className="nl-archived" role="status" data-archived>
          <Icon name="archive" size="sm" />
          <span className="msg">
            <b>已封存</b>：看板、列表都看不到這張票。
          </span>
          <button type="button" className="nl-btn nl-btn--secondary nl-btn--sm" onClick={() => void actions.unarchive()}>
            取消封存
          </button>
        </div>
      )}
      {review}
      <div className="meta-row">
        <StatusBadge status={issue.status} />
        {project !== undefined && (
          <span className="nl-chip proj-chip">
            <span className={`nl-pdot ${projectColorClass(project.id)}`} aria-hidden="true" />
            {project.name}
          </span>
        )}
        <span className="ident">{issue.identifier}</span>
        {issue.legacy_identifier !== null && <small className="legacy">{issue.legacy_identifier}</small>}
      </div>
      <TitleEditor issue={issue} actions={actions} headingId={headingId} />
      {/* 待驗收時下一步已經在頂端的驗收列，不再重複（NX-161） */}
      {issue.next_step !== null && !inReview && (
        <div className="next-step" role="note" aria-label="最新的下一步">
          <span className="k">下一步</span>
          <p>{issue.next_step}</p>
        </div>
      )}
      <DescriptionEditor issue={issue} actions={actions} />
      {layout === 'peek' && fields}
      <History events={events} names={names} actions={actions} />
      <Comments issueKey={issue.identifier} comments={comments} actions={actions} />
    </>
  );

  return (
    <>
      <DetailHeader layout={layout} issue={issue} label={issue.identifier} links={links} onClose={onClose} project={project} onMore={moreMenu} />
      {layout === 'peek' ? (
        <div className="bd detail" data-detail={issue.number}>
          {main}
        </div>
      ) : (
        <div className={`view${inReview && !rejectOpen ? ' has-review-bar' : ''}`}>
          <div className="detail-page" data-detail={issue.number}>
            <div className="main-col detail">{main}</div>
            <aside className="side-fields" aria-label="欄位">
              {fields}
            </aside>
          </div>
          {inReview && !rejectOpen && (
            <div className="m-review-bar" role="group" aria-label="驗收（手機）">
              <button type="button" className="nl-btn nl-btn--secondary nl-btn--lg" onClick={openReject}>
                退回
              </button>
              <button type="button" className="nl-btn nl-btn--primary nl-btn--lg" onClick={() => void actions.approve()}>
                通過
              </button>
            </div>
          )}
        </div>
      )}
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
    </>
  );
}

// ---- 驗收列 ----

function ReviewBar({ issue, actions, open, onOpen, onCancel, containerRef }: {
  issue: IssueDetail;
  actions: EditActions;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errId = useId();

  async function send() {
    if (busy) return;
    setBusy(true);
    const res = await actions.reject(reason);
    setBusy(false);
    if (res.ok) {
      setReason('');
      setError(null);
      onCancel();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="nl-review" role="group" aria-label="驗收" ref={containerRef}>
      <div className="who">
        <span className="rv-ic" aria-hidden="true">
          <Icon name="status-in-review" />
        </span>
        <div>
          <b>等你驗收</b>
          <p>{issue.next_step ?? '確認內容與變更紀錄後通過；需要修改則退回並寫明原因。'}</p>
        </div>
      </div>
      {open && (
        <div className="nl-field">
          <MarkdownEditor
            label="退回原因（必填）"
            value={reason}
            onChange={(v) => { setReason(v); if (error !== null && v.trim() !== '') setError(null); }}
            onSubmit={() => void send()}
            onCancel={onCancel}
            placeholder="寫明需要修改的地方，agent 依此繼續"
            hint="⌘↵ 送出"
            autoFocus
            required
            invalid={error !== null}
            {...(error === null ? {} : { describedBy: errId })}
          />
          {error !== null && (
            <p className="nl-error" id={errId}>
              <Icon name="alert" size="sm" />
              {error}
            </p>
          )}
        </div>
      )}
      <div className="acts">
        {open ? (
          <>
            <button type="button" className="nl-btn nl-btn--secondary" onClick={onCancel}>
              取消退回
            </button>
            <button type="button" className="nl-btn nl-btn--primary" disabled={reason.trim() === '' || busy} aria-busy={busy} onClick={() => void send()}>
              退回，回到 In Progress
            </button>
          </>
        ) : (
          <>
            <button type="button" className="nl-btn nl-btn--secondary" onClick={onOpen}>
              退回
            </button>
            <button type="button" className="nl-btn nl-btn--primary" aria-keyshortcuts="Meta+Enter" onClick={() => void actions.approve()}>
              通過（移到 Done）
              <span className="nl-kbd">⌘↵</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- 標題 ----

function TitleEditor({ issue, actions, headingId }: { issue: IssueDetail; actions: EditActions; headingId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const editing = draft !== null;
  // 打開編輯時選取全部
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function finish(save: boolean) {
    if (draft === null) return;
    const text = draft.trim();
    if (save && text === '') {
      setError(true);
      return;
    }
    setDraft(null);
    setError(false);
    if (save && text !== issue.title) void actions.edit({ title: text }, `${issue.identifier} 已更新標題`);
    setTimeout(() => { headRef.current?.focus(); }, 0);
  }

  if (draft !== null) {
    return (
      <div className="ttl-wrap">
        <label className="vh" htmlFor={`${headingId}-input`}>
          標題
        </label>
        <input
          ref={inputRef}
          id={`${headingId}-input`}
          className="nl-title-input"
          value={draft}
          autoFocus
          aria-invalid={error}
          onChange={(e) => { setDraft(e.target.value); setError(false); }}
          onBlur={() => { finish(draft.trim() !== ''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
          }}
        />
        {error && (
          <p className="nl-error">
            <Icon name="alert" size="sm" />
            標題必填
          </p>
        )}
      </div>
    );
  }
  return (
    <h2
      ref={headRef}
      className="ttl-edit"
      id={headingId}
      tabIndex={0}
      role="button"
      aria-label={`標題：${issue.title}（按 Enter 修改）`}
      onClick={() => { setDraft(issue.title); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDraft(issue.title); }
      }}
    >
      {issue.title}
    </h2>
  );
}

// ---- 描述 ----

function DescriptionEditor({ issue, actions }: { issue: IssueDetail; actions: EditActions }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setDraft(null); }, [issue.number]);

  const close = () => {
    setDraft(null);
    setTimeout(() => { editBtn.current?.focus(); }, 0);
  };
  const save = () => {
    if (draft === null) return;
    const text = draft;
    close();
    if (text !== issue.description) void actions.edit({ description: text }, `${issue.identifier} 已更新描述`);
  };

  return (
    <section className="desc" aria-label="描述">
      <div className="sec-h">
        <h3>描述</h3>
        {draft === null && (
          <button ref={editBtn} type="button" className="nl-btn nl-btn--ghost nl-btn--sm" onClick={() => { setDraft(issue.description); }}>
            <Icon name="edit" size="sm" />
            編輯
          </button>
        )}
      </div>
      {draft === null ? (
        <Markdown source={issue.description} empty="沒有描述" />
      ) : (
        <>
          <MarkdownEditor label="描述（Markdown）" value={draft} onChange={setDraft} onSubmit={save} onCancel={close} autoFocus tall placeholder="支援 Markdown" hint="⌘↵ 儲存、Esc 取消" />
          <div className="form-acts">
            <button type="button" className="nl-btn nl-btn--secondary nl-btn--sm" onClick={close}>
              取消
            </button>
            <button type="button" className="nl-btn nl-btn--primary nl-btn--sm" aria-keyshortcuts="Meta+Enter" onClick={save}>
              儲存
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ---- 欄位 ----

function Check({ on }: { on: boolean }): ReactNode {
  return on ? <Icon name="check" size="sm" /> : undefined;
}

function Fields({ issue, projects, projectMap, actions, links, openMenu }: {
  issue: IssueDetail;
  projects: Project[];
  projectMap: ReadonlyMap<number, Project>;
  actions: EditActions;
  links: DetailLinks;
  openMenu: (m: MenuState) => void;
}) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const project = issue.project_id === null ? undefined : projectMap.get(issue.project_id);
  const id = issue.identifier;
  const exclude = useMemo(() => new Set([issue.number, ...issue.blocked_by.map((b) => b.number)]), [issue.number, issue.blocked_by]);
  // 選得到的 Project：全部（Project 沒有狀態了，NX-165）
  const projectChoices = projects;

  const statusMenu = (anchor: HTMLElement) => {
    openMenu({
      anchor,
      label: '狀態',
      groups: [{
        items: ISSUE_STATUSES.map((s) => ({
          key: s,
          label: STATUS_LABEL[s],
          icon: STATUS_ICON[s],
          iconColor: `var(--status-${STATUS_TOKEN[s]}-solid)`,
          right: <Check on={s === issue.status} />,
          onSelect: () => { void actions.edit({ status: s }, s === 'Done' ? `${id} 已完成` : `${id} 已移到「${STATUS_LABEL[s]}」`); },
        })),
      }],
    });
  };
  const projectMenu = (anchor: HTMLElement) => {
    openMenu({
      anchor,
      label: 'Project',
      groups: [
        {
          items: projectChoices.map((p) => ({
            key: String(p.id),
            label: (
              <span className="opt-proj">
                <span className={`nl-pdot ${projectColorClass(p.id)}`} aria-hidden="true" />
                {p.name}
              </span>
            ),
            right: <Check on={p.id === issue.project_id} />,
            onSelect: () => { void actions.edit({ project_id: p.id }, `${id} 已移到「${p.name}」`); },
          })),
        },
        { items: [{ key: 'none', label: '沒有 Project', right: <Check on={issue.project_id === null} />, onSelect: () => { void actions.edit({ project_id: null }, `${id} 已移出 Project`); } }] },
      ],
    });
  };

  return (
    <div className="nl-fields">
      <span className="k" id={`${id}-f-status`}>狀態</span>
      <button type="button" className="nl-btn val" aria-haspopup="menu" aria-label={`狀態：${STATUS_LABEL[issue.status]}，按一下修改`} onClick={(e) => { statusMenu(e.currentTarget); }}>
        <StatusBadge status={issue.status} bare />
        <Icon name="chev-down" size="sm" />
      </button>

      <span className="k">Project</span>
      <button type="button" className="nl-btn val" aria-haspopup="menu" aria-label={`Project：${project?.name ?? '沒有 Project'}，按一下修改`} onClick={(e) => { projectMenu(e.currentTarget); }}>
        {project !== undefined && <span className={`nl-pdot ${projectColorClass(project.id)}`} aria-hidden="true" />}
        <span className={project === undefined ? 'lbl ph' : 'lbl'}>{project?.name ?? '沒有 Project'}</span>
        <Icon name="chev-down" size="sm" />
      </button>

      <label className="k" htmlFor={`${id}-due`}>到期日</label>
      <span className="val-row">
        <input
          id={`${id}-due`}
          type="date"
          className="nl-input due"
          value={issue.due_date ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? null : e.target.value;
            void actions.edit({ due_date: v }, v === null ? `${id} 已清除到期日` : `${id} 到期日已改為 ${v}`);
          }}
        />
        {issue.due_date !== null && (
          <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="清掉到期日" title="清掉到期日" onClick={() => void actions.edit({ due_date: null }, `${id} 已清除到期日`)}>
            <Icon name="x" size="sm" />
          </button>
        )}
      </span>

      <span className="k k-top">blocked by</span>
      <div className="blockers">
        {issue.blocked_by.length === 0 && <span className="ph">沒有</span>}
        {issue.blocked_by.map((b) => (
          <BlockerChip key={b.number} item={b} href={links.issue(b.identifier)} onRemove={() => void actions.removeBlocker(b)} />
        ))}
        <button
          type="button"
          className="nl-btn nl-btn--ghost nl-btn--sm add"
          aria-haspopup="listbox"
          aria-expanded={picker !== null}
          onClick={(e) => { setPicker(e.currentTarget); }}
        >
          <Icon name="plus" size="sm" />
          加入
        </button>
      </div>

      {issue.blocks.length > 0 && (
        <>
          <span className="k k-top">擋住</span>
          <div className="blockers">
            {issue.blocks.map((b) => (
              <BlockerChip key={b.number} item={b} href={links.issue(b.identifier)} />
            ))}
          </div>
        </>
      )}
      {picker !== null && (
        <BlockerPicker
          anchor={picker}
          exclude={exclude}
          onPick={(t) => void actions.addBlocker(t)}
          onClose={(opts) => {
            const a = picker;
            setPicker(null);
            if (opts?.restoreFocus !== false && a.isConnected) a.focus();
          }}
        />
      )}
    </div>
  );
}

function BlockerChip({ item, href, onRemove }: { item: IssueSummary; href: string; onRemove?: () => void }) {
  return (
    <span className="blk" data-blocker={item.number}>
      <span className="ic" style={{ color: `var(--status-${STATUS_TOKEN[item.status]}-solid)` }}>
        <Icon name={STATUS_ICON[item.status]} size="sm" />
      </span>
      <Link to={href} className="blk-link" title={`${item.identifier} ${item.title}（${STATUS_LABEL[item.status]}）`}>
        <span className="id">{item.identifier}</span>
        <span className="t">{item.title}</span>
      </Link>
      {onRemove !== undefined && (
        <button type="button" className="x" aria-label={`移除 blocked by ${item.identifier}`} onClick={onRemove}>
          <Icon name="x" size="sm" />
        </button>
      )}
    </span>
  );
}

// ---- 變更紀錄 ----

const HISTORY_SHOWN = 10;

function History({ events, names, actions }: { events: IssueEvent[]; names: EventNames; actions: EditActions }) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const list = newestFirst(events);
  const shown = all ? list : list.slice(0, HISTORY_SHOWN);
  return (
    <section className="nl-history" aria-label="變更紀錄">
      <h3>
        <Icon name="history" size="sm" />
        變更紀錄
        {events.length > 0 && <span className="n">{events.length}</span>}
      </h3>
      {list.length === 0 ? (
        <p className="md-empty">沒有變更紀錄</p>
      ) : (
        <div role="list">
          {shown.map((e) => {
            const reverted = e.reverted_by_event_id !== null;
            const label = revertLabel(e, names);
            return (
              <div key={e.id} className={`nl-hist${reverted ? ' is-reverted' : ''}`} role="listitem" data-event={e.id}>
                <span className="what">
                  <b>{e.actor}</b> {eventText(e, events, names)}
                  <span className="when" title={fullTime(e.created_at)}>
                    {relativeTime(e.created_at)}
                  </span>
                </span>
                {canRevert(e) ? (
                  <button
                    type="button"
                    className="nl-btn nl-btn--ghost nl-btn--sm"
                    aria-label={label}
                    aria-busy={busy === e.id}
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(e.id);
                      void actions.revert(e, label.replace(/^還原：/, '')).finally(() => { setBusy(null); });
                    }}
                  >
                    <Icon name="undo" size="sm" />
                    還原
                  </button>
                ) : reverted ? (
                  <span className="done-tag">已還原</span>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}
      {list.length > HISTORY_SHOWN && (
        <button type="button" className="nl-btn nl-btn--ghost nl-btn--sm more-hist" onClick={() => { setAll((v) => !v); }}>
          {all ? '只看最近 10 筆' : `顯示全部 ${String(list.length)} 筆`}
        </button>
      )}
    </section>
  );
}

// ---- comment ----

function Comments({ issueKey, comments, actions }: { issueKey: string; comments: DetailData['comments']; actions: EditActions }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { setDraft(''); }, [issueKey]);
  const list = [...comments].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);

  async function send() {
    if (sending || draft.trim() === '') return;
    setSending(true);
    const ok = await actions.comment(draft);
    setSending(false);
    if (ok) setDraft('');
  }

  return (
    <section className="comments" aria-label="comment">
      <h3>
        comment
        {list.length > 0 && <span className="n">{list.length}</span>}
      </h3>
      {list.length > 0 && (
        <ol className="cmt-list">
          {list.map((c) => (
            <li key={c.id} className="cmt" data-comment={c.id}>
              <div className="who">
                <span className="nm">{c.author}</span>
                <small title={fullTime(c.created_at)}>{relativeTime(c.created_at)}</small>
              </div>
              <Markdown source={c.body} />
            </li>
          ))}
        </ol>
      )}
      <div className="cmt-form">
        <MarkdownEditor label="寫 comment（Markdown）" value={draft} onChange={setDraft} onSubmit={() => void send()} placeholder="寫 comment…" hint="⌘↵ 送出" />
        <div className="form-acts">
          <button type="button" className="nl-btn nl-btn--secondary nl-btn--sm" aria-keyshortcuts="Meta+Enter" disabled={draft.trim() === '' || sending} aria-busy={sending} onClick={() => void send()}>
            送出
            <span className="nl-kbd">⌘↵</span>
          </button>
        </div>
      </div>
    </section>
  );
}
