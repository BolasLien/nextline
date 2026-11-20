// NX-156：開票的端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1），用一份獨立的本機 D1 灌測試資料，
// 再用 Playwright 在瀏覽器裡實際操作（做法同 scripts/e2e/board.mjs）：
//   1. 看板按 C → 填標題 → Cmd+Enter → 卡片出現在 Todo 頂端、API 查得到（不帶 Sprint，NX-160）、側欄「等你」（只算待驗收）不變、toast「打開」
//   2. 從 In Progress 欄的＋開票 → 狀態預填 In Progress → 卡片在 In Progress 頂端
//   3. 有草稿時按 Esc 先問（對話框裡的確認，不是瀏覽器的 confirm）→ 繼續寫 → 丟掉；沒草稿 Esc 直接關
//   4. 「建立後繼續建立下一張」
//   5. Project 頁開票 → Project 有預填
//   6. 列表頁（篩一個 Project、一種狀態）開票 → 兩個都預填
//   7. 手機 375 從 FAB 開票：全螢幕、建立按鈕固定在底部
// 截圖 1280／375 × 淺色／深色，量測沒有橫向捲動。
//
// 用法（repo 根目錄，.dev.vars 要有 DEV_SKIP_ACCESS=1）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8791] node scripts/e2e/create.mjs
// 輸出：.scratch/screenshots/create/*.png、.scratch/screenshots/create/e2e-result.json。
// 本機 D1 放在 .scratch/e2e-create/<時間>/（每次新的一份，不碰 .wrangler/state 的開發資料）。

