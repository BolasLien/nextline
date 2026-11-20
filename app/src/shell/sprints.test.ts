import { describe, expect, it } from 'vitest';
import type { Sprint } from '../api/types';
import { currentSprint, nextSprint, projectColorClass, sprintLabel } from './sprints';

function sprint(number: number, starts: string, ends: string, name: string | null = null): Sprint {
  return { id: number, number, name, starts_at: starts, ends_at: ends, linear_id: null, created_at: starts };
}

const S = [
  sprint(13, '2026-11-14T03:30:00.000Z', '2026-11-28T03:30:00.000Z'),
  sprint(12, '2026-10-31T03:30:00.000Z', '2026-11-14T03:30:00.000Z'),
  sprint(14, '2026-11-28T03:30:00.000Z', '2026-12-12T03:30:00.000Z', '年底衝刺'),
];

describe('側欄的 Sprint', () => {
  it('目前 Sprint 是包含現在的那一期；下一期是最早還沒開始的', () => {
    const now = new Date('2026-11-03T08:00:00.000Z');
    expect(currentSprint(S, now)?.number).toBe(12);
    expect(nextSprint(S, now)?.number).toBe(13);
  });

  it('剛好在邊界：結束時間那一刻屬於下一期', () => {
    const now = new Date('2026-11-14T03:30:00.000Z');
    expect(currentSprint(S, now)?.number).toBe(13);
  });

  it('沒有 Sprint 時回 null', () => {
    expect(currentSprint([], new Date())).toBeNull();
    expect(nextSprint([], new Date())).toBeNull();
  });

  it('有名字用名字，沒有就用編號', () => {
    expect(sprintLabel(S[0] as Sprint)).toBe('Sprint 13');
    expect(sprintLabel(S[2] as Sprint)).toBe('年底衝刺');
  });

  it('Project 色點在 1～10 之間輪流', () => {
    expect(projectColorClass(0)).toBe('pc-1');
    expect(projectColorClass(9)).toBe('pc-10');
    expect(projectColorClass(10)).toBe('pc-1');
  });
});
