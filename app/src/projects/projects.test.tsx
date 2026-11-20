import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Issue, Project } from '../api/types';
import { ProjectAbout } from './ProjectPage';
import { SIDEBAR_LIMIT, sidebarProjects, openCountByProject, parseTab, projectNameError, sortProjects, touchProject, upsertProject, withPinned } from './projects';

function project(id: number, name: string, last = '', pinned: string | null = null): Project {
  return { id, name, description: '', linear_id: null, created_at: '', updated_at: '', pinned_at: pinned, last_activity_at: last };
}
const T = (d: number) => `2026-10-${String(d).padStart(2, '0')}T00:00:00.000Z`;

describe('Project 頁', () => {
  it('分頁：預設看板，看不懂的值也是看板', () => {
    expect(parseTab(null)).toBe('board');
    expect(parseTab('list')).toBe('list');
    expect(parseTab('about')).toBe('about');
    expect(parseTab('nope')).toBe('board');
  });

  it('Project 順序（NX-162）：釘選的在上（釘選時間新到舊），其餘照最近有更新新到舊，同時間照名稱', () => {
    const list = sortProjects([
      project(1, 'B', T(5)),
      project(2, 'Z', T(9)),
      project(3, 'A', T(5)),
      project(4, 'C', T(1), T(2)),
      project(5, 'D', T(1), T(3)),
    ]);
    expect(list.map((p) => p.id)).toEqual([5, 4, 2, 3, 1]);
  });

  it('有票改了或寫了 comment：那個 Project 往上推，時間不會倒退', () => {
    const list = sortProjects([project(1, 'A', T(5)), project(2, 'B', T(3)), project(3, 'C', T(1), T(1))]);
    expect(touchProject(list, 2, T(8)).map((p) => p.id)).toEqual([3, 2, 1]);
    expect(touchProject(list, 2, T(2))).toBe(list);
    expect(touchProject(list, 99, T(9))).toBe(list);
  });

  it('釘選與取消', () => {
    const pinned = withPinned(project(1, 'A', T(1)), true, T(4));
    expect(pinned.pinned_at).toBe(T(4));
    expect(withPinned(pinned, true, T(9))).toBe(pinned);
    expect(withPinned(pinned, false).pinned_at).toBeNull();
  });

  it('側欄最多 7 個：全部 Project 照順序排（釘選的在前），不看票的狀態，超過的不列（NX-165）', () => {
    // 10 個，其中 2 個釘選；不管有沒有票、票做完沒有，一律照時間排
    const list = Array.from({ length: 10 }, (_, k) => project(k + 1, `P${String(k + 1)}`, T(k + 1), k === 0 ? T(1) : k === 1 ? T(2) : null));
    expect(SIDEBAR_LIMIT).toBe(7);
    expect(sidebarProjects(list).map((p) => p.id)).toEqual([2, 1, 10, 9, 8, 7, 6]);
    const allPinned = Array.from({ length: 9 }, (_, k) => project(k + 1, `Q${String(k)}`, T(1), T(k + 1)));
    expect(sidebarProjects(allPinned).map((p) => p.id)).toEqual([9, 8, 7, 6, 5, 4, 3]);
  });

  it('說明用 Markdown 顯示，原文的 HTML 一律跳脫（防 XSS）', () => {
    const html = renderToString(
      <ProjectAbout description={'## 目標\n\n**粗體** <script>alert(1)</script> <img src=x onerror="alert(2)">\n\n[壞連結](javascript:alert(3))'} />,
    );
    expect(html).toContain('<h3>目標</h3>'); // 說明裡的 ## 降一級，頁首才是 h1
    expect(html).toContain('<strong>粗體</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('沒有說明時顯示空狀態文字', () => {
    expect(renderToString(<ProjectAbout description="  " />)).toContain('沒有說明。');
  });

  it('新增或改過的 Project 換進清單並重新排序，側欄馬上看得到', () => {
    const list = [project(1, 'B', T(2)), project(2, 'D', T(1))];
    expect(upsertProject(list, project(3, 'C', T(3))).map((p) => p.id)).toEqual([3, 1, 2]);
    expect(upsertProject(list, project(2, 'A', T(4))).map((p) => [p.id, p.name])).toEqual([[2, 'A'], [1, 'B']]);
  });

  it('名稱必填、不能跟別的 Project 重複；改自己不算重複', () => {
    const list = [project(1, 'Nextline')];
    expect(projectNameError('  ', list)).toBe('名稱必填');
    expect(projectNameError(' Nextline ', list)).toContain('名稱「Nextline」已被使用');
    expect(projectNameError('Nextline', list, 1)).toBeNull();
    expect(projectNameError('Gem TD', list)).toBeNull();
  });

  it('每個 Project 沒做完的票數：Done／Canceled 不算', () => {
    const mk = (n: number, status: Issue['status'], project_id: number | null) => ({ number: n, status, project_id }) as Issue;
    const counts = openCountByProject([mk(1, 'Todo', 2), mk(2, 'In Review', 2), mk(3, 'Done', 2), mk(4, 'Backlog', null), mk(5, 'Canceled', 1)]);
    expect(counts.get(2)).toBe(2);
    expect(counts.get(1)).toBeUndefined();
    expect(counts.get(null)).toBe(1);
  });
});
