// 指令面板的項目與排序（跟 React 分開，方便測）。
// 分組：最近用過 → 對這張票 → 跳到 → 動作 → 票。打字時每組照最佳分數排，最好的組在最上面。
import { ISSUE_STATUSES, type Issue, type IssueEvent, type IssueStatus, type Project } from '../api/types';
import { WAITING_PATH } from '../shell/NavSections';
import type { ThemeChoice } from '../theme/theme';
import { THEME_OPTIONS } from '../theme/theme';
import type { IconName } from '../ui/Icon';
import { STATUS_LABEL } from '../ui/status';
import { fuzzyScore, normalize } from './fuzzy';

export type ItemGroup = 'issue' | 'pages' | 'actions' | 'issues';
export type GroupKey = 'recent' | ItemGroup;

export type PaletteCommand =
  | { type: 'go'; path: string }
  | { type: 'open-issue'; identifier: string }
  | { type: 'new-issue' }
  | { type: 'help' }
  | { type: 'theme'; theme: ThemeChoice }
  | { type: 'status'; status: IssueStatus; back: boolean }
  | { type: 'archive'; on: boolean };

export interface PaletteItem {
  // 也是「最近用過」存的 key（例如 issue:NX-12、page:/issues、action:new）
  id: string;
  group: ItemGroup;
  label: string;
  // 比對時多看的字（英文名稱、別名），不顯示
  keywords?: string;
  shortcut?: string;
  icon?: IconName;
  issue?: Issue;
  status?: IssueStatus;
  command: PaletteCommand;
}

export interface PaletteGroup {
  key: GroupKey;
  label: string;
  items: PaletteItem[];
}

// 打開著的那張票（預覽面板或整頁）
export interface ActiveIssueInfo {
  issue: Pick<Issue, 'identifier' | 'status'> & { archived_at?: string | null };
  events: readonly Pick<IssueEvent, 'field' | 'from_value' | 'to_value' | 'reverted_by_event_id' | 'revert_of_event_id' | 'id'>[];
}

export const MAX_RECENT_SHOWN = 5;
const MAX_ISSUES = 8;
const ORDER: GroupKey[] = ['recent', 'issue', 'pages', 'actions', 'issues'];

// Done／Canceled 的票「移回」上一個狀態：最近一筆改成目前狀態的變更（還沒還原過的）；找不到時 Done 移回待驗收。
export function moveBackTarget(active: ActiveIssueInfo): IssueStatus | null {
  const { status } = active.issue;
  if (status !== 'Done' && status !== 'Canceled') return null;
  const event = [...active.events]
    .sort((a, b) => b.id - a.id)
    .find((e) => e.field === 'status' && e.to_value === status && e.reverted_by_event_id === null && e.revert_of_event_id === null);
  const from = event?.from_value;
  if (from !== undefined && from !== null && (ISSUE_STATUSES as readonly string[]).includes(from) && from !== status) return from as IssueStatus;
  return status === 'Done' ? 'In Review' : null;
}

export function buildItems({ issues, projects, active, theme }: {
  issues: readonly Issue[];
  projects: readonly Pick<Project, 'id' | 'name'>[];
  active: ActiveIssueInfo | null;
  theme: ThemeChoice;
}): PaletteItem[] {
  const out: PaletteItem[] = [];
  if (active !== null) {
    const back = moveBackTarget(active);
    if (back !== null) {
      out.push({ id: `back:${back}`, group: 'issue', label: `移回${STATUS_LABEL[back]}`, keywords: `移回 ${back} move back undo`, status: back, command: { type: 'status', status: back, back: true } });
    }
    for (const s of ISSUE_STATUSES) {
      if (s === active.issue.status || s === back) continue;
      out.push({ id: `status:${s}`, group: 'issue', label: `改狀態成 ${STATUS_LABEL[s]}`, keywords: `${s} status 狀態`, status: s, command: { type: 'status', status: s, back: false } });
    }
    // 封存（不做永久刪除，NX-160）
    const archived = (active.issue.archived_at ?? null) !== null;
    out.push(
      archived
        ? { id: 'action:unarchive', group: 'issue', label: '取消封存', keywords: 'unarchive restore 封存 還原', icon: 'archive', command: { type: 'archive', on: false } }
        : { id: 'action:archive', group: 'issue', label: '封存這張票', keywords: 'archive delete 刪除 封存 不要了', icon: 'archive', command: { type: 'archive', on: true } },
    );
  }
  const page = (label: string, path: string, icon: IconName, keywords: string, shortcut?: string): PaletteItem => ({
    id: `page:${path}`, group: 'pages', label, keywords, icon, command: { type: 'go', path }, ...(shortcut === undefined ? {} : { shortcut }),
  });
  out.push(
    page('看板', '/', 'board', 'board kanban home 首頁', 'G B'),
    page('全部的票', '/issues', 'list', 'issues list all 列表', 'G I'),
    page('等你', WAITING_PATH, 'inbox', 'me waiting inbox review 等我 待驗收', 'G M'),
    page('全部 Project', '/projects', 'folder', 'projects'),
    ...projects.map((p) => page(`Project：${p.name}`, `/projects/${String(p.id)}`, 'folder', 'project')),
  );
  out.push({ id: 'action:new', group: 'actions', label: '建立票', keywords: '開票 開一張票 建立 新增 new issue create', icon: 'plus', shortcut: 'C', command: { type: 'new-issue' } });
  for (const t of THEME_OPTIONS) {
    if (t.value === theme) continue;
    out.push({ id: `action:theme:${t.value}`, group: 'actions', label: `切換外觀：${t.label}`, keywords: `外觀 主題 theme appearance ${t.value} 深色模式`, icon: 'settings', command: { type: 'theme', theme: t.value } });
  }
  out.push({ id: 'action:help', group: 'actions', label: '快捷鍵說明', keywords: 'shortcuts keyboard help 快速鍵', shortcut: '?', icon: 'info', command: { type: 'help' } });
  for (const i of issues) {
    out.push({ id: `issue:${i.identifier}`, group: 'issues', label: i.title, issue: i, status: i.status, command: { type: 'open-issue', identifier: i.identifier } });
  }
  return out;
}

