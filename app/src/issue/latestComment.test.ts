import { describe, expect, it } from 'vitest';
import type { Comment } from '../api/types';
import { latestComment } from './latestComment';

function cmt(id: number, created_at: string, body: string): Comment {
  return { id, issue_number: 7, author: 'nextline agent', body, linear_id: null, created_at, updated_at: created_at };
}

describe('latestComment', () => {
  it('沒有 comment 時回傳 null', () => {
    expect(latestComment([])).toBeNull();
  });

  it('依 created_at 取最新一則，不受陣列順序影響', () => {
    const older = cmt(1, '2026-11-24T01:00:00.000Z', '舊留言');
    const newer = cmt(2, '2026-11-25T01:00:00.000Z', '最新留言');
    expect(latestComment([newer, older])?.id).toBe(2);
    expect(latestComment([older, newer])?.id).toBe(2);
  });

  it('時間相同時取 id 較大的那一則', () => {
    const first = cmt(10, '2026-11-25T01:00:00.000Z', '第一則');
    const second = cmt(11, '2026-11-25T01:00:00.000Z', '第二則');
    expect(latestComment([first, second])?.id).toBe(11);
    expect(latestComment([second, first])?.id).toBe(11);
  });
});
