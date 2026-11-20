// 首頁看板（NX-153）：全部沒做完的票分在 Todo、In Progress、待驗收、Done（最近 7 天）四欄；
// Backlog、Canceled 收在標題列只顯示張數，點了展開，拖曳時當放置區。
// 拖拉換欄或調順序（dnd-kit，鍵盤也能搬），樂觀更新，失敗退回並出錯誤 toast；換欄後 toast「復原」（Cmd/Ctrl+Z 也行）。
// 手機一次看一欄（分頁切換），不拖拉，用卡片選單「移到…」。
// 點卡片：桌面開右側預覽（?peek=NX-n），手機直接進整頁。票詳細改了什麼，透過 issueSync 馬上反映在看板上（反過來也一樣）。
// Project 頁的「看板」分頁也用這個元件（project 有給）：只放這個 Project 沒做完的票＋7 天內的 Done，頁首是 Project 的，這裡只畫工具列。
import {
  type Announcements,
  type CollisionDetection,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  type UniqueIdentifier,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useApiContext } from '../api/ApiProvider';
import { ISSUE_STATUSES, type Issue, type IssueStatus, type Project } from '../api/types';
import { mergeIssue, useIssueSync, useIssueUpdates } from '../issue/issueSync';
import { useShellActions } from '../shell/actions';
import { PageHeader } from '../shell/AppShell';
import { useToast } from '../toast/ToastProvider';
import { Icon } from '../ui/Icon';
import { Menu, type MenuGroup } from '../ui/Menu';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states';
import { STATUS_ICON, STATUS_LABEL, STATUS_TOKEN } from '../ui/status';
import { MOBILE_QUERY, useMediaQuery } from '../ui/useMediaQuery';
import { BoardCard, type CardActions, CardOverlay } from './BoardCard';
import {
  BOARD_COLUMNS,
  type Columns,
  currentPlacement,
  FOLDED_COLUMNS,
  groupColumns,
  moveLocally,
  type Placement,
  placementAt,
  replaceIssue,
  shownColumns,
  without,
} from './columns';
import { saveMove, undoMove } from './moves';
import { useBoardData } from './useBoardData';
import '../ui/button.css';
import './board.css';

const SHORT_LABEL: Record<IssueStatus, string> = { ...STATUS_LABEL, 'In Progress': '進行中' };
const COL_PREFIX = 'col:';
const FOLD_PREFIX = 'fold:';
const NO_SENSORS: [] = [];

type IdColumns = Record<IssueStatus, number[]>;

function toIds(columns: Columns): IdColumns {
  return Object.fromEntries(ISSUE_STATUSES.map((s) => [s, columns[s].map((i) => i.number)])) as IdColumns;
}

function statusFromId(id: UniqueIdentifier, prefix: string): IssueStatus | null {
  if (typeof id !== 'string' || !id.startsWith(prefix)) return null;
  const s = id.slice(prefix.length);
  return (ISSUE_STATUSES as readonly string[]).includes(s) ? (s as IssueStatus) : null;
}

function containerOf(columns: IdColumns, id: UniqueIdentifier): IssueStatus | null {
  const col = statusFromId(id, COL_PREFIX);
  if (col !== null) return col;
  if (typeof id !== 'number') return null;
  return ISSUE_STATUSES.find((s) => columns[s].includes(id)) ?? null;
}

// 游標在標題列的 Backlog／Canceled 上就是放到那裡；其他用最近的角（多欄看板的常見做法）。
const collision: CollisionDetection = (args) => {
  const fold = pointerWithin(args).find((c) => statusFromId(c.id, FOLD_PREFIX) !== null);
  return fold === undefined ? closestCorners(args) : [fold];
};

// 網址 ?col= 用狀態的 token 名稱（todo、in-progress…）。
function colFromParam(v: string | null): IssueStatus {
  return ISSUE_STATUSES.find((s) => STATUS_TOKEN[s] === v) ?? 'Todo';
}


interface DragState {
  id: number;
  columns: IdColumns;
}

// 看板的標題列：一般是頁首（h1「看板」）；嵌在 Project 頁時只是一條工具列（手機沒有東西要放就不畫）。
function BoardBar({ embedded, isMobile, children }: { embedded: boolean; isMobile: boolean; children?: ReactNode }) {
  if (!embedded) return <PageHeader title="看板">{children}</PageHeader>;
  if (isMobile) return null;
  return <div className="topbar topbar--sub">{children}</div>;
}

