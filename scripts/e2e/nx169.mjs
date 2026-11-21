// NX-169：品牌識別改成方向 A「定線 Steady」的端對端截圖與檢查。
// 跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，灌固定資料後：
//   1. 看板、票詳細（整頁）、/projects × 1280／375 × 淺色／深色截圖，量測沒有橫向溢出
//   2. （E2E_LABEL=after，預設）檢查方向 A 有套上：字型 Inter／JetBrains Mono、圖示線寬 1.5、logo 是兩條橫線、favicon、
//      空狀態與按鈕文案是方向 A 的語氣
//   E2E_LABEL=v2、v3…：檔名加 -v2、-v3（深色第二、三輪），檢查同 after
//   E2E_LABEL=before：只截圖、檔名加 before- 前綴（改版前對照用），不檢查方向 A
// 用法（repo 根目錄）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8799] [E2E_LABEL=before|after] node scripts/e2e/nx169.mjs
// 輸出：.scratch/screenshots/nx169/*.png、.scratch/screenshots/nx169/e2e-result[-before].json。本機 D1 在 .scratch/e2e-nx169/<時間>/。

/* global document, getComputedStyle -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/nx169');
const persist = join(repo, '.scratch/e2e-nx169', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8799);
const BASE = `http://localhost:${String(PORT)}`;
const LABEL = process.env.E2E_LABEL === 'before' ? 'before' : 'after';
// E2E_LABEL=v2：深色改暗灰（第二輪），檔名加 -v2，照樣跑方向 A 的檢查
const prefix = LABEL === 'before' ? 'before-' : '';
const suffix = /^v\d+$/.test(process.env.E2E_LABEL ?? '') ? `-${String(process.env.E2E_LABEL)}` : '';

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

const H = (h) => new Date(Date.now() - h * 3600_000).toISOString();

// 改版前後用同一份資料：三個 Project、每個狀態都有票、待驗收有下一步、詳細頁有描述與 comment。
async function seed() {
  const p1 = await api('POST', '/projects', { name: 'Nextline 第二版', description: '品牌與設計系統。', created_at: H(3), updated_at: H(1) });
  const p2 = await api('POST', '/projects', { name: '個人待辦', created_at: H(30), updated_at: H(6) });
  const p3 = await api('POST', '/projects', { name: '記帳 App', created_at: H(80), updated_at: H(72) });
  const mk = (title, status, project, extra = {}) => api('POST', '/issues', { title, status, project_id: project.id, ...extra });
  await mk('整理 Sprint 會議議程', 'Backlog', p2);
  await mk('匯出 CSV 給試算表用', 'Backlog', p3);
  await mk('看板欄位寬度在 1024 寬太擠', 'Todo', p1);
  await mk('換掉過期的瀏覽器書籤', 'Todo', p2);
  const prog = await mk('側欄 Project 排序', 'In Progress', p1);
  await api('POST', `/issues/${prog.identifier}/comments`, { author: 'nextline agent', body: '改好排序，正在跑 e2e。\n\n下一步：nextline agent 跑完 e2e 後回報' });
  const review = await mk('品牌識別改成方向 A「定線 Steady」', 'In Review', p1, {
    description: '## 目標\nBolas 長時間看 Nextline 時，眼睛不吃力。\n\n## 範圍\n- 色彩：主色墨藍、agent 青綠、冷灰中性色\n- 字體：Inter、JetBrains Mono\n- 圖示：線寬 1.5、轉角 2\n\n`docs/design/system/tokens.ts` 是正本。',
  });
  await api('POST', `/issues/${review.identifier}/comments`, { author: '你', body: 'B 版顏色看久了眼睛吃力，改 A。' });
  await api('POST', `/issues/${review.identifier}/comments`, { author: 'nextline agent', body: '色票、字體、圖示、logo 都換好，截圖在 `.scratch/screenshots/nx169/`。\n\n下一步：阿澈驗收' });
  await mk('錄音轉逐字稿的可疑詞清單', 'In Review', p3);
  await mk('拿掉 Project 狀態', 'Done', p1);
  await mk('封存舊票', 'Canceled', p2);
  return { review };
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let count = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.vh, [inert], [aria-hidden="true"], .nl-cols')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > vw + 1) count++;
    }
    return { vw, docScroll: document.documentElement.scrollWidth, count };
  });
}

let browser;
const measures = {};
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const { review } = await seed();

  const screens = [
    ['board', '/', 'section[data-col="todo"] .nl-card'],
    ['detail', `/issues/${review.identifier}`, '.ttl-edit'],
    ['projects', '/projects', '.proj-row'],
  ];
  for (const [width, height, mobile] of [[1280, 860, false], [375, 812, true]]) {
    for (const scheme of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
      const p = await c.newPage();
      for (const [name, path, wait] of screens) {
        await p.goto(`${BASE}${path}`);
        await p.locator(wait).first().waitFor();
        await settle(p);
        const key = `${name}-${String(width)}-${scheme}`;
        await p.screenshot({ path: join(outDir, `${prefix}${key}${suffix}.png`) });
        measures[key] = await overflow(p);
      }
      await c.close();
    }
  }
  const scrolls = Object.entries(measures).filter(([, m]) => m.docScroll > m.vw).map(([k]) => k);
  step('12 張截圖都沒有整頁橫向捲動', scrolls.length === 0, { scrolls });

  if (LABEL === 'after') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => { errors.push(String(e)); });
    await page.goto(`${BASE}/`);
    await page.locator('section[data-col="todo"] .nl-card').first().waitFor();
    await settle(page);
    const info = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const icon = document.querySelector('.nl-icon');
      const id = document.querySelector('.nl-card .id');
      const logo = document.querySelector('.nl-logo');
      const fav = document.querySelector('link[rel="icon"]');
      return {
        sans: getComputedStyle(document.body).fontFamily,
        mono: id ? getComputedStyle(id).fontFamily : '',
        primary: css.getPropertyValue('--color-primary').trim(),
        agent: css.getPropertyValue('--color-agent').trim(),
        bg: css.getPropertyValue('--color-bg').trim(),
        iconStroke: icon ? getComputedStyle(icon).strokeWidth : '',
        logoRects: logo ? logo.querySelectorAll('rect').length : 0,
        logoCircles: logo ? logo.querySelectorAll('circle').length : 0,
        favicon: fav ? fav.getAttribute('href') : null,
      };
    });
    step('方向 A 色票：主色墨藍 #1E3A5F、agent 青綠（文字用加深一階 #0B7568，對比才到 4.5）、冷灰底 #F5F7FA', info.primary.toUpperCase() === '#1E3A5F' && info.agent.toUpperCase() === '#0B7568' && info.bg.toUpperCase() === '#F5F7FA', info);
    step('字型：英文數字 Inter、票號 JetBrains Mono', info.sans.startsWith('Inter') && info.mono.startsWith('"JetBrains Mono"'), { sans: info.sans, mono: info.mono });
    step('圖示線寬 1.5px', info.iconStroke === '1.5px', { iconStroke: info.iconStroke });
    step('logo 是方角容器＋兩條橫線（沒有圓）', info.logoRects === 3 && info.logoCircles === 0, { rects: info.logoRects, circles: info.logoCircles });
    const fav = await fetch(`${BASE}${String(info.favicon)}`);
    const favText = await fav.text();
    step('favicon 是方向 A 的兩條橫線 SVG', info.favicon === '/favicon.svg' && fav.ok && (fav.headers.get('content-type') ?? '').includes('svg') && (favText.match(/<rect/g) ?? []).length === 3, { href: info.favicon, status: fav.status });
    step('看板主按鈕文案「建立票」', (await page.getByRole('button', { name: /^建立票/ }).count()) >= 1);
    // 空狀態：只剩一個沒有票的 Project 頁看板
    const empty = await api('POST', '/projects', { name: '沒有票的 Project' });
    await page.goto(`${BASE}/projects/${String(empty.id)}`);
    await page.locator('.nl-empty').first().waitFor();
    const emptyText = (await page.locator('.nl-empty').first().textContent()) ?? '';
    step('空狀態是方向 A 的語氣（短、沒有口語）', !emptyText.includes('還空著') && !emptyText.includes('好像'), { emptyText });
    await page.screenshot({ path: join(outDir, `empty-1280-light${suffix}.png`) });
    step('沒有 console 錯誤', errors.length === 0, { errors });
    await ctx.close();
  }

  writeFileSync(join(outDir, `e2e-result${LABEL === 'before' ? '-before' : ''}.json`), JSON.stringify({ ok: true, results, measures }, null, 2));
  console.log(`\n全部通過（${String(results.length)} 步），截圖在 ${outDir}`);
} catch (e) {
  writeFileSync(join(outDir, `e2e-result${LABEL === 'before' ? '-before' : ''}.json`), JSON.stringify({ ok: false, error: String(e), results, measures }, null, 2));
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
