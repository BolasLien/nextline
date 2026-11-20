// NX-162：側欄 Project 依最近更新排序、可釘選在最上方的端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，
// 用 Playwright 在瀏覽器實際操作（不重新整理，看側欄自己跟著變）：
//   1. 一開始照最近有更新排
//   2. 預覽改某個 Project 底下的票（標題）→ 它移到側欄最上面
//   3. 對另一個 Project 的票寫 comment → 它移到最上面
//   4. hover 才出現圖釘；釘選一個最舊的 → 固定在最上方；再改其他 Project 的票，它還是在最上方；API 有 pinned_at
//   5. 重新整理後釘選還在；/projects 的順序跟側欄一致、也有釘選按鈕
//   6. API 失敗（攔截回 500）→ 畫面退回、跳 toast
//   7. 取消釘選 → 回到照時間排
//   8. 手機 375：「更多」裡按圖釘釘選、Project 頁頁首按圖釘；沒有橫向溢出
// 用法（repo 根目錄）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8797] node scripts/e2e/nx162.mjs
// 輸出：.scratch/screenshots/nx162/*.png、.scratch/screenshots/nx162/e2e-result.json。本機 D1 在 .scratch/e2e-nx162/<時間>/。

/* global document, getComputedStyle -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/nx162');
const persist = join(repo, '.scratch/e2e-nx162', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8797);
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

const DAY = (d) => `2026-10-${String(d).padStart(2, '0')}T08:00:00.000Z`;

// 四個進行中的 Project，時間由舊到新：舊 → A → B → C；每個底下一張票（時間跟 Project 一樣）。（NX-165 拿掉 Project 狀態後，原本「已完成」的那個 Project 不需要了。）
async function seed() {
  const names = { old: '舊的 Project', a: 'A 專案', b: 'B 專案', c: 'C 專案' };
  const out = {};
  let day = 1;
  for (const [key, name] of Object.entries(names)) {
    const p = await api('POST', '/projects', { name, created_at: DAY(day), updated_at: DAY(day) });
    const issue = await api('POST', '/issues', { title: `${name}的票`, status: 'Todo', project_id: p.id, created_at: DAY(day), updated_at: DAY(day) });
    out[key] = { ...p, issue };
    day++;
  }
  return out;
}

// ---- 瀏覽器 ----

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
}

async function shot(page, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

// 側欄（或「更多」sheet）Project 列的 id 順序
async function navOrder(page, scope = '.nl-sidebar') {
  return page.locator(`${scope} .nl-nav-row`).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-nav-project'))));
}

async function waitOrder(page, want, scope = '.nl-sidebar', timeout = 5000) {
  const end = Date.now() + timeout;
  let got = [];
  while (Date.now() < end) {
    got = await navOrder(page, scope);
    if (JSON.stringify(got.slice(0, want.length)) === JSON.stringify(want)) return got;
    await page.waitForTimeout(100);
  }
  return got;
}

async function apiOrder() {
  return (await api('GET', '/projects')).projects.map((p) => p.id);
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

const opacity = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).opacity));

let browser;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const d = await seed();
  const { old, a, b, c } = d;

  // ===== 桌面 1280 淺色 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); });
  const side = page.locator('.nl-sidebar');
  const row = (p) => side.locator(`.nl-nav-row[data-nav-project="${String(p.id)}"]`);

  await page.goto(`${BASE}/`);
  await page.locator('.nl-card').first().waitFor();
  await side.locator('.nl-nav-row').first().waitFor();
  await settle(page);
  const o0 = await navOrder(page);
  step('1. 一開始照最近有更新排（C → B → A → 舊）', JSON.stringify(o0) === JSON.stringify([c.id, b.id, a.id, old.id]), { o0 });

  // 2. 在預覽改 A 的票標題（不重新整理）
  await page.locator('.nl-card', { hasText: a.issue.title }).click();
  const peek = page.locator('.nl-peek');
  await peek.locator('.ttl-edit').waitFor();
  await peek.locator('.ttl-edit').click();
  await peek.locator('.nl-title-input').fill('A 專案的票（改過標題）');
  await page.keyboard.press('Enter');
  const o1 = await waitOrder(page, [a.id]);
  step('2. 改了 A 底下的票 → A 移到側欄最上面（沒重新整理）', o1[0] === a.id, { o1, api: await apiOrder() });
  step('2. API 的順序也是 A 在最上面，last_activity_at 是票的更新時間', (await apiOrder())[0] === a.id);

  // 3. 對「舊的 Project」的票寫 comment（從看板點卡片開預覽）
  await page.keyboard.press('Escape');
  await page.locator('.nl-card', { hasText: old.issue.title }).click();
  await peek.locator('.ttl-edit').waitFor();
  await peek.getByRole('textbox', { name: '寫 comment（Markdown）' }).fill('有新進度。\n下一步：Bolas 看一下');
  await page.keyboard.press('ControlOrMeta+Enter');
  await peek.locator('.cmt').first().waitFor();
  const o2 = await waitOrder(page, [old.id]);
  step('3. 對「舊的 Project」的票寫 comment → 它移到最上面（票本身沒改）', o2[0] === old.id, { o2 });
  const oldIssue = await api('GET', `/issues/${old.issue.identifier}`);
  const oldProj = await api('GET', `/projects/${String(old.id)}`);
  step('3. API：票的 updated_at 沒變，Project 的 last_activity_at 是 comment 時間', oldIssue.updated_at === DAY(1) && oldProj.last_activity_at > DAY(28), { last: oldProj.last_activity_at });
  // 關預覽（焦點在 comment 輸入框，Esc 只會離開輸入框）：點側欄「看板」，不重新整理
  await side.getByRole('link', { name: '看板' }).click();
  await peek.waitFor({ state: 'detached' });

  // 4. hover 才出現圖釘；釘選目前最舊的 B
  await page.mouse.move(700, 400);
  await settle(page);
  const hidden = await opacity(row(b).locator('.pin-btn'));
  await row(b).hover();
  await page.waitForTimeout(200);
  const shown = await opacity(row(b).locator('.pin-btn'));
  step('4. 沒 hover 時圖釘不顯示，hover 時出現', hidden === 0 && shown === 1, { hidden, shown });
  await shot(page, 'sidebar-hover-1280-light');
  const bLast = (await navOrder(page)).at(-1);
  step('4. 釘選前 B 是最舊的（排最後）', bLast === b.id);
  await row(b).locator('.pin-btn').click();
  const o3 = await waitOrder(page, [b.id], '.nl-sidebar', 300);
  step('4. 按下圖釘 → B 立刻到最上面（樂觀更新）', o3[0] === b.id, { o3 });
  await settle(page);
  const bApi = await api('GET', `/projects/${String(b.id)}`);
  step('4. API：B 有 pinned_at，updated_at 沒變（釘選不算更新）', bApi.pinned_at !== null && bApi.updated_at === DAY(3), { pinned_at: bApi.pinned_at });
  await page.mouse.move(700, 400);
  await page.waitForTimeout(200);
  step('4. 已釘選的圖釘不用 hover 也一直顯示', (await opacity(row(b).locator('.pin-btn'))) === 1 && (await row(b).locator('.pin-btn').getAttribute('aria-pressed')) === 'true');

  // 改 C 的票 → C 上去但排在 B 下面
  await page.locator('.nl-card', { hasText: c.issue.title }).click();
  await peek.locator('.ttl-edit').waitFor();
  await peek.locator('.ttl-edit').click();
  await peek.locator('.nl-title-input').fill('C 專案的票（改過標題）');
  await page.keyboard.press('Enter');
  const o4 = await waitOrder(page, [b.id, c.id]);
  step('4. 改其他 Project（C）的票：C 上來，但 B（釘選）還在最上方', o4[0] === b.id && o4[1] === c.id, { o4 });
  await page.keyboard.press('Escape');
  await page.mouse.move(700, 400);
  await settle(page);
  await row(a).hover();
  await page.waitForTimeout(200);
  await shot(page, 'sidebar-pinned-1280-light');

  // 5. 重新整理後還在
  await page.reload();
  await side.locator('.nl-nav-row').first().waitFor();
  await settle(page);
  const o5 = await navOrder(page);
  step('5. 重新整理後 B 還是釘選在最上方', o5[0] === b.id && (await row(b).locator('.pin-btn').getAttribute('aria-pressed')) === 'true', { o5 });
  step('5. 側欄順序跟 API 一致', JSON.stringify(o5) === JSON.stringify(await apiOrder()));

  // /projects：順序跟側欄一致、有釘選按鈕
  await side.getByRole('link', { name: '全部 Project' }).click();
  await page.locator('.proj-list').waitFor();
  await settle(page);
  const listOrder = await page.locator('.proj-row').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-project'))));
  step('5. /projects 順序跟側欄一致', JSON.stringify(listOrder) === JSON.stringify(o5), { listOrder });
  await page.locator(`.proj-li:has([data-project="${String(old.id)}"]) .pin-btn`).click();
  const o6 = await waitOrder(page, [old.id, b.id]);
  step('5. /projects 按圖釘釘選「舊的 Project」→ 側欄它在最上（較晚釘的在前），B 第二', o6[0] === old.id && o6[1] === b.id, { o6 });
  const lo2 = await page.locator('.proj-row').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-project'))));
  step('5. /projects 的列也跟著重排', lo2[0] === old.id && lo2[1] === b.id, { lo2 });
  await shot(page, 'projects-1280-light');
  // 取消「舊的」釘選，回到只有 B 釘選
  await page.locator(`.proj-li:has([data-project="${String(old.id)}"]) .pin-btn`).click();
  await waitOrder(page, [b.id]);
  await settle(page);

  // 6. API 失敗 → 退回、toast
  await page.route('**/app-api/projects/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"測試用的錯誤"}' }) : route.continue()));
  const before6 = await navOrder(page);
  await row(a).hover();
  await row(a).locator('.pin-btn').click();
  await page.locator('.nl-toast--error').first().waitFor({ timeout: 5000 });
  const after6 = await waitOrder(page, before6);
  step('6. 釘選 API 失敗：側欄退回原本順序、跳錯誤 toast', JSON.stringify(after6) === JSON.stringify(before6) && ((await page.locator('.nl-toast--error').first().textContent()) ?? '').includes('釘選失敗'), { before6, after6 });
  await page.unroute('**/app-api/projects/*');
  step('6. API 裡 A 沒有被釘選', (await api('GET', `/projects/${String(a.id)}`)).pinned_at === null);

  // 7. 取消釘選 B → 回到照時間排
  await row(b).locator('.pin-btn').click();
  await settle(page);
  const o7 = await navOrder(page);
  // NX-165：Project 沒有狀態，不再用 ?status=started 篩
  const listed7 = (await api('GET', '/projects')).projects;
  const want7 = listed7.map((p) => p.id);
  const times = listed7.map((p) => p.last_activity_at);
  step('7. 取消釘選 B → 照時間排（B 回到最後），跟 API 一致', o7.at(-1) === b.id && JSON.stringify(o7) === JSON.stringify(want7) && times.every((t, i) => i === 0 || times[i - 1] >= t), { o7 });
  step('7. API：B 的 pinned_at 清掉', (await api('GET', `/projects/${String(b.id)}`)).pinned_at === null);
  step('桌面淺色沒有頁面錯誤', pageErrors.length === 0, { pageErrors });
  await ctx.close();

  // ===== 桌面 1280 深色：截圖（hover、已釘選） =====
  await api('PATCH', `/projects/${String(b.id)}`, { pinned: true });
  {
    const dc = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
    const dp = await dc.newPage();
    await dp.goto(`${BASE}/`);
    await dp.locator('.nl-sidebar .nl-nav-row').first().waitFor();
    await settle(dp);
    await dp.locator(`.nl-sidebar .nl-nav-row[data-nav-project="${String(a.id)}"]`).hover();
    await dp.waitForTimeout(200);
    await shot(dp, 'sidebar-hover-pinned-1280-dark');
    await dp.goto(`${BASE}/projects`);
    await dp.locator('.proj-list').waitFor();
    await settle(dp);
    await shot(dp, 'projects-1280-dark');
    await dc.close();
  }
  await api('PATCH', `/projects/${String(b.id)}`, { pinned: false });

  // ===== 手機 375：「更多」釘選、Project 頁頁首釘選 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const mErrors = [];
    mp.on('pageerror', (e) => { mErrors.push(String(e)); });
    await mp.goto(`${BASE}/`);
    await mp.locator('.nl-card').first().waitFor();
    await mp.getByRole('button', { name: '更多' }).tap();
    const sheet = mp.locator('.nl-sheet');
    await sheet.locator('.nl-nav-row').first().waitFor();
    await settle(mp);
    const target = (await navOrder(mp, '.nl-sheet')).at(-1);
    const pin = sheet.locator(`.nl-nav-row[data-nav-project="${String(target)}"] .pin-btn`);
    step(`8. 375 ${scheme}：「更多」裡每列的圖釘不用 hover 就看得到`, (await opacity(pin)) === 1);
    await pin.tap();
    const so = await waitOrder(mp, [target], '.nl-sheet');
    await settle(mp);
    step(`8. 375 ${scheme}：「更多」按圖釘釘選最舊的 → 立刻到最上面，API 有 pinned_at`, so[0] === target && (await api('GET', `/projects/${String(target)}`)).pinned_at !== null, { so });
    const ov = await overflow(mp);
    step(`8. 375 ${scheme}：「更多」沒有橫向溢出`, ov.count === 0 && ov.docScroll <= ov.vw, ov);
    await shot(mp, `more-375-${scheme}`);
    await pin.tap();
    await settle(mp);
    step(`8. 375 ${scheme}：再按一次取消釘選`, (await api('GET', `/projects/${String(target)}`)).pinned_at === null);
    await mp.keyboard.press('Escape');

    // Project 頁頁首
    await mp.goto(`${BASE}/projects/${String(a.id)}`);
    const headPin = mp.locator('.proj-head .pin-btn');
    await headPin.waitFor();
    await headPin.tap();
    await settle(mp);
    step(`8. 375 ${scheme}：Project 頁頁首按圖釘釘選，API 有 pinned_at`, (await headPin.getAttribute('aria-pressed')) === 'true' && (await api('GET', `/projects/${String(a.id)}`)).pinned_at !== null);
    const ov2 = await overflow(mp);
    step(`8. 375 ${scheme}：Project 頁沒有橫向溢出`, ov2.count === 0 && ov2.docScroll <= ov2.vw, ov2);
    await shot(mp, `project-page-375-${scheme}`);
    await headPin.tap();
    await settle(mp);
    step(`8. 375 ${scheme}：Project 頁再按一次取消釘選`, (await api('GET', `/projects/${String(a.id)}`)).pinned_at === null);
    step(`375 ${scheme} 沒有頁面錯誤`, mErrors.length === 0, { mErrors });
    await m.close();
  }

  // 1280 寬沒有橫向捲動（淺色）
  {
    const lc = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
    const lp = await lc.newPage();
    await lp.goto(`${BASE}/`);
    await lp.locator('.nl-sidebar .nl-nav-row').first().waitFor();
    await settle(lp);
    const ov = await overflow(lp);
    step('1280：看板＋側欄沒有橫向捲動', ov.docScroll <= ov.vw, ov);
    await lc.close();
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
