// 變更紀錄（docs/api.md「變更紀錄與還原」）轉成畫面上的一句話，以及「還原」按鈕的說明。
import type { IssueEvent, Project, Sprint } from '../api/types';
import { sprintLabel } from '../shell/sprints';
import { STATUS_LABEL } from '../ui/status';

export const FIELD_LABEL: Record<string, string> = {
  title: '標題',
  description: '描述',
  status: '狀態',
  project: 'Project',
  sprint: 'Sprint',
  due_date: '到期日',
  blocked_by: 'blocked by',
  archived: '封存',
};

export interface EventNames {
  projects: ReadonlyMap<number, Project>;
  sprints: ReadonlyMap<number, Sprint>;
}

const MAX_TEXT = 40;

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT)}…` : one;
}

// 欄位的值（變更紀錄裡都是文字）轉成人看得懂的名稱。
export function valueText(field: string, value: string | null, names: EventNames): string {
  switch (field) {
    case 'status':
      return value === null ? '沒有狀態' : (STATUS_LABEL as Partial<Record<string, string>>)[value] ?? value;
    case 'project': {
      if (value === null) return '沒有 Project';
      return names.projects.get(Number(value))?.name ?? `Project ${value}`;
    }
    case 'sprint': {
      if (value === null) return '沒有 Sprint';
      const s = names.sprints.get(Number(value));
      return s === undefined ? `Sprint ${value}` : sprintLabel(s);
    }
    case 'due_date':
      return value ?? '沒有到期日';
    case 'blocked_by':
      return value === null ? '' : `NX-${value}`;
    case 'title':
      return value === null ? '' : clip(value);
    default:
      return value ?? '';
  }
}

// 一筆變更的說明（不含誰，誰另外粗體顯示）。
export function eventText(event: IssueEvent, all: readonly IssueEvent[], names: EventNames): string {
  const raw = FIELD_LABEL[event.field] ?? event.field;
  // 中英文之間留空格：「把 Project 從…」
  const label = /^[A-Za-z]/.test(raw) ? ` ${raw} ` : raw;
  if (event.revert_of_event_id !== null) {
    const original = all.find((e) => e.id === event.revert_of_event_id);
    const whose = original === undefined ? '' : ` ${original.actor} 的`;
    if (event.field === 'archived') return `還原了${whose}封存變更（${event.to_value === null ? '取消封存' : '封存回去'}）`;
    if (event.field === 'blocked_by') {
      const key = event.to_value ?? event.from_value;
      return `還原了${whose} blocked by 變更（${event.to_value === null ? '移除' : '加回'} NX-${key ?? '?'}）`;
    }
    if (event.field === 'description') return `還原了${whose}描述變更`;
    return `還原了${whose}${label}變更（改回「${valueText(event.field, event.to_value, names)}」）`;
  }
  if (event.field === 'blocked_by') {
    return event.to_value === null
      ? `移除了 blocked by ${valueText('blocked_by', event.from_value, names)}`
      : `加入 blocked by ${valueText('blocked_by', event.to_value, names)}`;
  }
  if (event.field === 'description') return event.from_value === null || event.from_value === '' ? '寫了描述' : '改了描述';
  if (event.field === 'archived') return event.to_value === null ? '取消封存' : '封存了這張票';
  return `把${label}從「${valueText(event.field, event.from_value, names)}」改成「${valueText(event.field, event.to_value, names)}」`;
}

// 「還原」按鈕的 aria-label：寫清楚會改回什麼。
export function revertLabel(event: IssueEvent, names: EventNames): string {
  if (event.field === 'blocked_by') {
    return event.to_value === null
      ? `還原：加回 blocked by ${valueText('blocked_by', event.from_value, names)}`
      : `還原：移除 blocked by ${valueText('blocked_by', event.to_value, names)}`;
  }
  if (event.field === 'description') return '還原：描述改回上一版';
  if (event.field === 'archived') return event.to_value === null ? '還原：封存回去' : '還原：取消封存';
  return `還原：${FIELD_LABEL[event.field] ?? event.field}改回 ${valueText(event.field, event.from_value, names)}`;
}

// 能不能按「還原」：「還原」本身和已經被還原的不能。之後又改過同一欄位的照樣顯示，按了由 API 回 409 說原因。
export function canRevert(event: IssueEvent): boolean {
  return event.revert_of_event_id === null && event.reverted_by_event_id === null;
}

// 新的在上面。
export function newestFirst(events: readonly IssueEvent[]): IssueEvent[] {
  return [...events].sort((a, b) => b.id - a.id);
}
