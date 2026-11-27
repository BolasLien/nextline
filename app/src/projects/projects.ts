// Project 頁與 Project 列表的資料計算（不碰 React，方便測）。
import { type Issue, OPEN_STATUSES, type Project } from '../api/types';

export const PROJECT_TABS = ['board', 'list', 'about'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export const TAB_LABEL: Record<ProjectTab, string> = { board: '看板', list: '列表', about: '說明' };

// 網址 ?tab=：預設 board（docs/design/ia/README.md 第 3 段），看不懂的值也當 board。
export function parseTab(v: string | null): ProjectTab {
  return v !== null && (PROJECT_TABS as readonly string[]).includes(v) ? (v as ProjectTab) : 'board';
}

// 字串逐字比（跟 SQLite 的 ORDER BY 一樣），大的在前用 -cmp。
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 側欄、/projects 共用的順序，跟 GET /api/projects 一樣（NX-162）：釘選的在最上面（彼此照釘選時間新到舊），
// 其餘照 last_activity_at 新到舊；同時間照名稱。
export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => {
    if ((a.pinned_at === null) !== (b.pinned_at === null)) return a.pinned_at === null ? 1 : -1;
    return -cmp(a.pinned_at ?? '', b.pinned_at ?? '') || -cmp(a.last_activity_at, b.last_activity_at) || cmp(a.name, b.name);
  });
}

// 新增或改過的 Project 換進清單，重新排序；側欄馬上跟著變。
export function upsertProject(list: readonly Project[], project: Project): Project[] {
  const next = list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [...list, project];
  return sortProjects(next);
}

// 合併 Project：移除來源 Project、更新目標 Project，重新排序。
export function applyProjectMerge(list: readonly Project[], sourceId: number, target: Project): Project[] {
  const withoutSource = list.filter((p) => p.id !== sourceId);
  return upsertProject(withoutSource, target);
}

// 這個 Project 底下有票改了或寫了 comment：last_activity_at 往新的推（不會變舊），重新排序。沒變就回原陣列。
export function touchProject(list: readonly Project[], projectId: number, at: string): readonly Project[] {
  const p = list.find((x) => x.id === projectId);
  if (p === undefined || at <= p.last_activity_at) return list;
  return upsertProject(list, { ...p, last_activity_at: at });
}

// 側欄（與手機「更多」）一次最多列幾個 Project（NX-165，2026-11-04 Bolas）。不看票的狀態，全部 Project 照 sortProjects 排好，
// 取前 N 個；釘選的超過也只列 N 個。其餘靠「全部 Project」找，不另做「更多」或展開。
export const SIDEBAR_LIMIT = 7;

export function sidebarProjects(projects: readonly Project[]): Project[] {
  return sortProjects(projects).slice(0, SIDEBAR_LIMIT);
}

// 釘選或取消（樂觀更新用）：釘選記成現在，跟 API 寫入的時間差不多，排序一樣在最上面。
export function withPinned(project: Project, pinned: boolean, at = new Date().toISOString()): Project {
  if ((project.pinned_at !== null) === pinned) return project;
  return { ...project, pinned_at: pinned ? at : null };
}

// 每個 Project 沒做完的票數，含 Backlog（/projects、Project 頁頁首的「N 張沒做完」）。封存的票不算。
export function openCountByProject(issues: readonly Issue[]): Map<number | null, number> {
  const out = new Map<number | null, number>();
  for (const i of issues) {
    if (!(OPEN_STATUSES as readonly string[]).includes(i.status) || (i.archived_at ?? null) !== null) continue;
    out.set(i.project_id, (out.get(i.project_id) ?? 0) + 1);
  }
  return out;
}

export interface ProjectDraft {
  name: string;
  description: string;
}

// 表單送出前檢查：名稱必填、不能跟別的 Project 重複（API 也會擋，回 409）。回傳要顯示的錯誤，沒問題是 null。
export function projectNameError(name: string, projects: readonly Project[], selfId: number | null = null): string | null {
  const n = name.trim();
  if (n === '') return '名稱必填';
  if (projects.some((p) => p.name === n && p.id !== selfId)) return `名稱「${n}」已被使用`;
  return null;
}
