// NX-154：「全部的票」、Project 頁、「等你」的端對端測試（三區在 NX-160 拿掉）。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1），
// 用一份獨立的本機 D1 灌 170 多張票（跟正式站差不多多），再用 Playwright 在瀏覽器裡實際操作：
//   1. 進 /issues，張數跟 API 一致
//   2. 篩選 Project 和狀態（網址跟著變、張數跟 API 一致）
//   3. 重新整理，篩選還在
//   4. 點一列：桌面開右側預覽（?peek=NX-n）
//   5. 進 Project 頁，切換看板／列表／說明三個分頁（說明的 HTML 被跳脫）
//   6. 側欄「等你」＝待驗收（In Review）張數，點進去只剩待驗收；/zones 轉到 /、/me 轉到等你；側欄沒有三區與 Agent 工作中
//   7. 手機 375：篩選、重新整理、點一列進整頁、Project 分頁、底部「等你」、「更多」裡沒有三區
// 另外量捲動：列表捲到底的每一格畫面時間。截圖 1280／375 × 淺色／深色，量測沒有橫向捲動。
//
// 用法（repo 根目錄，.dev.vars 要有 DEV_SKIP_ACCESS=1）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8790] node scripts/e2e/views.mjs
// 輸出：.scratch/screenshots/views/*.png、.scratch/screenshots/views/e2e-result.json。
// 本機 D1 放在 .scratch/e2e-views/<時間>/（每次新的一份，不碰 .wrangler/state 的開發資料）。

