import { describe, expect, it } from 'vitest';
import type { Issue, IssueStatus } from '../api/types';
import { fuzzyScore } from './fuzzy';
import { buildItems, issueScore, moveBackTarget, rankItems } from './items';
import { MAX_RECENT, pushRecent, readRecent, RECENT_KEY, saveRecent } from './recent';

function issue(number: number, title: string, extra: Partial<Issue> = {}): Issue {
  return {
    number,
    identifier: `NX-${String(number)}`,
    legacy_identifier: null,
    title,
    description: '',
    status: 'Todo',
    position: number,
    project_id: null,
    sprint_id: null,
    due_date: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: `2026-11-01T00:00:${String(number).padStart(2, '0')}Z`,
    completed_at: null,
    canceled_at: null,
    archived_at: null,
    next_step: null,
    ...extra,
  };
}

const ISSUES = [
  issue(12, '看板卡片加上到期日圖示'),
  issue(120, '寶石 3 階的材質再亮一點'),
  issue(148, 'Cmd+K 指令面板與基本快捷鍵', { legacy_identifier: 'ABC-150' }),
  issue(30, 'Deploy the worker to production'),
];

function ids(query: string, recent: string[] = [], active: Parameters<typeof buildItems>[0]['active'] = null) {
  const items = buildItems({ issues: ISSUES, projects: [{ id: 1, name: 'Nextline 第二版' }], active, theme: 'system' });
  return rankItems(items, query, recent, active?.issue.identifier ?? null);
}

describe('模糊比對', () => {
  it('中文：連續片段、依序出現都找得到；開頭對到的分數比中間高', () => {
    expect(fuzzyScore('開一張票', '開票')).not.toBeNull();
    expect(fuzzyScore('看板卡片加上到期日圖示', '到期日')).not.toBeNull();
    expect(fuzzyScore('看板卡片加上到期日圖示', '看板')).toBeGreaterThan(fuzzyScore('看板卡片加上到期日圖示', '到期日') ?? 0);
    expect(fuzzyScore('看板卡片加上到期日圖示', '材質')).toBeNull();
  });

  it('英文：不分大小寫、縮寫依序出現也算；字隔太遠不算', () => {
    expect(fuzzyScore('Deploy the worker', 'WORKER')).not.toBeNull();
    expect(fuzzyScore('Deploy the worker', 'dplw')).not.toBeNull();
    expect(fuzzyScore('a long title that goes on and on forever zz', 'az')).toBeNull();
  });

  it('多個詞每個都要對到', () => {
    expect(fuzzyScore('Deploy the worker', 'deploy worker')).not.toBeNull();
    expect(fuzzyScore('Deploy the worker', 'deploy 看板')).toBeNull();
  });

  it('連續片段的分數比跳著對到的高', () => {
    expect(fuzzyScore('開票對話框', '開票') ?? 0).toBeGreaterThan(fuzzyScore('開一張票', '開票') ?? 0);
  });
});

describe('票號比對', () => {
  it('NX-12、12、nx12 都完全對到 NX-12；舊編號也找得到', () => {
    for (const q of ['NX-12', '12', 'nx12', 'nx-12']) expect(issueScore(ISSUES[0] as Issue, q)).toBe(1000);
    expect(issueScore(ISSUES[2] as Issue, 'ABC-150')).toBe(1000);
    expect(issueScore(ISSUES[2] as Issue, 'abc150')).toBe(1000);
  });

  it('打 12：NX-12 排第一，NX-120 在後面', () => {
    const tickets = ids('12').find((g) => g.key === 'issues')?.items.map((i) => i.id);
    expect(tickets?.slice(0, 2)).toEqual(['issue:NX-12', 'issue:NX-120']);
  });

  it('打 ABC-150：結果第一組是票，第一張是 NX-148', () => {
    const groups = ids('ABC-150');
    expect(groups[0]?.key).toBe('issues');
    expect(groups[0]?.items[0]?.id).toBe('issue:NX-148');
  });
});

