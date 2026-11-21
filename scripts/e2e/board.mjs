// NX-153：看板的端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1），用一份獨立的本機 D1 灌測試資料，
// 再用 Playwright 在瀏覽器裡實際操作：
//   桌面：拖到 In Progress → 張數更新 → toast「復原」→ 回到原欄原位；Cmd/Ctrl+Z 復原；同欄調順序；鍵盤搬卡片；
//         拖到標題列的 Backlog；寫入失敗時退回並出錯誤 toast。
//   點卡片開右側預覽（?peek=NX-n）。看板顯示全部沒做完的票（NX-160：產品不放 Sprint）。
//   手機（375）：卡片選單「移到…」→ 分頁張數更新 → 復原。
// 每一步都對照 /app-api 的資料（狀態、位置、張數），截圖 1280／375 × 淺色／深色，量測沒有橫向捲動。
//
// 用法（repo 根目錄，.dev.vars 要有 DEV_SKIP_ACCESS=1）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8788] node scripts/e2e/board.mjs
// 本 repo 沒有把 Playwright 列為依賴，由環境變數指定要用哪一份。
// 輸出：.scratch/screenshots/board/*.png、.scratch/screenshots/board/e2e-result.json。
// 本機 D1 放在 .scratch/e2e-board/<時間>/（每次新的一份，不碰 .wrangler/state 的開發資料）。