export function BoardPage({ project = null }: { project?: number | null }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const embedded = project !== null;
  const board = useBoardData(project);
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // 票詳細（預覽面板、整頁）改了票：換掉看板上那張；換到別的 Project（Project 頁）就拿掉，換進來就加上。
  useIssueUpdates((issue) => {
    if (board.load.status !== 'success') return;
    board.setIssues((prev) => mergeIssue(prev, issue, (i) => (embedded ? i.project_id === project : true)));
  });

  if (board.load.status === 'loading') {
    return (
      <>
        <BoardBar embedded={embedded} isMobile={isMobile} />
        <div className="view">
          <LoadingBlock label="看板載入中" rows={4} />
        </div>
      </>
    );
  }
  if (board.load.status === 'error') {
    const { error } = board.load;
    return (
      <>
        <BoardBar embedded={embedded} isMobile={isMobile} />
        <div className="view">
          <ErrorState title="看板載入失敗" message={error.message} {...(error.isUnauthorized ? {} : { onRetry: board.reload })} />
        </div>
      </>
    );
  }

  const { projects } = board.load.meta;

  if (board.issues.length === 0 && embedded) {
    return (
      <div className="view">
        <EmptyState icon="board" title="這個 Project 沒有未完成的票">
          按 C 建立票，或由 agent 透過 API 建立。
        </EmptyState>
      </div>
    );
  }
  if (board.issues.length === 0) {
    return (
      <>
        <PageHeader title="看板">{!isMobile && <NewIssueButton />}</PageHeader>
        <div className="view">
          <EmptyState icon="board" title="沒有票">
            按 C 建立票。
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <Board
      embedded={embedded}
      issues={board.issues}
      setIssues={board.setIssues}
      hold={board.hold}
      projects={projects}
      regionLabel={embedded ? '看板：這個 Project 的票' : '看板：全部沒做完的票'}
      isMobile={isMobile}
      peek={params.get('peek')}
      openIssue={(identifier) => {
        if (isMobile) {
          void navigate(`/issues/${identifier}`);
          return;
        }
        setParams((p) => {
          const q = new URLSearchParams(p);
          q.set('peek', identifier);
          return q;
        });
      }}
      mobileCol={colFromParam(params.get('col'))}
      setMobileCol={(s) => {
        setParams((p) => {
          const q = new URLSearchParams(p);
          if (s === 'Todo') q.delete('col');
          else q.set('col', STATUS_TOKEN[s]);
          return q;
        }, { replace: true });
      }}
    />
  );
}

function Board({ embedded, issues, setIssues, hold, projects, regionLabel, isMobile, mobileCol, setMobileCol, peek, openIssue }: {
  embedded: boolean;
  issues: Issue[];
  setIssues: ReturnType<typeof useBoardData>['setIssues'];
  hold: () => () => void;
  projects: ReadonlyMap<number, Project>;
  regionLabel: string;
  isMobile: boolean;
  mobileCol: IssueStatus;
  setMobileCol: (s: IssueStatus) => void;
  peek: string | null;
  openIssue: (identifier: string) => void;
}) {
  const { api } = useApiContext();
  const { show } = useToast();
  const sync = useIssueSync();
  const { newIssue } = useShellActions();
  const [expanded, setExpanded] = useState<ReadonlySet<IssueStatus>>(() => new Set());
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const releaseDrag = useRef<(() => void) | null>(null);
  const justDragged = useRef(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; groups: MenuGroup[]; label: string; issue: number | null } | null>(null);
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  const columns = useMemo(() => groupColumns(issues, Date.now()), [issues]);
  const byNumber = useMemo(() => new Map(issues.map((i) => [i.number, i])), [issues]);
  const shown = shownColumns(expanded);

  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  // ---- 寫回 ----

  const undo = useCallback(
    async (original: Issue, fromPlacement: Placement, toStatus: IssueStatus) => {
      const moved = issuesRef.current.find((i) => i.number === original.number);
      if (moved !== undefined) {
        setIssues((prev) =>
          replaceIssue(prev, {
            ...moved,
            status: original.status,
            position: original.position,
            completed_at: original.completed_at,
            canceled_at: original.canceled_at,
          }),
        );
      }
      const release = hold();
      try {
        const res = await undoMove(api, { ref: original.identifier, from: { status: original.status, placement: fromPlacement }, toStatus });
        setIssues((prev) => replaceIssue(prev, res));
        sync.publish(res);
      } catch (e) {
        if (moved !== undefined) setIssues((prev) => replaceIssue(prev, moved));
        throw e;
      } finally {
        release();
      }
    },
    [api, hold, setIssues, sync],
  );

  // 把票搬到 toStatus 欄的第 toIndex 個（不含自己算）。
  const move = useCallback(
    async (number: number, toStatus: IssueStatus, toIndex: number): Promise<void> => {
      const list = issuesRef.current;
      const cols = groupColumns(list, Date.now());
      const original = list.find((i) => i.number === number);
      if (original === undefined) return;
      const target = without(cols[toStatus], number);
      const index = Math.max(0, Math.min(toIndex, target.length));
      if (original.status === toStatus && cols[toStatus].findIndex((i) => i.number === number) === index) return;
      const fromPlacement = currentPlacement(cols, original);
      const placement = placementAt(target, index);

      setIssues((prev) => moveLocally(prev, groupColumns(prev, Date.now()), number, toStatus, index, new Date().toISOString()));
      const release = hold();
      try {
        const saved = await saveMove(api, original.identifier, original.status, { status: toStatus, placement });
        setIssues((prev) => replaceIssue(prev, saved));
        sync.publish(saved);
        if (original.status !== toStatus) {
          show({
            message: toStatus === 'Done' ? `${original.identifier} 已完成` : `${original.identifier} 已移到「${STATUS_LABEL[toStatus]}」`,
            onUndo: () => undo(original, fromPlacement, toStatus),
          });
        }
      } catch (e) {
        setIssues((prev) => replaceIssue(prev, original));
        show({
          kind: 'error',
          message: `儲存失敗：${e instanceof Error ? e.message : String(e)}`,
          action: { label: '重試', run: () => move(number, toStatus, toIndex) },
        });
      } finally {
        release();
      }
    },
    [api, hold, setIssues, show, undo, sync],
  );

  // ---- 卡片動作 ----

  const actions: CardActions = {
    onOpen: (issue) => {
      if (justDragged.current) return;
      openIssue(issue.identifier);
    },
    onMenu: (issue, anchor) => {
      setMenu({
        anchor,
        issue: issue.number,
        label: `${issue.identifier} 的動作`,
        groups: [
          {
            title: '移到…',
            items: ISSUE_STATUSES.filter((s) => s !== issue.status).map((s) => ({
              key: s,
              label: STATUS_LABEL[s],
              icon: STATUS_ICON[s],
              iconColor: `var(--status-${STATUS_TOKEN[s]}-solid)`,
              onSelect: () => { void move(issue.number, s, 0); },
            })),
          },
          { items: [{ key: 'open', label: '打開', right: '↵', onSelect: () => { openIssue(issue.identifier); } }] },
        ],
      });
    },
    onShift: (issue, dir) => {
      const i = shown.indexOf(issue.status);
      const next = shown[i + dir];
      if (i === -1 || next === undefined) return;
      void move(issue.number, next, 0).then(() => {
        document.querySelector<HTMLElement>(`.nl-card[data-n="${String(issue.number)}"] .hit`)?.focus();
      });
    },
  };

  // ---- 拖拉 ----

  // 鍵盤拖拉：↑↓ 在同一欄上下移一格，←→ 移到左右欄的最上面（收起的 Backlog／Canceled 不算）。
  // 回傳的座標是被拖的卡片要對齊的左上角，dnd-kit 再用碰撞偵測算出放在哪裡。
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context: { active, over, droppableRects } }) => {
    const d = dragRef.current;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return undefined;
    event.preventDefault();
    if (d === null || active === null) return undefined;
    const container = containerOf(d.columns, d.id);
    if (container === null) return undefined;
    const list = d.columns[container];
    const at = (id: UniqueIdentifier | undefined) => {
      const r = id === undefined ? undefined : droppableRects.get(id);
      return r === undefined ? undefined : { x: r.left, y: r.top };
    };
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      // 現在看起來在第幾個：over 是同欄的某一張就是它的位置
      const overIndex = over !== null && typeof over.id === 'number' ? list.indexOf(over.id) : -1;
      const cur = overIndex >= 0 ? overIndex : list.indexOf(d.id);
      return at(list[cur + (event.code === 'ArrowDown' ? 1 : -1)]);
    }
    const cols = shownRef.current;
    const next = cols[cols.indexOf(container) + (event.code === 'ArrowRight' ? 1 : -1)];
    if (next === undefined) return undefined;
    const first = d.columns[next][0];
    if (first !== undefined) return at(first);
    const r = droppableRects.get(`${COL_PREFIX}${next}`);
    return r === undefined ? undefined : { x: r.left + 10, y: r.top + 40 };
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      // Enter 留給「打開」；空白鍵拿起，空白鍵或 Enter 放下，Esc 取消。
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  function onDragStart({ active }: DragStartEvent) {
    setMenu(null);
    releaseDrag.current = hold();
    setDrag({ id: active.id as number, columns: toIds(columns) });
  }

  function onDragOver({ active, over }: DragOverEvent) {
    const d = dragRef.current;
    if (d === null || over === null || statusFromId(over.id, FOLD_PREFIX) !== null) return;
    const from = containerOf(d.columns, active.id);
    const to = containerOf(d.columns, over.id);
    if (from === null || to === null || from === to) return;
    const toList = [...d.columns[to]];
    const overIndex = typeof over.id === 'number' ? toList.indexOf(over.id) : -1;
    const rect = active.rect.current.translated;
    const below = rect !== null && overIndex >= 0 && rect.top > over.rect.top + over.rect.height / 2;
    toList.splice(overIndex >= 0 ? overIndex + (below ? 1 : 0) : toList.length, 0, d.id);
    setDrag({ ...d, columns: { ...d.columns, [from]: d.columns[from].filter((n) => n !== d.id), [to]: toList } });
  }

  function endDrag() {
    setDrag(null);
    releaseDrag.current?.();
    releaseDrag.current = null;
    // 放下後瀏覽器可能補一個 click，別把它當成「打開」
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const d = dragRef.current;
    endDrag();
    if (d === null || over === null) return;
    const fold = statusFromId(over.id, FOLD_PREFIX);
    if (fold !== null) {
      void move(d.id, fold, 0);
      return;
    }
    const container = containerOf(d.columns, active.id);
    if (container === null) return;
    let list = d.columns[container];
    const from = list.indexOf(d.id);
    const to = typeof over.id === 'number' ? list.indexOf(over.id) : -1;
    if (to >= 0 && to !== from) list = arrayMove(list, from, to);
    void move(d.id, container, list.indexOf(d.id));
  }

  function where(id: UniqueIdentifier | undefined): string {
    if (id === undefined) return '原位';
    const fold = statusFromId(id, FOLD_PREFIX);
    if (fold !== null) return `${STATUS_LABEL[fold]}（放到最上面）`;
    const d = dragRef.current;
    if (d === null) return '';
    const s = containerOf(d.columns, id);
    if (s === null) return '';
    const i = d.columns[s].indexOf(d.id);
    return `${STATUS_LABEL[s]}第 ${String(i + 1)} 張，共 ${String(d.columns[s].length)} 張`;
  }
  const ref = (id: UniqueIdentifier) => byNumber.get(id as number)?.identifier ?? String(id);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `拿起 ${ref(active.id)}。用方向鍵移動，空白鍵放下，Esc 取消。`,
    onDragOver: ({ active, over }) => (over === null ? `${ref(active.id)} 不在可以放的地方` : `${ref(active.id)} 在${where(over.id)}`),
    onDragEnd: ({ active, over }) => (over === null ? `${ref(active.id)} 放回原位` : `${ref(active.id)} 放到${where(over.id)}`),
    onDragCancel: ({ active }) => `取消拖曳，${ref(active.id)} 回到原位`,
  };

  // ---- 畫面 ----

  const ids = drag?.columns ?? toIds(columns);
  const listOf = (s: IssueStatus) => ids[s].flatMap((n) => byNumber.get(n) ?? []);
  const dropTarget = drag === null ? null : containerOf(drag.columns, drag.id);
  const activeIssue = drag === null ? undefined : byNumber.get(drag.id);

  const renderColumn = (s: IssueStatus) => (
    <BoardColumn
      key={s}
      status={s}
      issues={listOf(s)}
      isDrop={dropTarget === s && drag !== null}
      foldable={!isMobile && (FOLDED_COLUMNS as readonly IssueStatus[]).includes(s)}
      onFold={() => { setExpanded((e) => { const n = new Set(e); n.delete(s); return n; }); }}
      onNew={() => { newIssue({ status: s }); }}
      emptyText={isMobile ? '這一欄沒有票。' : s === 'In Review' ? 'agent 完成的票顯示在這裡。' : '拖曳票到這裡。'}
    >
      {listOf(s).map((issue) => (
        <BoardCard
          key={issue.number}
          issue={issue}
          project={issue.project_id === null ? undefined : projects.get(issue.project_id)}
          draggable={!isMobile && issue.status !== 'Canceled'}
          peeked={peek !== null && peek.toUpperCase() === issue.identifier}
          menuOpen={menu?.issue === issue.number}
          actions={actions}
        />
      ))}
    </BoardColumn>
  );

  const foldedMenu = (anchor: HTMLElement) => {
    setMenu({
      anchor,
      issue: null,
      label: 'Backlog 與 Canceled',
      groups: [
        {
          items: FOLDED_COLUMNS.map((s) => ({
            key: s,
            label: STATUS_LABEL[s],
            icon: STATUS_ICON[s],
            iconColor: `var(--status-${STATUS_TOKEN[s]}-solid)`,
            right: String(columns[s].length),
            onSelect: () => { setMobileCol(s); },
          })),
        },
      ],
    });
  };
  const mobileFolded = (FOLDED_COLUMNS as readonly IssueStatus[]).includes(mobileCol);

  return (
    // 標題列收起的 Backlog／Canceled 也是放置區，所以 DndContext 要包住整頁
    <DndContext
      sensors={isMobile ? NO_SENSORS : sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: '按空白鍵拿起這張票，用方向鍵移到別的欄或調整順序，再按空白鍵放下；Esc 取消。Enter 打開票，Cmd 或 Ctrl 加左右鍵直接移到左右欄。',
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
    >
      <DragWatchdog dragging={drag !== null} onLost={endDrag} />
      <BoardBar embedded={embedded} isMobile={isMobile}>
        {!isMobile && (
          <div className="collapsed-row">
            {FOLDED_COLUMNS.map((s) => (
              <FoldButton
                key={s}
                status={s}
                count={columns[s].length}
                expanded={expanded.has(s)}
                dragging={drag !== null}
                onToggle={() => {
                  setExpanded((e) => {
                    const n = new Set(e);
                    if (n.has(s)) n.delete(s);
                    else n.add(s);
                    return n;
                  });
                }}
              />
            ))}
          </div>
        )}
        <span className="sp" />
        {!embedded && !isMobile && <NewIssueButton />}
      </BoardBar>
      <div className="view board-view">
        {isMobile && (
          <div className="col-tabs" role="tablist" aria-label="看板欄位">
            {BOARD_COLUMNS.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                id={`col-tab-${STATUS_TOKEN[s]}`}
                aria-selected={mobileCol === s}
                aria-controls="board-col-panel"
                onClick={() => { setMobileCol(s); }}
              >
                {SHORT_LABEL[s]}
                <span className="n">{columns[s].length}</span>
              </button>
            ))}
            <button
              type="button"
              className="more"
              aria-haspopup="menu"
              aria-expanded={menu?.issue === null}
              aria-selected={mobileFolded}
              aria-label="Backlog 與 Canceled"
              onClick={(e) => { foldedMenu(e.currentTarget); }}
            >
              {mobileFolded ? (
                <>
                  {STATUS_LABEL[mobileCol]}
                  <span className="n">{columns[mobileCol].length}</span>
                </>
              ) : (
                <Icon name="more" />
              )}
            </button>
          </div>
        )}
        <div className={`board-wrap${drag === null ? '' : ' is-dragging'}`}>
          <div className="nl-board" role="region" aria-label={regionLabel} id={isMobile ? 'board-col-panel' : undefined}>
            {isMobile ? renderColumn(mobileCol) : shown.map(renderColumn)}
          </div>
        </div>
        <DragOverlay>
          {activeIssue === undefined ? null : (
            <CardOverlay issue={activeIssue} project={activeIssue.project_id === null ? undefined : projects.get(activeIssue.project_id)} />
          )}
        </DragOverlay>
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
    </DndContext>
  );
}

