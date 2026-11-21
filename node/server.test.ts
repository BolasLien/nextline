import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configFromEnv, type Config } from './config';
import { openDatabase } from './database';
import { LocalAuth, digest, sessionCookie } from './auth';
import { createNodeServer } from './server';

const PASSWORD = 'local test password only';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

async function fixture(overrides: Partial<Config> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nextline-nx194-'));
  const clientDir = join(dir, 'client');
  mkdirSync(join(clientDir, 'assets'), { recursive: true });
  writeFileSync(join(clientDir, 'index.html'), '<html lang="zh"><body>public shell</body></html>');
  writeFileSync(join(clientDir, 'assets', 'app.js'), '/* no private data */');
  const config: Config = { ...configFromEnv({ NEXTLINE_DATA_DIR: join(dir, 'data') }), clientDir, ...overrides };
  const db = openDatabase(config, true);
  const auth = new LocalAuth(db);
  await auth.initialize(PASSWORD);
  const token = auth.rotateToken();
  const server = createNodeServer(config, db);
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${String(address.port)}`;
  if (!overrides.origin) config.origin = base;
  cleanup.push(() => { db.close(); });
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => { resolve(); }); server.closeAllConnections(); }));
  const call = (path: string, options: RequestInit = {}) => fetch(base + path, { redirect: 'manual', ...options });
  const login = () => call('/auth/login', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  const agent = { Authorization: `Bearer ${token}` };
  return { config, db, auth, token, server, base, call, login, agent, dir };
}

function raw(server: Server, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path, headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject); req.end();
  });
}

describe('Node self-host ingress and credentials', () => {
  it('keeps all private entry points closed; public shell assets and legacy disclose no data', async () => {
    const f = await fixture();
    for (const path of ['/api/issues', '/api/projects', '/mcp', '/app-api/issues']) {
      expect((await f.call(path)).status).toBe(401);
      expect((await f.call(path, { headers: { Authorization: 'Bearer wrong', Cookie: 'nextline_session=invalid', 'Cf-Access-Jwt-Assertion': 'forged' } })).status).toBe(401);
    }
    expect((await f.call('/issues/NX-1?x=1')).headers.get('location')).toBe('/login?returnTo=%2Fissues%2FNX-1%3Fx%3D1&expired=1');
    expect((await f.call('/login')).status).toBe(200);
    expect((await f.call('/assets/app.js')).status).toBe(200);
    expect(await (await f.call('/health')).json()).toEqual({ ok: true, db: 'ok' });
    expect((await f.call('/legacy/issues/NX-1')).status).toBe(301);
    expect((await f.call('/.env')).status).toBe(404);
    expect((await f.call('/api/issues', { headers: f.agent })).status).toBe(200);
    expect((await f.call('/app-api/issues', { headers: f.agent })).status).toBe(401);
  });

  it('enforces CSRF for login, logout and browser writes, expiry, logout and password reset revocation', async () => {
    const f = await fixture();
    expect((await f.call('/auth/login', { method: 'POST', body: '{}' })).status).toBe(403);
    const logged = await f.login();
    const cookie = logged.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(logged.status).toBe(200);
    expect(logged.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(sessionCookie('test', true)).toContain('Secure');
    expect((await f.call('/app-api/issues', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await f.call('/api/issues', { headers: { Cookie: cookie } })).status).toBe(401);
    for (const path of ['/auth/logout', '/app-api/issues']) {
      expect((await f.call(path, { method: 'POST', headers: { Cookie: cookie }, body: '{}' })).status).toBe(403);
      expect((await f.call(path, { method: 'POST', headers: { Cookie: cookie, Origin: f.base, 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status).toBe(403);
    }
    await f.call('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: f.base } });
    expect((await f.call('/app-api/issues', { headers: { Cookie: cookie } })).status).toBe(401);
    const second = (await f.login()).headers.get('set-cookie')?.split(';')[0] ?? '';
    await f.auth.resetPassword('new local password only');
    expect((await f.call('/app-api/issues', { headers: { Cookie: second } })).status).toBe(401);
    expect((await f.login()).status).toBe(401);
    f.db.prepare('INSERT INTO local_sessions VALUES (?,?)').run(digest('a'.repeat(43)), Date.now() - 1);
    expect((await f.call('/app-api/issues', { headers: { Cookie: `nextline_session=${'a'.repeat(43)}` } })).status).toBe(401);
  });

  it('NEXTLINE_OWNER_NAME sets the human name for the browser and In Review hand-back (NX-244)', async () => {
    expect(configFromEnv({}).ownerName).toBe('你');
    const f = await fixture({ ownerName: configFromEnv({ NEXTLINE_OWNER_NAME: 'Alice' }).ownerName });
    const cookie = (await f.login()).headers.get('set-cookie')?.split(';')[0] ?? '';
    const write = { Cookie: cookie, Origin: f.base, 'Content-Type': 'application/json' };
    expect(await (await f.call('/app-api/owner', { headers: { Cookie: cookie } })).json()).toEqual({ name: 'Alice' });
    expect(await (await f.call('/api/owner', { headers: f.agent })).json()).toEqual({ name: 'Alice' });
    await f.call('/app-api/issues', { method: 'POST', headers: write, body: '{"title":"review","status":"In Review"}' });
    await f.call('/api/issues/NX-1/comments', { method: 'POST', headers: { ...f.agent, 'Content-Type': 'application/json' }, body: '{"author":"nextline agent","body":"done"}' });
    expect(((await (await f.call('/api/issues/NX-1', { headers: f.agent })).json()) as { status: string }).status).toBe('In Review');
    await f.call('/app-api/issues/NX-1/comments', { method: 'POST', headers: write, body: '{"author":"Alice","body":"ok"}' });
    expect(((await (await f.call('/api/issues/NX-1', { headers: f.agent })).json()) as { status: string }).status).toBe('In Progress');
  });

  it('limits login attempts persistently and rotates agent tokens without a restart', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) expect((await f.call('/auth/login', { method: 'POST', headers: { Origin: f.base }, body: '{"password":"wrong"}' })).status).toBe(401);
    expect((await f.login()).status).toBe(429);
    const other = openDatabase(f.config);
    expect((await new LocalAuth(other).login(PASSWORD)).status).toBe(429);
    other.close();
    f.db.exec('UPDATE local_login_limit SET reset_at=0');
    expect((await f.login()).status).toBe(200);
    const next = f.auth.rotateToken();
    expect((await f.call('/api/issues', { headers: f.agent })).status).toBe(401);
    expect((await f.call('/mcp', { headers: f.agent })).status).toBe(401);
    expect((await f.call('/api/issues', { headers: { Authorization: `Bearer ${next}` } })).status).toBe(200);
    const owner = f.db.prepare('SELECT * FROM local_owner').get();
    expect(owner?.password_hash).toMatch(/^scrypt\$/);
    expect(owner?.token_hash).toBe(digest(next));
    expect(JSON.stringify(owner)).not.toContain(PASSWORD);
  });

  it('rejects Host/Origin spoofing, untrusted proxy headers and encoded/symlink traversal', async () => {
    const f = await fixture();
    expect(await raw(f.server, '/health', { Host: 'evil.test' })).toBe(403);
    expect((await f.call('/api/issues', { headers: { ...f.agent, Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await f.call('/health', { headers: { 'X-Forwarded-Proto': 'https' } })).status).toBe(403);
    for (const path of ['/assets/../secret', '/assets/%2e%2e/secret', '/assets/%252e%252e/secret', '/assets/%5c..%5csecret', '//evil.test/', '/%00', '/%ZZ']) {
      expect(await raw(f.server, path, { Host: new URL(f.base).host })).toBe(400);
    }
    writeFileSync(join(f.dir, 'secret.js'), 'SECRET');
    symlinkSync(join(f.dir, 'secret.js'), join(f.config.clientDir, 'assets', 'escape.js'));
    expect((await f.call('/assets/escape.js')).status).toBe(404);
    expect(configFromEnv({}).host).toBe('127.0.0.1');
    for (const env of [{ NEXTLINE_HOST: '0.0.0.0' }, { NEXTLINE_PUBLIC_URL: 'https://example.test' }, { NEXTLINE_PUBLIC_URL: 'https://example.test', NEXTLINE_TRUSTED_PROXIES: '*' }]) expect(() => configFromEnv(env)).toThrow();
  });

  it('accepts HTTPS proxy only from explicit peer IP with exact public host and protocol', async () => {
    const f = await fixture({ origin: 'https://nextline.example', secure: true, trustedProxies: ['127.0.0.1'] });
    const host = { Host: 'nextline.example', 'X-Forwarded-Proto': 'https' };
    expect(await raw(f.server, '/health', host)).toBe(200);
    expect(await raw(f.server, '/health', { ...host, 'X-Forwarded-Host': 'evil.test' })).toBe(403);
    expect(await raw(f.server, '/health', { ...host, 'X-Forwarded-Proto': 'http' })).toBe(403);
    f.config.trustedProxies = ['192.0.2.1'];
    expect(await raw(f.server, '/health', { ...host, 'X-Forwarded-For': '127.0.0.1' })).toBe(403);
  });
});

describe('persistent shared core', () => {
  it('real MCP SDK client and HTTP/browser API share writes, relations and events across reopening and repeated init', async () => {
    const f = await fixture();
    const client = new Client({ name: 'nx194-acceptance', version: '1.0.0' });
    // SDK 1.32.1 declares sessionId as string | undefined on this transport but optional on Transport.
    // @ts-expect-error Upstream exactOptionalPropertyTypes mismatch; exercised over real HTTP below.
    await client.connect(new StreamableHTTPClientTransport(new URL(f.base + '/mcp'), { requestInit: { headers: f.agent } }));
    cleanup.push(() => client.close());
    const created = await f.call('/api/issues', { method: 'POST', headers: { ...f.agent, 'Content-Type': 'application/json' }, body: '{"title":"API ticket","status":"Todo"}' });
    expect(created.status).toBe(201);
    const get = await client.callTool({ name: 'get_issue', arguments: { id: 'NX-1' } });
    expect(JSON.stringify(get)).toContain('API ticket');
    expect((await client.callTool({ name: 'save_issue', arguments: { title: 'MCP ticket', blockedBy: ['NX-1'] } })).isError).not.toBe(true);
    expect((await client.callTool({ name: 'save_comment', arguments: { issueId: 'NX-2', body: 'MCP comment', author: 'test' } })).isError).not.toBe(true);
    const cookie = (await f.login()).headers.get('set-cookie')?.split(';')[0] ?? '';
    const browser = await f.call('/app-api/issues/NX-2', { method: 'PATCH', headers: { Cookie: cookie, Origin: f.base, 'Content-Type': 'application/json' }, body: '{"status":"In Progress","actor":"browser"}' });
    expect(browser.status).toBe(200);
    expect(JSON.stringify(await client.callTool({ name: 'get_issue', arguments: { id: 'NX-2' } }))).toContain('In Progress');
    const snapshots = (db: DatabaseSync) => ['issues', 'comments', 'issue_blockers', 'issue_events'].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const before = snapshots(f.db);
    const reopened = openDatabase(f.config, true);
    expect(await new LocalAuth(reopened).initialize('different password')).toBe(false);
    expect(snapshots(reopened)).toEqual(before);
    expect(reopened.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(reopened.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(reopened.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(5000);
    reopened.close();
    // Concurrent independent agents and browser writes, all through actual HTTP.
    const writes = await Promise.all(Array.from({ length: 12 }, (_, i) => f.call('/api/issues/NX-1/comments', { method: 'POST', headers: f.agent, body: JSON.stringify({ author: `agent-${String(i)}`, body: `entry-${String(i)}` }) })));
    expect(writes.every((r) => r.status === 201)).toBe(true);
    expect(f.db.prepare('SELECT count(*) AS n FROM comments WHERE issue_number=1').get()?.n).toBe(12);
  });

  it('refuses unknown/checksum-mismatched versions and atomically rolls back failed migrations', async () => {
    const f = await fixture();
    f.db.prepare('INSERT INTO local_migrations VALUES (?,?)').run('9999_future.sql', 'unknown');
    expect(() => openDatabase(f.config)).toThrow(/版本/);
    f.db.prepare('DELETE FROM local_migrations WHERE name=?').run('9999_future.sql');
    const migrationsDir = join(f.dir, 'broken-migrations'); mkdirSync(migrationsDir);
    for (const row of f.db.prepare('SELECT name FROM local_migrations').all()) {
      const name = String(row.name); writeFileSync(join(migrationsDir, name), readFileSync(resolve('migrations', name)));
    }
    writeFileSync(join(migrationsDir, '0006_broken.sql'), 'CREATE TABLE should_rollback (id INTEGER); THIS IS INVALID;');
    expect(() => openDatabase({ ...f.config, migrationsDir }, true)).toThrow();
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get()).toBeUndefined();
    expect(f.db.prepare('SELECT count(*) AS n FROM local_migrations').get()?.n).toBe(5);
  });
});
