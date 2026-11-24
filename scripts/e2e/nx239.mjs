// 待驗收「等你回覆」直接顯示最新 comment 全文（長文限高 240px 可展開）。
// 跑本機 wrangler dev（.dev.vars 的 DEV_SKIP_ACCESS=1）與一份新的本機 D1，用 Playwright 在瀏覽器實際操作：
//   1. 一般短 comment：頂端是「等你回覆」＋作者與時間＋完整 Markdown＋回覆框；短文不出現「展開全文」按鈕；
//      沒有通過、退回、手機底部的通過／退回列；comment 區不放第二個輸入框
//   2. 多題決定＋稿子：頂端完整顯示引用稿子與 ①② 兩題「要你決定」，不漏題
//   3. 超長 comment：預設限高約 240px（.is-clamped）＋「展開全文」按鈕；點擊展開後看得到全文與文末選項、
//      按鈕變「收合」，再點可收合回約 240px；手機 375 預設限高時回覆框仍在第一屏
//   4. 無 comment：退回顯示預設提示，不出現 .rv-ctx
//   5. 已有較新 comment：頂端只顯示最新一則 comment，不顯示舊則
//   6. 手機回覆：comment 作者「你」、原文照存，票移到 In Progress，toast 可復原
//   7. 1280（預覽、整頁）／375 × 淺色／深色截圖，量測沒有橫向捲動
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

const MULTI_BODY = [
  '巡票：剩分享文的一句話和網頁提示字要你選，選完就能定稿。',
  '',
  '- 稿子（除了 ① 這句都沒改）：',
  '',
  '> 輪到我處理的票會集中在「等你」，我在那邊只要回覆就好，**① 回完票就自動交回給 agent。**',
  '',
  '要你決定：① 貼文那句怎麼寫？',
  '1. 「回完票會自動移到進行中，agent 下次來看票就接著做。」（推薦）',
  '2. 「我在那邊只要回覆就好。」——後半句刪掉',
  '',
  '要你決定：② 網頁回覆框提示字要不要一起改？',
  '1. 改成「直接寫你的意思，agent 下次看票時會接著做」（推薦）',
  '2. 不改',
  '',
  '下一步：你回兩個數字（例如 1、2）',
].join('\n');

const LONG_BODY = [
  'FB、LinkedIn 兩則中文初稿寫好了，全文在下面，陌生讀者各看過兩輪；沒有發文、沒有配圖。',
  '',
  '### FB 粉專',
  '我的作品集網站更新了，打開首頁會有字從上面落下來，按鍵盤就可以打掉，用手機就直接點。',
  '上一版停在 2025 年 5 月，我後來當前端工程師的經歷、今年用 AI 做的東西，網站上都沒有。所以這次重新設計外觀，把做過的東西整理在同一頁，也補上所有專案的實際截圖與互動示範。',
  '',
  '### LinkedIn',
  '大約兩天，我從規劃、開發到實際上線使用，做了一套任務管理系統，取代原本用的服務。它現在放在我剛更新的作品集網站最前面，文章裡完整交代了架構取捨、Cloudflare Workers + D1 的部署成本與日常使用流程。',
  '另外也附上幾段在開發過程中的踩坑紀錄，方便其他也在做個人工具的朋友直接參考。',
  '',
  '要你決定：這次為什麼想改版，貼文裡要怎麼寫？',
  '1. 就寫現在這樣（上一版停在 2025 年 5 月，新的東西都沒有）（推薦）',
  '2. 回我一句真正的原因，我換掉那一句',
  '',
  '下一步：你選 1 或 2',
].join('\n');

