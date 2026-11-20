// NX-157：Cmd+K 指令面板與全域快捷鍵的端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1），
// 用一份獨立的本機 D1 灌測試資料，再用 Playwright 在瀏覽器裡實際操作（做法同 scripts/e2e/create.mjs）：
//   1. Cmd+K → 打票號 → Enter 開右側預覽；BOL 舊票號也找得到
//   2. Cmd+K → 打標題的中文片段 → 找得到
//   3. 列表頁開著預覽時 Cmd+K →「改狀態成 In Progress」→ API 確認 → Cmd+Z 復原（看板以外）→ API 確認
//   4. Esc 只關最上層：先關面板，預覽還在；再按才關預覽
//   5. G 接 I 跳到全部的票；G 接 B 回看板
//   6. 在輸入框裡按 C 不會開票、G 接 I 不會跳頁
//   7. ? 顯示快捷鍵說明，Esc 關掉
//   8. 側欄「搜尋 ⌘K」打開面板；最近用過放最上面
//   9. 手機 375：底部「搜尋」打開面板（滿版），選票進整頁
// 截圖 1280／375 × 淺色／深色，量測沒有橫向捲動。
//
// 用法（repo 根目錄，.dev.vars 要有 DEV_SKIP_ACCESS=1）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8792] node scripts/e2e/palette.mjs
// 輸出：.scratch/screenshots/palette/*.png、.scratch/screenshots/palette/e2e-result.json。
// 本機 D1 放在 .scratch/e2e-palette/<時間>/（每次新的一份，不碰 .wrangler/state 的開發資料）。

