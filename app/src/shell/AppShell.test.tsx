// App shell 用 react-dom/server 渲染（不需要瀏覽器）：側欄項目、手機分頁列、目前頁標示、深淺色切換都在。
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createApiClient } from '../api/client';

function render(path: string): string {
  // SSR 不會跑 effect，所以不會真的打 API；資料區塊停在載入中。
  const client = createApiClient({ fetch: () => Promise.reject(new Error('不該打 API')) });
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App client={client} theme="system" />
    </MemoryRouter>,
  );
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('App shell', () => {
  it('桌面側欄：搜尋、開票、等你、看板、全部的票、Project、外觀；三區、Sprint、「我的 view」拿掉了（NX-160）', () => {
    const html = render('/');
    const t = text(html);
    for (const label of ['搜尋', '建立票', '等你', '看板', '全部的票', 'Project', '全部 Project', '外觀', '跟系統', '淺色', '深色']) {
      expect(t, label).toContain(label);
    }
    for (const gone of ['三區', 'Sprint', '我的 view', 'Agent 工作中']) expect(t, gone).not.toContain(gone);
    expect(html).not.toContain('href="/zones"');
    expect(html).not.toContain('href="/sprints');
    expect(html).toContain('aria-label="主要"');
  });

  it('手機分頁列五格＋開票 FAB', () => {
    const t = text(render('/'));
    expect(t).toMatch(/看板 等你 全部 搜尋 更多/);
    expect(render('/')).toContain('aria-label="建立票"');
  });

  it('目前頁用 aria-current 標示；等你（待驗收）和全部的票分得開', () => {
    // React 輸出的屬性順序：class、aria-current、href
    const sideAll = 'class="nl-nav-item" aria-current="page" href="/issues"';
    const sideWaiting = 'class="nl-nav-item" aria-current="page" href="/issues?status=in_review"';
    const issues = render('/issues');
    expect(issues).toContain(sideAll);
    expect(issues).not.toContain(sideWaiting);
    expect(issues).toContain('class="nl-tab" aria-current="page" href="/issues"');
    const waiting = render('/issues?status=in_review');
    expect(waiting).toContain(sideWaiting);
    expect(waiting).not.toContain(sideAll);
    expect(waiting).toContain('class="nl-tab" aria-current="page" href="/issues?status=in_review"');
    expect(text(waiting)).toContain('等你');
  });

  it('拿掉的頁面（三區、Sprint、我的 view）有路由接住（轉回看板，瀏覽器 e2e 驗轉址），不是「找不到」也不是「還在做」', () => {
    for (const path of ['/zones', '/sprints/3', '/views/1']) {
      const t = text(render(path));
      expect(t, path).not.toContain('找不到這一頁');
      expect(t, path).not.toContain('還在做');
    }
  });

  it('Project 列表、Project 頁先顯示載入中', () => {
    expect(render('/projects')).toContain('aria-label="Project 載入中"');
    expect(render('/projects/3')).toContain('aria-label="Project 載入中"');
    expect(text(render('/projects/abc'))).toContain('找不到這個 Project');
  });

  it('看板、全部的票先顯示載入中', () => {
    expect(render('/')).toContain('aria-label="看板載入中"');
    expect(render('/issues')).toContain('aria-label="全部的票載入中"');
  });

  it('外觀切換標出目前的選擇', () => {
    expect(render('/')).toMatch(/aria-pressed="true"[^>]*>跟系統/);
  });

  it('不存在的網址顯示找不到', () => {
    expect(text(render('/nope/really'))).toContain('找不到這一頁');
  });
});
