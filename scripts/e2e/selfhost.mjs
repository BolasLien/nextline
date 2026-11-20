/* global document, window */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const out = resolve('.scratch/nx194', `ui-${Date.now()}`);
const data = join(out, 'data'); mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:3014';
const password = 'local browser test password';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXTLINE_DATA_DIR: data, NEXTLINE_PORT: '3014' };
const cli = (command, input) => {
  const result = spawnSync(process.execPath, ['dist/server/cli.mjs', command, ...(input ? ['--password-stdin'] : [])], { env, encoding: 'utf8', input });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
cli('init', password);
const token = cli('rotate-token');
let server;
let browser;
const results = [];
const screenshots = [];
const log = [];
const check = (name, detail = {}) => { results.push({ name, ...detail }); console.log(`PASS ${name}`); };
const api = async (path, method = 'GET', body) => {
  const res = await fetch(base + '/api' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${path}: ${res.status}`); return res.json();
};
async function start() {
  server = spawn(process.execPath, ['dist/server/main.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (b) => log.push(String(b)));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/health')).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(log.join(''));
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill('SIGTERM'); await exited;
}
function clearLimit() { const db = new DatabaseSync(join(data, 'nextline.sqlite')); db.exec('DELETE FROM local_login_limit'); db.close(); }
async function shot(page, name) {
  await page.screenshot({ path: join(out, `${name}.png`) });
  const measure = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.equal(measure.scrollWidth, measure.clientWidth); screenshots.push({ name, ...measure });
}
async function login(page) { await page.getByLabel('密碼', { exact: true }).fill(password); await page.getByRole('button', { name: '登入', exact: true }).click(); await page.locator('.app').waitFor(); }
async function drag(page, from, to) {
  const a = await from.boundingBox(); const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 }); await page.waitForTimeout(100);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 }); await page.waitForTimeout(150); await page.mouse.up();
}
try {
  await start();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const width of [1280, 375]) for (const scheme of ['light', 'dark']) {
    clearLimit();
    const context = await browser.newContext({ viewport: { width, height: 860 }, colorScheme: scheme, ...(width === 375 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/issues?status=todo'); await page.getByLabel('密碼', { exact: true }).waitFor();
    await shot(page, `login-${width}-${scheme}`);
    await page.getByLabel('密碼', { exact: true }).fill('wrong password'); await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.getByRole('alert').waitFor(); await shot(page, `error-${width}-${scheme}`);
    await login(page); assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/issues?status=todo');
    await page.goto(base); await page.getByRole('button', { name: /^建立票/ }).first().click();
    const dialog = page.getByRole('dialog', { name: '建立票' });
    await dialog.getByLabel('標題（必填）').fill(`自架驗收 ${width} ${scheme}`);
    await dialog.locator('.create-submit').click();
    await dialog.waitFor({ state: 'detached' });
    const issue = (await api('/issues')).issues.find((item) => item.title === `自架驗收 ${width} ${scheme}`); assert.ok(issue);
    if (width === 1280) {
      const card = page.locator('.nl-card', { has: page.locator('.id', { hasText: new RegExp(`^${issue.identifier}$`) }) });
      await drag(page, card.locator('.hit'), page.locator('section[data-col="in-progress"]'));
      for (let i = 0; i < 30 && (await api(`/issues/${issue.identifier}`)).status !== 'In Progress'; i++) await page.waitForTimeout(100);
      assert.equal((await api(`/issues/${issue.identifier}`)).status, 'In Progress');
    }
    await page.goto(base + `/issues/${issue.identifier}`);
    await page.getByLabel('寫 comment（Markdown）', { exact: true }).fill('自架網頁留言，重啟後保留。');
    await page.getByRole('button', { name: /^送出/ }).click();
    await page.locator('.cmt').getByText('自架網頁留言，重啟後保留。', { exact: true }).waitFor();
    assert.equal((await api(`/issues/${issue.identifier}/comments`)).comments[0].body, '自架網頁留言，重啟後保留。');
    await shot(page, `detail-${width}-${scheme}`);
    const frame = await page.evaluate(() => new Promise((resolve) => {
      const deltas = []; let last = performance.now(); const until = last + 1200;
      function tick(now) { deltas.push(now - last); last = now; if (now < until) requestAnimationFrame(tick); else { deltas.sort((a, b) => a - b); resolve({ frames: deltas.length, p95: deltas[Math.floor(deltas.length * .95)], max: deltas.at(-1) }); } }
      requestAnimationFrame(tick);
    }));
    assert.ok(frame.p95 < 50, JSON.stringify(frame));
    // Expire server-side session, refresh original detail; login must return to that ticket.
    const db = new DatabaseSync(join(data, 'nextline.sqlite')); db.exec('UPDATE local_sessions SET expires_at=0'); db.close();
    await page.reload(); await page.getByLabel('密碼', { exact: true }).waitFor(); await shot(page, `expired-${width}-${scheme}`);
    await login(page); assert.equal(new URL(page.url()).pathname, `/issues/${issue.identifier}`);
    if (width === 375) await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: '登出', exact: true }).click(); await page.getByLabel('密碼', { exact: true }).waitFor();
    assert.equal((await context.request.get(base + '/app-api/issues')).status(), 401);
    assert.deepEqual(errors, []); check(`網頁 ${width} ${scheme} 登入／錯誤／開票／留言／過期回原頁／登出`, { frame, ref: issue.identifier, errors });
    await context.close();
  }
  const before = await api('/issues');
  const commentsBefore = await Promise.all(before.issues.map((issue) => api(`/issues/${issue.identifier}/comments`)));
  await stop(); cli('init'); await start();
  assert.deepEqual(await api('/issues'), before);
  assert.deepEqual(await Promise.all(before.issues.map((issue) => api(`/issues/${issue.identifier}/comments`))), commentsBefore);
  check('正式程序停止、初始化重跑、重新啟動，票與留言完全保留');
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: true, results, screenshots, data }, null, 2));
  console.log(`Evidence: ${out}`);
} catch (error) {
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: false, error: String(error), results, screenshots }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser?.close(); await stop(); }
