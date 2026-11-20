// NX-165：拿掉 Project 狀態、側欄最多列 7 個 Project、/projects 顯示最後更新時間的端對端測試。
// 跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，用 Playwright 在瀏覽器實際操作：
//   1. API 沒有 status、有 last_activity_at；PATCH 帶 status 忽略
//   2. 頁面上任何地方都沒有 Project 狀態標籤（看板、/projects、Project 頁頁首、新增與編輯對話框）
//   3. /projects 每列有最後更新時間（相對時間，滑過 title 是完整時間），很久沒動的顯示「N 天前」
//   4. 側欄不看票的狀態：票全部 Done、只剩 Backlog、一張票都沒有的 Project 都照時間排在側欄
//   5. 新增 Project 不用重新整理就出現在側欄
//   6. 釘選的排在最前面
//   7. 有 9 個 Project 時側欄（與手機「更多」）只列 7 個，順序跟 API 一致（釘選的在前，其餘照最後更新）
//   8. /projects 1280／375 × 淺色／深色截圖，沒有橫向溢出；側欄截圖
// 用法（repo 根目錄）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8798] node scripts/e2e/nx165.mjs
// 輸出：.scratch/screenshots/nx165/*.png、.scratch/screenshots/nx165/e2e-result.json。本機 D1 在 .scratch/e2e-nx165/<時間>/。