// dnd-kit 拿起後如果放下得太快（pointerdown、一大步 move、pointerup 在同一輪事件裡送完，例如自動化工具的拖拉、
// 或手很快點一下又放），它內部已經結束拖曳，卻不會呼叫 onDragEnd／onDragCancel（結束時 sensorContext 還沒有 active）。
// 這時看板自己記的 drag 會一直留著：畫面固定顯示拿起那一刻的欄位快照、hold 不放所以也不重抓，
// 之後的移動、復原都只改了資料、畫面不動（NX-160 驗收時在正式站重現）。這裡看 dnd-kit 真正的 active，
// 它已經沒有東西在拖、我們卻還記著，就當成取消，把 drag 清掉。
function DragWatchdog({ dragging, onLost }: { dragging: boolean; onLost: () => void }) {
  const { active } = useDndContext();
  const lost = dragging && active === null;
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;
  useEffect(() => {
    if (lost) onLostRef.current();
  }, [lost]);
  return null;
}

// 看板頁頂端的主要按鈕（一個畫面最多一顆主要按鈕）；手機用右下角的 FAB。
function NewIssueButton() {
  const { newIssue } = useShellActions();
  return (
    <button type="button" className="nl-btn nl-btn--primary nl-btn--sm" aria-keyshortcuts="C" onClick={() => { newIssue(); }}>
      <Icon name="plus" size="sm" />
      建立票
      <span className="nl-kbd">C</span>
    </button>
  );
}