/* global document, window -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/board');
const persist = join(repo, '.scratch/e2e-board', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8788);
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
  // 自己一個 process group，結束時連 workerd 一起關掉
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

// /app-api（DEV_SKIP_ACCESS 只對 localhost 有效）；寫入要帶本站 Origin（CSRF 檢查）。
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

// beforeIssues：Project 開好、還沒有票時先跑（檢查空狀態）。Sprint 仍照舊建（API 保留），看板不看它。
async function seed(beforeIssues) {
  const now = Date.now();
  const sprint = await api('POST', '/sprints', {
    number: 1,
    starts_at: new Date(now - 2 * DAY).toISOString(),
    ends_at: new Date(now + 12 * DAY).toISOString(),
  });
  const nextline = await api('POST', '/projects', { name: 'Nextline 第二版' });
  const gem = await api('POST', '/projects', { name: 'Gem TD' });
  const travel = await api('POST', '/projects', { name: '旅遊剪片 Agent' });
  await beforeIssues();
  const mk = async (title, status, project, extra = {}) =>
    api('POST', '/issues', { title, status, project_id: project?.id ?? null, sprint_id: sprint.id, ...extra });
  // 同一欄後開的放上面，所以由下往上開。
  const t3 = await mk('看板卡片加上到期日圖示', 'Todo', nextline);
  const t2 = await mk('寶石 3 階的材質再亮一點', 'Todo', gem);
  const t1 = await mk('整理第二版的驗收清單，給 Bolas 一次看完', 'Todo', nextline);
  const p2 = await mk('旅遊影片第二支：京都三天', 'In Progress', travel);
  const p1 = await mk('列表頁：篩選與存成 view', 'In Progress', nextline);
  const r1 = await mk('設計系統：深色模式對比修正', 'In Review', nextline);
  const d1 = await mk('前端骨架：shell、router、toast', 'Done', nextline);
  await mk('搬家腳本補上 comment 時間', 'Done', nextline, {
    completed_at: new Date(now - 10 * DAY).toISOString(),
    updated_at: new Date(now - 10 * DAY).toISOString(),
  });
  const b1 = await mk('通知：agent 做完時寄信', 'Backlog', nextline);
  await mk('甘特圖', 'Backlog', null);
  await mk('舊版首頁的三區改成看板', 'Canceled', nextline);

  const say = (issue, author, body) => api('POST', `/issues/${issue.identifier}/comments`, { author, body });
  await say(t1, '阿澈', '清單草稿放在票的描述。\n下一步：Bolas 看過清單，把不要的劃掉');
  await say(p1, 'claude-nextline', '篩選列做好一半。\n下一步：claude-nextline 接著做存成 view');
  await say(r1, 'claude-nextline', '對比都過了，截圖在 .scratch。\n下一步：Bolas 驗收深色模式截圖');
  await say(p2, '阿澈', '素材整理好了');
  await say(b1, '你', '下一步：等 Sprint 2 再排');
  return { sprint, t1, t2, t3, p1, p2, r1, d1 };
}

// 看板上的全部票（API 預設不含已封存）
async function sprintIssues() {
  const { issues } = await api('GET', '/issues?sort=position&limit=200');
  return issues;
}

// 照看板的規則算每欄張數：Done 只算最近 7 天完成的。
function expectedCounts(issues) {
  const now = Date.now();
  const counts = { Backlog: 0, Todo: 0, 'In Progress': 0, 'In Review': 0, Done: 0, Canceled: 0 };
  for (const i of issues) {
    if (i.status === 'Done' && now - Date.parse(i.completed_at ?? i.updated_at) >= 7 * DAY) continue;
    counts[i.status]++;
  }
  return counts;
}

function sameCounts(ui, expected) {
  return Object.entries(TOKENS).every(([s, t]) => ui[t] === expected[s]);
}

function order(issues, status) {
  return issues.filter((i) => i.status === status).map((i) => i.identifier);
}

// ---- 瀏覽器 ----

const TOKENS = { Backlog: 'backlog', Todo: 'todo', 'In Progress': 'in-progress', 'In Review': 'in-review', Done: 'done', Canceled: 'canceled' };

async function uiCounts(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-count]')].map((el) => [el.getAttribute('data-count'), Number(el.textContent)])));
}

async function columnOrder(page, status) {
  return page.locator(`section[data-col="${TOKENS[status]}"] .nl-card .id`).allTextContents();
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const wrap = document.querySelector('.board-wrap');
    return {
      viewport: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageHorizontalScroll: doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > doc.clientWidth,
      boardWrapScrollWidth: wrap?.scrollWidth ?? null,
      boardWrapClientWidth: wrap?.clientWidth ?? null,
    };
  });
}

async function dragTo(page, source, target, { y = 'center' } = {}) {
  const from = await source.boundingBox();
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
  // 拖曳開始後版面會變（收起的欄變成放置區），所以拿起之後才量目標的位置
  await page.waitForTimeout(100);
  const to = await target.boundingBox();
  const tx = to.x + to.width / 2;
  const ty = y === 'top' ? to.y + 8 : y === 'bottom' ? to.y + to.height - 8 : to.y + to.height / 2;
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.move(tx, ty + 1, { steps: 2 });
  await page.mouse.up();
}

async function waitStatus(ref, status) {
  for (let i = 0; i < 40; i++) {
    const issue = await api('GET', `/issues/${ref}`);
    if (issue.status === status) return issue;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${ref} 沒變成 ${status}`);
}

async function settle(page) {
  // 等寫入都回來（toast 出現或 API 狀態到位），再多等一點讓畫面套用 API 回來的位置
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
}

const measures = {};
let browser;

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const data = await seed(async () => {
    const e = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
    const ep = await e.newPage();
    await ep.goto(`${BASE}/`);
    await ep.locator('.nl-empty').waitFor();
    step('空狀態：還沒有票（沒有 Sprint 的字樣）', (await ep.locator('.nl-empty h2').textContent()) === '沒有票' && !(await ep.locator('.app').textContent()).includes('Sprint'));
    await ep.screenshot({ path: join(outDir, 'board-1280-light-empty.png') });
    measures['1280-light-empty'] = await measure(ep);
    await e.close();
  });
  const sprintId = null;

  // ===== 桌面 1280 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();

  let issues = await sprintIssues(sprintId);
  let counts = await uiCounts(page);
  let expected = expectedCounts(issues);
  step('桌面：每欄張數跟 API 一致（Done 只算 7 天內）', sameCounts(counts, expected), { ui: counts, api: expected });
  step('桌面：欄內順序跟 API 的 position 一致', JSON.stringify(await columnOrder(page, 'Todo')) === JSON.stringify(order(issues, 'Todo')), {
    ui: await columnOrder(page, 'Todo'),
    api: order(issues, 'Todo'),
  });
  step('桌面：看板沒有 Sprint 標籤、沒有「回到 Sprint」（NX-160）', !(await page.locator('main#main').textContent()).includes('Sprint') && (await page.getByRole('button', { name: /回到 Sprint/ }).count()) === 0);
  step('卡片顯示最新的下一步', (await page.locator(`.nl-card[data-n="${String(data.t1.number)}"] .next`).textContent()).includes('Bolas 看過清單'));
  step('最新 comment 沒寫下一步的卡片不顯示下一步', (await page.locator(`.nl-card[data-n="${String(data.p2.number)}"] .next`).count()) === 0);

  await page.screenshot({ path: join(outDir, 'board-1280-light.png') });
  measures['1280-light'] = await measure(page);

  // 1. 拖到 In Progress → 張數更新 → toast 復原 → 回到原欄原位
  const before = await columnOrder(page, 'Todo');
  const card = page.locator(`.nl-card[data-n="${String(data.t2.number)}"] .hit`);
  await dragTo(page, card, page.locator('section[data-col="in-progress"] .nl-card').first(), { y: 'top' });
  await page.locator('.nl-toast', { hasText: `${data.t2.identifier} 已移到「In Progress」` }).waitFor();
  await waitStatus(data.t2.identifier, 'In Progress');
  await settle(page);
  issues = await sprintIssues(sprintId);
  counts = await uiCounts(page);
  step('拖到 In Progress：API 狀態改了、兩欄張數更新', counts.todo === 2 && counts['in-progress'] === 3 && sameCounts(counts, expectedCounts(issues)), { ui: counts });
  step('拖到 In Progress：放在指定的位置（第一張的上面）', order(issues, 'In Progress')[0] === data.t2.identifier && (await columnOrder(page, 'In Progress'))[0] === data.t2.identifier, {
    api: order(issues, 'In Progress'),
  });
  await page.screenshot({ path: join(outDir, 'board-1280-light-toast.png') });

  await page.locator('.nl-toast', { hasText: data.t2.identifier }).getByRole('button', { name: '復原' }).click();
  await page.locator('.nl-toast', { hasText: '已復原' }).waitFor();
  await waitStatus(data.t2.identifier, 'Todo');
  await settle(page);
  issues = await sprintIssues(sprintId);
  const events = (await api('GET', `/issues/${data.t2.identifier}/events`)).events;
  step('toast 復原：回到 Todo 原本的位置', JSON.stringify(order(issues, 'Todo')) === JSON.stringify(before) && JSON.stringify(await columnOrder(page, 'Todo')) === JSON.stringify(before), {
    api: order(issues, 'Todo'),
    before,
  });
  step('toast 復原：變更紀錄是「還原」，原本那筆標已還原', events.length === 2 && events[0].reverted_by_event_id === events[1].id && events[1].revert_of_event_id === events[0].id, {
    events: events.map((e) => ({ id: e.id, from: e.from_value, to: e.to_value, revert_of: e.revert_of_event_id, reverted_by: e.reverted_by_event_id })),
  });
  counts = await uiCounts(page);
  step('toast 復原：張數回到原本', counts.todo === 3 && counts['in-progress'] === 2, { ui: counts });

  // 2. Cmd/Ctrl+Z 復原
  await dragTo(page, page.locator(`.nl-card[data-n="${String(data.t3.number)}"] .hit`), page.locator('section[data-col="in-review"]'));
  await page.locator('.nl-toast', { hasText: `${data.t3.identifier} 已移到「待驗收」` }).waitFor();
  await waitStatus(data.t3.identifier, 'In Review');
  await page.mouse.click(5, 5);
  await page.keyboard.press('ControlOrMeta+z');
  await waitStatus(data.t3.identifier, 'Todo');
  await settle(page);
  issues = await sprintIssues(sprintId);
  step('Cmd/Ctrl+Z 復原：回到 Todo 原位', JSON.stringify(order(issues, 'Todo')) === JSON.stringify(before), { api: order(issues, 'Todo') });

  // 3. 同欄調順序：把最後一張拖到最上面
  await dragTo(page, page.locator(`.nl-card[data-n="${String(data.t3.number)}"] .hit`), page.locator(`.nl-card[data-n="${String(data.t1.number)}"]`), { y: 'top' });
  await settle(page);
  issues = await sprintIssues(sprintId);
  step('同欄調順序：用 before／after 寫回，API 順序跟畫面一樣', order(issues, 'Todo')[0] === data.t3.identifier && JSON.stringify(await columnOrder(page, 'Todo')) === JSON.stringify(order(issues, 'Todo')), {
    api: order(issues, 'Todo'),
    ui: await columnOrder(page, 'Todo'),
  });
  step('同欄調順序：不跳「移到」toast', (await page.locator('.nl-toast', { hasText: `${data.t3.identifier} 已移到「Todo」` }).count()) === 0);

  // 4. 鍵盤搬卡片：空白鍵拿起、→ 移到右邊那欄、空白鍵放下
  await page.locator(`.nl-card[data-n="${String(data.t1.number)}"] .hit`).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await waitStatus(data.t1.identifier, 'In Progress');
  await settle(page);
  step('鍵盤拖拉：空白鍵＋方向鍵把卡片移到 In Progress', (await columnOrder(page, 'In Progress')).includes(data.t1.identifier));
  await page.keyboard.press('ControlOrMeta+z');
  await waitStatus(data.t1.identifier, 'Todo');
  await page.locator(`.nl-card[data-n="${String(data.t1.number)}"] .hit`).focus();
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await waitStatus(data.t1.identifier, 'In Progress');
  step('鍵盤：Cmd/Ctrl+→ 移到右邊那欄', true);
  // API 先寫好、回應才到瀏覽器；等「移到」toast 出現（復原登記好了）再按 Cmd+Z
  await page.locator('.nl-toast', { hasText: `${data.t1.identifier} 已移到` }).last().waitFor();
  await settle(page);
  await page.keyboard.press('ControlOrMeta+z');
  await waitStatus(data.t1.identifier, 'Todo');
  await settle(page);

  // 5. 拖到標題列的 Backlog（收起的欄當放置區）
  const backlogBefore = (await uiCounts(page)).backlog;
  await dragTo(page, page.locator(`.nl-card[data-n="${String(data.p2.number)}"] .hit`), page.locator('[data-fold="backlog"]'));
  await waitStatus(data.p2.identifier, 'Backlog');
  await settle(page);
  counts = await uiCounts(page);
  step('拖到收起的 Backlog：狀態改了、Backlog 張數 +1', counts.backlog === backlogBefore + 1, { ui: counts });
  await page.locator('.nl-toast', { hasText: data.p2.identifier }).getByRole('button', { name: '復原' }).click();
  await waitStatus(data.p2.identifier, 'In Progress');
  await settle(page);

  // 6. 展開 Backlog
  await page.locator('[data-fold="backlog"]').click();
  await page.locator('section[data-col="backlog"]').waitFor();
  step('點收起的 Backlog 會展開成一欄', (await page.locator('section[data-col="backlog"] .nl-card').count()) === (await uiCounts(page)).backlog);
  measures['1280-light-backlog-open'] = await measure(page);
  await page.screenshot({ path: join(outDir, 'board-1280-light-backlog.png') });
  await page.locator('[data-fold="backlog"]').click();

  // 7. 寫入失敗：退回原欄、錯誤 toast
  await page.route('**/app-api/issues/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '資料庫暫時忙不過來' }) })
      : route.continue(),
  );
  const todoBeforeFail = await columnOrder(page, 'Todo');
  await dragTo(page, page.locator(`.nl-card[data-n="${String(data.t2.number)}"] .hit`), page.locator('section[data-col="done"]'));
  await page.locator('.nl-toast--error', { hasText: '儲存失敗：資料庫暫時忙不過來' }).waitFor();
  await settle(page);
  step('寫入失敗：卡片退回原欄原位、出錯誤 toast（附重試）', JSON.stringify(await columnOrder(page, 'Todo')) === JSON.stringify(todoBeforeFail) && (await page.locator('.nl-toast--error').getByRole('button', { name: '重試' }).count()) === 1);
  await page.unroute('**/app-api/issues/*');
  await page.locator('.nl-toast--error').getByRole('button', { name: '重試' }).click();
  await waitStatus(data.t2.identifier, 'Done');
  step('重試：真的寫進 Done', true);
  await page.locator('.nl-toast', { hasText: `${data.t2.identifier} 已完成` }).getByRole('button', { name: '復原' }).click();
  await waitStatus(data.t2.identifier, 'Todo');
  await settle(page);

  // 8. 點卡片打開右側預覽（?peek=NX-n；票詳細的完整流程在 scripts/e2e/detail.mjs）
  await page.locator(`.nl-card[data-n="${String(data.r1.number)}"] .hit`).click();
  await page.waitForURL(`**/?peek=${data.r1.identifier}`);
  await page.locator('.nl-peek .ttl-edit').waitFor();
  step('點卡片：右側預覽打開，顯示標題與待驗收', (await page.locator('.nl-peek .meta-row').textContent()).includes('待驗收'));
  await page.keyboard.press('Escape');
  await page.locator('.nl-peek').waitFor({ state: 'detached' });
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  // 第 7 步故意讓 PATCH 回 500，瀏覽器會記一筆 Failed to load resource，不算
  const unexpected = consoleErrors.filter((m) => !m.includes('status of 500'));
  step('桌面沒有 console 錯誤（故意的 500 除外）', unexpected.length === 0, { consoleErrors });

  // 深色截圖
  const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  const dp = await dark.newPage();
  await dp.goto(`${BASE}/`);
  await dp.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await dp.waitForTimeout(300);
  await dp.screenshot({ path: join(outDir, 'board-1280-dark.png') });
  measures['1280-dark'] = await measure(dp);
  await dark.close();
  await ctx.close();

  // ===== 手機 375 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(`${BASE}/`);
    await mp.locator('.col-tabs').waitFor();
    await mp.locator('section[data-col="todo"] .nl-card').first().waitFor();
    await mp.waitForTimeout(300);
    await mp.screenshot({ path: join(outDir, `board-375-${scheme}.png`) });
    measures[`375-${scheme}`] = await measure(mp);
    if (scheme === 'light') {
      step('手機：一次只顯示一欄', (await mp.locator('section.nl-col').count()) === 1);
      const tabCount = async (name) => Number(await mp.getByRole('tab', { name: new RegExp(`^${name}`) }).locator('.n').textContent());
      const todoN = await tabCount('Todo');
      const progN = await tabCount('進行中');
      await mp.locator(`.nl-card[data-n="${String(data.t1.number)}"] .more`).tap();
      await mp.getByRole('menu').waitFor();
      await mp.waitForTimeout(400);
      await mp.screenshot({ path: join(outDir, 'board-375-light-move-menu.png') });
      measures['375-light-move-menu'] = await measure(mp);
      await mp.getByRole('menuitem', { name: 'In Progress' }).tap();
      await mp.locator('.nl-toast', { hasText: `${data.t1.identifier} 已移到「In Progress」` }).waitFor();
      await waitStatus(data.t1.identifier, 'In Progress');
      await settle(mp);
      step('手機「移到…」：API 狀態改了、分頁張數更新', (await tabCount('Todo')) === todoN - 1 && (await tabCount('進行中')) === progN + 1);
      await mp.getByRole('tab', { name: /^進行中/ }).tap();
      await mp.waitForTimeout(300);
      const progOrder = await columnOrder(mp, 'In Progress');
      step('手機：切到「進行中」分頁看得到那張，放在最上面', progOrder[0] === data.t1.identifier, { order: progOrder, want: data.t1.identifier });
      await mp.screenshot({ path: join(outDir, 'board-375-light-moved.png') });
      await mp.locator('.nl-toast', { hasText: data.t1.identifier }).getByRole('button', { name: '復原' }).tap();
      await waitStatus(data.t1.identifier, 'Todo');
      await settle(mp);
      step('手機：復原後回到 Todo、張數回來', (await tabCount('Todo')) === todoN && (await tabCount('進行中')) === progN);
      await mp.getByRole('button', { name: 'Backlog 與 Canceled' }).tap();
      await mp.getByRole('menuitem', { name: /Backlog/ }).tap();
      const switched = await mp.locator('section[data-col="backlog"]').waitFor({ timeout: 3000 }).then(() => true, () => false);
      if (!switched) await mp.screenshot({ path: join(outDir, 'fail-375-fold.png') });
      step('手機：從「⋯」切到 Backlog', switched, { url: mp.url() });
      await mp.screenshot({ path: join(outDir, 'board-375-light-backlog.png') });
    }
    await m.close();
  }

  const noScroll = Object.values(measures).every((x) => !x.pageHorizontalScroll);
  step('所有截圖的頁面都沒有橫向捲動（看板框內可以橫捲）', noScroll, { measures });
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