/* global document, getComputedStyle -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/nx165');
const persist = join(repo, '.scratch/e2e-nx165', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8798);
const BASE = `http://localhost:${String(PORT)}`;

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

// ---- 瀏覽器 ----

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
}

// 側欄（或「更多」sheet）Project 列的 id 順序
async function navOrder(page, scope = '.nl-sidebar') {
  return page.locator(`${scope} .nl-nav-row`).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-nav-project'))));
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.vh, [inert], [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > vw + 1) bad.push({ el: `${el.tagName.toLowerCase()}.${String(el.className)}`, right: Math.round(r.right), vw });
    }
    return { vw, docScroll: document.documentElement.scrollWidth, bad: bad.slice(0, 10), count: bad.length };
  });
}

// 舊的 Project 狀態文字（NX-165 前的 PROJECT_STATUS_LABEL）
const OLD_LABELS = ['進行中', '已規劃', '暫停', '之後', '完成', '取消'];

const H = (h) => new Date(Date.now() - h * 3600_000).toISOString();

// 四個 Project：有在做的、票全部 Done 的、只剩 Backlog 的、一張票都沒有的。時間由新到舊。
async function seed() {
  const mkProject = async (name, h) => ({ ...(await api('POST', '/projects', { name, created_at: H(h), updated_at: H(h) })), h });
  const mkIssue = (title, status, project) => api('POST', '/issues', { title, status, project_id: project.id, created_at: H(project.h), updated_at: H(project.h) });
  const busy = await mkProject('還在忙的 Project', 2);
  await mkIssue('忙：還沒做', 'Todo', busy);
  const finished = await mkProject('做完的 Project', 5);
  await mkIssue('做完：一', 'Done', finished);
  await mkIssue('做完：二', 'Canceled', finished);
  const backlog = await mkProject('只剩 Backlog 的 Project', 8);
  await mkIssue('之後再說', 'Backlog', backlog);
  const empty = await mkProject('沒有票的 Project', 50);
  return { busy, finished, backlog, empty };
}

// 畫面上有沒有 Project 狀態：舊的徽章 class、狀態下拉、Project 列、頁首、側欄裡的舊狀態字（對話框的「取消」按鈕不算，對話框另外看有沒有下拉與「狀態」欄名）
async function statusLeftovers(page) {
  return page.evaluate((labels) => {
    const found = [];
    for (const sel of ['.proj-status', '.project-status-select', '.proj-row .st']) {
      if (document.querySelector(sel)) found.push(sel);
    }
    for (const el of document.querySelectorAll('.proj-row, .proj-head, .nl-nav-row')) {
      const text = el.textContent ?? '';
      for (const l of labels) if (text.includes(l)) found.push(`${el.className}: ${l}`);
    }
    return found;
  }, OLD_LABELS);
}

const apiOrder = async () => (await api('GET', '/projects')).projects.map((p) => p.id);

let browser;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const { busy, finished, backlog, empty } = await seed();

  // 1. API
  const apiProjects = (await api('GET', '/projects')).projects;
  step('1. API GET /projects：每個都沒有 status、有 last_activity_at', apiProjects.every((p) => !('status' in p) && typeof p.last_activity_at === 'string' && p.last_activity_at !== ''), { keys: Object.keys(apiProjects[0]) });
  const ignored = await api('PATCH', `/projects/${String(busy.id)}`, { status: 'completed' });
  step('1. API PATCH 帶 status：200、忽略、回傳沒有 status', !('status' in ignored) && ignored.name === busy.name);

  // ===== 桌面 1280 淺色 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); });
  const side = page.locator('.nl-sidebar');

  await page.goto(`${BASE}/`);
  await page.locator('.nl-card').first().waitFor();
  await side.locator('.nl-nav-row').first().waitFor();
  await settle(page);
  const s4 = await navOrder(page);
  step('4. 側欄不看票的狀態：票全部 Done、只剩 Backlog、沒有票的都在，照最後更新排', JSON.stringify(s4) === JSON.stringify([busy.id, finished.id, backlog.id, empty.id]), { s4 });
  step('2. 看板頁沒有 Project 狀態標籤', (await statusLeftovers(page)).length === 0, { left: await statusLeftovers(page) });

  // 2. Project 頁頁首、編輯對話框
  await side.locator(`.nl-nav-row[data-nav-project="${String(busy.id)}"] .nl-nav-item`).click();
  await page.locator('.proj-head h1', { hasText: busy.name }).waitFor();
  await settle(page);
  step('2. Project 頁頁首沒有狀態標籤', (await statusLeftovers(page)).length === 0, { left: await statusLeftovers(page) });
  await page.screenshot({ path: join(outDir, 'project-page-1280-light.png') });
  await page.locator('[data-edit-project]').click();
  const ed = page.getByRole('dialog', { name: '編輯 Project' });
  await ed.waitFor();
  const edInfo = { selects: await ed.locator('select').count(), labels: await ed.getByText('狀態', { exact: true }).count() };
  step('2. 編輯 Project 對話框沒有狀態欄', edInfo.selects === 0 && edInfo.labels === 0, edInfo);
  await page.keyboard.press('Escape');
  await ed.waitFor({ state: 'detached' });

  // 3. /projects 最後更新時間
  await side.getByRole('link', { name: '全部 Project' }).click();
  await page.locator('.proj-row time.upd').first().waitFor();
  await settle(page);
  const upd = page.locator(`.proj-row[data-project="${String(busy.id)}"] time.upd`);
  const info = await upd.evaluate((el) => ({ text: el.textContent, title: el.getAttribute('title'), dt: el.getAttribute('datetime') }));
  const apiBusy = await api('GET', `/projects/${String(busy.id)}`);
  step('3. 最後更新時間：相對時間（N 小時前），title 是完整時間，datetime 是 API 的 last_activity_at', /^\d+ 小時前$/.test(info.text) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(info.title) && info.dt === apiBusy.last_activity_at, info);
  const emptyTime = await page.locator(`.proj-row[data-project="${String(empty.id)}"] time.upd`).textContent();
  step('3. 很久沒動的顯示「N 天前」', /^\d+ 天前$/.test(emptyTime), { emptyTime });
  await upd.hover();
  step('3. 滑鼠移到時間上：title 是完整時間', (await upd.getAttribute('title')) === info.title);
  step('2. /projects 沒有狀態標籤', (await statusLeftovers(page)).length === 0, { left: await statusLeftovers(page) });

  // 5. 新增 Project → 馬上出現在側欄
  await page.locator('[data-new-project]').first().click();
  const pd = page.getByRole('dialog', { name: '新增 Project' });
  await pd.waitFor();
  step('2. 新增 Project 對話框沒有狀態欄', (await pd.locator('select').count()) === 0);
  await pd.getByLabel('名稱（必填）').fill('剛建好的 Project');
  await pd.getByRole('button', { name: /^建立/ }).click();
  await page.waitForURL(/\/projects\/\d+$/);
  const fresh = Number(new URL(page.url()).pathname.split('/').pop());
  await side.locator(`.nl-nav-row[data-nav-project="${String(fresh)}"]`).waitFor({ timeout: 3000 });
  const s5 = await navOrder(page);
  step('5. 新增 Project：不重新整理就出現在側欄最上面', s5[0] === fresh, { s5, fresh });

  // 6. 釘選的排在最前面（釘最舊的那個）
  await side.locator(`.nl-nav-row[data-nav-project="${String(empty.id)}"]`).hover();
  await side.locator(`.nl-nav-row[data-nav-project="${String(empty.id)}"] .pin-btn`).click();
  await settle(page);
  const s6 = await navOrder(page);
  step('6. 釘選最舊的 Project：排到側欄最前面，API 有 pinned_at', s6[0] === empty.id && (await api('GET', `/projects/${String(empty.id)}`)).pinned_at !== null, { s6 });

  // 7. 再加 4 個 → 共 9 個，側欄只列 7 個
  for (let k = 1; k <= 4; k++) await api('POST', '/projects', { name: `第 ${String(k)} 個加的 Project`, created_at: H(20 + k), updated_at: H(20 + k) });
  const all = await apiOrder();
  await page.reload();
  await side.locator('.nl-nav-row').first().waitFor();
  await settle(page);
  const s7 = await navOrder(page);
  step('7. 有 9 個 Project：側欄只列 7 個，順序跟 API 一致（釘選的在前，其餘照最後更新）', all.length === 9 && s7.length === 7 && JSON.stringify(s7) === JSON.stringify(all.slice(0, 7)) && s7[0] === empty.id, { s7, all });
  step('7. 第 8、9 個不在側欄，「全部 Project」還在', all.slice(7).every((id) => !s7.includes(id)) && (await side.getByRole('link', { name: '全部 Project' }).count()) === 1);
  await side.screenshot({ path: join(outDir, 'sidebar-1280-light-limit7.png') });
  step('1280 淺色沒有頁面錯誤', pageErrors.length === 0, { pageErrors });
  await ctx.close();

  // ===== 截圖：/projects 1280／375 × 淺色／深色、側欄、手機「更多」 =====
  for (const scheme of ['light', 'dark']) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: scheme });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => { errs.push(String(e)); });
    await p.goto(`${BASE}/projects`);
    await p.locator('.proj-row time.upd').first().waitFor();
    await p.locator('.nl-sidebar .nl-nav-row').first().waitFor();
    await settle(p);
    const ov = await overflow(p);
    step(`8. /projects 1280 ${scheme}：沒有橫向捲動、沒有狀態標籤`, ov.docScroll <= ov.vw && (await statusLeftovers(p)).length === 0, ov);
    await p.screenshot({ path: join(outDir, `projects-1280-${scheme}.png`) });
    await p.locator('.nl-sidebar').screenshot({ path: join(outDir, `sidebar-1280-${scheme}.png`) });
    step(`1280 ${scheme} 沒有頁面錯誤`, errs.length === 0, { errs });
    await c.close();

    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const mErrors = [];
    mp.on('pageerror', (e) => { mErrors.push(String(e)); });
    await mp.goto(`${BASE}/projects`);
    await mp.locator('.proj-row time.upd').first().waitFor();
    await settle(mp);
    const mv = await overflow(mp);
    step(`8. /projects 375 ${scheme}：沒有橫向溢出、時間看得到、沒有狀態標籤`, mv.count === 0 && mv.docScroll <= mv.vw && (await mp.locator('.proj-row time.upd').first().isVisible()) && (await statusLeftovers(mp)).length === 0, mv);
    await mp.screenshot({ path: join(outDir, `projects-375-${scheme}.png`) });
    await mp.getByRole('button', { name: '更多' }).tap();
    const sheet = mp.locator('.nl-sheet');
    await sheet.locator('.nl-nav-row').first().waitFor();
    await settle(mp);
    const sm = await navOrder(mp, '.nl-sheet');
    step(`7. 375 ${scheme}「更多」：也只列 7 個，順序跟側欄一樣`, JSON.stringify(sm) === JSON.stringify(all.slice(0, 7)), { sm });
    await mp.screenshot({ path: join(outDir, `more-375-${scheme}.png`) });
    step(`375 ${scheme} 沒有頁面錯誤`, mErrors.length === 0, { mErrors });
    await m.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(join(outDir, 'e2e-result.json'), `${JSON.stringify({ ok: failed === 0, base: BASE, persist, failed, results }, null, 2)}\n`);
  console.log(`\n${failed === 0 ? '全部通過' : `${String(failed)} 步失敗`}（${String(results.length)} 步），截圖在 ${outDir}`);
  if (failed > 0) process.exitCode = 1;
} catch (e) {
  writeFileSync(join(outDir, 'e2e-result.json'), `${JSON.stringify({ ok: false, error: String(e?.stack ?? e), results }, null, 2)}\n`);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    // 已經結束
  }
}
