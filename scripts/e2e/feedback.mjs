// NX-160：第一次試用回饋的端對端測試（含「沒完成的拖拉讓看板卡在拖曳中」）。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，
// 用 Playwright 在瀏覽器實際操作：
//   1. 選 Project → 開票詳細（預覽）→ 拖卡片到別欄：畫面不會變空白、沒有頁面錯誤（第一次試用的回報）
//   2. 按 toast「復原」：300ms 內就變「已復原」（寫入故意延遲 1.5 秒，證明不等請求回來）
//   3. 描述編輯框：最少 12 行（或 50vh）、跟著內容長高不出現內捲軸；comment、開票描述也會長高
//   4. /projects 新增 Project（名稱必填、不能重複），側欄馬上出現；Project 頁改名稱、說明，沒有狀態（NX-165）
//   5. 封存：預覽「⋯」封存 → 從看板消失、等你張數跟著變 → 復原；Cmd+K 封存；「已封存」列表取消封存；直接打開已封存的票有提示
//   6. 拿掉的頁面（/zones、/sprints/:n、/views/:id）轉回看板；看板沒有 Sprint
//   7. 手機（觸控）：看不到任何鍵盤提示，placeholder 沒有快捷鍵
// 用法（repo 根目錄）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8794] node scripts/e2e/feedback.mjs
// 輸出：.scratch/screenshots/nx160/*.png、.scratch/screenshots/nx160/e2e-result.json。本機 D1 在 .scratch/e2e-feedback/<時間>/。

