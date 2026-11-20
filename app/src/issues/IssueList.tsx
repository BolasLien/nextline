// 「全部的票」列表（/issues）與 Project 頁的列表分頁共用。篩選、分組、排序都在網址上（listQuery.ts），
// 重新整理或把網址給別人，打開就是同一個畫面。點一列：桌面開右側預覽，手機進整頁。
//
// 「已封存」（?archived=1，NX-160）：只列封存的票，每列可以取消封存。產品不放 Sprint，沒有 Sprint 篩選。
// 票數：一次抓完符合狀態／Project 的所有票（目前 160 多張沒做完的），不分頁、也不用 JS 虛擬化：
// 每一列用 CSS content-visibility: auto（list.css），畫面外的列瀏覽器不排版、不繪製，捲動跟只有一屏一樣順；
// DOM 還在，所以分組標題、Cmd+F 找字、鍵盤 J／K 都照常。分頁會把分組切斷、搜尋也只搜到這一頁，所以不用。
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiContext } from '../api/ApiProvider';
import { ISSUE_STATUSES, type Issue, type IssueStatus, OPEN_STATUSES } from '../api/types';
import { useIssueSync } from '../issue/issueSync';
import { PageHeader } from '../shell/AppShell';
import { projectColorClass } from '../shell/sprints';
import { useToast } from '../toast/ToastProvider';
import { Icon } from '../ui/Icon';
import { Menu, type MenuGroup } from '../ui/Menu';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states';
import { STATUS_ICON, STATUS_LABEL, STATUS_TOKEN } from '../ui/status';
import { unarchiveFromList } from './archive';
import { IssueRow, onListKeyDown } from './IssueRow';
import {
  apiQuery,
  clearFilters,
  DEFAULT_QUERY,
  type GroupBy,
  groupIssues,
  hasFilter,
  type IssueGroup,
  type ListQuery,
  matchesQuery,
  parseListQuery,
  type SortBy,
  toggleStatus,
  writeListQuery,
} from './listQuery';
import { type ListMeta, useListMeta, usePeekOpener } from './useListMeta';
import { useIssues } from './useIssues';
import '../ui/input.css';
import './list.css';

const GROUP_LABEL: Record<GroupBy, string> = { status: '狀態', project: 'Project', none: '不分組' };
const SORT_LABEL: Record<SortBy, string> = { updated: '更新時間', number: '票號' };
const SEARCH_DELAY_MS = 200;

