import { describe, expect, it } from 'vitest';
import { ISSUE_STATUSES } from '../api/types';
import { STATUS_LABEL, STATUS_TOKEN } from './status';

describe('票狀態名稱', () => {
  it('六種狀態都有名稱與 token；In Review 顯示「待驗收」', () => {
    expect(ISSUE_STATUSES).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled']);
    expect(STATUS_LABEL['In Review']).toBe('待驗收');
    expect(STATUS_TOKEN['In Review']).toBe('in-review');
    for (const s of ISSUE_STATUSES) expect(STATUS_LABEL[s]).not.toBe('');
  });
});
