// NX-155：票詳細（右側預覽面板與整頁）的端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1），
// 用一份獨立的本機 D1 灌測試資料，再用 Playwright 在瀏覽器裡實際操作：
//   桌面：從看板開預覽 → 改標題（Esc 取消、Enter 儲存）→ 改狀態（看板跟著換欄）→ 寫 comment（下一步跟著變）
//         → 描述 Markdown 預覽（防 XSS）→ Project／到期日（沒有 Sprint 欄位，NX-160）→ blocked by 加入與移除
//         → 還原一筆變更紀錄（標「已還原」）→ 還原遇到 409（toast 說原因）→ 寫入失敗退回
//         → 待驗收只有「等你回覆」（沒有通過／退回，NX-239）→ 回覆後交回 agent 並可復原 → 展開成整頁。
//   手機（375）：點卡片直接進整頁，回覆框在第一屏、沒有底部通過／退回；?peek 轉成整頁。
// 每一步都對照 /app-api 的資料，截圖 1280（預覽面板、整頁）／375 × 淺色／深色，量測沒有橫向捲動。
//
// 用法（repo 根目錄，.dev.vars 要有 DEV_SKIP_ACCESS=1）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8789] node scripts/e2e/detail.mjs
// 輸出：.scratch/screenshots/detail/*.png、.scratch/screenshots/detail/e2e-result.json。
// 本機 D1 放在 .scratch/e2e-detail/<時間>/（每次新的一份，不碰 .wrangler/state 的開發資料）。

