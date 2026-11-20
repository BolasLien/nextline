// Linux: installed caddy + supervisord; verified local CA without modifying machine trust.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { request } from 'node:https';
const root = process.cwd();
const state = resolve('.scratch/nx195', `https-${Date.now()}`); mkdirSync(state, { recursive: true, mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXTLINE_ROOT: root, NEXTLINE_STATE: state, NEXTLINE_NODE: process.execPath, NEXTLINE_CADDY: '/usr/bin/caddy', NEXTLINE_CADDYFILE: join(root, 'docs/deploy/local.Caddyfile'), NEXTLINE_PUBLIC_URL: 'https://localhost:8443', NEXTLINE_DATA_DIR: join(state, 'data'), NEXTLINE_TRUSTED_PROXIES: '127.0.0.1' };
const password = 'https fixture password';
const cli = args => spawnSync(process.execPath, ['dist/server/cli.mjs', ...args], { env, input: password, encoding: 'utf8' });
assert.equal(cli(['init', '--password-stdin']).status, 0);
const token = cli(['rotate-token']).stdout.trim();
const config = 'docs/deploy/supervisord.conf';
const control = (...args) => { const r = spawnSync('supervisorctl', ['-c', config, ...args], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout.trim(); };
const supervisor = spawn('supervisord', ['-n', '-c', config], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; supervisor.stdout.on('data', b => { log += b; }); supervisor.stderr.on('data', b => { log += b; });
let ca;
const call = (path, method = 'GET', body, headers = {}) => new Promise((resolve, reject) => {
  const req = request('https://localhost:8443' + path, { method, ca, headers, lookup: (_host, _options, done) => done(null, [{ address: '127.0.0.1', family: 4 }]) }, res => {
    const authorized = res.socket.authorized;
    let text = ''; res.on('data', b => { text += b; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, authorized }));
  });
  req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('HTTPS request timeout'))); req.end(body);
});
const wait = async () => {
  for (let i = 0; i < 100; i++) {
    try { ca = readFileSync(join(state, 'caddy-data/caddy/pki/authorities/local/root.crt')); if ((await call('/health')).status === 200) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('HTTPS not ready: ' + log);
};
try {
  await wait();
  const health = await call('/health'); assert.equal(health.authorized, true);
  const login = await call('/auth/login', 'POST', JSON.stringify({ password }), { Origin: env.NEXTLINE_PUBLIC_URL });
  assert.equal(login.status, 200); assert.match(login.headers['set-cookie'][0], /Secure/);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const created = await call('/app-api/issues', 'POST', JSON.stringify({ title: 'HTTPS persistent ticket', status: 'Todo' }), { Origin: env.NEXTLINE_PUBLIC_URL, Cookie: cookie }); assert.equal(created.status, 201);
  const before = await call('/api/issues', 'GET', undefined, { Authorization: `Bearer ${token}` }); assert.equal(before.status, 200);
  await new Promise(r => setTimeout(r, 1200));
  const pid = Number(control('pid', 'nextline')); assert.ok(pid > 0); process.kill(pid, 'SIGKILL');
  await new Promise(r => setTimeout(r, 1800)); await wait();
  const newPid = Number(control('pid', 'nextline')); assert.notEqual(newPid, pid);
  assert.equal((await call('/api/issues', 'GET', undefined, { Authorization: `Bearer ${token}` })).body, before.body);
  assert.equal((await call('/app-api/issues', 'GET', undefined, { Cookie: cookie })).status, 200);
  control('restart', 'caddy'); await wait();
  assert.equal((await call('/health')).authorized, true);
  const status = control('status');
  const stopped = new Promise(r => supervisor.once('exit', r));
  control('shutdown');
  await stopped;
  for (const name of readdirSync(state).filter(n => n.endsWith('.log'))) {
    const text = readFileSync(join(state, name), 'utf8'); assert.ok(!text.includes(password) && !text.includes(token) && !text.includes(cookie), `secret in ${name}`);
  }
  writeFileSync(join(state, 'result.json'), JSON.stringify({ ok: true, uid: process.getuid(), tlsAuthorized: true, secureCookie: true, nodeRestart: { oldPid: pid, newPid }, persistedTicket: true, sessionSurvived: true, caddyRestart: true, logsContainSecrets: false, status }, null, 2));
  console.log(`PASS HTTPS certificate verified with explicit CA, Secure cookie, browser write, supervisor crash restart, persistent data/session, proxy restart, secret-free logs\nEvidence: ${state}`);
} finally {
  if (supervisor.exitCode === null) { const exit = new Promise(r => supervisor.once('exit', r)); supervisor.kill('SIGTERM'); await exit; }
}