/* global document, window, MutationObserver -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/nx160');
const persist = join(repo, '.scratch/e2e-feedback', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8794);
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

async function poll(fn, ok, what) {
  for (let i = 0; i < 50; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等不到：${what}`);
}
const issueOf = (ref) => api('GET', `/issues/${ref}`);

async function seed() {
  const now = Date.now();
  // Sprint 照舊建（API 保留給 Sprint 會議），網頁不顯示
  await api('POST', '/sprints', { number: 1, starts_at: new Date(now - 2 * DAY).toISOString(), ends_at: new Date(now + 12 * DAY).toISOString() });
  const nextline = await api('POST', '/projects', { name: 'Nextline 第二版', description: '# 第二版\n可商用的任務系統。' });
  const gem = await api('POST', '/projects', { name: 'Gem TD' });
  const mk = (title, status, project, extra = {}) => api('POST', '/issues', { title, status, project_id: project?.id ?? null, ...extra });
  const say = (issue, author, body) => api('POST', `/issues/${issue.identifier}/comments`, { author, body });
  const t1 = await mk('整理第二版的驗收清單', 'Todo', nextline);
  await say(t1, '阿澈', '草稿在描述。\n下一步：Bolas 看過清單，把不要的劃掉');
  const t2 = await mk('看板卡片加上到期日圖示', 'Todo', nextline, { description: '短短一行說明。' });
  const p1 = await mk('列表頁：篩選與分組', 'In Progress', nextline);
  await say(p1, 'claude-nextline', '篩選列做好一半。\n下一步：claude-nextline 接著做分組');
  const r1 = await mk('設計系統：深色模式對比修正', 'In Review', nextline);
  await say(r1, 'claude-nextline', '對比都過了。\n下一步：Bolas 驗收深色模式截圖');
  const r2 = await mk('寶石 3 階的材質再亮一點', 'In Review', gem);
  await mk('前端骨架：shell、router、toast', 'Done', nextline);
  await mk('通知：agent 做完時寄信', 'Backlog', nextline);
  await api('POST', `/issues/${r1.identifier}/blockers`, { blocked_by: p1.identifier, actor: '阿澈' });
  return { nextline, gem, t1, t2, p1, r1, r2 };
}

// ---- 瀏覽器 ----

async function dragTo(page, source, target) {
  const from = await source.boundingBox();
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
  await page.waitForTimeout(100);
  const to = await target.boundingBox();
  const tx = to.x + to.width / 2;
  const ty = to.y + Math.min(to.height / 2, 120);
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.move(tx, ty + 1, { steps: 2 });
  await page.mouse.up();
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function dismissToasts(page) {
  for (const btn of await page.locator('.nl-toast .x').all()) await btn.click().catch(() => {});
  await page.waitForTimeout(150);
}

async function shot(page, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

const card = (page, ref) => page.locator('.nl-card', { has: page.locator('.id', { hasText: new RegExp(`^${ref}$`) }) });
const waitingCount = async (page) => {
  const el = page.locator('.app-side [data-nav-count="waiting"]');
  return (await el.count()) === 0 ? 0 : Number(await el.textContent());
};

// 量一個 textarea：高度、行高、有沒有內捲軸（scrollHeight 比看得到的高）
async function box(locator) {
  return locator.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(cs.lineHeight),
      innerScroll: el.scrollHeight > el.clientHeight + 1,
      viewport: window.innerHeight,
    };
  });
}

let browser;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const d = await seed();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // ===== 1. Project 頁開著預覽：移動卡片後畫面馬上同步（不重新整理）=====
  // 阿澈驗收時在正式站看到：Project 看板開著預覽按 Cmd+→，toast 與 API 都對了，卡片卻留在原欄。
  // 所以每一步都直接看畫面上每一欄有哪些卡片、欄標題的張數，跟 API 對照；中間不重新整理。
  const TOK = { Todo: 'todo', 'In Progress': 'in-progress', 'In Review': 'in-review', Done: 'done' };
  const boardShows = async () => {
    const out = {};
    for (const [s, t] of Object.entries(TOK)) {
      const sec = page.locator(`section[data-col="${t}"]`);
      out[s] = { ids: await sec.locator('.nl-card .id').allTextContents(), n: Number(await sec.locator(`[data-count="${t}"]`).textContent()) };
    }
    return out;
  };
  // 等畫面在 1.5 秒內變成預期（只看畫面，不重新整理）
  const expectOnBoard = async (label, ref, status) => {
    const deadline = Date.now() + 1500;
    let shown;
    for (;;) {
      shown = await boardShows();
      const ok = Object.entries(shown).every(([s, c]) => c.n === c.ids.length && (s === status) === c.ids.includes(ref));
      if (ok || Date.now() > deadline) break;
      await page.waitForTimeout(50);
    }
    const okNow = Object.entries(shown).every(([s, c]) => c.n === c.ids.length && (s === status) === c.ids.includes(ref));
    step(label, okNow && page.url().includes(`/projects/${String(d.nextline.id)}`), { ref, want: status, board: Object.fromEntries(Object.entries(shown).map(([s, c]) => [s, `${String(c.n)}:${c.ids.join(',')}`])) });
  };
  const undoToast = async (text) => {
    await page.locator('.nl-toast', { hasText: text }).getByRole('button', { name: '復原' }).click();
  };
  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await page.locator('.app-side .nl-nav-item', { hasText: d.nextline.name }).click();
  await page.waitForURL(`**/projects/${String(d.nextline.id)}`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  // 跟正式站一樣：開著的是待驗收那欄的票
  await card(page, d.r1.identifier).locator('.hit').click();
  await page.waitForURL((u) => u.searchParams.get('peek') === d.r1.identifier);
  await page.locator('.nl-peek .ttl-edit').waitFor();
  await shot(page, 'after-3-project-peek-before-drag');

  // 1a. 鍵盤 Cmd+→：進行中 → 待驗收
  await card(page, d.p1.identifier).locator('.hit').focus();
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expectOnBoard('1a. Project 頁＋預覽，Cmd+→：卡片馬上到待驗收、張數跟著變', d.p1.identifier, 'In Review');
  await page.locator('.nl-toast', { hasText: `${d.p1.identifier} 已移到` }).waitFor();
  await poll(() => issueOf(d.p1.identifier), (i) => i.status === 'In Review', 'Cmd+→ 寫進 API');
  await expectOnBoard('1a. API 回來後畫面還是待驗收', d.p1.identifier, 'In Review');
  await shot(page, 'after-3-project-peek-cmd-right');
  await undoToast(`${d.p1.identifier} 已移到`);
  await expectOnBoard('1a. 按 toast「復原」：卡片馬上回進行中', d.p1.identifier, 'In Progress');
  await poll(() => issueOf(d.p1.identifier), (i) => i.status === 'In Progress', '復原寫進 API');
  await settle(page);
  await dismissToasts(page);

  // 1b. 滑鼠拖拉：Todo → 進行中
  await dragTo(page, card(page, d.t1.identifier).locator('.hit'), page.locator('section[data-col="in-progress"]'));
  await expectOnBoard('1b. Project 頁＋預覽，滑鼠拖到進行中：卡片馬上換欄、張數跟著變', d.t1.identifier, 'In Progress');
  await poll(() => issueOf(d.t1.identifier), (i) => i.status === 'In Progress', '拖拉寫進 API');
  await settle(page);
  await expectOnBoard('1b. API 回來後畫面還是進行中', d.t1.identifier, 'In Progress');
  await shot(page, 'after-3-project-peek-drag');
  await undoToast(`${d.t1.identifier} 已移到`);
  await expectOnBoard('1b. 按 toast「復原」：卡片馬上回 Todo', d.t1.identifier, 'Todo');
  await poll(() => issueOf(d.t1.identifier), (i) => i.status === 'Todo', '復原寫進 API');
  await settle(page);
  await dismissToasts(page);

  // 1c. Cmd+Z 復原
  await card(page, d.t1.identifier).locator('.hit').focus();
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expectOnBoard('1c. 再按一次 Cmd+→：到進行中', d.t1.identifier, 'In Progress');
  await poll(() => issueOf(d.t1.identifier), (i) => i.status === 'In Progress', '第二次 Cmd+→');
  await settle(page);
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('ControlOrMeta+z');
  await expectOnBoard('1c. Cmd+Z：卡片馬上回 Todo', d.t1.identifier, 'Todo');
  await poll(() => issueOf(d.t1.identifier), (i) => i.status === 'Todo', 'Cmd+Z 寫進 API');
  await settle(page);
  await dismissToasts(page);

  // 1d. 從預覽改狀態（狀態選單移到 Done；NX-239 起待驗收沒有「通過」）：Project 看板跟著動
  await page.locator('.nl-peek').getByRole('button', { name: /^狀態：/ }).click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await expectOnBoard('1d. 預覽狀態選單改 Done：Project 看板上那張馬上到 Done', d.r1.identifier, 'Done');
  await poll(() => issueOf(d.r1.identifier), (i) => i.status === 'Done', '改 Done 寫進 API');
  await undoToast(d.r1.identifier);
  await expectOnBoard('1d. 復原：回到待驗收', d.r1.identifier, 'In Review');
  await poll(() => issueOf(d.r1.identifier), (i) => i.status === 'In Review', '改 Done 的復原寫進 API');
  await settle(page);
  await dismissToasts(page);

  // 1e. 在 Project 頁開票：卡片馬上出現在這個 Project 的 Todo
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('c');
  const cdlg = page.getByRole('dialog', { name: '建立票' });
  await cdlg.waitFor();
  await cdlg.getByLabel('標題（必填）').fill('Project 頁開的票');
  await page.keyboard.press('ControlOrMeta+Enter');
  await cdlg.waitFor({ state: 'detached' });
  const createdRef = (await page.locator('.nl-toast .msg', { hasText: /已建立 NX-\d+/ }).textContent()).replace('已建立 ', '').trim();
  await expectOnBoard('1e. Project 頁按 C 開票：卡片馬上出現在 Todo', createdRef, 'Todo');
  await dismissToasts(page);

  // 1f. 沒完成的滑鼠拖拉之後，看板不能卡在「拖曳中」（阿澈在正式站重現的根因）
  //     三種：一次送完的 pointerdown→move→up（自動化工具的拖拉）、mouse.down 加一大步 move（不給 steps）加 up、只有 down 加 up
  const jumps = {
    sameTask: async (from, to) => {
      await page.evaluate(({ ref, x, y, tx, ty }) => {
        const el = [...document.querySelectorAll('.nl-card')].find((c) => c.querySelector('.id')?.textContent === ref).querySelector('.hit');
        const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
        el.dispatchEvent(new window.PointerEvent('pointerdown', { ...o, clientX: x, clientY: y }));
        document.dispatchEvent(new window.PointerEvent('pointermove', { ...o, clientX: tx, clientY: ty }));
        document.dispatchEvent(new window.PointerEvent('pointerup', { ...o, buttons: 0, clientX: tx, clientY: ty }));
      }, { ref: d.p1.identifier, ...from, ...to });
    },
    oneMove: async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.tx, to.ty);
      await page.mouse.up();
    },
    noMove: async (from) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.up();
    },
  };
  for (const [kind, jump] of Object.entries(jumps)) {
    await page.goto(`${BASE}/projects/${String(d.nextline.id)}?peek=${d.r1.identifier}`);
    await page.locator('.nl-peek .ttl-edit').waitFor();
    await card(page, d.p1.identifier).waitFor();
    const fb = await card(page, d.p1.identifier).locator('.hit').boundingBox();
    const tb = await page.locator('section[data-col="todo"]').boundingBox();
    await jump({ x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 }, { tx: tb.x + tb.width / 2, ty: tb.y + 60 });
    await page.waitForTimeout(300);
    const stuck = await page.locator('.board-wrap.is-dragging').count();
    await expectOnBoard(`1f. ${kind}：拖拉沒完成，卡片留在進行中、看板沒卡在拖曳中`, d.p1.identifier, 'In Progress');
    step(`1f. ${kind}：沒有留下「拖曳中」`, stuck === 0, { stuck });
    await card(page, d.p1.identifier).locator('.hit').focus();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await expectOnBoard(`1f. ${kind} 之後 Cmd+→：卡片馬上到待驗收`, d.p1.identifier, 'In Review');
    await poll(() => issueOf(d.p1.identifier), (i) => i.status === 'In Review', `${kind} 之後 Cmd+→ 寫進 API`);
    await undoToast(`${d.p1.identifier} 已移到`);
    await expectOnBoard(`1f. ${kind} 之後復原：卡片馬上回進行中`, d.p1.identifier, 'In Progress');
    await poll(() => issueOf(d.p1.identifier), (i) => i.status === 'In Progress', `${kind} 之後復原寫進 API`);
    await settle(page);
    // 再用正常的拖拉搬一次，確認拖拉還能用、沒有錯誤畫面
    await dragTo(page, card(page, d.p1.identifier).locator('.hit'), page.locator('section[data-col="todo"]'));
    await expectOnBoard(`1f. ${kind} 之後正常拖拉：卡片馬上到 Todo`, d.p1.identifier, 'Todo');
    await poll(() => issueOf(d.p1.identifier), (i) => i.status === 'Todo', `${kind} 之後拖拉寫進 API`);
    await undoToast(`${d.p1.identifier} 已移到`);
    await expectOnBoard(`1f. ${kind} 之後拖拉再復原：回進行中`, d.p1.identifier, 'In Progress');
    await poll(() => issueOf(d.p1.identifier), (i) => i.status === 'In Progress', `${kind} 拖拉復原寫進 API`);
    await settle(page);
    await dismissToasts(page);
  }
  await shot(page, 'after-3-project-peek-after-jumps');

  const alive = {
    peek: await page.locator('.nl-peek .ttl-edit').count(),
    boundary: await page.locator('[data-error-boundary]').count(),
  };
  step('1. 全程預覽都開著、沒有錯誤畫面', alive.peek === 1 && alive.boundary === 0, alive);
  step('1. 沒有頁面錯誤（pageerror）', pageErrors.length === 0, { pageErrors });
  await page.keyboard.press('Escape');

  // ===== 2. toast「復原」300ms 內變「已復原」 =====
  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  await dragTo(page, card(page, d.t2.identifier).locator('.hit'), page.locator('section[data-col="in-progress"]'));
  await poll(() => issueOf(d.t2.identifier), (i) => i.status === 'In Progress', 't2 拖到進行中');
  const undoBtn = page.locator('.nl-toast', { hasText: `${d.t2.identifier} 已移到` }).getByRole('button', { name: '復原' });
  await undoBtn.waitFor();
  // 之後的請求都晚 1.5 秒才送出：舊版要等請求回來才改字，會超過 300ms
  await page.route('**/app-api/**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); });
  // 在頁面裡記下「按下去」與「出現已復原」的時間，用真的滑鼠點
  await page.evaluate(() => {
    window.__t = { click: null, undone: null };
    document.addEventListener('click', () => { window.__t.click ??= window.performance.now(); }, true);
    new MutationObserver(() => {
      if (window.__t.undone === null && [...document.querySelectorAll('.nl-toast .msg')].some((m) => m.textContent === '已復原')) window.__t.undone = window.performance.now();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await undoBtn.click();
  await page.locator('.nl-toast .msg', { hasText: '已復原' }).waitFor({ timeout: 3000 }).catch(() => {});
  const elapsed = await page.evaluate(() => (window.__t.undone === null || window.__t.click === null ? -1 : Math.round(window.__t.undone - window.__t.click)));
  const cardBackFast = await page.locator('section[data-col="todo"] .nl-card .id', { hasText: d.t2.identifier }).count();
  await shot(page, 'after-1-toast-undone');
  step('2. 按「復原」後「已復原」在 300ms 內出現（請求延遲 1.5 秒）', elapsed >= 0 && elapsed <= 300, { elapsedMs: elapsed });
  step('2. 卡片同時就回到 Todo（不等請求）', cardBackFast === 1);
  await page.unrouteAll({ behavior: 'wait' });
  await poll(() => issueOf(d.t2.identifier), (i) => i.status === 'Todo', '復原寫回 API');
  step('2. 背景寫入完成：API 回到 Todo', true);
  await dismissToasts(page);

  // ===== 3. 描述、comment、開票描述會長高 =====
  await page.goto(`${BASE}/issues/${d.t2.identifier}`);
  await page.locator('.ttl-edit').waitFor();
  await page.locator('.desc').getByRole('button', { name: '編輯' }).click();
  const desc = page.getByRole('textbox', { name: '描述（Markdown）' });
  const d0 = await box(desc);
  const minWant = Math.min(12 * d0.lineHeight + 19, d0.viewport / 2);
  step('3. 描述編輯框一打開就至少 12 行（或半個畫面高）', d0.height >= minWant - 2, { ...d0, minWant: Math.round(minWant) });
  await desc.fill(Array.from({ length: 40 }, (_, i) => `第 ${String(i + 1)} 行：驗收清單的一項`).join('\n'));
  await page.waitForTimeout(100);
  const d1 = await box(desc);
  step('3. 描述打到 40 行：框跟著長高、沒有內捲軸', d1.height > d0.height + 100 && !d1.innerScroll, d1);
  await desc.evaluate((el) => { el.scrollIntoView({ block: 'start' }); });
  await shot(page, 'after-2-description-tall');
  await page.keyboard.press('Escape');
  const cmt = page.getByRole('textbox', { name: '寫 comment（Markdown）' });
  const c0 = await box(cmt);
  await cmt.fill(Array.from({ length: 12 }, (_, i) => `comment 第 ${String(i + 1)} 行`).join('\n'));
  await page.waitForTimeout(100);
  const c1 = await box(cmt);
  step('3. comment 打到 12 行：框跟著長高、沒有內捲軸', c1.height > c0.height && !c1.innerScroll, { before: c0.height, after: c1.height });
  await cmt.scrollIntoViewIfNeeded();
  await shot(page, 'after-2-comment-grow');
  await cmt.fill('');
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('c');
  const create = page.getByRole('dialog', { name: '建立票' });
  await create.waitFor();
  const cd = create.getByRole('textbox', { name: /描述/ });
  const k0 = await box(cd);
  await cd.fill(Array.from({ length: 14 }, (_, i) => `描述第 ${String(i + 1)} 行`).join('\n'));
  await page.waitForTimeout(100);
  const k1 = await box(cd);
  step('3. 開票對話框的描述也跟著長高、沒有內捲軸', k1.height > k0.height && !k1.innerScroll, { before: k0.height, after: k1.height });
  await shot(page, 'after-2-create-grow');
  await cd.fill('');
  await page.keyboard.press('Escape');
  await create.waitFor({ state: 'detached' });

  // ===== 4. 網頁新增、修改 Project =====
  await page.goto(`${BASE}/projects`);
  await page.locator('.proj-row').first().waitFor();
  await page.locator('[data-new-project]').first().click();
  const pd = page.getByRole('dialog', { name: '新增 Project' });
  await pd.waitFor();
  step('4. 新增 Project：名稱空白時「建立」不能按，沒有狀態欄（NX-165 拿掉 Project 狀態）', (await pd.getByRole('button', { name: /^建立/ }).isDisabled()) && (await pd.locator('select').count()) === 0);
  await pd.getByLabel('名稱（必填）').fill('Gem TD');
  await pd.getByRole('button', { name: /^建立/ }).click();
  await pd.locator('.nl-error', { hasText: '名稱「Gem TD」已被使用' }).waitFor();
  step('4. 名稱重複：對話框裡說明，不送出', (await pd.count()) === 1);
  await shot(page, 'after-4-project-dup');
  const newName = 'NX-160 試用回饋';
  await pd.getByLabel('名稱（必填）').fill(newName);
  await pd.getByRole('textbox', { name: '說明（Markdown）' }).fill('## 目標\n\n把第一次試用的回饋修掉。');
  await shot(page, 'after-4-project-create');
  await pd.getByRole('button', { name: /^建立/ }).click();
  await page.waitForURL(/\/projects\/\d+$/);
  const newId = Number(new URL(page.url()).pathname.split('/').pop());
  await page.locator('.proj-head h1', { hasText: newName }).waitFor();
  const apiNew = await api('GET', `/projects/${String(newId)}`);
  // NX-165：一張票都沒有的 Project 也放側欄，剛建好就找得到
  await page.locator('.app-side .nl-nav-item', { hasText: newName }).waitFor({ timeout: 2000 });
  step('4. 建立後進到新 Project 頁、側欄馬上出現（沒重新整理）、API 存了名稱與說明、沒有 status', apiNew.name === newName && !('status' in apiNew) && apiNew.description.includes('把第一次試用'), { id: newId });
  await page.locator('[data-edit-project]').click();
  const ed = page.getByRole('dialog', { name: '編輯 Project' });
  await ed.waitFor();
  await ed.getByLabel('名稱（必填）').fill(`${newName}（改）`);
  step('4. 編輯 Project 沒有狀態欄', (await ed.locator('select').count()) === 0);
  await ed.getByRole('textbox', { name: '說明（Markdown）' }).fill('改過的說明');
  await shot(page, 'after-4-project-edit');
  await ed.getByRole('button', { name: /^儲存/ }).click();
  await ed.waitFor({ state: 'detached' });
  await page.locator('.proj-head h1', { hasText: '（改）' }).waitFor();
  const apiEdited = await api('GET', `/projects/${String(newId)}`);
  step('4. Project 頁改名稱、說明：API 都改了；頁首沒有狀態標籤', apiEdited.name === `${newName}（改）` && !('status' in apiEdited) && apiEdited.description === '改過的說明' && (await page.locator('.proj-status').count()) === 0);
  await page.locator('.proj-tabs [data-tab="about"]').click();
  await page.locator('.proj-about', { hasText: '改過的說明' }).waitFor();
  await shot(page, 'after-4-project-edited');

  // ===== 5. 封存 =====
  await page.goto(`${BASE}/`);
  await card(page, d.r2.identifier).waitFor();
  await page.locator('.app-side [data-nav-count="waiting"]').waitFor();
  const waitBefore = await waitingCount(page);
  await card(page, d.r2.identifier).locator('.hit').click();
  await page.locator('.nl-peek .ttl-edit').waitFor();
  await page.locator('.nl-peek [data-more]').click();
  await page.getByRole('menuitem', { name: '封存這張票' }).click();
  await card(page, d.r2.identifier).waitFor({ state: 'detached', timeout: 2000 });
  const archToast = page.locator('.nl-toast', { hasText: `已封存 ${d.r2.identifier}` });
  await archToast.waitFor();
  const archived = await poll(() => issueOf(d.r2.identifier), (i) => i.archived_at !== null, '封存寫進 API');
  await page.waitForFunction((n) => Number(document.querySelector('.app-side [data-nav-count="waiting"]')?.textContent ?? '0') === n, waitBefore - 1, { timeout: 3000 });
  step('5. 預覽「⋯」封存：卡片從看板消失、等你張數 -1、預覽頂端顯示已封存、API 有 archived_at', (await page.locator('.nl-peek [data-archived]').count()) === 1, { waitBefore, archived_at: archived.archived_at });
  await shot(page, 'after-C-archived-peek');
  await archToast.getByRole('button', { name: '復原' }).click();
  await card(page, d.r2.identifier).waitFor({ timeout: 2000 });
  await poll(() => issueOf(d.r2.identifier), (i) => i.archived_at === null, '復原取消封存');
  const ev = (await api('GET', `/issues/${d.r2.identifier}/events`)).events.filter((e) => e.field === 'archived');
  step('5. toast「復原」：卡片回來、API 取消封存，變更紀錄是封存＋還原', ev.length === 2 && ev[1].revert_of_event_id === ev[0].id, { events: ev.map((e) => [e.id, e.from_value === null, e.to_value === null, e.revert_of_event_id]) });
  await dismissToasts(page);
  // Cmd+K 封存（開著這張票時）
  // 開著這張票（預覽）時才有「封存這張票」
  await page.goto(`${BASE}/?peek=${d.r2.identifier}`);
  await page.locator('.nl-peek .ttl-edit').waitFor();
  await card(page, d.r2.identifier).waitFor();
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.nl-palette input').waitFor();
  await page.locator('.nl-palette input').fill('封存');
  await page.locator('.nl-palette [role="option"]', { hasText: '封存這張票' }).first().waitFor();
  await shot(page, 'after-C-palette-archive');
  await page.keyboard.press('Enter');
  await card(page, d.r2.identifier).waitFor({ state: 'detached', timeout: 2000 });
  await poll(() => issueOf(d.r2.identifier), (i) => i.archived_at !== null, 'Cmd+K 封存');
  step('5. Cmd+K「封存這張票」：卡片消失、API 封存', true);
  await dismissToasts(page);
  await page.goto(`${BASE}/issues?status=in_review`);
  await page.locator('[data-count="list"]').waitFor();
  step('5. 封存的票不在「等你」列表', (await page.locator(`a.nl-row[data-n="${String(d.r2.number)}"]`).count()) === 0);
  await page.goto(`${BASE}/issues`);
  await page.locator('a.nl-row').first().waitFor();
  step('5. 封存的票不在「全部的票」', (await page.locator(`a.nl-row[data-n="${String(d.r2.number)}"]`).count()) === 0);
  await page.locator('[data-filter="archived"]').click();
  await page.waitForURL((u) => u.searchParams.get('archived') === '1');
  await page.locator(`[data-unarchive="${d.r2.identifier}"]`).waitFor();
  step('5. 「已封存」列表：只有封存的票，標題「已封存」，每列有取消封存', (await page.locator('a.nl-row').count()) === 1 && (await page.locator('.topbar h1').textContent()) === '已封存');
  await shot(page, 'after-C-archived-list');
  await page.goto(`${BASE}/issues/${d.r2.identifier}`);
  await page.locator('[data-archived]').waitFor();
  step('5. 直接打開已封存的票：頂端「已封存」＋取消封存', (await page.locator('[data-archived]').getByRole('button', { name: '取消封存' }).count()) === 1);
  await shot(page, 'after-C-archived-page');
  await page.goto(`${BASE}/issues?archived=1`);
  await page.locator(`[data-unarchive="${d.r2.identifier}"]`).click();
  await page.locator(`a.nl-row[data-n="${String(d.r2.number)}"]`).waitFor({ state: 'detached', timeout: 2000 });
  await page.locator('.nl-toast', { hasText: `已取消封存 ${d.r2.identifier}` }).waitFor();
  await poll(() => issueOf(d.r2.identifier), (i) => i.archived_at === null, '列表取消封存');
  await shot(page, 'after-C-unarchived');
  await page.goto(`${BASE}/`);
  await card(page, d.r2.identifier).waitFor();
  step('5. 「已封存」取消封存：列表拿掉、API 取消封存、卡片回到看板', true);

  // ===== 6. 拿掉的頁面轉回看板；看板沒有 Sprint =====
  for (const path of ['/zones', '/sprints/1', '/views/1']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForURL(`${BASE}/`);
  }
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
  step('6. /zones、/sprints/1、/views/1 轉回看板；側欄與看板都沒有 Sprint', !(await page.locator('.app').textContent()).includes('Sprint'));
  const kbdDesktop = await page.locator('.nl-kbd').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
  step('6. 桌面照樣顯示鍵盤提示', kbdDesktop > 0, { kbdDesktop });
  await shot(page, 'after-6B-board-1280');
  step('桌面沒有頁面錯誤', pageErrors.length === 0, { pageErrors, consoleErrors });
  await ctx.close();

  // ===== 7. 手機觸控：沒有鍵盤提示 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const mErrors = [];
    mp.on('pageerror', (e) => { mErrors.push(String(e)); });
    const visibleKbd = () => mp.locator('.nl-kbd').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent));
    await mp.goto(`${BASE}/`);
    await mp.locator('.nl-card').first().waitFor();
    const k1 = await visibleKbd();
    await shot(mp, `after-5-mobile-board-${scheme}`);
    await mp.goto(`${BASE}/issues/${d.t1.identifier}`);
    await mp.locator('.ttl-edit').waitFor();
    const ph = await mp.getByRole('textbox', { name: '寫 comment（Markdown）' }).getAttribute('placeholder');
    await mp.locator('.desc').getByRole('button', { name: '編輯' }).tap();
    const dph = await mp.getByRole('textbox', { name: '描述（Markdown）' }).getAttribute('placeholder');
    const k2 = await visibleKbd();
    await shot(mp, `after-5-mobile-detail-${scheme}`);
    await mp.locator('.nl-fab').tap();
    await mp.getByRole('dialog', { name: '建立票' }).waitFor();
    const k3 = await visibleKbd();
    await shot(mp, `after-5-mobile-create-${scheme}`);
    if (scheme === 'light') {
      step('7. 手機：看板、票詳細、開票對話框都看不到鍵盤提示', k1.length + k2.length + k3.length === 0, { board: k1, detail: k2, create: k3 });
      step('7. 手機：placeholder 沒有快捷鍵', !/[⌘↵]|Esc/.test(`${ph ?? ''}${dph ?? ''}`), { comment: ph, description: dph });
      step('7. 手機沒有頁面錯誤', mErrors.length === 0, { mErrors });
    }
    await m.close();
  }

  writeFileSync(join(outDir, 'e2e-result.json'), `${JSON.stringify({ ok: true, base: BASE, persist, results }, null, 2)}\n`);
  console.log(`\n全部通過（${String(results.length)} 步），截圖在 ${outDir}`);
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
