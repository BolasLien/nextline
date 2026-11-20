// CLI rehearsal with real files/process death; every run uses its own data and release directories.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const out = resolve('.scratch/nx195', `operations-${Date.now()}`); mkdirSync(out, { recursive: true });
const cliPath = resolve('dist/server/cli.mjs');
const serverPath = resolve('dist/server/main.mjs');
const password = 'operations fixture password';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXTLINE_DATA_DIR: join(out, 'data') };
const cli = (args, options = {}) => spawnSync(process.execPath, [cliPath, ...args], { env, encoding: 'utf8', ...options });
const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r.stdout; };
const file = join(env.NEXTLINE_DATA_DIR, 'nextline.sqlite');
const tables = ['issues', 'projects', 'sprints', 'comments', 'issue_blockers', 'issue_events', 'local_owner', 'local_sessions', 'local_migrations'];
const snapshot = (db) => tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
const results = [];
const check = name => { results.push(name); console.log(`PASS ${name}`); };
ok(cli(['init', '--password-stdin'], { input: password }));
const token = ok(cli(['rotate-token'])).trim();
let db = new DatabaseSync(file);
db.exec("INSERT INTO projects(name) VALUES('operations'); INSERT INTO issues(title,project_id) VALUES('one',1),('two',1); INSERT INTO comments(issue_number,author,body) VALUES(1,'test','remember me'); INSERT INTO issue_blockers(issue_number,blocked_by_number) VALUES(2,1); INSERT INTO issue_events(issue_number,field,from_value,to_value,actor) VALUES(1,'status','Backlog','Todo','test');");
const before = snapshot(db);
ok(cli(['backup', join(out, 'backup')])); // live WAL reader with open writer
assert.deepEqual(snapshot(db), before);
db.close();
for (let round = 1; round <= 2; round++) {
  const destination = join(out, `restore-${round}`);
  ok(cli(['restore', join(out, 'backup'), destination]));
  ok(cli(['init'], { env: { ...env, NEXTLINE_DATA_DIR: destination } }));
  const restored = new DatabaseSync(join(destination, 'nextline.sqlite'));
  assert.deepEqual(snapshot(restored), before); restored.close();
}
assert.notEqual(cli(['restore', join(out, 'backup'), env.NEXTLINE_DATA_DIR]).status, 0);
check('CLI live-WAL backup + two restores: ticket numbers, comments, relations, events and credentials identical; overwrite refused');

const release = join(out, 'interrupted-release'); mkdirSync(release);
cpSync('migrations', join(release, 'migrations'), { recursive: true });
const pending = join(release, 'migrations/0006_interruption.sql');
writeFileSync(pending, 'CREATE TABLE interrupted_marker(id INTEGER); INSERT INTO interrupted_marker VALUES(1); WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n;');
db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout=0');
const processToKill = spawn(process.execPath, [cliPath, 'init'], { cwd: release, env, stdio: ['ignore', 'ignore', 'pipe'] });
let held = false;
try {
  for (let i = 0; i < 100; i++) {
    try { db.exec('BEGIN IMMEDIATE; ROLLBACK'); } catch (e) { if (String(e).includes('locked')) { held = true; break; } throw e; }
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(held, 'child migration must actually hold SQLite write transaction');
} finally {
  const exit = new Promise(r => processToKill.once('exit', r)); processToKill.kill('SIGKILL'); await exit;
}
assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='interrupted_marker'").get(), undefined);
assert.deepEqual(snapshot(db), before); db.close();
check('SIGKILL during active migration rolls back schema/data/version ledger; original snapshot unchanged');
writeFileSync(pending, 'CREATE TABLE interrupted_marker(id INTEGER); INVALID SQL;');
const failed = cli(['init'], { cwd: release }); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /撤回/);
db = new DatabaseSync(file); assert.deepEqual(snapshot(db), before); db.close();
writeFileSync(pending, 'CREATE TABLE interrupted_marker(id INTEGER); INSERT INTO interrupted_marker VALUES(1);');
ok(cli(['init'], { cwd: release })); ok(cli(['init'], { cwd: release }));
assert.notEqual(cli(['init']).status, 0); // older release refuses new schema
db = new DatabaseSync(file); assert.equal(db.prepare('SELECT count(*) AS n FROM interrupted_marker').get().n, 1); db.close();
ok(cli(['restore', join(out, 'backup'), join(out, 'rollback')]));
ok(cli(['init'], { env: { ...env, NEXTLINE_DATA_DIR: join(out, 'rollback') } }));
check('failed migration diagnosed/retry succeeds once; old release refuses future DB; rollback uses original release + snapshot');
// Reopen the restored snapshot through the actual server, not only SQL comparisons.
const server = spawn(process.execPath, [serverPath], { env: { ...env, NEXTLINE_DATA_DIR: join(out, 'rollback'), NEXTLINE_PORT: '3026' }, stdio: ['ignore', 'ignore', 'pipe'] });
let serverLog = ''; server.stderr.on('data', b => { serverLog += b; });
try {
  const base = 'http://127.0.0.1:3026';
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 50)); }
  const api = async path => { const r = await fetch(base + '/api' + path, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(r.status, 200); return r.json(); };
  assert.equal((await api('/issues/NX-1')).title, 'one');
  assert.equal((await api('/issues/NX-1/comments')).comments[0].body, 'remember me');
  assert.equal((await api('/issues/NX-2/blockers')).blocked_by[0].number, 1);
  assert.equal((await api('/issues/NX-1/events')).events[0].actor, 'test');
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { Origin: base }, body: JSON.stringify({ password }) }); assert.equal(login.status, 200);
  assert.ok(!serverLog.includes(password) && !serverLog.includes(token));
  check('restored server starts: original token reads tickets/comments/blockers/events and original password logs in');
} finally {
  if (server.exitCode === null) { const exit = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exit; }
}
// The output must not contain the password or one-time token.
const report = JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, node: process.version, results, files: readdirSync(out) }, null, 2);
assert.ok(!report.includes(password) && !report.includes(token));
writeFileSync(join(out, 'result.json'), report);
// Retain only a generic failure message, never SQL/bind values.
writeFileSync(join(out, 'expected-migration-failure.log'), failed.stderr);
assert.ok(readFileSync(file).length > 0);
console.log(`Evidence: ${out}`);