function BoardColumn({ status, issues, isDrop, foldable, onFold, onNew, emptyText, children }: {
  status: IssueStatus;
  issues: Issue[];
  isDrop: boolean;
  foldable: boolean;
  onFold: () => void;
  onNew: () => void;
  emptyText: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `${COL_PREFIX}${status}` });
  const label = STATUS_LABEL[status];
  const cls = ['nl-col', status === 'In Review' ? 'nl-col--review' : '', isDrop ? 'is-drop' : ''].filter(Boolean).join(' ');
  return (
    <section
      ref={setNodeRef}
      className={cls}
      aria-label={`${label}，${String(issues.length)} 張`}
      data-col={STATUS_TOKEN[status]}
      style={{ '--s-solid': `var(--status-${STATUS_TOKEN[status]}-solid)` } as React.CSSProperties}
    >
      <div className="nl-col-h">
        <Icon name={STATUS_ICON[status]} />
        <span className="ttl">
          {label}
          {status === 'Done' ? '・7 天' : ''}
        </span>
        <span className="n" data-count={STATUS_TOKEN[status]}>
          {issues.length}
        </span>
        <span className="sp" />
        <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label={`在 ${label} 開票`} title={`在 ${label} 開票`} data-new={STATUS_TOKEN[status]} onClick={onNew}>
          <Icon name="plus" size="sm" />
        </button>
        {foldable && (
          <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label={`收起 ${label}`} onClick={onFold}>
            <Icon name="x" size="sm" />
          </button>
        )}
      </div>
      <SortableContext items={issues.map((i) => i.number)} strategy={verticalListSortingStrategy}>
        <div className="cards">{issues.length > 0 ? children : <div className="nl-col-empty">{emptyText}</div>}</div>
      </SortableContext>
    </section>
  );
}

// 標題列上收起的 Backlog／Canceled：顯示張數，點了展開；拖曳中變成放置區。
function FoldButton({ status, count, expanded, dragging, onToggle }: {
  status: IssueStatus;
  count: number;
  expanded: boolean;
  dragging: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${FOLD_PREFIX}${status}` });
  const label = STATUS_LABEL[status];
  const cls = ['nl-col', 'nl-col--collapsed', dragging ? 'is-target' : '', isOver ? 'is-drop' : ''].filter(Boolean).join(' ');
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cls}
      aria-expanded={expanded}
      aria-label={`${label}，${String(count)} 張`}
      data-fold={STATUS_TOKEN[status]}
      onClick={onToggle}
    >
      <Icon name={STATUS_ICON[status]} size="sm" />
      <span style={{ color: `var(--status-${STATUS_TOKEN[status]}-fg)` }}>{label}</span>
      <span className="n" data-count={STATUS_TOKEN[status]}>
        {count}
      </span>
      <Icon name={expanded ? 'chev-down' : 'chev-right'} size="sm" />
    </button>
  );
}