// 票：票號（NX-12、12）與舊票號（BOL-150）完全對到最優先，再來是票號開頭，最後比標題。
export function issueScore(issue: Pick<Issue, 'number' | 'legacy_identifier' | 'title'>, query: string): number | null {
  const q = normalize(query);
  if (q === '') return 0;
  const compact = q.replace(/[\s-]/g, '');
  const num = /^(?:nx)?(\d+)$/.exec(compact)?.[1];
  const legacy = issue.legacy_identifier?.toLowerCase().replace(/-/g, '') ?? null;
  if (num !== undefined && String(issue.number) === num) return 1000;
  if (legacy !== null && legacy === compact) return 1000;
  if (num !== undefined && String(issue.number).startsWith(num)) return 300;
  if (legacy !== null && compact.length >= 3 && legacy.startsWith(compact)) return 300;
  return fuzzyScore(issue.title, q);
}

export function itemScore(item: PaletteItem, query: string): number | null {
  if (item.issue !== undefined) return issueScore(item.issue, query);
  const main = fuzzyScore(item.label, query);
  const extra = item.keywords === undefined ? null : fuzzyScore(item.keywords, query);
  if (main === null && extra === null) return null;
  // 別名對到的比名稱對到的稍微後面
  return Math.max(main ?? -Infinity, extra === null ? -Infinity : extra - 10);
}

export function groupLabel(key: GroupKey, activeId: string | null, query: string): string {
  switch (key) {
    case 'recent': return '最近用過';
    case 'issue': return activeId === null ? '對這張票' : `對這張票・${activeId}`;
    case 'pages': return '跳到';
    case 'actions': return '動作';
    case 'issues': return query.trim() === '' ? '最近更新的票' : '票';
  }
}

export function rankItems(items: readonly PaletteItem[], query: string, recent: readonly string[], activeId: string | null = null): PaletteGroup[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<GroupKey, { best: number; items: { item: PaletteItem; score: number }[] }>();
  const add = (key: GroupKey, item: PaletteItem, score: number) => {
    const g = groups.get(key) ?? { best: -Infinity, items: [] };
    g.items.push({ item, score });
    g.best = Math.max(g.best, score);
    groups.set(key, g);
  };

  if (normalize(query) === '') {
    const recentItems = recent.map((id) => byId.get(id)).filter((i): i is PaletteItem => i !== undefined).slice(0, MAX_RECENT_SHOWN);
    const shown = new Set(recentItems.map((i) => i.id));
    recentItems.forEach((item, k) => { add('recent', item, -k); });
    for (const item of items) {
      if (shown.has(item.id) || item.group === 'issues') continue;
      add(item.group, item, 0);
    }
    // 最近用過裡沒有票時，補幾張最近更新的票
    if (!recentItems.some((i) => i.group === 'issues')) {
      const latest = items
        .filter((i) => i.issue !== undefined)
        .sort((a, b) => (b.issue?.updated_at ?? '').localeCompare(a.issue?.updated_at ?? ''))
        .slice(0, MAX_RECENT_SHOWN);
      latest.forEach((item, k) => { add('issues', item, -k); });
    }
    return ORDER.flatMap((key) => {
      const g = groups.get(key);
      return g === undefined ? [] : [{ key, label: groupLabel(key, activeId, query), items: g.items.map((x) => x.item) }];
    });
  }

  const recentRank = new Map(recent.map((id, k) => [id, k]));
  for (const item of items) {
    const s = itemScore(item, query);
    if (s === null) continue;
    const r = recentRank.get(item.id);
    add(item.group, item, s + (r === undefined ? 0 : Math.max(2, 20 - r * 2)));
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const sorted = g.items.sort((a, b) => b.score - a.score || (b.item.issue?.number ?? 0) - (a.item.issue?.number ?? 0));
      return { key, best: g.best, items: (key === 'issues' ? sorted.slice(0, MAX_ISSUES) : sorted).map((x) => x.item) };
    })
    .sort((a, b) => b.best - a.best || ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
    .map(({ key, items: list }) => ({ key, label: groupLabel(key, activeId, query), items: list }));
}
