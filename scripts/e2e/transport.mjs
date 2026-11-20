// Actual TCP + official MCP SDK clients, same fixed browser/API/MCP workload on both runtimes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const out = resolve('.scratch/nx195', `transport-${Date.now()}`); mkdirSync(out, { recursive: true });
const results = [];
const password = 'transport fixture password';
const token = randomBytes(32).toString('hex');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXTLINE_DATA_DIR: join(out, 'data'), NEXTLINE_PORT: '3025' };
let node, mf;
const clients = [];
let logs = '';
async function exercise(kind, base, agentToken, cookie, raw) {
  const api = async (path, method = 'GET', body, browser = false) => {
    const response = await fetch(base + (browser ? '/app-api' : '/api') + path, { method, headers: { 'Content-Type': 'application/json', ...(browser ? { Origin: base, Cookie: cookie } : { Authorization: `Bearer ${agentToken}` }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `${kind} ${path} ${response.status}`); return response.json();
  };
  const agents = [];
  for (let i = 0; i < 4; i++) {
    const client = new Client({ name: `agent-${i}`, version: '1.0' }); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${agentToken}` } } }));
    agents.push(client);
  }
  const tool = async (client, name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
  const project = await api('/projects', 'POST', { name: 'fixed project' });
  await api('/issues', 'POST', { title: 'shared', status: 'Todo', project_id: project.id }, true);
  await tool(agents[0], 'save_issue', { title: 'dependency', blockedBy: ['NX-1'], project: String(project.id) });
  const jobs = [];
  for (let i = 0; i < 24; i++) jobs.push(i % 3 === 0
    ? api('/issues/NX-1/comments', 'POST', { author: 'browser', body: `entry-${i}` }, true)
    : tool(agents[i % 4], 'save_comment', { issueId: 'NX-1', author: `agent-${i % 4}`, body: `entry-${i}` }));
  for (let i = 0; i < 12; i++) jobs.push(i % 2 === 0
    ? api('/issues', 'POST', { title: `created-${i}` }, true)
    : tool(agents[i % 4], 'save_issue', { title: `created-${i}` }));
  await Promise.all(jobs);
  await Promise.all([
    api('/issues/NX-1', 'PATCH', { status: 'In Progress', actor: 'browser' }, true),
    tool(agents[1], 'save_issue', { id: 'NX-1', title: 'updated', actor: 'agent-1' }),
    tool(agents[2], 'save_issue', { id: 'NX-1', description: 'new description', actor: 'agent-2' }),
  ]);
  const issue = await api('/issues/NX-1');
  assert.equal(issue.title, 'updated'); assert.equal(issue.description, 'new description'); assert.equal(issue.status, 'In Progress');
  const comments = (await api('/issues/NX-1/comments')).comments;
  assert.equal(comments.length, 24); assert.equal(new Set(comments.map(c => c.body)).size, 24);
  const issues = (await api('/issues')).issues;
  assert.equal(issues.length, 14); assert.equal(new Set(issues.map(i => i.number)).size, 14);
  const events = (await api('/issues/NX-1/events')).events;
  for (const field of ['status', 'title', 'description']) assert.equal(events.filter(e => e.field === field).length, 1);
  const before = JSON.stringify({ issue, events });
  await raw("CREATE TRIGGER fail_event BEFORE INSERT ON issue_events WHEN NEW.actor='fail-fixture' BEGIN SELECT RAISE(ABORT, 'injected'); END");
  const failed = await fetch(base + '/api/issues/NX-1', { method: 'PATCH', headers: { Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ title: 'must rollback', status: 'Done', actor: 'fail-fixture' }) });
  assert.equal(failed.status, 500);
  await raw('DROP TRIGGER fail_event');
  assert.equal(JSON.stringify({ issue: await api('/issues/NX-1'), events: (await api('/issues/NX-1/events')).events }), before);
  assert.equal((await tool(agents[3], 'get_issue', { id: 'NX-2' })).relations.blockedBy[0].id, 'NX-1');
  results.push({ kind, ok: true, agents: 4, parallelComments: 24, concurrentCreates: 12, uniqueTickets: 14, eventFields: 3, faultRollback: true });
  console.log(`PASS ${kind} browser + 4 MCP clients + API concurrent writes, relation/history, injected rollback`);
  for (const client of clients.splice(0)) await client.close();
}

try {
  const init = spawnSync(process.execPath, ['dist/server/cli.mjs', 'init', '--password-stdin'], { env, input: password, encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  const rotated = spawnSync(process.execPath, ['dist/server/cli.mjs', 'rotate-token'], { env, encoding: 'utf8' }); assert.equal(rotated.status, 0); const nodeToken = rotated.stdout.trim();
  node = spawn(process.execPath, ['dist/server/main.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  node.stdout.on('data', b => { logs += b; }); node.stderr.on('data', b => { logs += b; });
  const base = 'http://127.0.0.1:3025';
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { Origin: base }, body: JSON.stringify({ password }) }); assert.equal(login.status, 200);
  const db = new DatabaseSync(join(env.NEXTLINE_DATA_DIR, 'nextline.sqlite'));
  try { await exercise('Node SQLite', base, nodeToken, login.headers.get('set-cookie').split(';')[0], sql => db.exec(sql)); } finally { db.close(); }
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01', d1Databases: ['DB'], bindings: { API_TOKEN: token, DEV_SKIP_ACCESS: '1' } }));
  const d1 = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', file), 'utf8').replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    await d1.batch(sql.map(s => d1.prepare(s)));
  }
  await exercise('Worker D1', (await mf.ready).origin, token, '', sql => d1.prepare(sql).run());
  assert.ok(!logs.includes(nodeToken) && !logs.includes(password));
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: true, platform: process.platform, node: process.version, results }, null, 2));
  console.log(`Evidence: ${out}`);
} finally {
  for (const client of clients) await client.close();
  await mf?.dispose();
  if (node && node.exitCode === null) { const exit = new Promise(r => node.once('exit', r)); node.kill('SIGTERM'); await exit; }
}