/* global document, window, getComputedStyle -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/detail');
const persist = join(repo, '.scratch/e2e-detail', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8789);
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

// ---- 測試資料 ----

async function seed() {
  const now = Date.now();
  const sprint = await api('POST', '/sprints', { number: 1, starts_at: new Date(now - 2 * DAY).toISOString(), ends_at: new Date(now + 12 * DAY).toISOString() });
  const nextline = await api('POST', '/projects', { name: 'Nextline 第二版' });
  const gem = await api('POST', '/projects', { name: 'Gem TD' });
  const mk = (title, status, project, extra = {}) => api('POST', '/issues', { title, status, project_id: project?.id ?? null, sprint_id: sprint.id, ...extra });
  const t2 = await mk('看板卡片加上到期日圖示', 'Todo', nextline);
  const t1 = await mk('整理第二版的驗收清單，給 Bolas 一次看完', 'Todo', nextline, {
    description: '## 目標\n\nBolas 一次看完第二版要驗收的東西。\n\n- [x] 看板\n- [ ] 票詳細\n\n參考 `docs/design/ia/flows.md`。',
    legacy_identifier: 'BOL-301',
  });
  const p1 = await mk('列表頁：篩選與存成 view', 'In Progress', nextline);
  const r2 = await mk('設計系統：深色模式對比修正', 'In Review', nextline);
  const r1 = await mk('前端骨架：toast 與復原', 'In Review', nextline);
  const say = (issue, author, body) => api('POST', `/issues/${issue.identifier}/comments`, { author, body });
  await say(r1, 'claude-nextline', 'toast 都做好了，截圖在 .scratch。\n下一步：Bolas 驗收 toast 的復原');
  await say(r2, 'claude-nextline', '對比都過了。\n\n| 畫面 | 結果 |\n| --- | --- |\n| 看板 | 通過 |\n\n下一步：Bolas 驗收深色模式截圖');
  await say(p1, '阿澈', '篩選列做好一半');
  await api('POST', `/issues/${r2.identifier}/blockers`, { blocked_by: p1.identifier, actor: '阿澈' });
  return { sprint, nextline, gem, t1, t2, p1, r1, r2 };
}

// ---- 瀏覽器 ----

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const peek = document.querySelector('.nl-peek');
    return {
      viewport: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageHorizontalScroll: doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > doc.clientWidth,
      peekScrollWidth: peek?.scrollWidth ?? null,
      peekClientWidth: peek?.clientWidth ?? null,
      peekHorizontalScroll: peek === null ? false : peek.scrollWidth > peek.clientWidth,
      viewHorizontalScroll: [...document.querySelectorAll('.view:not(.board-view)')].some((v) => v.scrollWidth > v.clientWidth),
    };
  });
}

async function poll(fn, check, label) {
  let last;
  for (let i = 0; i < 50; i++) {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等不到：${label}（最後的值：${JSON.stringify(last)?.slice(0, 300)}）`);
}

const issueOf = (ref) => api('GET', `/issues/${ref}`);
const waitIssue = (ref, check, label) => poll(() => issueOf(ref), check, label);

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
}

// 欄位選單：先把按鈕捲進畫面、等捲動事件過去再點。選單遇到外面捲動會自己關（跟 Menu.tsx 一樣），
// Playwright 點之前自動捲動的 scroll 事件會在下一個 frame 才送，剛打開的選單會被它關掉。
async function openField(page, scope, name) {
  const btn = scope.getByRole('button', { name: new RegExp(`^${name}：`) });
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await btn.click();
  await page.getByRole('menu').waitFor();
}

async function dismissToasts(page) {
  for (const x of await page.locator('.nl-toast .x').all()) await x.click().catch(() => {});
}

const measures = {};
let browser;

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const d = await seed();
  const n = (issue) => String(issue.number);

  // ===== 桌面 1280 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { consoleErrors.push(String(e)); });
  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  const peek = page.locator('.nl-peek');
  const card = (issue) => page.locator(`.nl-card[data-n="${n(issue)}"]`);
  const inCol = (issue, col) => page.locator(`section[data-col="${col}"] .nl-card[data-n="${n(issue)}"]`);

  // 1. 從看板開預覽
  await card(d.t1).locator('.hit').click();
  await page.waitForURL(`**/?peek=${d.t1.identifier}`);
  await peek.locator('.ttl-edit').waitFor();
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('ttl-edit') ?? false);
  step('從看板點卡片：右側預覽打開（?peek=NX-n），看板還在，焦點在標題', (await card(d.t1).count()) === 1 && focused && (await peek.locator('.ttl-edit').textContent()) === d.t1.title, { url: page.url() });
  const top = await peek.locator('.meta-row').textContent();
  step('預覽頂端：狀態、Project、票號、舊編號小字', top.includes('Todo') && top.includes('Nextline 第二版') && top.includes(d.t1.identifier) && (await peek.locator('.meta-row .legacy').textContent()) === 'BOL-301', { top });
  step('描述用 Markdown 顯示（標題、核取方塊、行內程式碼）', (await peek.locator('.desc .md h3').count()) === 1 && (await peek.locator('.desc .md code').count()) === 1 && (await peek.locator('.desc .md .task.done').count()) === 1);
  await settle(page);
  await page.screenshot({ path: join(outDir, 'peek-1280-light.png') });
  measures['peek-1280-light'] = await measure(page);

  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.search.includes('peek'));
  await peek.waitFor({ state: 'detached' });
  step('Esc 關閉預覽，焦點回到卡片', (await peek.count()) === 0 && (await page.evaluate((num) => document.activeElement?.closest('.nl-card')?.getAttribute('data-n') === num, n(d.t1))));
  await card(d.t1).locator('.hit').click();
  await peek.locator('.ttl-edit').waitFor();

  // 2. 改標題：Esc 取消、Enter 儲存
  await peek.locator('.ttl-edit').click();
  await peek.locator('.nl-title-input').fill('這段不該存進去');
  await page.keyboard.press('Escape');
  await settle(page);
  step('改標題：Esc 取消，不送出、預覽沒關', (await issueOf(d.t1.identifier)).title === d.t1.title && (await peek.locator('.ttl-edit').textContent()) === d.t1.title && (await peek.count()) === 1);
  const newTitle = '整理第二版驗收清單（網頁改的）';
  await peek.locator('.ttl-edit').click();
  await peek.locator('.nl-title-input').fill(newTitle);
  await page.keyboard.press('Enter');
  await waitIssue(d.t1.identifier, (i) => i.title === newTitle, '標題寫進 API');
  await settle(page);
  step('改標題：Enter 儲存，API、預覽、看板卡片都換成新標題', (await peek.locator('.ttl-edit').textContent()) === newTitle && (await card(d.t1).locator('.t').textContent()) === newTitle);
  step('改標題：toast 附「復原」', (await page.locator('.nl-toast', { hasText: '已更新標題' }).getByRole('button', { name: '復原' }).count()) === 1);
  await dismissToasts(page);

  // 3. 改狀態：看板馬上換欄
  await openField(page, peek, '狀態');
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  await inCol(d.t1, 'in-progress').waitFor({ timeout: 3000 });
  await waitIssue(d.t1.identifier, (i) => i.status === 'In Progress', '狀態寫進 API');
  await settle(page);
  step('改狀態：API 改成 In Progress，看板卡片馬上移到 In Progress 欄，預覽的徽章也變', (await inCol(d.t1, 'in-progress').count()) === 1 && (await peek.locator('.meta-row .nl-badge').textContent()) === 'In Progress');
  await dismissToasts(page);

  // 4. 寫 comment：Cmd/Ctrl+Enter 送出，最新的下一步跟著變
  await peek.getByRole('textbox', { name: '寫 comment（Markdown）' }).fill('驗收清單整理好一半。\n下一步：Bolas 看 **預覽** 有沒有漏');
  await page.keyboard.press('ControlOrMeta+Enter');
  const comments = await poll(() => api('GET', `/issues/${d.t1.identifier}/comments`), (r) => r.comments.length === 1, 'comment 寫進 API');
  await peek.locator('.cmt').first().waitFor();
  await peek.locator('.next-step').waitFor();
  await settle(page);
  step('寫 comment：API 多一則（作者「你」），時間軸出現，輸入框清空', comments.comments[0].author === '你' && (await peek.locator('.cmt').count()) === 1 && (await peek.getByRole('textbox', { name: '寫 comment（Markdown）' }).inputValue()) === '');
  step('寫 comment：comment 的 Markdown 有轉（粗體）、作者和時間用小字', (await peek.locator('.cmt .md strong').count()) === 1 && (await peek.locator('.cmt .who small').textContent()) === '剛剛');
  step('寫 comment：「最新的下一步」區塊和看板卡片都換成新的下一步', (await peek.locator('.next-step p').textContent()).includes('Bolas 看') && (await card(d.t1).locator('.next').textContent()).includes('Bolas 看'));

  // 5. 描述：編輯／預覽切換、防 XSS、Cmd/Ctrl+Enter 儲存
  await peek.locator('.desc').getByRole('button', { name: '編輯' }).click();
  const xss = '**粗體**\n\n<script>window.__xss = 1</script><img src=x onerror="window.__xss = 2">\n\n[壞連結](javascript:window.__xss=3)';
  await peek.getByRole('textbox', { name: '描述（Markdown）' }).fill(xss);
  await peek.locator('.desc').getByRole('tab', { name: '預覽' }).click();
  const preview = peek.locator('.desc .md-preview');
  await preview.locator('strong').waitFor();
  const dangerous = await preview.evaluate((el) => ({ script: el.querySelectorAll('script').length, img: el.querySelectorAll('img').length, jsLink: [...el.querySelectorAll('a')].filter((a) => a.getAttribute('href')?.startsWith('javascript')).length, text: el.textContent }));
  step('描述預覽：Markdown 有轉，<script>、<img onerror>、javascript: 連結都只當文字', dangerous.script === 0 && dangerous.img === 0 && dangerous.jsLink === 0 && dangerous.text.includes('<script>') && (await page.evaluate(() => window.__xss)) === undefined, dangerous);
  await page.keyboard.press('ControlOrMeta+Enter');
  await waitIssue(d.t1.identifier, (i) => i.description === xss, '描述寫進 API');
  await settle(page);
  step('描述：Cmd/Ctrl+Enter 儲存，API 存原文、畫面顯示轉好的 Markdown，仍然沒有執行任何腳本', (await peek.locator('.desc .md strong').count()) === 1 && (await page.evaluate(() => window.__xss)) === undefined);
  await peek.locator('.desc').getByRole('button', { name: '編輯' }).click();
  await peek.getByRole('textbox', { name: '描述（Markdown）' }).fill('不要存');
  await page.keyboard.press('Escape');
  await settle(page);
  step('描述：Esc 取消編輯，不送出', (await issueOf(d.t1.identifier)).description === xss && (await peek.count()) === 1);
  await dismissToasts(page);

  // 6. Project、到期日（產品不放 Sprint，NX-160）
  await openField(page, peek, 'Project');
  await page.getByRole('menuitem', { name: 'Gem TD' }).click();
  await waitIssue(d.t1.identifier, (i) => i.project_id === d.gem.id, 'Project 寫進 API');
  await settle(page);
  step('改 Project：API 改了，看板卡片的 Project 名稱也換了', (await card(d.t1).locator('.proj .nm').textContent()) === 'Gem TD');
  step('欄位沒有 Sprint（NX-160）', (await peek.locator('.nl-fields').textContent()).includes('Project') && !(await peek.locator('.nl-fields').textContent()).includes('Sprint'));
  await peek.getByLabel('到期日').fill('2026-11-30');
  await waitIssue(d.t1.identifier, (i) => i.due_date === '2026-11-30', '到期日寫進 API');
  step('改到期日：API 是 2026-11-30', true);
  await dismissToasts(page);

  // 7. blocked by：搜尋標題加入、移除
  await peek.getByRole('button', { name: '加入' }).click();
  await page.getByRole('combobox').fill('到期日圖示');
  await page.getByRole('option', { name: new RegExp(d.t2.identifier) }).waitFor();
  await page.keyboard.press('Enter');
  await poll(() => api('GET', `/issues/${d.t1.identifier}/blockers`), (r) => r.blocked_by.some((b) => b.number === d.t2.number), 'blocked by 寫進 API');
  await settle(page);
  step('blocked by：用標題搜尋、Enter 加入，API 有了、畫面出現那張', (await peek.locator(`.blk[data-blocker="${n(d.t2)}"]`).count()) === 1);
  await peek.getByRole('button', { name: '加入' }).click();
  await page.getByRole('combobox').fill(d.p1.identifier);
  await page.getByRole('option', { name: new RegExp(d.p1.identifier) }).click();
  await poll(() => api('GET', `/issues/${d.t1.identifier}/blockers`), (r) => r.blocked_by.length === 2, '第二張 blocked by');
  step('blocked by：用票號搜尋、點選加入', true);
  await peek.getByRole('button', { name: `移除 blocked by ${d.p1.identifier}` }).click();
  await poll(() => api('GET', `/issues/${d.t1.identifier}/blockers`), (r) => r.blocked_by.length === 1, '移除 blocked by');
  await settle(page);
  step('blocked by：移除後 API 和畫面都只剩一張', (await peek.locator('.blk').count()) === 1);
  await dismissToasts(page);

  // 8. 變更紀錄：還原改標題那一筆
  const revertTitle = peek.getByRole('button', { name: `還原：標題改回 ${d.t1.title}` });
  await revertTitle.click();
  await waitIssue(d.t1.identifier, (i) => i.title === d.t1.title, '標題還原');
  await settle(page);
  const events = (await api('GET', `/issues/${d.t1.identifier}/events`)).events;
  const titleEvent = events.find((e) => e.field === 'title' && e.revert_of_event_id === null);
  const row = peek.locator(`.nl-hist[data-event="${String(titleEvent.id)}"]`);
  // 變更紀錄預設只列最近 10 筆，比較舊的要按「顯示全部」
  const showAll = peek.getByRole('button', { name: /^顯示全部/ });
  if ((await showAll.count()) > 0) await showAll.click();
  step('還原：標題改回原本，那一筆標「已還原」加刪除線，多一筆「還原了…」', titleEvent.reverted_by_event_id !== null && (await row.locator('.done-tag').textContent()) === '已還原' && (await row.getAttribute('class')).includes('is-reverted') && (await peek.locator('.nl-hist', { hasText: '還原了 你 的標題變更' }).count()) === 1);
  step('還原：看板卡片標題也改回來', (await card(d.t1).locator('.t').textContent()) === d.t1.title);
  await page.screenshot({ path: join(outDir, 'peek-1280-light-history.png') });

  // 9. 還原遇到 409：先再改一次狀態，再去還原更早那筆狀態變更
  await openField(page, peek, '狀態');
  await page.getByRole('menuitem', { name: 'Todo' }).click();
  await waitIssue(d.t1.identifier, (i) => i.status === 'Todo', '狀態改回 Todo');
  await settle(page);
  await dismissToasts(page);
  await peek.getByRole('button', { name: '還原：狀態改回 Todo' }).click();
  const conflict = page.locator('.nl-toast--error', { hasText: '無法還原' });
  await conflict.waitFor();
  const conflictText = await conflict.textContent();
  step('還原遇到 409：toast 說明原因（之後又改過），票不變', (await issueOf(d.t1.identifier)).status === 'Todo' && conflictText.includes('被改過'), { toast: conflictText });
  await dismissToasts(page);

  // 10. 寫入失敗：退回原本的值、錯誤 toast
  await page.route('**/app-api/issues/*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '資料庫暫時忙不過來' }) }) : route.continue(),
  );
  await openField(page, peek, '狀態');
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await page.locator('.nl-toast--error', { hasText: '儲存失敗：資料庫暫時忙不過來' }).waitFor();
  await settle(page);
  step('寫入失敗：徽章退回 Todo、看板卡片留在 Todo，錯誤 toast 附「重試」', (await peek.locator('.meta-row .nl-badge').textContent()) === 'Todo' && (await inCol(d.t1, 'todo').count()) === 1 && (await page.locator('.nl-toast--error').getByRole('button', { name: '重試' }).count()) === 1);
  await page.unroute('**/app-api/issues/*');
  await dismissToasts(page);

  // 11. 待驗收：頂端只有「等你回覆」＋回覆框（NX-239），沒有通過／退回，comment 區不放第二個輸入框
  await card(d.r1).locator('.hit').click();
  await page.waitForURL(`**/?peek=${d.r1.identifier}`);
  const reply = peek.locator('.nl-review');
  await reply.waitFor();
  step('待驗收的票：預覽頂端是「等你回覆」，摘要＝最新的下一步', ((await reply.textContent()) ?? '').includes('等你回覆') && ((await reply.textContent()) ?? '').includes('Bolas 驗收 toast 的復原'));
  step('待驗收的票：沒有通過、退回按鈕', (await peek.getByRole('button', { name: /^通過/ }).count()) === 0 && (await peek.getByRole('button', { name: /^退回/ }).count()) === 0);
  step('待驗收的票：comment 區沒有輸入框，回覆框只有頂端一個', (await peek.locator('.cmt-form').count()) === 0 && (await peek.getByRole('textbox', { name: '回覆' }).count()) === 1);
  await peek.locator('.ttl-edit').focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForTimeout(600);
  step('待驗收的票：焦點不在輸入框時 ⌘↵ 不再改狀態', (await api('GET', `/issues/${d.r1.identifier}`)).status === 'In Review');
  const replyBtn = reply.getByRole('button', { name: /^回覆/ });
  step('回覆：沒寫內容時按鈕停用', await replyBtn.isDisabled());
  await peek.getByRole('textbox', { name: '回覆' }).fill('   ');
  step('回覆：只打空白也不能送', await replyBtn.isDisabled());

  // 12. 回覆：author 是網頁上的人（預設「你」），票交回 agent（In Progress，NX-221），狀態之後交給 agent
  await peek.getByRole('textbox', { name: '回覆' }).fill('toast 在手機上擋到底部分頁列，往上移一點');
  await replyBtn.click();
  await waitIssue(d.r1.identifier, (i) => i.status === 'In Progress', '回覆寫進 API');
  const rc = (await api('GET', `/issues/${d.r1.identifier}/comments`)).comments;
  await inCol(d.r1, 'in-progress').waitFor({ timeout: 3000 });
  step('回覆：comment 原文寫進去（作者「你」），狀態回 In Progress，看板跟著移', rc.at(-1).author === '你' && rc.at(-1).body === 'toast 在手機上擋到底部分頁列，往上移一點');
  const rjEvents = (await api('GET', `/issues/${d.r1.identifier}/events`)).events.filter((e) => e.from_value === 'In Review' && e.to_value === 'In Progress');
  const rjToast = page.locator('.nl-toast', { hasText: `${d.r1.identifier} 已交回 agent` });
  step('回覆（NX-221）：變更紀錄只有一筆「In Review → In Progress」，toast 附復原；「等你回覆」收起、comment 區輸入框回來', rjEvents.length === 1 && (await rjToast.getByRole('button', { name: '復原' }).count()) === 1 && (await reply.count()) === 0 && (await peek.locator('.cmt-form').count()) === 1, { events: rjEvents.length });
  await dismissToasts(page);

  // 12b. 在回覆框按 ⌘↵ 送出 → 票自動交回 agent（In Progress），可復原（NX-221）
  await card(d.r2).locator('.hit').click();
  await page.waitForURL(`**/?peek=${d.r2.identifier}`);
  await peek.locator('.nl-review').waitFor();
  await peek.getByRole('textbox', { name: '回覆' }).fill('1.1 2.1 3.1');
  await page.keyboard.press('ControlOrMeta+Enter');
  await waitIssue(d.r2.identifier, (i) => i.status === 'In Progress', '回覆後移到 In Progress');
  await inCol(d.r2, 'in-progress').waitFor({ timeout: 3000 });
  const handToast = page.locator('.nl-toast', { hasText: `${d.r2.identifier} 已交回 agent` });
  await handToast.waitFor();
  const hEvents = (await api('GET', `/issues/${d.r2.identifier}/events`)).events.filter((e) => e.field === 'status');
  step('待驗收回覆（NX-221）：API 變 In Progress、看板卡片移欄、「等你回覆」消失、變更紀錄一筆（你）、toast 附復原',
    (await peek.locator('.nl-review').count()) === 0 && hEvents.length === 1 && hEvents[0].actor === '你' && hEvents[0].from_value === 'In Review' && (await handToast.getByRole('button', { name: '復原' }).count()) === 1,
    { events: hEvents.map((e) => [e.from_value, e.to_value, e.actor]) });
  await page.screenshot({ path: join(outDir, 'peek-1280-light-handback.png') });
  await handToast.getByRole('button', { name: '復原' }).click();
  await waitIssue(d.r2.identifier, (i) => i.status === 'In Review', '復原交回');
  await inCol(d.r2, 'in-review').waitFor({ timeout: 3000 });
  step('交回後按復原：回到待驗收，卡片回待驗收欄', (await peek.locator('.nl-review').count()) === 1);
  await dismissToasts(page);

  // 13. 截圖：待驗收的預覽（r2）
  await card(d.r2).locator('.hit').click();
  await page.waitForURL(`**/?peek=${d.r2.identifier}`);
  await peek.locator('.nl-review').waitFor();
  await settle(page);
  await page.screenshot({ path: join(outDir, 'peek-1280-light-review.png') });
  measures['peek-1280-light-review'] = await measure(page);

  // 14. 展開成整頁
  await peek.getByRole('link', { name: '展開成整頁' }).click();
  await page.waitForURL(`**/issues/${d.r2.identifier}`);
  await page.locator('.detail-page .ttl-edit').waitFor();
  step('展開成整頁：/issues/NX-n，預覽面板收起，欄位在右欄', (await peek.count()) === 0 && (await page.locator('.side-fields .nl-fields').count()) === 1);
  step('整頁：blocked by 顯示擋住它的票', (await page.locator(`.blk[data-blocker="${n(d.p1)}"]`).count()) === 1);
  await settle(page);
  await page.screenshot({ path: join(outDir, 'page-1280-light.png') });
  measures['page-1280-light'] = await measure(page);
  await page.goto(`${BASE}/issues/BOL-301`);
  await page.waitForURL(`**/issues/${d.t1.identifier}`);
  step('整頁：舊編號 /issues/BOL-301 轉到 NX 編號', true, { url: page.url() });

  const unexpected = consoleErrors.filter((m) => !m.includes('status of 500') && !m.includes('status of 409'));
  step('桌面沒有 console 錯誤（故意的 500、409 除外）', unexpected.length === 0, { consoleErrors });
  await ctx.close();

  // ===== 深色 1280 =====
  const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  const dp = await dark.newPage();
  await dp.goto(`${BASE}/?peek=${d.r2.identifier}`);
  await dp.locator('.nl-peek .nl-review').waitFor();
  await dp.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await settle(dp);
  await dp.screenshot({ path: join(outDir, 'peek-1280-dark.png') });
  measures['peek-1280-dark'] = await measure(dp);
  await dp.goto(`${BASE}/issues/${d.r2.identifier}`);
  await dp.locator('.detail-page .ttl-edit').waitFor();
  await settle(dp);
  await dp.screenshot({ path: join(outDir, 'page-1280-dark.png') });
  measures['page-1280-dark'] = await measure(dp);
  await dark.close();

  // ===== 1000 寬：預覽蓋在看板上 =====
  const mid = await browser.newContext({ viewport: { width: 1000, height: 800 }, colorScheme: 'light' });
  const midp = await mid.newPage();
  await midp.goto(`${BASE}/?peek=${d.t1.identifier}`);
  await midp.locator('.nl-peek .ttl-edit').waitFor();
  await settle(midp);
  const overlay = await midp.locator('.nl-peek').evaluate((el) => getComputedStyle(el).position);
  step('視窗 < 1024：預覽蓋在看板上（position: fixed）', overlay === 'fixed');
  measures['peek-1000-light'] = await measure(midp);
  await midp.screenshot({ path: join(outDir, 'peek-1000-light.png') });
  await mid.close();

  // ===== 手機 375 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(`${BASE}/?col=in-review`);
    await mp.locator(`.nl-card[data-n="${n(d.r2)}"]`).waitFor();
    await mp.locator(`.nl-card[data-n="${n(d.r2)}"] .hit`).tap();
    await mp.waitForURL(`**/issues/${d.r2.identifier}`);
    await mp.locator('.detail-page .ttl-edit').waitFor();
    await settle(mp);
    const box = await mp.getByRole('textbox', { name: '回覆' }).boundingBox();
    if (scheme === 'light') {
      step('手機：點卡片直接進整頁（不開預覽）', (await mp.locator('.nl-peek').count()) === 0);
      step('手機：沒有底部固定的通過／退回', (await mp.locator('.m-review-bar').count()) === 0 && (await mp.getByRole('button', { name: /^通過/ }).count()) === 0);
      step('手機：回覆框在第一屏（底部分頁列上方）', box !== null && box.y + box.height <= 812 - 56, { box });
    }
    await mp.screenshot({ path: join(outDir, `page-375-${scheme}.png`) });
    measures[`page-375-${scheme}`] = await measure(mp);
    await mp.evaluate(() => { document.querySelector('.view')?.scrollTo({ top: 99999 }); });
    await mp.waitForTimeout(300);
    await mp.screenshot({ path: join(outDir, `page-375-${scheme}-bottom.png`) });
    measures[`page-375-${scheme}-bottom`] = await measure(mp);
    if (scheme === 'light') {
      await mp.getByRole('textbox', { name: '回覆' }).fill('可以');
      await mp.locator('.nl-review').getByRole('button', { name: /^回覆/ }).tap();
      await waitIssue(d.r2.identifier, (i) => i.status === 'In Progress', '手機回覆');
      const t = mp.locator('.nl-toast', { hasText: `${d.r2.identifier} 已交回 agent` });
      await t.waitFor();
      step('手機：回覆 → API 改成 In Progress、「等你回覆」收起', (await mp.locator('.nl-review').count()) === 0);
      await t.getByRole('button', { name: '復原' }).tap();
      await waitIssue(d.r2.identifier, (i) => i.status === 'In Review', '手機復原');
      await mp.locator('.nl-review').waitFor();
      step('手機：復原回到待驗收，「等你回覆」回來', true);
      await mp.goto(`${BASE}/?peek=${d.t1.identifier}`);
      await mp.waitForURL(`**/issues/${d.t1.identifier}`);
      step('手機：網址帶 ?peek 時直接換成整頁', true, { url: mp.url() });
    }
    await m.close();
  }

  const noScroll = Object.values(measures).every((x) => !x.pageHorizontalScroll && !x.peekHorizontalScroll && !x.viewHorizontalScroll);
  step('所有截圖的頁面、預覽面板、內容區都沒有橫向捲動', noScroll, { measures });
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