async function seed() {
  const project = await api('POST', '/projects', { name: 'Nextline 第二版' });
  const mk = (title, extra = {}) => api('POST', '/issues', { title, status: 'In Review', project_id: project.id, ...extra });
  const say = (issue, body, author = 'nextline agent') => api('POST', `/issues/${issue.identifier}/comments`, { author, body });

  // 1. 無決定題短文
  const plain = await mk('各 agent 獨立 token 撤銷與舊 token 清理', { description: '## 目標\n確認兩把新 token 正常後清理舊的共用 token。' });
  await say(plain, '巡票：查過兩把新 token 都還在用；舊的共用 `API_TOKEN` 還沒刪。\n- 證據：claude-code 與 codex 皆有使用紀錄\n下一步：你確認後再刪舊 token', 'my-agent');

  // 2. 多題決定＋稿子
  const multi = await mk('Nextline 開源與社團作品分享', { description: '## 目標\n準備開源分享貼文。' });
  await say(multi, MULTI_BODY, 'my-agent');

  // 3. 超長文
  const long = await mk('需準備 FB、LinkedIn 貼文', { description: '## 目標\n準備作品集改版的兩則社群貼文。' });
  await say(long, LONG_BODY, 'my-agent agent');

  // 4. 沒有 comment
  const empty = await mk('尚未留言的待驗收票');

  // 5. 較新 comment 蓋過舊 comment
  const updated = await mk('已補新留言的待驗收票');
  await say(updated, '要你決定：舊問題要不要處理？\n1. 要\n2. 不要\n下一步：你選');
  await say(updated, '補一張最新截圖，確認沒問題就能收票。\n下一步：你看截圖');

  return { plain, multi, long, empty, updated };
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

    // 1. 短文無決定題
    await page.goto(`${BASE}/?peek=${d.plain.identifier}`);
    const peek = page.locator('.nl-peek');
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const plainText = await checkReply(peek, `1280 ${scheme} 預覽短文`);
    step(`1280 ${scheme} 預覽短文：顯示作者與完整 Markdown，短文不出現展開鈕`,
      plainText.includes('my-agent') && plainText.includes('API_TOKEN') && plainText.includes('claude-code 與 codex')
      && (await peek.locator('.rv-ctx.is-clamped').count()) === 0 && (await peek.locator('.rv-toggle').count()) === 0);
    await page.screenshot({ path: join(outDir, `e2e-plain-peek-1280-${scheme}.png`) });

    // 2. 多題決定＋稿子
    await page.goto(`${BASE}/?peek=${d.multi.identifier}`);
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const multiText = await checkReply(peek, `1280 ${scheme} 預覽多題決定`);
    step(`1280 ${scheme} 預覽多題決定：同時看得到引用稿子與 ①② 兩題「要你決定」`,
      multiText.includes('① 回完票就自動交回給 agent') && multiText.includes('要你決定：①') && multiText.includes('要你決定：②'));
    await page.screenshot({ path: join(outDir, `e2e-multi-peek-1280-${scheme}.png`) });

    // 3. 超長文限高＋展開／收合
    await page.goto(`${BASE}/?peek=${d.long.identifier}`);
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    await checkReply(peek, `1280 ${scheme} 預覽長文`);
    const ctxBox = peek.locator('.rv-ctx');
    const toggle = peek.locator('.rv-toggle');
    const clampedBox = await ctxBox.boundingBox();
    step(`1280 ${scheme} 預覽長文：預設限高約 240px 且出現「展開全文」按鈕`,
      (await peek.locator('.rv-ctx.is-clamped').count()) === 1
      && clampedBox !== null && clampedBox.height <= 245 && clampedBox.height >= 200
      && ((await toggle.textContent()) ?? '').includes('展開全文'), { clampedBox });
    await page.screenshot({ path: join(outDir, `e2e-long-peek-1280-${scheme}.png`) });

    await toggle.click();
    await page.waitForTimeout(150);
    const expandedBox = await ctxBox.boundingBox();
    step(`1280 ${scheme} 預覽長文：點擊展開後顯示全文且按鈕變「收合」`,
      (await peek.locator('.rv-ctx.is-clamped').count()) === 0
      && expandedBox !== null && expandedBox.height > 300
      && ((await toggle.textContent()) ?? '').includes('收合'), { expandedBox });

    await toggle.click();
    await page.waitForTimeout(150);
    const collapsedBox = await ctxBox.boundingBox();
    step(`1280 ${scheme} 預覽長文：點擊收合回到限高狀態`,
      (await peek.locator('.rv-ctx.is-clamped').count()) === 1 && collapsedBox !== null && collapsedBox.height <= 245, { collapsedBox });

    // 整頁（長文）
    await page.goto(`${BASE}/issues/${d.long.identifier}`);
    await page.locator('.detail-page .ttl-edit').waitFor();
    await settle(page);
    await checkReply(page.locator('.detail-page'), `1280 ${scheme} 整頁長文`);
    await page.screenshot({ path: join(outDir, `e2e-long-page-1280-${scheme}.png`) });
    const ov = await noHScroll(page);
    step(`1280 ${scheme} 整頁沒有橫向捲動`, ov.bad.length === 0 && ov.docScroll <= ov.vw, ov);

    // 4. 無 comment 退回預設提示
    await page.goto(`${BASE}/?peek=${d.empty.identifier}`);
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const emptyText = (await peek.locator('.nl-review').textContent()) ?? '';
    step(`1280 ${scheme} 無 comment：退回預設提示、不顯示 .rv-ctx`,
      emptyText.includes('看完後回覆你的意思，agent 會接著處理。') && (await peek.locator('.rv-ctx').count()) === 0);

    // 5. 較新 comment 蓋過舊 comment
    await page.goto(`${BASE}/?peek=${d.updated.identifier}`);
    await peek.locator('.ttl-edit').waitFor();
    await settle(page);
    const updText = (await peek.locator('.nl-review').textContent()) ?? '';
    step(`1280 ${scheme} 最新 comment：只顯示最新一則，不顯示舊則`,
      updText.includes('補一張最新截圖') && !updText.includes('舊問題要不要處理'));
    step(`1280 ${scheme} 沒有頁面錯誤`, errors.length === 0, { errors });
    await ctx.close();
  }

  // ===== 375：整頁 × 深色／淺色；最後在淺色實際回覆 =====
  for (const scheme of ['dark', 'light']) {
    const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: scheme, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    const errors = [];
    mp.on('pageerror', (e) => { errors.push(String(e)); });
    for (const key of ['plain', 'long']) {
      await mp.goto(`${BASE}/issues/${d[key].identifier}`);
      await mp.locator('.ttl-edit').waitFor();
      await settle(mp);
      await checkReply(mp, `375 ${scheme} ${key}`);
      const box = await mp.getByRole('textbox', { name: '回覆' }).boundingBox();
      step(`375 ${scheme} ${key}：沒有底部通過／退回列，回覆框在第一屏`, (await mp.locator('.m-review-bar').count()) === 0 && box !== null && box.y + box.height <= 812 - 56, { box });
      if (key === 'long') {
        step(`375 ${scheme} long：預設限高且有展開按鈕`, (await mp.locator('.rv-ctx.is-clamped').count()) === 1 && (await mp.locator('.rv-toggle').count()) === 1);
      } else {
        step(`375 ${scheme} plain：短文不出現展開按鈕`, (await mp.locator('.rv-toggle').count()) === 0);
      }
      const ov = await noHScroll(mp);
      step(`375 ${scheme} ${key}：沒有橫向捲動`, ov.bad.length === 0 && ov.docScroll <= ov.vw, ov);
      await mp.screenshot({ path: join(outDir, `e2e-${key}-page-375-${scheme}.png`) });
    }
    if (scheme === 'light') {
      await mp.getByRole('textbox', { name: '回覆' }).fill('選 1');
      await mp.locator('.nl-review').getByRole('button', { name: /^回覆/ }).tap();
      await waitIssue(d.long.identifier, (i) => i.status === 'In Progress', '回覆後移到 In Progress');
      const toast = mp.locator('.nl-toast', { hasText: `${d.long.identifier} 已交回 agent` });
      await toast.waitFor();
      const cs = (await api('GET', `/issues/${d.long.identifier}/comments`)).comments;
      step('375 回覆：comment 作者「你」、原文照存，票移到 In Progress，「等你回覆」收起、toast 附復原',
        cs.at(-1).author === '你' && cs.at(-1).body === '選 1' && (await mp.locator('.nl-review').count()) === 0 && (await toast.getByRole('button', { name: '復原' }).count()) === 1);
      await mp.screenshot({ path: join(outDir, 'e2e-replied-375-light.png') });
      await toast.getByRole('button', { name: '復原' }).tap();
      await waitIssue(d.long.identifier, (i) => i.status === 'In Review', '復原回待驗收');
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