/* global document, window -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/create');
const persist = join(repo, '.scratch/e2e-create', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8791);
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
  const mk = async (title, status, project) => api('POST', '/issues', { title, status, project_id: project?.id ?? null, sprint_id: sprint.id });
  await mk('看板卡片加上到期日圖示', 'Todo', nextline);
  await mk('寶石 3 階的材質再亮一點', 'Todo', gem);
  await mk('整理第二版的驗收清單', 'Todo', nextline);
  const p1 = await mk('列表頁：篩選與存成 view', 'In Progress', nextline);
  await mk('寶石 4 階模型', 'In Progress', gem);
  await mk('設計系統：深色模式對比修正', 'In Review', nextline);
  await api('POST', `/issues/${p1.identifier}/comments`, { author: 'claude-nextline', body: '下一步：claude-nextline 接著做存成 view' });
  return { sprint, nextline, gem };
}

async function allIssues() {
  const { issues } = await api('GET', '/issues?limit=200');
  return issues;
}

// ---- 瀏覽器 ----

async function measure(page) {
  // 等開啟動畫（上移 8px＋淡入）跑完再量
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return page.evaluate(() => {
    const doc = document.documentElement;
    const modal = document.querySelector('.create-modal');
    const r = modal?.getBoundingClientRect();
    const submit = document.querySelector('.create-submit')?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageHorizontalScroll: doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > doc.clientWidth,
      modal: r === undefined ? null : { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: modal.scrollWidth, clientWidth: modal.clientWidth },
      modalHorizontalScroll: modal === null ? null : modal.scrollWidth > modal.clientWidth,
      submit: submit === undefined ? null : { top: submit.top, bottom: submit.bottom, width: submit.width },
    };
  });
}

const dialog = (page) => page.getByRole('dialog', { name: '建立票' });
const titleInput = (page) => dialog(page).getByLabel('標題（必填）');

async function cardOrder(page, token) {
  return page.locator(`section[data-col="${token}"] .nl-card .id`).allTextContents();
}

async function count(page, token) {
  return Number(await page.locator(`section[data-col="${token}"] [data-count="${token}"]`).textContent());
}

async function waitingCount(page) {
  return Number(await page.locator('.app-side [data-nav-count="waiting"]').textContent());
}

async function openWithC(page) {
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('c');
  await dialog(page).waitFor();
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
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; void d.dismiss(); });

  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await page.locator('.app-side [data-nav-count="waiting"]').waitFor();
  const todoBefore = await cardOrder(page, 'todo');
  const todoCountBefore = await count(page, 'todo');
  const waitingBefore = await waitingCount(page);
  const apiBefore = (await allIssues()).length;

  // --- 1. 看板按 C → 填標題 → Cmd+Enter ---
  await openWithC(page);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? '');
  const titleFocused = await titleInput(page).evaluate((el) => el === document.activeElement);
  step('1. 看板按 C 打開開票對話框，游標在標題', titleFocused, { focused });
  await dialog(page).getByRole('button', { name: /^Project：沒有 Project/ }).waitFor();
  const statusChip = await dialog(page).getByRole('button', { name: /^狀態：/ }).getAttribute('aria-label');
  step('1. 預填：狀態 Todo、沒有 Project；沒有 Sprint 欄位（NX-160）', statusChip.startsWith('狀態：Todo') && (await dialog(page).getByRole('button', { name: /^Sprint：/ }).count()) === 0, { statusChip });
  const createDisabled = await dialog(page).getByRole('button', { name: /^建立/ }).isDisabled();
  step('1. 標題空白時「建立」不能按', createDisabled);
  measures['1280-light-empty'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'create-1280-light-empty.png') });
  await titleInput(page).fill('從看板按 C 開的票');
  measures['1280-light-filled'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'create-1280-light-filled.png') });
  await page.keyboard.press('Meta+Enter');
  await dialog(page).waitFor({ state: 'detached' });
  const toast = page.locator('.nl-toast', { hasText: /已建立 NX-\d+/ });
  await toast.waitFor();
  const created1 = (await toast.locator('.msg').textContent()).replace('已建立 ', '').trim();
  await page.locator(`section[data-col="todo"] .nl-card .id`, { hasText: created1 }).waitFor();
  const todoAfter = await cardOrder(page, 'todo');
  step('1. Cmd+Enter 建立：對話框關閉、toast「已建立 NX-n」', true, { created: created1 });
  step('1. 卡片出現在 Todo 頂端、張數 +1', todoAfter[0] === created1 && (await count(page, 'todo')) === todoCountBefore + 1 && todoAfter.slice(1).join() === todoBefore.join(), { before: todoBefore, after: todoAfter });
  const api1 = await api('GET', `/issues/${created1}`);
  step('1. API 查得到：標題、Todo、沒有 Sprint、沒有 Project', api1.title === '從看板按 C 開的票' && api1.status === 'Todo' && api1.sprint_id === null && api1.project_id === null, { status: api1.status, sprint_id: api1.sprint_id });
  const waitingAfter = await waitingCount(page);
  step('1. 側欄「等你」只算待驗收：開的是 Todo，張數不變', waitingAfter === waitingBefore, { before: waitingBefore, after: waitingAfter });
  measures['1280-light-created'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'create-1280-light-created.png') });
  await toast.getByRole('button', { name: '打開' }).click();
  await page.waitForURL(`**/?peek=${created1}`);
  await page.locator(`.nl-peek[data-peek="${created1}"]`).waitFor();
  step('1. toast「打開」開右側預覽', true, { url: page.url() });
  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.search.includes('peek'));

  // --- 2. In Progress 欄的＋ ---
  const progBefore = await cardOrder(page, 'in-progress');
  await page.locator('section[data-col="in-progress"] [data-new="in-progress"]').click();
  await dialog(page).waitFor();
  const st2 = await dialog(page).getByRole('button', { name: /^狀態：/ }).getAttribute('aria-label');
  step('2. 從 In Progress 欄的＋開：狀態預填 In Progress', st2.startsWith('狀態：In Progress'), { chip: st2 });
  await titleInput(page).fill('從 In Progress 欄開的票');
  await dialog(page).getByRole('button', { name: /^建立/ }).click();
  await dialog(page).waitFor({ state: 'detached' });
  const progAfterLoc = page.locator('section[data-col="in-progress"] .nl-card .id');
  await page.waitForFunction((n) => document.querySelectorAll('section[data-col="in-progress"] .nl-card').length === n, progBefore.length + 1);
  const progAfter = await progAfterLoc.allTextContents();
  const api2 = await api('GET', `/issues/${progAfter[0]}`);
  step('2. 卡片在 In Progress 頂端，API 狀態 In Progress', api2.title === '從 In Progress 欄開的票' && api2.status === 'In Progress', { order: progAfter });

  // --- 3. Esc ---
  const n3 = (await allIssues()).length;
  await openWithC(page);
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  step('3. 沒有草稿：Esc 直接關', true);
  await openWithC(page);
  await titleInput(page).fill('打到一半的草稿');
  await page.keyboard.press('Escape');
  const confirm = dialog(page).getByRole('alertdialog', { name: '捨棄這份草稿？' });
  await confirm.waitFor();
  const keepFocused = await page.waitForFunction(() => document.activeElement?.textContent === '繼續編輯', null, { timeout: 2000 }).then(() => true, () => false);
  step('3. 有草稿：Esc 先在對話框裡問「捨棄這份草稿？」，焦點在「繼續編輯」', keepFocused && dialogs === 0, { browserDialogs: dialogs });
  measures['1280-light-confirm'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'create-1280-light-confirm.png') });
  await confirm.getByRole('button', { name: '繼續編輯' }).click();
  await confirm.waitFor({ state: 'detached' });
  const backFocus = await page.evaluate(() => document.activeElement?.className ?? '');
  step('3. 繼續編輯：草稿還在，游標回標題', (await titleInput(page).inputValue()) === '打到一半的草稿', { focus: backFocus });
  await page.keyboard.press('Escape');
  await confirm.waitFor();
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  step('3. 確認出現時再按 Esc：回到草稿（不會直接丟）', (await dialog(page).count()) === 1 && (await titleInput(page).inputValue()) === '打到一半的草稿');
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: '捨棄' }).click();
  await dialog(page).waitFor({ state: 'detached' });
  step('3. 捨棄：對話框關閉、沒有開出票', (await allIssues()).length === n3 && dialogs === 0, { browserDialogs: dialogs });

  // --- 4. 繼續開下一張 ---
  await openWithC(page);
  await dialog(page).getByLabel('建立後繼續建立下一張').check();
  await titleInput(page).fill('連續開的第一張');
  await page.keyboard.press('Control+Enter');
  await page.locator('.nl-toast', { hasText: '已建立' }).last().waitFor();
  await page.waitForFunction(() => document.querySelector('.create-title')?.value === '');
  const stillOpen = (await dialog(page).count()) === 1 && (await titleInput(page).evaluate((el) => el === document.activeElement));
  await titleInput(page).fill('連續開的第二張');
  await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => document.querySelector('.create-title')?.value === '');
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  const titles = (await allIssues()).map((i) => i.title);
  step('4. 勾「建立後繼續建立下一張」：建立後對話框留著、清空標題、游標回標題（Ctrl+Enter 也能送出）', stillOpen && titles.includes('連續開的第一張') && titles.includes('連續開的第二張'));

  // --- 5. Project 頁 ---
  await page.goto(`${BASE}/projects/${String(data.gem.id)}`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await openWithC(page);
  await dialog(page).getByRole('button', { name: /^Project：Gem TD/ }).waitFor();
  step('5. Project 頁開票：Project 預填 Gem TD', true);
  measures['1280-light-project'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'create-1280-light-project.png') });
  await titleInput(page).fill('從 Project 頁開的票');
  await page.keyboard.press('Meta+Enter');
  await dialog(page).waitFor({ state: 'detached' });
  await page.locator('section[data-col="todo"] .nl-card .t', { hasText: '從 Project 頁開的票' }).waitFor();
  const api5 = (await allIssues()).find((i) => i.title === '從 Project 頁開的票');
  step('5. API：project_id 是 Gem TD；Project 看板頂端出現', api5?.project_id === data.gem.id && (await cardOrder(page, 'todo'))[0] === api5.identifier, { project_id: api5?.project_id });

  // --- 6. 列表頁（一個 Project、一種狀態） ---
  await page.goto(`${BASE}/issues?project=${String(data.nextline.id)}&status=in_progress`);
  await page.locator('.nl-row').first().waitFor();
  const rowsBefore = await page.locator('.nl-row[data-n]').count();
  await openWithC(page);
  await dialog(page).getByRole('button', { name: /^Project：Nextline 第二版/ }).waitFor();
  const st6 = await dialog(page).getByRole('button', { name: /^狀態：/ }).getAttribute('aria-label');
  step('6. 列表頁（篩 Nextline 第二版、In Progress）：兩個都預填', st6.startsWith('狀態：In Progress'), { chip: st6 });
  await titleInput(page).fill('從列表開的票');
  await page.keyboard.press('Meta+Enter');
  await dialog(page).waitFor({ state: 'detached' });
  await page.locator('.nl-row', { hasText: '從列表開的票' }).waitFor();
  step('6. 列表即時多一列', (await page.locator('.nl-row[data-n]').count()) === rowsBefore + 1, { before: rowsBefore });

  step('桌面沒有 console 錯誤', consoleErrors.length === 0, { consoleErrors });
  await ctx.close();

  // ===== 桌面 1280 深色 =====
  const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  const dp = await dark.newPage();
  await dp.goto(`${BASE}/`);
  await dp.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await openWithC(dp);
  await dialog(dp).getByRole('button', { name: /^Project：/ }).waitFor();
  await titleInput(dp).fill('深色模式的開票對話框');
  measures['1280-dark-filled'] = await measure(dp);
  await dp.screenshot({ path: join(outDir, 'create-1280-dark-filled.png') });
  await dp.keyboard.press('Escape');
  await dialog(dp).getByRole('alertdialog').waitFor();
  measures['1280-dark-confirm'] = await measure(dp);
  await dp.screenshot({ path: join(outDir, 'create-1280-dark-confirm.png') });
  await dark.close();

  // ===== 手機 375 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(`${BASE}/`);
    await mp.locator('.nl-card').first().waitFor();
    const tabBefore = Number(await mp.locator('#col-tab-todo .n').textContent());
    await mp.locator('.nl-fab').tap();
    await dialog(mp).waitFor();
    await dialog(mp).getByRole('button', { name: /^Project：/ }).waitFor();
    await mp.waitForFunction(() => !document.querySelector('.create-modal button[aria-label^="Project："]')?.hasAttribute('disabled'));
    const mm = await measure(mp);
    const full = mm.modal !== null && mm.modal.x === 0 && mm.modal.y === 0 && Math.round(mm.modal.width) === 375 && Math.round(mm.modal.height) === mm.viewportHeight;
    const bottom = mm.submit !== null && mm.viewportHeight - mm.submit.bottom <= 24 && mm.submit.width > 300;
    step(`7. 手機 ${scheme}：FAB 打開的是全螢幕頁面，建立按鈕固定在底部`, full && bottom, { modal: mm.modal, submit: mm.submit, viewportHeight: mm.viewportHeight });
    measures[`375-${scheme}-empty`] = mm;
    await mp.screenshot({ path: join(outDir, `create-375-${scheme}-empty.png`) });
    await titleInput(mp).fill(`手機 ${scheme} 從 FAB 開的票`);
    measures[`375-${scheme}-filled`] = await measure(mp);
    await mp.screenshot({ path: join(outDir, `create-375-${scheme}-filled.png`) });
    if (scheme === 'light') {
      await dialog(mp).getByRole('button', { name: /^建立/ }).tap();
      await dialog(mp).waitFor({ state: 'detached' });
      await mp.locator('.nl-toast', { hasText: '已建立' }).waitFor();
      await mp.locator('.nl-card .t', { hasText: '手機 light 從 FAB 開的票' }).waitFor();
      const tabAfter = Number(await mp.locator('#col-tab-todo .n').textContent());
      const apiM = (await allIssues()).find((i) => i.title === '手機 light 從 FAB 開的票');
      step('7. 手機建立：卡片出現在 Todo、分頁張數 +1、API 查得到', apiM?.status === 'Todo' && apiM.sprint_id === null && tabAfter === tabBefore + 1, { before: tabBefore, after: tabAfter });
      measures['375-light-created'] = await measure(mp);
      await mp.screenshot({ path: join(outDir, 'create-375-light-created.png') });
    }
    await m.close();
  }

  const noScroll = Object.values(measures).every((x) => !x.pageHorizontalScroll && x.modalHorizontalScroll !== true);
  step('所有截圖的頁面與對話框都沒有橫向捲動', noScroll, { measures });
  step('API 總張數（只在本機 D1）', true, { before: apiBefore, after: (await allIssues()).length });
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
