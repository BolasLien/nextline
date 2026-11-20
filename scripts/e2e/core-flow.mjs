// NX-158：切換上線前的核心流程端對端測試。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，
// 用 Playwright 在瀏覽器走一次：
//   看板按 C 開票 → 拖到 In Progress → 拖到待驗收 → 預覽「通過」→ Done → toast「復原」回到待驗收。
// 每一步對照 /app-api 的狀態與變更紀錄；另外確認 /legacy 舊網址 301 轉到新網頁對應的路徑。
// 最後截上線用的畫面：看板、全部的票、票詳細、等你（待驗收） × 1280／375 × 淺色／深色，量測沒有橫向捲動。
//
// 用法（repo 根目錄，.dev.vars 要有 DEV_SKIP_ACCESS=1）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8793] node scripts/e2e/core-flow.mjs
// 輸出：.scratch/screenshots/golive/*.png、.scratch/screenshots/golive/e2e-result.json。
// 本機 D1 放在 .scratch/e2e-core-flow/<時間>/（每次新的一份）。正式站不跑這支（會開測試票）。

/* global document, window -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/golive');
const persist = join(repo, '.scratch/e2e-core-flow', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8793);
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
  const nextline = await api('POST', '/projects', { name: 'Nextline 第二版', description: '# 第二版\n可商用的任務系統。' });
  const gem = await api('POST', '/projects', { name: 'Gem TD' });
  const mk = (title, status, project, extra = {}) =>
    api('POST', '/issues', { title, status, project_id: project?.id ?? null, sprint_id: sprint.id, ...extra });
  const say = (issue, author, body) => api('POST', `/issues/${issue.identifier}/comments`, { author, body });
  const t1 = await mk('整理第二版的驗收清單', 'Todo', nextline);
  await say(t1, '阿澈', '草稿在描述。\n下一步：Bolas 看過清單，把不要的劃掉');
  const p1 = await mk('列表頁：篩選與存成 view', 'In Progress', nextline);
  await say(p1, 'claude-nextline', '篩選列做好一半。\n下一步：claude-nextline 接著做存成 view');
  const r1 = await mk('設計系統：深色模式對比修正', 'In Review', nextline, { description: '對比都要過 WCAG AA。\n\n- 文字 4.5:1\n- 大字 3:1' });
  await say(r1, 'claude-nextline', '對比都過了，截圖在 `.scratch/screenshots/`。\n下一步：Bolas 驗收深色模式截圖');
  await mk('寶石 3 階的材質再亮一點', 'Todo', gem);
  await mk('前端骨架：shell、router、toast', 'Done', nextline);
  await mk('通知：agent 做完時寄信', 'Backlog', nextline);
  return { sprint, nextline, t1, p1, r1 };
}

// ---- 瀏覽器 ----

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      viewport: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      pageHorizontalScroll: doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > doc.clientWidth,
    };
  });
}

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
  const ty = to.y + to.height / 2;
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
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
}

async function dismissToasts(page) {
  for (const btn of await page.locator('.nl-toast .x').all()) await btn.click().catch(() => {});
  await page.waitForTimeout(150);
}

const card = (page, ref) => page.locator('.nl-card', { has: page.locator('.id', { hasText: new RegExp(`^${ref}$`) }) });
const measures = {};
let browser;

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const data = await seed();

  // ===== /legacy 舊網址 =====
  const legacyCases = [
    ['/legacy', '/'],
    [`/legacy/issues/${data.r1.identifier}`, `/issues/${data.r1.identifier}`],
    [`/legacy/projects/${String(data.nextline.id)}`, `/projects/${String(data.nextline.id)}`],
    ['/legacy/whatever', '/'],
  ];
  for (const [from, to] of legacyCases) {
    const res = await fetch(`${BASE}${from}`, { redirect: 'manual' });
    step(`/legacy 轉址：${from} → ${to}`, res.status === 301 && res.headers.get('Location') === to, { status: res.status, location: res.headers.get('Location') });
  }

  // ===== 核心流程（1280 淺色）=====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // 舊書籤在瀏覽器裡也會落到新網頁
  await page.goto(`${BASE}/legacy/issues/${data.r1.identifier}`);
  await page.locator('.ttl-edit').waitFor();
  step('瀏覽器打開舊書籤 /legacy/issues/NX-n：落在新版票整頁', new URL(page.url()).pathname === `/issues/${data.r1.identifier}`, { url: page.url() });

  await page.goto(`${BASE}/`);
  await page.locator('section[data-col="todo"] .nl-card').first().waitFor();

  // 1. 開票
  await page.evaluate(() => { if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: '建立票' });
  await dialog.waitFor();
  await dialog.getByLabel('標題（必填）').fill('核心流程：從開票走到 Done');
  await page.keyboard.press('ControlOrMeta+Enter');
  await dialog.waitFor({ state: 'detached' });
  const toast = page.locator('.nl-toast', { hasText: /已建立 NX-\d+/ });
  await toast.waitFor();
  const ref = (await toast.locator('.msg').textContent()).replace('已建立 ', '').trim();
  await card(page, ref).waitFor();
  const created = await api('GET', `/issues/${ref}`);
  step('1. 按 C 開票：卡片出現在 Todo、API 查得到', created.status === 'Todo' && created.title === '核心流程：從開票走到 Done' && (await page.locator(`section[data-col="todo"] .nl-card .id`, { hasText: ref }).count()) === 1, { ref, status: created.status });
  await dismissToasts(page);

  // 2. 拖到 In Progress
  await dragTo(page, card(page, ref).locator('.hit'), page.locator('section[data-col="in-progress"]'));
  await waitStatus(ref, 'In Progress');
  await settle(page);
  step('2. 拖到 In Progress：API 狀態改了、卡片在進行中欄', (await page.locator(`section[data-col="in-progress"] .nl-card .id`, { hasText: ref }).count()) === 1);
  await dismissToasts(page);

  // 3. 拖到待驗收
  await dragTo(page, card(page, ref).locator('.hit'), page.locator('section[data-col="in-review"]'));
  await page.locator('.nl-toast', { hasText: `${ref} 已移到「待驗收」` }).waitFor();
  const inReview = await waitStatus(ref, 'In Review');
  await settle(page);
  step('3. 拖到待驗收：API 是 In Review、沒有 zone 欄位（NX-160）', (await page.locator(`section[data-col="in-review"] .nl-card .id`, { hasText: ref }).count()) === 1 && inReview.status === 'In Review' && !('zone' in inReview), { status: inReview.status });
  await dismissToasts(page);

  // 4. 預覽「通過」→ Done
  await card(page, ref).locator('.hit').click();
  await page.waitForURL(`**/?peek=${ref}`);
  const peek = page.locator('.nl-peek');
  await peek.locator('.nl-review').waitFor();
  await peek.getByRole('button', { name: /^通過/ }).click();
  await waitStatus(ref, 'Done');
  const doneToast = page.locator('.nl-toast', { hasText: `${ref} 已完成` });
  await doneToast.waitFor();
  await page.locator(`section[data-col="done"] .nl-card .id`, { hasText: ref }).waitFor({ timeout: 3000 });
  step('4. 預覽按「通過」：API 是 Done、卡片在 Done 欄、toast 附復原', (await doneToast.getByRole('button', { name: '復原' }).count()) === 1);
  await page.screenshot({ path: join(outDir, 'core-flow-1280-light-done.png') });

  // 5. 復原
  await doneToast.getByRole('button', { name: '復原' }).click();
  await waitStatus(ref, 'In Review');
  await page.locator(`section[data-col="in-review"] .nl-card .id`, { hasText: ref }).waitFor({ timeout: 3000 });
  const events = (await api('GET', `/issues/${ref}/events`)).events.filter((e) => e.field === 'status');
  const chain = events.map((e) => `${String(e.from_value)}→${String(e.to_value)}`);
  const last = events[events.length - 1];
  const done = events.find((e) => e.to_value === 'Done');
  step('5. 復原：回到待驗收；變更紀錄 Todo→In Progress→In Review→Done→In Review（還原）', JSON.stringify(chain) === JSON.stringify(['Todo→In Progress', 'In Progress→In Review', 'In Review→Done', 'Done→In Review']) && last.revert_of_event_id === done.id && done.reverted_by_event_id === last.id, { chain });
  await page.keyboard.press('Escape');
  step('核心流程沒有 console 錯誤', consoleErrors.length === 0, { consoleErrors });
  await ctx.close();

  // ===== 上線截圖：看板、全部的票、票詳細、等你 =====
  const screens = [
    ['board', '/', 'section[data-col="todo"] .nl-card'],
    ['issues', '/issues', 'a.nl-row'],
    ['detail', `/issues/${data.r1.identifier}`, '.ttl-edit'],
    ['waiting', '/issues?status=in_review', 'a.nl-row'],
  ];
  for (const [width, height, mobile] of [[1280, 860, false], [375, 812, true]]) {
    for (const scheme of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
      const p = await c.newPage();
      for (const [name, path, wait] of screens) {
        await p.goto(`${BASE}${path}`);
        await p.locator(wait).first().waitFor();
        await p.waitForTimeout(300);
        const key = `${name}-${String(width)}-${scheme}`;
        await p.screenshot({ path: join(outDir, `${key}.png`) });
        measures[key] = await measure(p);
      }
      await c.close();
    }
  }
  const scrolls = Object.entries(measures).filter(([, m]) => m.pageHorizontalScroll).map(([k]) => k);
  step('上線截圖 16 張都沒有橫向捲動', scrolls.length === 0, { scrolls });

  writeFileSync(join(outDir, 'e2e-result.json'), JSON.stringify({ ok: true, results, measures }, null, 2));
  console.log(`\n全部通過（${String(results.length)} 步），截圖在 ${outDir}`);
} catch (e) {
  writeFileSync(join(outDir, 'e2e-result.json'), JSON.stringify({ ok: false, error: String(e), results, measures }, null, 2));
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