/* global document, window, getComputedStyle -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/palette');
const persist = join(repo, '.scratch/e2e-palette', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8792);
const BASE = `http://localhost:${String(PORT)}`;
const DAY = 24 * 60 * 60 * 1000;

const results = [];
function step(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) throw new Error(`步驟失敗：${name}`);
}

// ---- 本機 D1 與 wrangler dev ----

const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'nextline', '--local', '--persist-to', persist], {
  cwd: repo,
  encoding: 'utf8',
  env: { ...process.env, CI: '1' },
});
if (migrate.status !== 0) {
  console.error(migrate.stdout, migrate.stderr);
  throw new Error('本機 D1 migration 失敗');
}

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', persist, '--show-interactive-dev-session=false'], {
  cwd: repo,
  env: { ...process.env, CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let devLog = '';
dev.stdout.on('data', (b) => { devLog += String(b); });
dev.stderr.on('data', (b) => { devLog += String(b); });

async function waitHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      // 還沒起來
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev 沒起來：\n${devLog.slice(-2000)}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}/app-api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Requested-With': 'XMLHttpRequest' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${String(res.status)} ${JSON.stringify(json)}`);
  return json;
}

async function seed() {
  const now = Date.now();
  const sprint = await api('POST', '/sprints', {
    number: 1,
    starts_at: new Date(now - 2 * DAY).toISOString(),
    ends_at: new Date(now + 12 * DAY).toISOString(),
  });
  const nextline = await api('POST', '/projects', { name: 'Nextline 第二版' });
  const gem = await api('POST', '/projects', { name: 'Gem TD' });
  const mk = async (title, status, project, extra = {}) => api('POST', '/issues', { title, status, project_id: project?.id ?? null, sprint_id: sprint.id, ...extra });
  const due = await mk('看板卡片加上到期日圖示', 'Todo', nextline);
  const gemTodo = await mk('寶石 3 階的材質再亮一點', 'Todo', gem);
  const legacy = await mk('從 Linear 搬來的舊票：整理驗收清單', 'Todo', nextline, { legacy_identifier: 'BOL-150' });
  await mk('列表頁：篩選與存成 view', 'In Progress', nextline);
  await mk('寶石 4 階模型', 'In Progress', gem);
  await mk('設計系統：深色模式對比修正', 'In Review', nextline);
  await mk('Deploy the worker to production', 'Done', nextline);
  return { sprint, nextline, gem, due, gemTodo, legacy };
}

// ---- 瀏覽器 ----

async function measure(page) {
  // 等開啟動畫（面板縮放、預覽滑入）跑完、版面穩定再量
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return page.evaluate(() => {
    const doc = document.documentElement;
    const pal = document.querySelector('.nl-palette') ?? document.querySelector('.kb-help');
    const r = pal?.getBoundingClientRect();
    const wide = doc.scrollWidth > doc.clientWidth;
    return {
      // 有橫向捲動時，列出超出右邊或自己內容溢出的元素，方便找原因
      culprits: wide
        ? [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > doc.clientWidth || (el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'visible'))
          .slice(0, 8)
          .map((el) => `${el.tagName}.${String(el.className)} right=${String(el.getBoundingClientRect().right)} sw=${String(el.scrollWidth)} cw=${String(el.clientWidth)}`)
        : [],
      viewport: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      pageHorizontalScroll: doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > doc.clientWidth,
      panel: r === undefined ? null : { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: pal.scrollWidth, clientWidth: pal.clientWidth },
      panelHorizontalScroll: pal === null ? null : pal.scrollWidth > pal.clientWidth,
    };
  });
}

const palette = (page) => page.getByRole('dialog', { name: '指令面板' });
const paletteInput = (page) => palette(page).getByRole('combobox');
const selected = (page) => palette(page).locator('[role="option"][aria-selected="true"]');

async function blur(page) {
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
}

async function openPalette(page) {
  await page.keyboard.press('Meta+K');
  await palette(page).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'combobox');
}

const measures = {};
let browser;

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const data = await seed();

  // ===== 桌面 1280 淺色 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await blur(page);

  // --- 1. 票號 → Enter 開預覽 ---
  await openPalette(page);
  measures['1280-light-empty'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'palette-1280-light-empty.png') });
  const groupsEmpty = await palette(page).locator('[role="group"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  step('1. Cmd+K 打開面板，焦點在輸入框；空輸入顯示「跳到」「動作」「最近更新的票」', groupsEmpty.includes('跳到') && groupsEmpty.includes('動作') && groupsEmpty.includes('最近更新的票'), { groups: groupsEmpty });
  await paletteInput(page).fill(data.due.identifier);
  await selected(page).filter({ hasText: data.due.identifier }).waitFor();
  const first1 = await selected(page).getAttribute('data-item');
  step('1. 打票號：第一個選中的就是那張票', first1 === `issue:${data.due.identifier}`, { query: data.due.identifier, selected: first1 });
  await page.keyboard.press('Enter');
  await palette(page).waitFor({ state: 'detached' });
  await page.waitForURL(`**/?peek=${data.due.identifier}`);
  await page.locator(`.nl-peek[data-peek="${data.due.identifier}"] [data-detail]`).waitFor();
  step('1. Enter 關面板、開右側預覽', true, { url: page.url() });
  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.search.includes('peek'));

  await blur(page);
  await openPalette(page);
  await paletteInput(page).fill('BOL-150');
  await selected(page).filter({ hasText: data.legacy.identifier }).waitFor();
  step('1. BOL 舊票號也找得到（BOL-150 → ' + data.legacy.identifier + '）', (await selected(page).getAttribute('data-item')) === `issue:${data.legacy.identifier}`);
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });

  // --- 2. 中文標題片段 ---
  await blur(page);
  await openPalette(page);
  await paletteInput(page).fill('材質');
  const hit2 = palette(page).locator(`[data-item="issue:${data.gemTodo.identifier}"]`);
  await hit2.waitFor();
  measures['1280-light-query'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'palette-1280-light-query.png') });
  step('2. 打中文片段「材質」找得到「寶石 3 階的材質再亮一點」', (await hit2.textContent()).includes('寶石 3 階的材質再亮一點'));
  await paletteInput(page).fill('開票');
  const fuzzyHit = await palette(page).locator('[data-item="action:new"]').count();
  step('2. 模糊比對：「開票」對到動作「建立票」', fuzzyHit === 1);
  await paletteInput(page).fill('甘特圖');
  const empty = await palette(page).locator('.nl-empty-inline').textContent();
  step('2. 找不到時一句話＋建議', empty.includes('找不到「甘特圖」'), { text: empty });
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });

  // --- 3. 列表頁開著預覽：改狀態 → API → Cmd+Z 復原 ---
  const ref3 = data.gemTodo.identifier;
  await page.goto(`${BASE}/issues?peek=${ref3}`);
  await page.locator(`.nl-peek[data-peek="${ref3}"] [data-detail]`).waitFor();
  await blur(page);
  measures['1280-light-peek-only'] = await measure(page);
  await openPalette(page);
  const chip = await palette(page).locator('.ctx').textContent();
  const issueGroup = await palette(page).getByRole('group', { name: `對這張票・${ref3}` }).locator('[role="option"]').allTextContents();
  measures['1280-light-issue'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'palette-1280-light-issue.png') });
  step('3. 開著預覽時面板多出「對這張票」，輸入框旁有票號晶片', chip === ref3 && issueGroup.includes('改狀態成 In Progress') && !issueGroup.includes('改狀態成 Todo'), { chip, items: issueGroup });
  await paletteInput(page).fill('in progress');
  await selected(page).filter({ hasText: '改狀態成 In Progress' }).waitFor();
  await page.keyboard.press('Enter');
  await palette(page).waitFor({ state: 'detached' });
  const toast3 = page.locator('.nl-toast', { hasText: `${ref3} 已移到「In Progress」` });
  await toast3.waitFor();
  const hasUndo = (await toast3.getByRole('button', { name: '復原' }).count()) === 1;
  await page.waitForFunction(async (r) => (await (await fetch(`/app-api/issues/${r}`)).json()).status === 'In Progress', ref3);
  const after3 = await api('GET', `/issues/${ref3}`);
  step('3. 「改狀態成 In Progress」：toast 附「復原」，API 狀態是 In Progress', hasUndo && after3.status === 'In Progress', { status: after3.status });
  const peekBadge = await page.locator(`.nl-peek[data-peek="${ref3}"] .meta-row .nl-badge`).first().textContent();
  step('3. 預覽面板同步變成 In Progress', peekBadge.includes('In Progress'), { badge: peekBadge });
  await blur(page);
  await page.keyboard.press('Meta+Z');
  await page.locator('.nl-toast', { hasText: '已復原' }).waitFor();
  await page.waitForFunction(async (r) => (await (await fetch(`/app-api/issues/${r}`)).json()).status === 'Todo', ref3);
  const undone = await api('GET', `/issues/${ref3}`);
  const events = (await api('GET', `/issues/${ref3}/events`)).events.filter((e) => e.field === 'status');
  step('3. 在列表頁按 Cmd+Z 復原：API 回到 Todo，變更紀錄標已還原', undone.status === 'Todo' && events.some((e) => e.reverted_by_event_id !== null), { status: undone.status, statusEvents: events.length });

  // --- 4. Esc 只關最上層 ---
  await blur(page);
  await openPalette(page);
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  const peekStill = await page.locator(`.nl-peek[data-peek="${ref3}"]`).count();
  step('4. 面板和預覽都開著時，Esc 先關面板，預覽還在', peekStill === 1);
  await blur(page);
  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.search.includes('peek'));
  step('4. 再按 Esc 關預覽', true, { url: page.url() });

  // --- 5. G 接 I／B ---
  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await blur(page);
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await page.waitForURL((u) => u.pathname === '/issues' && u.search === '');
  step('5. G 接 I 跳到全部的票', true, { url: page.url() });
  await page.locator('.nl-row').first().waitFor();
  await blur(page);
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.waitForURL((u) => u.pathname === '/');
  step('5. G 接 B 回看板', true, { url: page.url() });

  // --- 6. 輸入框裡按 C、G I 不觸發 ---
  await page.goto(`${BASE}/issues`);
  await page.locator('.nl-row').first().waitFor();
  const search = page.getByRole('searchbox', { name: '搜尋票號或標題' });
  await search.click();
  await page.keyboard.press('c');
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await page.waitForTimeout(400);
  const createCount = await page.getByRole('dialog', { name: '建立票' }).count();
  const value6 = await search.inputValue();
  step('6. 在搜尋框裡按 C、G、I：只是打字，不開票、不跳頁', createCount === 0 && value6 === 'cgi' && new URL(page.url()).pathname === '/issues', { value: value6, url: page.url() });
  await page.keyboard.press('Meta+K');
  await palette(page).waitFor();
  step('6. 在輸入框裡 Cmd+K 照樣打開面板', true);
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜尋票號或標題', null, { timeout: 2000 }).catch(() => {});
  const back6 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  step('6. 關閉面板後焦點回到原本的輸入框', back6 === '搜尋票號或標題', { focus: back6 });

  // --- 7. ? 顯示說明 ---
  await blur(page);
  await page.keyboard.press('Shift+Slash');
  const help = page.getByRole('dialog', { name: '快捷鍵' });
  await help.waitFor();
  const helpText = await help.textContent();
  measures['1280-light-help'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'help-1280-light.png') });
  step('7. ? 顯示快捷鍵說明', ['建立票', '跳到看板', '跳到全部的票', '跳到等你', '復原'].every((t) => helpText.includes(t)) && !helpText.includes('三區'));
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'detached' });
  step('7. Esc 關掉說明', true);

  // --- 8. 側欄「搜尋」＋最近用過 ---
  await page.locator('.app-side').getByRole('button', { name: /搜尋/ }).click();
  await palette(page).waitFor();
  const recentGroup = palette(page).getByRole('group', { name: '最近用過' });
  const recentItems = await recentGroup.locator('[role="option"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item')));
  const firstGroup = await palette(page).locator('[role="group"]').first().getAttribute('aria-label');
  step('8. 側欄「搜尋 ⌘K」打開面板；最近用過放最上面（剛開過的票在裡面）', firstGroup === '最近用過' && recentItems[0] === `issue:${data.due.identifier}`, { firstGroup, recentItems });
  await page.keyboard.press('ArrowDown');
  const sel8 = await selected(page).getAttribute('data-item');
  step('8. ↓ 移動選中項', sel8 !== recentItems[0], { selected: sel8 });
  await page.keyboard.press('Escape');

  step('桌面沒有 console 錯誤', consoleErrors.length === 0, { consoleErrors });
  await ctx.close();

  // ===== 桌面 1280 深色 =====
  const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  const dp = await dark.newPage();
  await dp.goto(`${BASE}/?peek=${data.due.identifier}`);
  await dp.locator(`.nl-peek [data-detail]`).waitFor();
  await blur(dp);
  await openPalette(dp);
  measures['1280-dark-issue'] = await measure(dp);
  await dp.screenshot({ path: join(outDir, 'palette-1280-dark-issue.png') });
  await paletteInput(dp).fill('寶石');
  await palette(dp).locator(`[data-item="issue:${data.gemTodo.identifier}"]`).waitFor();
  measures['1280-dark-query'] = await measure(dp);
  await dp.screenshot({ path: join(outDir, 'palette-1280-dark-query.png') });
  await dp.keyboard.press('Escape');
  await blur(dp);
  await dp.keyboard.press('Shift+Slash');
  await dp.getByRole('dialog', { name: '快捷鍵' }).waitFor();
  measures['1280-dark-help'] = await measure(dp);
  await dp.screenshot({ path: join(outDir, 'help-1280-dark.png') });
  await dark.close();

  // ===== 手機 375 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(`${BASE}/`);
    await mp.locator('.nl-card').first().waitFor();
    await mp.locator('.app-tabbar').getByRole('button', { name: '搜尋' }).tap();
    await palette(mp).waitFor();
    const mm = await measure(mp);
    measures[`375-${scheme}-empty`] = mm;
    await mp.screenshot({ path: join(outDir, `palette-375-${scheme}-empty.png`) });
    step(`9. 手機 ${scheme}：底部「搜尋」打開面板，滿版（左右 8px）`, mm.panel !== null && Math.round(mm.panel.x) === 8 && Math.round(mm.panel.width) === 375 - 16, { panel: mm.panel });
    await paletteInput(mp).fill('寶石');
    await palette(mp).locator(`[data-item="issue:${data.gemTodo.identifier}"]`).waitFor();
    measures[`375-${scheme}-query`] = await measure(mp);
    await mp.screenshot({ path: join(outDir, `palette-375-${scheme}-query.png`) });
    if (scheme === 'light') {
      await palette(mp).locator(`[data-item="issue:${data.gemTodo.identifier}"]`).tap();
      await mp.waitForURL(`**/issues/${data.gemTodo.identifier}`);
      await mp.locator('[data-detail]').waitFor();
      step('9. 手機點選票：進整頁', true, { url: mp.url() });
    }
    await m.close();
  }

  const noScroll = Object.values(measures).every((x) => !x.pageHorizontalScroll && x.panelHorizontalScroll !== true);
  step('所有截圖的頁面與面板都沒有橫向捲動', noScroll, { measures });
} catch (e) {
  results.push({ name: '例外', ok: false, error: String(e?.stack ?? e) });
  console.error(e);
  process.exitCode = 1;
} finally {
  writeFileSync(join(outDir, 'e2e-result.json'), `${JSON.stringify({ base: BASE, persist, results, measures }, null, 2)}\n`);
  await browser?.close();
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    dev.kill('SIGTERM');
  }
}
