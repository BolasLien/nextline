import type { IssueStatus } from '../api/types';

// 票狀態的介面名稱（components.md 第 5 節）：只有 In Review 顯示中文「待驗收」，其他跟 Linear 同名。
export const STATUS_LABEL: Record<IssueStatus, string> = {
  Backlog: 'Backlog',
  Todo: 'Todo',
  'In Progress': 'In Progress',
  'In Review': '待驗收',
  Done: 'Done',
  Canceled: 'Canceled',
};

// 對應 tokens.css 的 --status-<key>-fg／solid／soft。
export const STATUS_TOKEN: Record<IssueStatus, string> = {
  Backlog: 'backlog',
  Todo: 'todo',
  'In Progress': 'in-progress',
  'In Review': 'in-review',
  Done: 'done',
  Canceled: 'canceled',
};

// 狀態圖示（Icon 的名稱）。
export const STATUS_ICON = {
  Backlog: 'status-backlog',
  Todo: 'status-todo',
  'In Progress': 'status-in-progress',
  'In Review': 'status-in-review',
  Done: 'status-done',
  Canceled: 'status-canceled',
} as const satisfies Record<IssueStatus, string>;