/* global document, window -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/views');
const persist = join(repo, '.scratch/e2e-views', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8790);
const BASE = `http://localhost:${String(PORT)}`;
const DAY = 24 * 60 * 60 * 1000;
const OPEN = ['Backlog', 'Todo', 'In Progress', 'In Review'];

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

async function listAll(query) {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const res = await api('GET', `/issues?${query}&limit=200&offset=${String(offset)}`);
    out.push(...res.issues);
    if (!res.has_more) return out;
  }
}

// ---- 測試資料 ----

async function seed() {
  const now = Date.now();
  const sprint = await api('POST', '/sprints', { number: 1, starts_at: new Date(now - 2 * DAY).toISOString(), ends_at: new Date(now + 12 * DAY).toISOString() });
  const nextline = await api('POST', '/projects', {
    name: 'Nextline 第二版：可商用',
    description: '## 目標\n\n讓 **Bolas** 和 agent 都用同一套票。\n\n- 看板\n- 列表\n\n<script>window.__xss = 1</script> <img src=x onerror="window.__xss = 2">\n\n[壞連結](javascript:alert(1))',
  });
  const gem = await api('POST', '/projects', { name: 'Gem TD', description: '' });
  const travel = await api('POST', '/projects', { name: '旅遊剪片 Agent', description: '旅遊影片。' });
  const projects = [nextline, gem, travel];

  const mk = (title, status, project, extra = {}) =>
    api('POST', '/issues', { title, status, project_id: project?.id ?? null, sprint_id: extra.sprint === false ? null : sprint.id, ...extra, sprint: undefined });
  const say = (issue, body) => api('POST', `/issues/${issue.identifier}/comments`, { author: '阿澈', body });

  // 有名字的幾張：待驗收、進行中、Todo 各種情況
  const review = await mk('設計系統：深色模式對比修正', 'In Review', nextline);
  await say(review, '下一步：Bolas 驗收深色模式截圖');
  const aiWork = await mk('列表頁：篩選與分組', 'In Progress', nextline);
  await say(aiWork, '篩選列做好一半。\n下一步：claude-nextline 接著做分組');
  const youTodo = await mk('整理第二版的驗收清單', 'Todo', nextline);
  await say(youTodo, '下一步：Bolas 看過清單，把不要的劃掉');
  const gemAi = await mk('寶石 3 階的材質再亮一點', 'Todo', gem);
  await say(gemAi, '下一步：agent 依回饋調材質');
  await mk('旅遊影片第二支：京都三天', 'In Progress', travel);
  await mk('甘特圖', 'Backlog', null, { sprint: false });
  await mk('前端骨架：shell、router、toast', 'Done', nextline);
  await mk('舊版首頁的三區改成看板', 'Canceled', nextline);

  // 其餘 160 張：輪流分到各 Project、各狀態，更新時間錯開（跟正式站一樣多，量捲動）
  const statuses = ['Backlog', 'Backlog', 'Todo', 'In Progress', 'Done', 'Backlog', 'Todo', 'Canceled'];
  for (let k = 0; k < 160; k++) {
    const status = statuses[k % statuses.length];
    const project = k % 7 === 0 ? null : projects[k % projects.length];
    const issue = await mk(`第 ${String(k + 1)} 張：${['調整看板卡片', '補文件', '修手機版', '研究 agent 用法', '整理素材'][k % 5]}${k % 3 === 0 ? '，順便把很長很長的標題截斷看看會不會撐破版面' : ''}`, status, project, {
      sprint: k % 2 === 0 ? undefined : false,
      updated_at: new Date(now - k * 3600 * 1000).toISOString(),
    });
    if (k % 4 === 0) await say(issue, `下一步：${k % 8 === 0 ? 'agent 接著做' : 'Bolas 決定要不要做'}`);
  }
  return { sprint, nextline, gem, travel, review, aiWork, youTodo };
}

// ---- 瀏覽器 ----

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      viewport: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageHorizontalScroll: doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > doc.clientWidth,
    };
  });
}

async function listCount(page) {
  const t = await page.locator('[data-count="list"]').textContent();
  return Number(t.replace(/\D/g, ''));
}

// 換條件後要重抓，等張數變成預期的數字（等不到就照實際的值往下比對）。
async function waitCount(page, n) {
  await page.waitForFunction((want) => document.querySelector('[data-count="list"]')?.textContent?.replace(/\D/g, '') === String(want), n, { timeout: 5000 }).catch(() => {});
}

async function waitRows(page) {
  await page.locator('a.nl-row').first().waitFor();
  await page.locator('[data-count="list"]').waitFor();
}

// 捲到底：每一格畫面的時間（ms）。超過 50ms 算卡。
async function scrollFrames(page) {
  return page.evaluate(async () => {
    const view = document.querySelector('.list-view');
    const frames = [];
    let last = performance.now();
    const total = view.scrollHeight - view.clientHeight;
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      view.scrollTop = (total * i) / steps;
      await new Promise((r) => requestAnimationFrame(r));
      const t = performance.now();
      frames.push(t - last);
      last = t;
    }
    frames.sort((a, b) => a - b);
    return {
      rows: document.querySelectorAll('a.nl-row').length,
      scrollHeight: view.scrollHeight,
      frames: frames.length,
      p50: Math.round(frames[Math.floor(frames.length / 2)]),
      p95: Math.round(frames[Math.floor(frames.length * 0.95)]),
      max: Math.round(frames[frames.length - 1]),
      longFrames: frames.filter((f) => f > 50).length,
    };
  });
}

async function navCounts(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.app-side [data-nav-count]')].map((el) => [el.getAttribute('data-nav-count'), Number(el.textContent)])));
}

const measures = {};
const perf = {};
let browser;

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  measures[name] = await measure(page);
}

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const data = await seed();
  const allOpen = await listAll(`status=${OPEN.join(',')}`);
  console.log(`灌好資料：沒做完 ${String(allOpen.length)} 張`);

  // ===== 桌面 1280 =====
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { consoleErrors.push(String(e)); });

  // 1. 進 /issues
  await page.goto(`${BASE}/issues`);
  await waitRows(page);
  step('1. /issues：預設只列沒做完的四種，張數跟 API 一致', (await listCount(page)) === allOpen.length && (await page.locator('a.nl-row').count()) === allOpen.length, {
    ui: await listCount(page),
    api: allOpen.length,
  });
  const headers = await page.locator('.grp-h').allTextContents();
  step('1. 預設依狀態分組（Backlog、Todo、In Progress、待驗收）', headers.length === 4 && headers[0].startsWith('Backlog') && headers[3].startsWith('待驗收'), { headers });
  const firstRow = page.locator('a.nl-row').first();
  const rowParts = {
    id: await firstRow.locator('.id').textContent(),
    proj: await firstRow.locator('.proj').textContent(),
    upd: await firstRow.locator('.upd').textContent(),
  };
  step('1. 每列有狀態、票號、標題、Project、下一步、更新時間', (await firstRow.locator('.st[role="img"]').count()) === 1 && /^NX-\d+$/.test(rowParts.id) && rowParts.upd !== '', rowParts);
  perf['1280-全部沒做完'] = await scrollFrames(page);
  step('1. 捲到底很順（沒有超過 50ms 的畫面）', perf['1280-全部沒做完'].longFrames === 0, perf['1280-全部沒做完']);
  await page.locator('.list-view').evaluate((el) => { el.scrollTop = 0; });
  await shot(page, 'issues-1280-light');

  // 2. 篩選 Project 和狀態
  await page.locator('[data-filter="project"]').click();
  await page.getByRole('menuitemcheckbox', { name: data.nextline.name }).click();
  await page.waitForURL((u) => u.searchParams.get('project') === String(data.nextline.id));
  await page.locator('[data-filter="status"]').click();
  await page.getByRole('menuitemcheckbox', { name: 'Backlog' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  await page.waitForURL((u) => u.searchParams.get('status') === 'todo,in_progress,in_review,done');
  await page.waitForTimeout(400);
  const filtered = await listAll(`status=Todo,In Progress,In Review,Done&project=${String(data.nextline.id)}`);
  await waitRows(page);
  await waitCount(page, filtered.length);
  step('2. 篩選 Project＋狀態：網址寫進 project 與 status，張數跟 API 一致', (await listCount(page)) === filtered.length, {
    url: page.url().replace(BASE, ''),
    ui: await listCount(page),
    api: filtered.length,
  });
  const projNames = new Set(await page.locator('a.nl-row .proj .nm').allTextContents());
  step('2. 每一列都是這個 Project', projNames.size === 1 && projNames.has(data.nextline.name), { projNames: [...projNames] });
  // 分組與排序也寫進網址
  await page.locator('[data-filter="group"]').click();
  await page.getByRole('menuitemcheckbox', { name: '不分組' }).click();
  await page.locator('[data-filter="sort"]').click();
  await page.getByRole('menuitemcheckbox', { name: /票號/ }).click();
  await page.waitForURL((u) => u.searchParams.get('group') === 'none' && u.searchParams.get('sort') === 'number');
  await page.locator('.grp-h').first().waitFor({ state: 'detached' });
  await page.waitForTimeout(200);
  const ids = (await page.locator('a.nl-row .id').allTextContents()).map((s) => Number(s.replace('NX-', '')));
  step('2. 不分組、依票號（大到小）', (await page.locator('.grp-h').count()) === 0 && ids.every((n, i) => i === 0 || ids[i - 1] > n), { first: ids.slice(0, 5) });
  // 文字搜尋
  await page.getByRole('searchbox', { name: '搜尋票號或標題' }).fill('驗收清單');
  await page.waitForURL((u) => u.searchParams.get('q') === '驗收清單');
  await page.waitForTimeout(200);
  step('2. 文字搜尋寫進網址 q，只剩符合的票', (await page.locator('a.nl-row').count()) === 1 && (await page.locator('a.nl-row .id').textContent()) === data.youTodo.identifier);
  await shot(page, 'issues-1280-light-filtered');
  const urlBefore = page.url();

  // 3. 重新整理，篩選還在
  await page.reload();
  await waitRows(page);
  step('3. 重新整理：網址、篩選 chip、搜尋框、結果都還在', page.url() === urlBefore && (await page.locator('[data-filter="project"]').textContent()).includes(data.nextline.name) && (await page.getByRole('searchbox').inputValue()) === '驗收清單' && (await page.locator('a.nl-row').count()) === 1, {
    url: page.url().replace(BASE, ''),
    statusChip: await page.locator('[data-filter="status"]').textContent(),
  });

  // 4. 點一列，開出預覽
  await page.locator('a.nl-row').first().click();
  await page.waitForURL((u) => u.searchParams.get('peek') === data.youTodo.identifier);
  await page.locator('.nl-peek .ttl-edit').waitFor();
  step('4. 點一列：右側預覽打開（?peek=），其他篩選參數留著、那一列標成目前', (await page.locator('.nl-peek .ttl-edit').textContent()).includes('驗收清單') && new URL(page.url()).searchParams.get('q') === '驗收清單' && (await page.locator('a.nl-row.is-peek').count()) === 1, {
    url: page.url().replace(BASE, ''),
  });
  await shot(page, 'issues-1280-light-peek');
  await page.keyboard.press('Escape');
  await page.locator('.nl-peek').waitFor({ state: 'detached' });
  // 清除篩選
  await page.getByRole('button', { name: '清除篩選' }).first().click();
  await page.waitForURL((u) => !u.searchParams.has('q') && !u.searchParams.has('project') && !u.searchParams.has('status'));
  await waitCount(page, allOpen.length);
  step('清除篩選：回到全部沒做完，分組排序留著', (await listCount(page)) === allOpen.length && new URL(page.url()).searchParams.get('group') === 'none');

  // 5. Project 頁三個分頁
  const projectOpen = allOpen.filter((i) => i.project_id === data.nextline.id);
  await page.goto(`${BASE}/projects/${String(data.nextline.id)}`);
  await page.locator('.proj-head h1').waitFor();
  await page.locator('section.nl-col').first().waitFor();
  await page.locator('[data-count="project-open"]').waitFor();
  step('5. Project 頁首：名稱、色點、沒做完張數跟 API 一致', (await page.locator('.proj-head h1').textContent()) === data.nextline.name && (await page.locator('.proj-head .nl-pdot').count()) === 1 && (await page.locator('[data-count="project-open"]').textContent()).startsWith(String(projectOpen.length)), {
    count: await page.locator('[data-count="project-open"]').textContent(),
    api: projectOpen.length,
  });
  const cardNs = (await page.locator('.nl-card').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-n')))));
  const projectAll = await listAll(`project=${String(data.nextline.id)}&status=${['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled'].join(',')}`);
  const projectNumbers = new Set(projectAll.map((i) => i.number));
  step('5. 看板分頁：只有這個 Project 的票', cardNs.length > 0 && cardNs.every((n) => projectNumbers.has(n)), { cards: cardNs.length });
  await shot(page, 'project-1280-light-board');
  await page.locator('.proj-tabs [data-tab="list"]').click();
  await page.waitForURL((u) => u.searchParams.get('tab') === 'list');
  await waitRows(page);
  await waitCount(page, projectOpen.length);
  step('5. 列表分頁：預先套 Project 篩選（沒有 Project chip），張數跟 API 一致', (await listCount(page)) === projectOpen.length && (await page.locator('[data-filter="project"]').count()) === 0, {
    ui: await listCount(page),
    api: projectOpen.length,
  });
  await shot(page, 'project-1280-light-list');
  await page.locator('.proj-tabs [data-tab="about"]').click();
  await page.waitForURL((u) => u.searchParams.get('tab') === 'about');
  await page.locator('.proj-about .md').waitFor();
  const xss = await page.evaluate(() => ({
    flag: window.__xss ?? null,
    scripts: document.querySelectorAll('.proj-about script, .proj-about img').length,
    jsLinks: document.querySelectorAll('.proj-about a[href^="javascript"]').length,
    text: document.querySelector('.proj-about').textContent,
  }));
  step('5. 說明分頁：Markdown 有排版，HTML 被跳脫成文字（沒有執行）', (await page.locator('.proj-about h3').textContent()) === '目標' && xss.flag === null && xss.scripts === 0 && xss.jsLinks === 0 && xss.text.includes('<script>'), xss);
  await shot(page, 'project-1280-light-about');
  await page.locator('.proj-tabs [data-tab="board"]').click();
  await page.waitForURL((u) => !u.searchParams.has('tab'));
  await page.locator('section.nl-col').first().waitFor();
  step('5. 切回看板分頁', true);

  // /projects
  await page.goto(`${BASE}/projects`);
  await page.locator('.proj-row').first().waitFor();
  await page.locator(`[data-open-count="${String(data.nextline.id)}"]`, { hasText: '張沒做完' }).waitFor();
  const pc = Object.fromEntries(await Promise.all([data.nextline, data.gem, data.travel].map(async (p) => [p.name, Number((await page.locator(`[data-open-count="${String(p.id)}"]`).textContent()).replace(/\D/g, ''))])));
  const pcApi = Object.fromEntries([data.nextline, data.gem, data.travel].map((p) => [p.name, allOpen.filter((i) => i.project_id === p.id).length]));
  step('/projects：每個 Project 的沒做完張數跟 API 一致', JSON.stringify(pc) === JSON.stringify(pcApi), { ui: pc, api: pcApi });
  await shot(page, 'projects-1280-light');

  // 6. 等你＝待驗收（NX-160 拿掉三區）
  const inReview = allOpen.filter((i) => i.status === 'In Review');
  await page.goto(`${BASE}/`);
  await page.locator('.app-side [data-nav-count="waiting"]').waitFor();
  const nav = await navCounts(page);
  step('6. 側欄「等你」張數＝API 待驗收（In Review）的張數', nav.waiting === inReview.length, { nav, api: inReview.length });
  step('6. 側欄沒有三區、沒有「我的 view／Agent 工作中」', (await page.locator('.app-side a[href="/zones"]').count()) === 0 && !(await page.locator('.app-side').textContent()).includes('Agent 工作中') && !(await page.locator('.app-side').textContent()).includes('我的 view'));
  await page.locator('.app-side a[href="/issues?status=in_review"]').click();
  await page.waitForURL('**/issues?status=in_review');
  await waitRows(page);
  await waitCount(page, inReview.length);
  step('6. 點「等你」：列表只剩待驗收，張數＝側欄，標題是「等你」，側欄標成目前頁', (await listCount(page)) === inReview.length && (await page.locator('.topbar h1').textContent()) === '等你' && (await page.locator('.app-side a[href="/issues?status=in_review"][aria-current="page"]').count()) === 1, { ui: await listCount(page) });
  await shot(page, 'waiting-1280-light');
  await page.goto(`${BASE}/zones`);
  await page.waitForURL(`${BASE}/`);
  step('6. 舊網址 /zones 轉到看板 /', true, { url: page.url() });
  await page.goto(`${BASE}/me`);
  await page.waitForURL('**/issues?status=in_review');
  step('6. /me 轉到等你（待驗收）', true, { url: page.url().replace(BASE, '') });
  step('桌面沒有 console 錯誤', consoleErrors.length === 0, { consoleErrors });
  await ctx.close();

  // 深色截圖
  const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  const dp = await dark.newPage();
  for (const [name, path, wait] of [
    ['issues-1280-dark', '/issues', 'a.nl-row'],
    ['project-1280-dark-board', `/projects/${String(data.nextline.id)}`, 'section.nl-col'],
    ['project-1280-dark-list', `/projects/${String(data.nextline.id)}?tab=list`, 'a.nl-row'],
    ['project-1280-dark-about', `/projects/${String(data.nextline.id)}?tab=about`, '.proj-about .md'],
    ['projects-1280-dark', '/projects', '.proj-row'],
    ['waiting-1280-dark', '/issues?status=in_review', 'a.nl-row'],
  ]) {
    await dp.goto(`${BASE}${path}`);
    await dp.locator(wait).first().waitFor();
    await shot(dp, name);
  }
  await dark.close();

  // ===== 7. 手機 375 =====
  for (const scheme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const mErrors = [];
    mp.on('pageerror', (e) => { mErrors.push(String(e)); });
    await mp.goto(`${BASE}/issues`);
    await waitRows(mp);
    await shot(mp, `issues-375-${scheme}`);
    if (scheme === 'light') {
      perf['375-全部沒做完'] = await scrollFrames(mp);
      step('7. 手機：捲到底很順', perf['375-全部沒做完'].longFrames === 0, perf['375-全部沒做完']);
      await mp.locator('.list-view').evaluate((el) => { el.scrollTop = 0; });
      await mp.locator('[data-filter="project"]').tap();
      await mp.getByRole('menuitemcheckbox', { name: data.gem.name }).tap();
      await mp.waitForURL((u) => u.searchParams.get('project') === String(data.gem.id));
      await mp.locator('[data-filter="status"]').tap();
      await mp.getByRole('menuitemcheckbox', { name: 'Backlog' }).tap();
      await mp.keyboard.press('Escape');
      await mp.waitForURL((u) => u.searchParams.get('status') === 'todo,in_progress,in_review');
      await mp.waitForTimeout(300);
      const gemOpen = allOpen.filter((i) => i.project_id === data.gem.id && i.status !== 'Backlog');
      await waitCount(mp, gemOpen.length);
      step('7. 手機：篩選 Project＋狀態，張數跟 API 一致', (await listCount(mp)) === gemOpen.length, { ui: await listCount(mp), api: gemOpen.length });
      await shot(mp, 'issues-375-light-filtered');
      const murl = mp.url();
      await mp.reload();
      await waitRows(mp);
      step('7. 手機：重新整理，篩選還在', mp.url() === murl && (await listCount(mp)) === gemOpen.length);
      const target = await mp.locator('a.nl-row .id').first().textContent();
      await mp.locator('a.nl-row').first().tap();
      await mp.waitForURL(`**/issues/${target}`);
      await mp.locator('.ttl-edit').waitFor();
      step('7. 手機：點一列進整頁（不開預覽）', (await mp.locator('.nl-peek').count()) === 0, { url: mp.url().replace(BASE, '') });
      await shot(mp, 'issue-375-light-page');
      await mp.goBack();
      await waitRows(mp);
    }
    await mp.goto(`${BASE}/projects/${String(data.nextline.id)}`);
    await mp.locator('.col-tabs').waitFor();
    await shot(mp, `project-375-${scheme}-board`);
    if (scheme === 'light') step('7. 手機 Project 看板：一次一欄', (await mp.locator('section.nl-col').count()) === 1);
    await mp.locator('.proj-tabs [data-tab="list"]').tap();
    await waitRows(mp);
    await shot(mp, `project-375-${scheme}-list`);
    await mp.locator('.proj-tabs [data-tab="about"]').tap();
    await mp.locator('.proj-about .md').waitFor();
    await shot(mp, `project-375-${scheme}-about`);
    if (scheme === 'light') step('7. 手機：Project 三個分頁都切得過去', true);
    await mp.goto(`${BASE}/projects`);
    await mp.locator('.proj-row').first().waitFor();
    await shot(mp, `projects-375-${scheme}`);
    await mp.goto(`${BASE}/issues?status=in_review`);
    await waitRows(mp);
    if (scheme === 'light') step('7. 手機：底部「等你」是待驗收的列表', (await mp.locator('.nl-tabbar a[href="/issues?status=in_review"][aria-current="page"]').count()) === 1 && (await listCount(mp)) === allOpen.filter((i) => i.status === 'In Review').length);
    await shot(mp, `waiting-375-${scheme}`);
    if (scheme === 'light') {
      await mp.locator('.nl-tabbar button', { hasText: '更多' }).tap();
      await mp.locator('.nl-sheet').waitFor();
      step('7. 手機「更多」裡沒有三區、沒有 Agent 工作中', !(await mp.locator('.nl-sheet').textContent()).includes('三區') && !(await mp.locator('.nl-sheet').textContent()).includes('Agent 工作中'));
      await shot(mp, 'more-375-light');
      await mp.keyboard.press('Escape');
    }
    if (scheme === 'light') step('7. 手機沒有頁面錯誤', mErrors.length === 0, { mErrors });
    await m.close();
  }

  const scrolls = Object.entries(measures).filter(([, x]) => x.pageHorizontalScroll).map(([k]) => k);
  step('所有截圖的頁面都沒有橫向捲動', scrolls.length === 0, { scrolls, shots: Object.keys(measures).length });
} catch (e) {
  results.push({ name: '例外', ok: false, error: String(e?.stack ?? e) });
  console.error(e);
  process.exitCode = 1;
} finally {
  writeFileSync(join(outDir, 'e2e-result.json'), `${JSON.stringify({ base: BASE, persist, results, perf, measures }, null, 2)}\n`);
  await browser?.close();
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    dev.kill('SIGTERM');
  }
}
