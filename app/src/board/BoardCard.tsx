// 票卡片（components.md 第 7 節）：票號＋Project 色點與名稱、標題、最新的下一步。滑過時右上角「⋯」（手機一直顯示）。
// 拖拉用 dnd-kit 的 useSortable；整張卡片（不含「⋯」）是拖拉把手，也是打開票的按鈕：
// 滑鼠拖 6px 以上才算拖曳，所以點一下仍是打開。鍵盤：Enter 打開、空白鍵拿起／放下、Cmd/Ctrl+←→ 移到左右欄。
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Issue, Project } from '../api/types';
import { projectColorClass } from '../shell/sprints';
import { Icon } from '../ui/Icon';
import { STATUS_LABEL } from '../ui/status';

export interface CardActions {
  onOpen: (issue: Issue) => void;
  onMenu: (issue: Issue, anchor: HTMLElement) => void;
  // Cmd/Ctrl+←→：移到左邊（-1）或右邊（1）的欄
  onShift: (issue: Issue, dir: -1 | 1) => void;
}

export function cardLabel(issue: Issue): string {
  const next = issue.next_step === null ? '' : `，下一步：${issue.next_step}`;
  return `${issue.identifier} ${issue.title}，${STATUS_LABEL[issue.status]}${next}`;
}

function CardContent({ issue, project }: { issue: Issue; project: Project | undefined }) {
  return (
    <>
      <div className="top">
        <span className="id">{issue.identifier}</span>
        {project !== undefined && (
          <span className="proj">
            <span className={`nl-pdot ${projectColorClass(project.id)}`} aria-hidden="true" />
            <span className="nm">{project.name}</span>
          </span>
        )}
      </div>
      <p className="t">{issue.title}</p>
      {issue.next_step !== null && (
        <p className="next">
          <span className="k">下一步</span>
          {issue.next_step}
        </p>
      )}
    </>
  );
}

function cardClass(issue: Issue, extra: string[] = []): string {
  return ['nl-card', issue.status === 'Done' ? 'nl-card--done' : '', issue.status === 'Canceled' ? 'nl-card--canceled' : '', ...extra]
    .filter(Boolean)
    .join(' ');
}

// 拖曳中跟著游標的那一張（DragOverlay 裡）：旋轉 1.5°、放大 1.02、shadow-drag。
export function CardOverlay({ issue, project }: { issue: Issue; project: Project | undefined }) {
  return (
    <article className={cardClass(issue, ['is-lifted'])} aria-hidden="true">
      <div className="hit">
        <CardContent issue={issue} project={project} />
      </div>
    </article>
  );
}

export function BoardCard({ issue, project, draggable, menuOpen, actions, peeked = false }: {
  issue: Issue;
  project: Project | undefined;
  // 右側預覽正開著這張
  peeked?: boolean;
  // 手機和 Canceled 的票不能拖（改用「移到…」）
  draggable: boolean;
  menuOpen: boolean;
  actions: CardActions;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging, active } = useSortable({
    id: issue.number,
    disabled: !draggable,
    attributes: { roleDescription: '可拖曳的票' },
  });
  const dragging = active !== null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!dragging && e.key === 'Enter') {
      e.preventDefault();
      actions.onOpen(issue);
      return;
    }
    if (!dragging && draggable && (e.metaKey || e.ctrlKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      actions.onShift(issue, e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    // 其他鍵交給 dnd-kit 的鍵盤拖拉（空白鍵拿起）
    (listeners?.onKeyDown as ((ev: KeyboardEvent) => void) | undefined)?.(e);
  }

  const handle: Record<string, unknown> = draggable ? { ...attributes, ...listeners } : { role: 'button', tabIndex: 0 };
  return (
    <article
      ref={setNodeRef}
      className={cardClass(issue, [...(isDragging ? ['is-placeholder'] : []), ...(peeked ? ['is-peek'] : [])])}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-n={issue.number}
    >
      <div
        ref={setActivatorNodeRef}
        className="hit"
        {...handle}
        aria-label={cardLabel(issue)}
        onKeyDown={onKeyDown}
        onClick={() => { actions.onOpen(issue); }}
      >
        <CardContent issue={issue} project={project} />
      </div>
      <MoreButton issue={issue} open={menuOpen} onMenu={actions.onMenu} />
    </article>
  );
}

function MoreButton({ issue, open, onMenu }: { issue: Issue; open: boolean; onMenu: CardActions['onMenu'] }): ReactNode {
  return (
    <button
      type="button"
      className="nl-btn nl-btn--icon more"
      aria-label={`${issue.identifier} 的動作`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => { onMenu(issue, e.currentTarget); }}
      // 不讓空白鍵／Enter 冒泡到卡片（會被當成拿起或打開）
      onKeyDown={(e) => { e.stopPropagation(); }}
      onPointerDown={(e) => { e.stopPropagation(); }}
    >
      <Icon name="more" />
    </button>
  );
}
