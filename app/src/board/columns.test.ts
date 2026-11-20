import { describe, expect, it } from 'vitest';
import type { Issue, IssueStatus } from '../api/types';
import {
  currentPlacement,
  DONE_WINDOW_MS,
  groupColumns,
  moveLocally,
  placementAt,
  positionAt,
  shownColumns,
  without,
} from './columns';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function issue(number: number, status: IssueStatus, position: number, extra: Partial<Issue> = {}): Issue {
  return {
    number,
    identifier: `NX-${String(number)}`,
    legacy_identifier: null,
    title: `票 ${String(number)}`,
    description: '',
    status,
    position,
    project_id: null,
    sprint_id: 1,
    due_date: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    ...extra,
  };
}

const numbers = (list: readonly Issue[]) => list.map((i) => i.number);

describe('欄位分組', () => {
  it('依狀態分欄；欄內 position 小的在上，同位置時票號大的在上（跟後端一樣）', () => {
    const cols = groupColumns(
      [issue(1, 'Todo', 2048), issue(2, 'Todo', 1024), issue(3, 'Todo', 1024), issue(4, 'In Progress', 0), issue(5, 'In Review', -5), issue(6, 'Backlog', 1)],
      NOW,
    );
    expect(numbers(cols.Todo)).toEqual([3, 2, 1]);
    expect(numbers(cols['In Progress'])).toEqual([4]);
    expect(numbers(cols['In Review'])).toEqual([5]);
    expect(numbers(cols.Backlog)).toEqual([6]);
    expect(cols.Canceled).toEqual([]);
  });

  it('Done 只留最近 7 天完成的；沒有完成時間的舊資料看更新時間', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const cols = groupColumns(
      [
        issue(1, 'Done', 0, { completed_at: iso(NOW - DAY) }),
        issue(2, 'Done', 0, { completed_at: iso(NOW - DONE_WINDOW_MS - 1) }),
        issue(3, 'Done', 0, { completed_at: null, updated_at: iso(NOW - 2 * DAY) }),
        issue(4, 'Done', 0, { completed_at: null, updated_at: iso(NOW - 30 * DAY) }),
        // 不是 Done 的舊票照樣顯示
        issue(5, 'Todo', 0, { updated_at: iso(NOW - 90 * DAY) }),
      ],
      NOW,
    );
    expect(numbers(cols.Done).sort()).toEqual([1, 3]);
    expect(numbers(cols.Todo)).toEqual([5]);
  });

  it('桌面的欄：固定 Todo、In Progress、待驗收、Done；展開的 Backlog／Canceled 照狀態順序插進去', () => {
    expect(shownColumns(new Set())).toEqual(['Todo', 'In Progress', 'In Review', 'Done']);
    expect(shownColumns(new Set<IssueStatus>(['Canceled', 'Backlog']))).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled']);
  });
});

describe('排序計算', () => {
  const col = [issue(1, 'Todo', 1024), issue(2, 'Todo', 2048), issue(3, 'Todo', 3072)];

  it('放到某個位置：有下一張就 before 它，放到最後就 after 最後一張；空欄不指定', () => {
    expect(placementAt(col, 0)).toEqual({ before: 'NX-1' });
    expect(placementAt(col, 2)).toEqual({ before: 'NX-3' });
    expect(placementAt(col, 3)).toEqual({ after: 'NX-3' });
    expect(placementAt([], 0)).toBeUndefined();
  });

  it('本機先算的 position：欄頂減一格、欄尾加一格、中間取中間值、空欄 0', () => {
    expect(positionAt(col, 0)).toBe(0);
    expect(positionAt(col, 1)).toBe(1536);
    expect(positionAt(col, 3)).toBe(4096);
    expect(positionAt([], 0)).toBe(0);
  });

  it('現在的位置：記下面那張（最後一張就記上面那張），給復原用', () => {
    const cols = groupColumns(col, NOW);
    expect(currentPlacement(cols, col[0] as Issue)).toEqual({ before: 'NX-2' });
    expect(currentPlacement(cols, col[1] as Issue)).toEqual({ before: 'NX-3' });
    expect(currentPlacement(cols, col[2] as Issue)).toEqual({ after: 'NX-2' });
    expect(currentPlacement(groupColumns([issue(9, 'Todo', 0)], NOW), issue(9, 'Todo', 0))).toBeUndefined();
  });

  it('同欄調順序：拖到第 0 個就排到最上面', () => {
    const issues = [...col];
    const cols = groupColumns(issues, NOW);
    const moved = moveLocally(issues, cols, 3, 'Todo', 0, '2026-11-03T12:00:00.000Z');
    expect(numbers(groupColumns(moved, NOW).Todo)).toEqual([3, 1, 2]);
    // 同欄不動完成時間
    expect(moved.find((i) => i.number === 3)?.completed_at).toBeNull();
  });

  it('換欄：插到目標欄的指定位置，移到 Done 填完成時間、移出就清掉', () => {
    const issues = [...col, issue(4, 'Done', 1024, { completed_at: '2026-11-03T00:00:00.000Z' }), issue(5, 'Done', 2048, { completed_at: '2026-11-03T00:00:00.000Z' })];
    const cols = groupColumns(issues, NOW);
    const toDone = moveLocally(issues, cols, 2, 'Done', 1, '2026-11-03T12:00:00.000Z');
    const after = groupColumns(toDone, NOW);
    expect(numbers(after.Done)).toEqual([4, 2, 5]);
    expect(numbers(after.Todo)).toEqual([1, 3]);
    expect(toDone.find((i) => i.number === 2)?.completed_at).toBe('2026-11-03T12:00:00.000Z');

    const back = moveLocally(toDone, after, 2, 'Todo', 0, '2026-11-03T12:01:00.000Z');
    expect(back.find((i) => i.number === 2)?.completed_at).toBeNull();
    expect(numbers(groupColumns(back, NOW).Todo)).toEqual([2, 1, 3]);
  });

  it('without 拿掉自己', () => {
    expect(numbers(without(col, 2))).toEqual([1, 3]);
  });
});