function statusSummary(statuses: readonly IssueStatus[]): string {
  if (statuses.length === OPEN_STATUSES.length && OPEN_STATUSES.every((s) => statuses.includes(s))) return '沒做完';
  if (statuses.length === ISSUE_STATUSES.length) return '全部';
  const names = ISSUE_STATUSES.filter((s) => statuses.includes(s)).map((s) => STATUS_LABEL[s]);
  return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${String(names.length)} 種`;
}

// 列表頁。title 有給就畫頁首（/issues）；Project 頁的列表分頁不給（頁首是 Project 的）。
export function IssueListView({ title, fixedProject = null }: { title?: (query: ListQuery) => string; fixedProject?: number | null }) {
  const [params, setParams] = useSearchParams();
  const parsed = parseListQuery(params);
  const query: ListQuery = fixedProject === null ? parsed : { ...parsed, project: fixedProject };
  const meta = useListMeta();

  const serverQuery = meta.status === 'success' ? apiQuery(query) : null;
  // 別處改過的票還屬不屬於這個列表：只看伺服器篩的條件（狀態、Project、封存），關鍵字在畫面上再篩。
  const belongs = (i: Issue) => matchesQuery(i, { ...query, q: '' });
  const data = useIssues(serverQuery, belongs);

  const update = useCallback(
    (next: ListQuery) => {
      setParams((p) => writeListQuery(p, fixedProject === null ? next : { ...next, project: null }), { replace: true });
    },
    [setParams, fixedProject],
  );

  const queryKey = JSON.stringify(query);
  const visible = useMemo(() => {
    const q = JSON.parse(queryKey) as ListQuery;
    return data.issues.filter((i) => matchesQuery(i, q));
  }, [data.issues, queryKey]);
  const ready = meta.status === 'success' && data.status === 'success';
  const heading = title?.(query);

  let body: ReactNode;
  if (meta.status === 'error') {
    body = <ErrorState title="列表載入失敗" message={meta.error.message} {...(meta.error.isUnauthorized ? {} : { onRetry: meta.reload })} />;
  } else if (data.status === 'error') {
    body = <ErrorState title="列表載入失敗" message={data.error.message} {...(data.error.isUnauthorized ? {} : { onRetry: data.reload })} />;
  } else if (!ready) {
    body = <LoadingBlock label={`${heading ?? '列表'}載入中`} rows={6} />;
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        icon={query.archived ? 'archive' : 'filter'}
        title={query.archived && !hasFilter({ ...query, archived: false }, fixedProject) ? '沒有封存的票' : '沒有符合的票'}
        action={
          hasFilter(query, fixedProject) ? (
            <button type="button" className="nl-btn nl-btn--secondary" onClick={() => { update(clearFilters(query)); }}>
              清除篩選
            </button>
          ) : undefined
        }
      >
        {query.archived ? '封存的票顯示在這裡，可隨時取消封存。' : hasFilter(query, fixedProject) ? '調整條件，或清除篩選。' : '沒有票。'}
      </EmptyState>
    );
  } else {
    body = <GroupedList groups={groupIssues(visible, query.group, query.sort, meta.data.projectMap)} meta={meta.data} grouped={query.group !== 'none'} archived={query.archived} />;
  }

  const count = ready ? (
    <span className="list-count" data-count="list">
      {visible.length} 張
    </span>
  ) : null;

  return (
    <>
      {heading !== undefined && (
        <PageHeader title={heading}>
          {count}
        </PageHeader>
      )}
      <div className="view list-view">
        <FilterBar query={query} meta={meta.status === 'success' ? meta.data : null} fixedProject={fixedProject} onChange={update}>
          {heading === undefined && count}
        </FilterBar>
        {body}
      </div>
    </>
  );
}

function GroupedList({ groups, meta, grouped, archived }: { groups: IssueGroup[]; meta: ListMeta; grouped: boolean; archived: boolean }) {
  const { peek, open } = usePeekOpener();
  const { api } = useApiContext();
  const sync = useIssueSync();
  const { show } = useToast();
  return (
    <div className="nl-list" onKeyDown={onListKeyDown}>
      {groups.map((g) => (
        <section key={g.key} className="grp" aria-label={`${groupLabel(g)}，${String(g.issues.length)} 張`} data-group={g.key}>
          {grouped && <GroupHeader group={g} />}
          <ul className="rows">
            {g.issues.map((i) => (
              <IssueRow
                key={i.number}
                issue={i}
                project={i.project_id === null ? undefined : meta.projectMap.get(i.project_id)}
                peeked={peek === i.identifier}
                onOpen={open}
                {...(archived
                  ? {
                      action: (
                        <button type="button" className="nl-btn nl-btn--secondary nl-btn--sm row-act" aria-label={`取消封存 ${i.identifier}`} data-unarchive={i.identifier} onClick={() => void unarchiveFromList(api, sync, show, i)}>
                          取消封存
                        </button>
                      ),
                    }
                  : {})}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupLabel(g: IssueGroup): string {
  return g.status === undefined ? g.label : STATUS_LABEL[g.status];
}

function GroupHeader({ group }: { group: IssueGroup }) {
  return (
    <h2 className="grp-h">
      {group.status !== undefined && (
        <span className="ic" style={{ color: `var(--status-${STATUS_TOKEN[group.status]}-solid)` }}>
          <Icon name={STATUS_ICON[group.status]} size="sm" />
        </span>
      )}
      {group.kind === 'project' && (group.project ? <span className={`nl-pdot ${projectColorClass(group.project.id)}`} aria-hidden="true" /> : <Icon name="folder" size="sm" />)}
      <span>{groupLabel(group)}</span>
      <span className="n">{group.issues.length}</span>
    </h2>
  );
}

type MenuKind = 'status' | 'project' | 'group' | 'sort';

function FilterBar({ query, meta, fixedProject, onChange, children }: {
  query: ListQuery;
  meta: ListMeta | null;
  fixedProject: number | null;
  onChange: (q: ListQuery) => void;
  children?: ReactNode;
}) {
  const [menu, setMenu] = useState<{ kind: MenuKind; anchor: HTMLElement } | null>(null);
  const closeMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setMenu((m) => {
      if (m !== null && opts?.restoreFocus !== false && m.anchor.isConnected) m.anchor.focus();
      return null;
    });
  }, []);

  // 搜尋框：打字後 200ms 寫進網址；網址的 q 被別處清掉時跟著清。
  const [text, setText] = useState(query.q);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    if (text.trim() === queryRef.current.q) return;
    const t = setTimeout(() => { onChange({ ...queryRef.current, q: text }); }, SEARCH_DELAY_MS);
    return () => { clearTimeout(t); };
  }, [text, onChange]);
  useEffect(() => {
    setText((t) => (t.trim() === query.q ? t : query.q));
  }, [query.q]);

  const toggle = (kind: MenuKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget;
    setMenu((m) => (m?.kind === kind ? null : { kind, anchor }));
  };

  const projectName = (id: number) => meta?.projectMap.get(id)?.name ?? `Project ${String(id)}`;

  const groups = menu === null ? [] : menuGroups(menu.kind, query, meta, onChange);
  const statusOn = !(query.statuses.length === DEFAULT_QUERY.statuses.length && DEFAULT_QUERY.statuses.every((s) => query.statuses.includes(s)));

  return (
    <div className="filters" role="toolbar" aria-label="篩選">
      <label className="search">
        <Icon name="search" size="sm" />
        <input
          className="nl-input"
          type="search"
          aria-label="搜尋票號或標題"
          placeholder="搜尋票號或標題"
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text !== '') {
              e.preventDefault();
              e.stopPropagation();
              setText('');
              onChange({ ...query, q: '' });
            }
          }}
        />
      </label>
      <Chip on={statusOn} icon="filter" expanded={menu?.kind === 'status'} onClick={toggle('status')} filter="status">
        狀態：{statusSummary(query.statuses)}
      </Chip>
      {fixedProject === null && (
        <Chip on={query.project !== null} icon="folder" expanded={menu?.kind === 'project'} onClick={toggle('project')} filter="project">
          {query.project !== null && query.project !== 'none' && <span className={`nl-pdot ${projectColorClass(query.project)}`} aria-hidden="true" />}
          Project：{query.project === null ? '全部' : query.project === 'none' ? '沒有 Project' : projectName(query.project)}
        </Chip>
      )}
      <Chip on={false} expanded={menu?.kind === 'group'} onClick={toggle('group')} filter="group">
        分組：{GROUP_LABEL[query.group]}
      </Chip>
      <Chip on={false} expanded={menu?.kind === 'sort'} onClick={toggle('sort')} filter="sort">
        排序：{SORT_LABEL[query.sort]}
      </Chip>
      {hasFilter(query, fixedProject) && (
        <button type="button" className="nl-btn nl-btn--ghost nl-btn--sm" onClick={() => { setText(''); onChange(clearFilters(query)); }}>
          清除篩選
        </button>
      )}
      <span className="sp" />
      {/* 封存的票不在一般列表；這裡切到「已封存」看、取消封存（NX-160） */}
      <button type="button" className={`nl-fchip${query.archived ? ' on' : ''}`} aria-pressed={query.archived} data-filter="archived" onClick={() => { onChange({ ...query, archived: !query.archived }); }}>
        <Icon name="archive" size="sm" />
        <span className="lbl">已封存</span>
      </button>
      {children}
      {menu !== null && <Menu anchor={menu.anchor} label={MENU_LABEL[menu.kind]} groups={groups} onClose={closeMenu} />}
    </div>
  );
}

const MENU_LABEL: Record<MenuKind, string> = { status: '狀態篩選', project: 'Project 篩選', group: '分組', sort: '排序' };

function Chip({ on, icon, expanded, onClick, filter, children }: {
  on: boolean;
  icon?: Parameters<typeof Icon>[0]['name'];
  expanded: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  filter: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`nl-fchip${on ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={expanded} data-filter={filter} onClick={onClick}>
      {icon !== undefined && <Icon name={icon} size="sm" />}
      <span className="lbl">{children}</span>
      <Icon name="chev-down" size="sm" />
    </button>
  );
}