describe('分組與排序', () => {
  it('空輸入：跳到、動作、最近更新的票；沒打開票時沒有「對這張票」', () => {
    const groups = ids('');
    expect(groups.map((g) => g.key)).toEqual(['pages', 'actions', 'issues']);
    expect(groups[0]?.items.map((i) => i.label)).toContain('看板');
    expect(groups.find((g) => g.key === 'issues')?.label).toBe('最近更新的票');
  });

  it('打「看板」：跳到「看板」排在最上面', () => {
    const groups = ids('看板');
    expect(groups[0]?.key).toBe('pages');
    expect(groups[0]?.items[0]?.id).toBe('page:/');
  });

  it('打中文標題片段：找得到票', () => {
    const groups = ids('材質');
    expect(groups.find((g) => g.key === 'issues')?.items.map((i) => i.id)).toEqual(['issue:NX-120']);
  });

  it('英文別名也找得到中文名稱的頁面（board → 看板）', () => {
    expect(ids('board')[0]?.items[0]?.id).toBe('page:/');
  });

  it('找不到時沒有任何組', () => {
    expect(ids('甘特圖')).toEqual([]);
  });

  it('最近用過放最上面；空輸入時不在下面重複出現', () => {
    const groups = ids('', ['issue:NX-30', 'page:/projects', 'gone:item']);
    expect(groups[0]?.key).toBe('recent');
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['issue:NX-30', 'page:/projects']);
    const pages = groups.find((g) => g.key === 'pages')?.items.map((i) => i.id) ?? [];
    expect(pages).not.toContain('page:/projects');
    // 最近用過已經有票，就不補「最近更新的票」
    expect(groups.some((g) => g.key === 'issues')).toBe(false);
  });

  it('打字時最近用過的項目分數加一點，排在同分的前面', () => {
    // 「全部」同時開頭對到「全部的票」和「全部 Project」
    const without = ids('全部').find((g) => g.key === 'pages')?.items.map((i) => i.id) ?? [];
    expect(without.slice(0, 2)).toEqual(['page:/issues', 'page:/projects']);
    const withRecent = ids('全部', ['page:/projects']).find((g) => g.key === 'pages')?.items.map((i) => i.id) ?? [];
    expect(withRecent.slice(0, 2)).toEqual(['page:/projects', 'page:/issues']);
  });

  it('打開著某張票：多出「對這張票」，列出其他狀態，沒有目前的狀態', () => {
    const groups = ids('', [], { issue: { identifier: 'NX-12', status: 'Todo' }, events: [] });
    const g = groups.find((x) => x.key === 'issue');
    expect(g?.label).toBe('對這張票・NX-12');
    expect(g?.items.map((i) => i.label)).toEqual(['改狀態成 Backlog', '改狀態成 In Progress', '改狀態成 待驗收', '改狀態成 Done', '改狀態成 Canceled', '封存這張票']);
  });

  it('封存（NX-160）：沒封存的票有「封存這張票」，已封存的換成「取消封存」；打「刪除」也找得到封存', () => {
    const archive = ids('刪除', [], { issue: { identifier: 'NX-12', status: 'Todo' }, events: [] });
    expect(archive[0]?.items[0]?.id).toBe('action:archive');
    const groups = ids('', [], { issue: { identifier: 'NX-12', status: 'Todo', archived_at: '2026-11-04T00:00:00Z' }, events: [] });
    const labels = groups.find((x) => x.key === 'issue')?.items.map((i) => i.label) ?? [];
    expect(labels).toContain('取消封存');
    expect(labels).not.toContain('封存這張票');
  });

  it('打「in progress」找得到「改狀態成 In Progress」，而且排第一', () => {
    const groups = ids('in progress', [], { issue: { identifier: 'NX-12', status: 'Todo' }, events: [] });
    expect(groups[0]?.items[0]?.id).toBe('status:In Progress');
  });
});

describe('移回', () => {
  const ev = (id: number, from: IssueStatus, to: IssueStatus, reverted: number | null = null) => ({
    id, field: 'status', from_value: from, to_value: to, reverted_by_event_id: reverted, revert_of_event_id: null,
  });

  it('Done 的票移回上一個狀態（最近一筆改成 Done 的變更）', () => {
    expect(moveBackTarget({ issue: { identifier: 'NX-1', status: 'Done' }, events: [ev(1, 'Todo', 'In Progress'), ev(2, 'In Progress', 'Done')] })).toBe('In Progress');
  });

  it('找不到紀錄時 Done 移回待驗收；已還原的那筆不算', () => {
    expect(moveBackTarget({ issue: { identifier: 'NX-1', status: 'Done' }, events: [] })).toBe('In Review');
    expect(moveBackTarget({ issue: { identifier: 'NX-1', status: 'Done' }, events: [ev(2, 'Todo', 'Done', 9)] })).toBe('In Review');
  });

  it('沒做完的票沒有「移回」；有的話列在「對這張票」第一個，下面不再重複那個狀態', () => {
    expect(moveBackTarget({ issue: { identifier: 'NX-1', status: 'Todo' }, events: [] })).toBeNull();
    const groups = ids('', [], { issue: { identifier: 'NX-12', status: 'Done' }, events: [ev(3, 'In Progress', 'Done')] });
    const labels = groups.find((g) => g.key === 'issue')?.items.map((i) => i.label) ?? [];
    expect(labels[0]).toBe('移回In Progress');
    expect(labels).not.toContain('改狀態成 In Progress');
  });
});

describe('最近用過（localStorage）', () => {
  function memory(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { m.set(k, v); },
      removeItem: (k) => { m.delete(k); },
      clear: () => { m.clear(); },
      key: () => null,
      get length() { return m.size; },
    };
  }

  it('新的放前面、不重複、最多 8 筆，存了讀得回來', () => {
    let list: string[] = [];
    for (let n = 0; n < 10; n++) list = pushRecent(list, `issue:NX-${String(n)}`);
    list = pushRecent(list, 'issue:NX-5');
    expect(list[0]).toBe('issue:NX-5');
    expect(list).toHaveLength(MAX_RECENT);
    expect(new Set(list).size).toBe(list.length);
    const s = memory();
    saveRecent(s, list);
    expect(readRecent(s)).toEqual(list);
  });

  it('讀寫丟例外（私密視窗）不會壞：讀回空的、存就略過', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(readRecent(broken)).toEqual([]);
    expect(() => { saveRecent(broken, ['page:/']); }).not.toThrow();
    expect(readRecent(undefined)).toEqual([]);
  });

  it('存的內容壞掉（不是 JSON、不是陣列）當成空的', () => {
    const s = memory();
    s.setItem(RECENT_KEY, '{oops');
    expect(readRecent(s)).toEqual([]);
    s.setItem(RECENT_KEY, '{"a":1}');
    expect(readRecent(s)).toEqual([]);
    s.setItem(RECENT_KEY, '["page:/", 3]');
    expect(readRecent(s)).toEqual(['page:/']);
  });
});
