// NX-239：「等我」只剩回覆。跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，
// 用 Playwright 在瀏覽器實際操作：
//   1. 待驗收的票（預覽面板與整頁）：頂端是「等你回覆」＋最新的下一步＋回覆框；沒有通過、退回、手機底部的通過／退回列；
//      comment 區不放第二個輸入框
//   2. 最新 comment 有「要你決定：」＋編號選項：頂端寫「要你決定：〈問題〉」，照原文列出選項（純文字，沒有按鈕），下面是回覆框；
//      之後有新 comment（不是這個格式）就不再顯示
//   3. 手機回覆：comment 作者 Bolas、原文照存，票移到 In Progress（NX-221），toast 可復原
//   4. 1280（預覽、整頁）／375 × 淺色／深色截圖，量測沒有橫向捲動
// 用法（repo 根目錄）：
//   PLAYWRIGHT_MODULE=<playwright 套件的 index.mjs> [CHROMIUM_PATH=<chromium>] [E2E_PORT=8800] node scripts/e2e/nx239.mjs
// 輸出：.scratch/screenshots/nx239/e2e-*.png、.scratch/screenshots/nx239/e2e-result.json。本機 D1 在 .scratch/e2e-nx239/<時間>/。

/* global document -- page.evaluate 裡的程式在瀏覽器跑 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.scratch/screenshots/nx239');
const persist = join(repo, '.scratch/e2e-nx239', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });
mkdirSync(persist, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 8800);
const BASE = `http://localhost:${String(PORT)}`;

const results = [];
function step(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) throw new Error(`步驟失敗：${name}`);
}

const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'nextline', '--local', '--persist-to', persist], { cwd: repo, encoding: 'utf8', env: { ...process.env, CI: '1' } });
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
      if ((await fetch(`${BASE}/health`)).ok) return;
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

async function waitIssue(ref, pred, what) {
  for (let i = 0; i < 40; i++) {
    const issue = await api('GET', `/issues/${ref}`);
    if (pred(issue)) return issue;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等不到：${what}`);
}

const QUESTION = '卡片上的到期日要怎麼顯示？';
const OPT1 = '只在 3 天內到期時顯示——卡片比較乾淨（推薦）';
const OPT2 = '有到期日就一直顯示——一眼看到全部日期';

async function seed() {
  const project = await api('POST', '/projects', { name: 'Nextline 第二版' });
  const mk = (title, extra = {}) => api('POST', '/issues', { title, status: 'In Review', project_id: project.id, ...extra });
  const say = (issue, body) => api('POST', `/issues/${issue.identifier}/comments`, { author: 'nextline agent', body });
  const plain = await mk('側欄 Project 排序改成依最近更新', { description: '## 目標\n側欄 Project 依最近更新排序。' });
  await say(plain, '做好了：改票後那個 Project 會移到側欄最上面。\n下一步：Bolas 在手機看側欄順序對不對');
  const decide = await mk('看板卡片要不要顯示到期日', { description: '## 目標\n看板卡片上看得到快到期的票。' });
  await say(decide, `兩種顯示方式都做好示意了。\n\n要你決定：${QUESTION}\n1. ${OPT1}\n2. ${OPT2}\n\n下一步：Bolas 選 1 或 2`);
  const answered = await mk('已經回過的決定題');
  await say(answered, `要你決定：要不要上線？\n1. 要\n2. 不要\n下一步：Bolas 選`);
  await say(answered, '補一張截圖。\n下一步：Bolas 看截圖');
  return { plain, decide, answered };
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function noHScroll(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.vh, [inert], [aria-hidden="true"], pre, .table-wrap')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) bad.push(el.className || el.tagName);
    }
    return { vw, docScroll: document.documentElement.scrollWidth, bad: bad.slice(0, 5) };
  });
}

// 頂端「等你回覆」的共同檢查：預覽面板或整頁
async function checkReply(scope, label) {
  const bar = scope.locator('.nl-review');
  await bar.waitFor();
  const text = (await bar.textContent()) ?? '';
  step(`${label}：頂端是「等你回覆」＋回覆框，沒有通過／退回`, text.includes('等你回覆') && (await bar.getByRole('textbox', { name: '回覆' }).count()) === 1
    && (await scope.getByRole('button', { name: /^通過/ }).count()) === 0 && (await scope.getByRole('button', { name: /^退回/ }).count()) === 0);
  step(`${label}：comment 區沒有第二個輸入框`, (await scope.locator('.cmt-form').count()) === 0);
  return text;
}

let browser;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await waitHealth();
  const d = await seed();

  // ===== 1280：預覽面板與整頁 × 淺色／深色 =====
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => { errors.push(String(e)); });

    await page.goto(`${BASE}/?peek=${d.plain.identifier}`);
    const peek = page.locator('.nl-peek');
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const plainText = await checkReply(peek, `1280 ${scheme} 預覽一般票`);
    step(`1280 ${scheme} 預覽一般票：摘要＝最新的下一步，沒有選項`, plainText.includes('Bolas 在手機看側欄順序對不對') && (await peek.locator('.rv-options').count()) === 0);
    await page.screenshot({ path: join(outDir, `e2e-plain-peek-1280-${scheme}.png`) });

    await page.goto(`${BASE}/?peek=${d.decide.identifier}`);
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const decText = await checkReply(peek, `1280 ${scheme} 預覽決定題`);
    const opts = await peek.locator('.rv-options li').allTextContents();
    step(`1280 ${scheme} 預覽決定題：寫出「要你決定：問題」與兩個選項原文，沒有選項按鈕`, decText.includes(`要你決定：${QUESTION}`) && JSON.stringify(opts) === JSON.stringify([OPT1, OPT2]) && (await peek.locator('.nl-review button', { hasText: '只在 3 天' }).count()) === 0, { opts });
    await page.screenshot({ path: join(outDir, `e2e-decision-peek-1280-${scheme}.png`) });

    await page.goto(`${BASE}/issues/${d.decide.identifier}`);
    await page.locator('.detail-page .ttl-edit').waitFor();
    await settle(page);
    await checkReply(page.locator('.detail-page'), `1280 ${scheme} 整頁決定題`);
    await page.screenshot({ path: join(outDir, `e2e-decision-page-1280-${scheme}.png`) });
    const ov = await noHScroll(page);
    step(`1280 ${scheme} 整頁沒有橫向捲動`, ov.bad.length === 0 && ov.docScroll <= ov.vw, ov);

    await page.goto(`${BASE}/?peek=${d.answered.identifier}`);
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const ansText = (await peek.locator('.nl-review').textContent()) ?? '';
    step(`1280 ${scheme}：決定題之後有新 comment，就不再列選項，摘要回到最新的下一步`, (await peek.locator('.rv-options').count()) === 0 && ansText.includes('Bolas 看截圖') && !ansText.includes('要你決定'));
    step(`1280 ${scheme} 沒有頁面錯誤`, errors.length === 0, { errors });
    await ctx.close();
  }

  // ===== 375：整頁 × 深色／淺色；最後在淺色實際回覆（回覆後決定題就不再顯示，所以放最後）=====
  for (const scheme of ['dark', 'light']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const errors = [];
    mp.on('pageerror', (e) => { errors.push(String(e)); });
    for (const key of ['plain', 'decide']) {
      await mp.goto(`${BASE}/issues/${d[key].identifier}`);
      await mp.locator('.ttl-edit').waitFor();
      await settle(mp);
      await checkReply(mp, `375 ${scheme} ${key}`);
      const box = await mp.getByRole('textbox', { name: '回覆' }).boundingBox();
      step(`375 ${scheme} ${key}：沒有底部通過／退回列，回覆框在第一屏`, (await mp.locator('.m-review-bar').count()) === 0 && box !== null && box.y + box.height <= 812 - 56, { box });
      const ov = await noHScroll(mp);
      step(`375 ${scheme} ${key}：沒有橫向捲動`, ov.bad.length === 0 && ov.docScroll <= ov.vw, ov);
      await mp.screenshot({ path: join(outDir, `e2e-${key === 'decide' ? 'decision' : 'plain'}-page-375-${scheme}.png`) });
    }
    if (scheme === 'light') {
      await mp.getByRole('textbox', { name: '回覆' }).fill('選 1');
      await mp.locator('.nl-review').getByRole('button', { name: /^回覆/ }).tap();
      await waitIssue(d.decide.identifier, (i) => i.status === 'In Progress', '回覆後移到 In Progress');
      const toast = mp.locator('.nl-toast', { hasText: `${d.decide.identifier} 已交回 agent` });
      await toast.waitFor();
      const cs = (await api('GET', `/issues/${d.decide.identifier}/comments`)).comments;
      step('375 回覆：comment 作者 Bolas、原文照存，票移到 In Progress，「等你回覆」收起、toast 附復原',
        cs.at(-1).author === 'Bolas' && cs.at(-1).body === '選 1' && (await mp.locator('.nl-review').count()) === 0 && (await toast.getByRole('button', { name: '復原' }).count()) === 1);
      await mp.screenshot({ path: join(outDir, 'e2e-decision-replied-375-light.png') });
      await toast.getByRole('button', { name: '復原' }).tap();
      await waitIssue(d.decide.identifier, (i) => i.status === 'In Review', '復原回待驗收');
      step('375 回覆後復原：回到待驗收', true);
    }
    step(`375 ${scheme} 沒有頁面錯誤`, errors.length === 0, { errors });
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