function menuGroups(kind: MenuKind, query: ListQuery, meta: ListMeta | null, onChange: (q: ListQuery) => void): MenuGroup[] {
  switch (kind) {
    case 'status':
      return [
        {
          items: ISSUE_STATUSES.map((s) => ({
            key: s,
            label: STATUS_LABEL[s],
            icon: STATUS_ICON[s],
            iconColor: `var(--status-${STATUS_TOKEN[s]}-solid)`,
            checked: query.statuses.includes(s),
            keepOpen: true,
            onSelect: () => { onChange({ ...query, statuses: toggleStatus(query.statuses, s) }); },
          })),
        },
        {
          items: [
            { key: 'open', label: '只看沒做完的', onSelect: () => { onChange({ ...query, statuses: [...OPEN_STATUSES] }); } },
            { key: 'all', label: '全部狀態', onSelect: () => { onChange({ ...query, statuses: [...ISSUE_STATUSES] }); } },
          ],
        },
      ];
    case 'project':
      return [
        {
          items: [
            { key: 'all', label: '全部 Project', checked: query.project === null, onSelect: () => { onChange({ ...query, project: null }); } },
            ...(meta?.projects ?? []).map((p) => ({
              key: String(p.id),
              label: (
                <span className="menu-proj">
                  <span className={`nl-pdot ${projectColorClass(p.id)}`} aria-hidden="true" />
                  {p.name}
                </span>
              ),
              checked: query.project === p.id,
              onSelect: () => { onChange({ ...query, project: p.id }); },
            })),
            { key: 'none', label: '沒有 Project', checked: query.project === 'none', onSelect: () => { onChange({ ...query, project: 'none' }); } },
          ],
        },
      ];
    case 'group':
      return [
        {
          items: (['status', 'project', 'none'] as const).map((g) => ({
            key: g,
            label: GROUP_LABEL[g],
            checked: query.group === g,
            onSelect: () => { onChange({ ...query, group: g }); },
          })),
        },
      ];
    case 'sort':
      return [
        {
          items: (['updated', 'number'] as const).map((s) => ({
            key: s,
            label: s === 'updated' ? '更新時間（新到舊）' : '票號（大到小）',
            checked: query.sort === s,
            onSelect: () => { onChange({ ...query, sort: s }); },
          })),
        },
      ];
  }
}

export function IssuesPage() {
  // 只篩待驗收（側欄「等你」）時標題叫「等你」；看封存的叫「已封存」
  return <IssueListView title={(q) => (q.archived ? '已封存' : q.statuses.length === 1 && q.statuses[0] === 'In Review' ? '等你' : '全部的票')} />;
}
