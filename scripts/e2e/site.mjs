// 官網與文件站端對端檢查：先建站（scripts/build-site.mjs），用本機靜態伺服器提供 dist/site/，
// 每一頁 × 1280／375 × 淺色／深色量測沒有整頁橫向捲動、沒有元素超出右緣；再實際操作搜尋、手機目錄、深淺色切換。
//   PLAYWRIGHT_MODULE=<playwright 的 index.mjs> [CHROMIUM_PATH=…] [E2E_PORT=8801] node scripts/e2e/site.mjs
// 截圖與結果在 .scratch/screenshots/site/。
/* global document, getComputedStyle, window -- page.evaluate 裡的程式在瀏覽器跑 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { buildSite, docOrder } from '../build-site.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SITE = join(ROOT, 'dist/site');
const SHOTS = join(ROOT, '.scratch/screenshots/site');
const PORT = Number(process.env.E2E_PORT ?? 8801);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

await buildSite(SITE);
await mkdir(SHOTS, { recursive: true });

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  const file = join(SITE, path === '' ? 'index.html' : path);
  if (!file.startsWith(SITE)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${String(PORT)}`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
const failures = [];

// 超出右緣的元素（在自己可捲動的容器裡的不算，例如程式碼區塊與表格）。
async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollable = (el) => {
      for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1) return true;
        if (p.hidden || s.display === 'none') return true;
      }
      return false;
    };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && !scrollable(el)) out.push(`${el.tagName.toLowerCase()}.${String(el.className)} right=${Math.round(r.right)}`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, vw, out: out.slice(0, 5) };
  });
}

const urls = ['index.html', ...docOrder().map((p) => `docs/${p.slug}.html`)];
const shotPages = new Set(['index.html', 'docs/index.html', 'docs/install.html', 'docs/api-issues.html', 'docs/mcp.html', 'docs/mcp-linear.html', 'docs/cloudflare.html']);

try {
  for (const width of [1280, 375]) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, colorScheme: scheme });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      for (const url of urls) {
        const res = await page.goto(`${base}/${url}`);
        assert.equal(res?.status(), 200, url);
        await page.waitForLoadState('networkidle');
        if (url === 'index.html') {
          // 首頁的區塊捲進畫面才浮上來：先捲過一遍，整頁截圖才看得到全部。
          await page.evaluate(async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 400) {
              window.scrollTo({ top: y, behavior: 'instant' });
              await new Promise((r) => setTimeout(r, 60));
            }
            window.scrollTo({ top: 0, behavior: 'instant' });
          });
          await page.waitForTimeout(700);
        }
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const o = await overflow(page);
        const ok = o.scrollWidth <= o.vw && o.out.length === 0;
        results.push({ url, width, scheme, scrollWidth: o.scrollWidth, viewport: o.vw, overflowing: o.out, bodyBackground: bg, ok });
        if (!ok) failures.push(`${url} ${String(width)} ${scheme}: scrollWidth=${String(o.scrollWidth)} ${o.out.join(', ')}`);
        if (shotPages.has(url)) {
          const name = `${url.replace(/\//g, '_').replace('.html', '')}-${String(width)}-${scheme}.png`;
          await page.screenshot({ path: join(SHOTS, name), fullPage: true });
        }
      }
      if (errors.length > 0) failures.push(`JS 錯誤（${String(width)} ${scheme}）：${errors.join('; ')}`);
      await context.close();
    }
  }

  // 互動：桌面搜尋（⌘K → 打字 → Enter 跳到結果）。
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/docs/index.html`);
    await page.keyboard.press('Control+k');
    await page.locator('#search-input').fill('封存');
    await page.locator('#search-results a').first().waitFor();
    const count = await page.locator('#search-results a').count();
    await page.screenshot({ path: join(SHOTS, 'search-1280-light.png') });
    await page.keyboard.press('Enter');
    await page.waitForURL(/archive|api-issues|mcp/);
    results.push({ check: '搜尋「封存」', results: count, landed: page.url().replace(base, '') });
    assert.ok(count > 0, '搜尋「封存」要有結果');

    // 深淺色切換：記住選擇，換頁後還在。
    await page.goto(`${base}/docs/install.html`);
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.locator('[data-theme-toggle]').click();
    const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.goto(`${base}/docs/api.html`);
    const persisted = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    results.push({ check: '深淺色切換', before, after, persisted });
    assert.notEqual(before, after, '按切換要換背景色');
    assert.ok(persisted === 'dark' || persisted === 'light', '換頁後還記得');
    await context.close();
  }

  // 互動：手機目錄打開、點一頁會跳過去。
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(`${base}/docs/api-issues.html`);
    await page.locator('[data-menu]').click();
    assert.equal(await page.locator('#side').isVisible(), true, '手機目錄要打開');
    await page.screenshot({ path: join(SHOTS, 'docs_menu-375-light.png') });
    await page.locator('#side a', { hasText: 'MCP 工具' }).click();
    await page.waitForURL(/mcp\.html$/);
    results.push({ check: '手機目錄', landed: page.url().replace(base, '') });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
  await writeFile(join(SHOTS, 'results.json'), JSON.stringify({ failures, results }, null, 2));
}

const pagesChecked = results.filter((r) => r.url !== undefined).length;
console.log(`量測 ${String(pagesChecked)} 組（${String(urls.length)} 頁 × 1280／375 × 淺色／深色），失敗 ${String(failures.length)} 組`);
for (const f of failures) console.log(`  ✗ ${f}`);
for (const r of results.filter((x) => x.check !== undefined)) console.log(`  ✓ ${JSON.stringify(r)}`);
console.log(`截圖與結果：${SHOTS}`);
if (failures.length > 0) process.exitCode = 1;
