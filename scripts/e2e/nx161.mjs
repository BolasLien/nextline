// NX-161：第二次試用回饋的端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，
// 用 Playwright 在瀏覽器實際操作：
//   1. 開票對話框（桌面與手機全螢幕）：畫面由上到下是 標題 → 描述（編輯／預覽切換在描述的標題列）→ 欄位晶片；Tab 的 focus 順序一樣
//   2. 手機 375：下一步、描述、comment 含長路徑與網址的待驗收票，整頁沒有任何元素橫向溢出（量 scrollWidth 與右邊界）；看板、列表也一樣
//   3. 待驗收的票：頂端顯示下一步（NX-161 時是「等你驗收」＋通過／退回，NX-239 起改成「等你回覆」、沒有通過／退回），沒有另外的「下一步」區塊；進行中的票照舊有「下一步」區塊
// 用法（repo 根目錄）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8796] node scripts/e2e/nx161.mjs
//   E2E_LABEL=before：只截圖、失敗的步驟照記不中斷（修改前對照用），截圖檔名以 before- 開頭
// 輸出：.scratch/screenshots/nx161/*.png、.scratch/screenshots/nx161/e2e-result-<label>.json。本機 D1 在 .scratch/e2e-nx161/<時間>/。

/* global document, getComputedStyle -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.env.E2E_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LABEL = process.env.E2E_LABEL ?? 'after';
const strict = LABEL !== 'before';
const outDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), '.scratch/screenshots/nx161');
const persist = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), '.scratch/e2e-nx161', `${LABEL}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8796);
const BASE = `http://localhost:${String(PORT)}`;

const results = [];
function step(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok && strict) throw new Error(`步驟失敗：${name}`);
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

const LONG_PATH = '~/Documents/github/nextline/docs/design/system/overview.html';
const LONG_URL = 'https://nextline.example.com/issues/NX-161?peek=NX-161&tab=history&from=board-column-in-review-very-long-query';
const NEXT = `Bolas 打開 ${LONG_PATH} 對照 ${LONG_URL} 驗收`;

async function seed() {
  const project = await api('POST', '/projects', { name: 'Nextline 第二版：可商用' });
  const mk = (title, status, extra = {}) => api('POST', '/issues', { title, status, project_id: project.id, ...extra });
  const say = (issue, author, body) => api('POST', `/issues/${issue.identifier}/comments`, { author, body });
  const desc = [
    '## 驗收',
    `原型在 \`${LONG_PATH}\`，正式站 ${LONG_URL}`,
    '',
    `- 截圖：.scratch/screenshots/nx161/after-mobile-review-light-and-dark-comparison-with-a-very-long-file-name.png`,
  ].join('\n');
  const review = await mk('17 第二次試用回饋：開票欄位順序、手機待驗收爆版', 'In Review', { description: desc });
  await say(review, 'claude-nextline', `做好了，證據在 \`${LONG_PATH}\` 與 ${LONG_URL}\n下一步：${NEXT}`);
  const progress = await mk('手機待驗收爆版（進行中對照）', 'In Progress', { description: desc });
  await say(progress, 'claude-nextline', `做到一半。\n下一步：claude-nextline 接著改 ${LONG_PATH}`);
  await mk('一般的 Todo 票', 'Todo');
  return { project, review, progress };
}

// ---- 瀏覽器 ----

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function shot(page, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, `${LABEL}-${name}.png`) });
}

// 畫面上每個看得到的元素：右邊界不超過視窗、內容不比自己寬（scrollWidth ≤ clientWidth）。
// 本來就設計成可以橫向捲動的（程式碼區塊 pre、表格）只檢查它自己不超出視窗；只給螢幕報讀器的 .vh 不算。
async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.vh, [inert], [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      if (r.right > vw + 1) bad.push({ el: name(el), why: 'right', right: Math.round(r.right), vw });
      if (el.closest('pre, .table-wrap') !== null) continue;
      if (cs.textOverflow === 'ellipsis') continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) bad.push({ el: name(el), why: 'scrollWidth', scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    return { vw, docScroll: document.documentElement.scrollWidth, bad: bad.slice(0, 15), count: bad.length };
  });
}

// 開票對話框：標題、描述、欄位晶片三者由上到下的位置，與 Tab 的 focus 順序
async function createOrder(page, dialog) {
  const top = (sel) => dialog.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top);
  const bottom = (sel) => dialog.locator(sel).first().evaluate((el) => el.getBoundingClientRect().bottom);
  const y = {
    title: await top('.create-title'),
    descTabs: await top('.md-tabs'),
    desc: await top('textarea'),
    chips: await top('.chips'),
    titleBottom: await bottom('.create-title'),
    descBottom: await bottom('.md-editor'),
  };
  // 編輯／預覽切換不在晶片那一列：跟晶片列沒有上下重疊
  const chipsBox = await dialog.locator('.chips').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const tabsBox = await dialog.locator('.md-tabs').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const tabsApart = tabsBox.bottom <= chipsBox.top || tabsBox.top >= chipsBox.bottom;

  // Tab 順序：從標題開始按 Tab，記錄每個 focus 屬於哪一區
  await dialog.locator('.create-title').focus();
  const regions = [];
  for (let i = 0; i < 24; i++) {
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      if (a === null) return 'none';
      if (a.classList.contains('create-title')) return 'title';
      if (a.closest('.md-editor') !== null) return 'desc';
      if (a.closest('.chips') !== null) return 'chips';
      if (a.closest('.ft') !== null) return 'footer';
      if (a.closest('.hd') !== null) return 'close';
      return `other:${a.tagName}`;
    });
    regions.push(r);
    // 繞一圈回到標題就停（到期日的日期欄位會分成年／月／日好幾個 Tab 停點，所以次數抓寬）
    if (i > 0 && r === 'title') break;
    await page.keyboard.press('Tab');
  }
  // 連續相同的合併成一段
  const seq = regions.filter((r, i) => i === 0 || regions[i - 1] !== r);
  return { y, tabsApart, seq };
}

let browser;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const d = await seed();
  const reviewRef = d.review.identifier;
  const progressRef = d.progress.identifier;
  const wantSeq = ['title', 'desc', 'chips', 'footer', 'close', 'title'];

  // ===== 1. 桌面 1280：開票對話框順序、預覽的下一步區塊 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); });

  await page.goto(`${BASE}/`);
  await page.locator('.nl-card').first().waitFor();
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: '建立票' });
  await dialog.waitFor();
  await dialog.locator('.create-title').fill('長路徑測試');
  await settle(page);
  await shot(page, 'create-1280-light');
  const o1 = await createOrder(page, dialog);
  step('1. 桌面開票：畫面由上到下是 標題 → 描述 → 欄位晶片', o1.y.title < o1.y.desc && o1.y.desc < o1.y.chips && o1.y.descBottom <= o1.y.chips, o1.y);
  step('1. 桌面開票：編輯／預覽切換在描述框上方、標題下方，不跟晶片同一排', o1.y.descTabs >= o1.y.titleBottom && o1.y.descTabs < o1.y.desc && o1.tabsApart, { tabs: o1.y.descTabs, apart: o1.tabsApart });
  step('1. 桌面開票：Tab 順序是 標題 → 描述 → 晶片 → 底列 → 關閉鈕 → 回到標題', JSON.stringify(o1.seq) === JSON.stringify(wantSeq), { seq: o1.seq });
  await page.keyboard.press('Escape');
  const discard = dialog.getByRole('button', { name: '捨棄' });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await dialog.waitFor({ state: 'detached' });

  // 預覽待驗收的票：頂端驗收列有下一步，沒有另外的「下一步」區塊
  await page.goto(`${BASE}/?peek=${reviewRef}`);
  const peek = page.locator('.nl-peek');
  await peek.locator('.ttl-edit').waitFor();
  await settle(page);
  await shot(page, 'review-peek-1280-light');
  const reviewText = (await peek.locator('.nl-review').textContent()) ?? '';
  step('3. 桌面預覽待驗收：「等你回覆」顯示下一步（NX-239 起沒有通過／退回）', reviewText.includes(LONG_PATH) && (await peek.locator('.nl-review').getByRole('button', { name: /通過/ }).count()) === 0);
  step('3. 桌面預覽待驗收：沒有獨立的「下一步」區塊', (await peek.locator('.next-step').count()) === 0, { nextStep: await peek.locator('.next-step').count() });
  await page.goto(`${BASE}/?peek=${progressRef}`);
  await peek.locator('.ttl-edit').waitFor();
  await settle(page);
  step('3. 桌面預覽進行中：有「下一步」區塊、沒有驗收列', (await peek.locator('.next-step').count()) === 1 && (await peek.locator('.nl-review').count()) === 0);
  step('桌面沒有頁面錯誤', pageErrors.length === 0, { pageErrors });
  await ctx.close();

  // ===== 2. 手機 375：淺色／深色 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const mErrors = [];
    mp.on('pageerror', (e) => { mErrors.push(String(e)); });

    // 待驗收整頁
    await mp.goto(`${BASE}/issues/${reviewRef}`);
    await mp.locator('.ttl-edit').waitFor();
    await settle(mp);
    await shot(mp, `review-375-${scheme}`);
    const ov = await overflow(mp);
    step(`2. 375 ${scheme}：待驗收整頁沒有元素橫向溢出`, ov.count === 0 && ov.docScroll <= ov.vw, ov);
    // 往下捲到 comment 再截一張（長路徑在 comment 與描述裡）
    await mp.locator('.comments').scrollIntoViewIfNeeded();
    await shot(mp, `review-375-${scheme}-comments`);
    step(`3. 375 ${scheme}：待驗收沒有獨立的「下一步」區塊，「等你驗收」有下一步`, (await mp.locator('.next-step').count()) === 0 && ((await mp.locator('.nl-review').textContent()) ?? '').includes(LONG_PATH));
    step(`3. 375 ${scheme}：沒有手機底部固定的通過／退回（NX-239）`, (await mp.locator('.m-review-bar').count()) === 0);

    // 進行中整頁
    await mp.goto(`${BASE}/issues/${progressRef}`);
    await mp.locator('.ttl-edit').waitFor();
    await settle(mp);
    await shot(mp, `progress-375-${scheme}`);
    const ov2 = await overflow(mp);
    step(`2. 375 ${scheme}：進行中整頁沒有元素橫向溢出`, ov2.count === 0, ov2);
    step(`3. 375 ${scheme}：進行中有「下一步」區塊`, (await mp.locator('.next-step').count()) === 1);

    // 看板（待驗收那欄的卡片有長下一步）與列表
    await mp.goto(`${BASE}/`);
    await mp.locator('.nl-card').first().waitFor();
    await settle(mp);
    const ov3 = await overflow(mp);
    await shot(mp, `board-375-${scheme}`);
    step(`2. 375 ${scheme}：看板沒有元素橫向溢出`, ov3.count === 0, ov3);
    await mp.goto(`${BASE}/issues`);
    await mp.locator('.nl-row').first().waitFor();
    await settle(mp);
    const ov4 = await overflow(mp);
    await shot(mp, `issues-375-${scheme}`);
    step(`2. 375 ${scheme}：全部的票沒有元素橫向溢出`, ov4.count === 0, ov4);

    // 手機全螢幕開票
    await mp.goto(`${BASE}/`);
    await mp.locator('.nl-card').first().waitFor();
    await mp.locator('.nl-fab').tap();
    const md = mp.getByRole('dialog', { name: '建立票' });
    await md.waitFor();
    await settle(mp);
    await shot(mp, `create-375-${scheme}`);
    const o2 = await createOrder(mp, md);
    step(`1. 375 ${scheme}：全螢幕開票由上到下是 標題 → 描述 → 欄位晶片`, o2.y.title < o2.y.desc && o2.y.desc < o2.y.chips && o2.y.descBottom <= o2.y.chips, o2.y);
    step(`1. 375 ${scheme}：編輯／預覽切換不跟晶片同一排`, o2.tabsApart && o2.y.descTabs >= o2.y.titleBottom);
    step(`1. 375 ${scheme}：Tab 順序是 標題 → 描述 → 晶片 → 底列 → 關閉鈕 → 回到標題`, JSON.stringify(o2.seq) === JSON.stringify(wantSeq), { seq: o2.seq });
    step(`375 ${scheme} 沒有頁面錯誤`, mErrors.length === 0, { mErrors });
    await m.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(join(outDir, `e2e-result-${LABEL}.json`), `${JSON.stringify({ ok: failed === 0, label: LABEL, base: BASE, persist, failed, results }, null, 2)}\n`);
  console.log(`\n${failed === 0 ? '全部通過' : `${String(failed)} 步失敗`}（${String(results.length)} 步），截圖在 ${outDir}`);
  if (failed > 0 && strict) process.exitCode = 1;
} catch (e) {
  writeFileSync(join(outDir, `e2e-result-${LABEL}.json`), `${JSON.stringify({ ok: false, label: LABEL, error: String(e?.stack ?? e), results }, null, 2)}\n`);
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
