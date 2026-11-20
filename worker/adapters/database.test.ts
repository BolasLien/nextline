import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseError, type Database, type SqlValue } from '../core/database';
import { routeApi } from '../api';
import { createDatabase, type TestDatabase } from '../test/database';

let fixture: TestDatabase;
let db: Database;
beforeEach(async () => { fixture = await createDatabase(); db = fixture.db; });
afterEach(async () => { await fixture.close(); });

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  const url = new URL(`https://test/api${path}`);
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return routeApi(new Request(url, init), db, url);
}

describe('shared database contract (Node SQLite / workerd D1)', () => {
  it('first returns row, scalar, null; bound statements are reusable and immutable', async () => {
    const statement = db.prepare('SELECT ?1 AS text, ?2 AS n, ?3 AS empty');
    const bound = statement.bind('中文', 0, null);
    expect(await bound.first()).toEqual({ text: '中文', n: 0, empty: null });
    expect(await bound.first<number>('n')).toBe(0);
    expect(await bound.first('empty')).toBeNull();
    expect(await statement.bind('other', 1.5, null).first('n')).toBe(1.5);
    expect(await bound.first('text')).toBe('中文');
    expect(await db.prepare('SELECT * FROM issues WHERE number = -1').first()).toBeNull();
    expect(await db.prepare('SELECT * FROM issues WHERE number = -1').first('title')).toBeNull();
    await expect(bound.first('missing')).rejects.toMatchObject({ code: 'query' });
  });

  it('all/run/RETURNING and meta expose the same fields and values', async () => {
    const created = await db.prepare('INSERT INTO issues(title) VALUES (?) RETURNING number, title').bind('A').run();
    expect(created).toEqual({ success: true, results: [{ number: 1, title: 'A' }], meta: { changes: 1, last_row_id: 1 } });
    expect(await db.prepare('SELECT number, title FROM issues').all()).toEqual({
      success: true, results: [{ number: 1, title: 'A' }], meta: { changes: 0, last_row_id: 1 },
    });
    expect(await db.prepare('UPDATE issues SET title = ? WHERE number = 1').bind('B').all()).toEqual({
      success: true, results: [], meta: { changes: 1, last_row_id: 1 },
    });
    expect(await db.prepare('SELECT number FROM issues WHERE number = -1').all()).toEqual({
      success: true, results: [], meta: { changes: 0, last_row_id: 1 },
    });
    expect((await db.prepare('UPDATE issues SET title = title WHERE number = -1').run()).meta.changes).toBe(0);
    expect((await db.prepare('DELETE FROM issues').run()).meta.changes).toBe(1);
  });

  it('batch preserves statement order, RETURNING rows, and individual meta', async () => {
    expect(await db.batch([])).toEqual([]);
    expect(await db.batch([
      db.prepare("INSERT INTO issues(title) VALUES ('A') RETURNING number"),
      db.prepare("INSERT INTO issues(title) VALUES ('B') RETURNING number"),
      db.prepare('SELECT number FROM issues ORDER BY number'),
    ])).toEqual([
      { success: true, results: [{ number: 1 }], meta: { changes: 1, last_row_id: 1 } },
      { success: true, results: [{ number: 2 }], meta: { changes: 1, last_row_id: 2 } },
      { success: true, results: [{ number: 1 }, { number: 2 }], meta: { changes: 0, last_row_id: 2 } },
    ]);
  });

  it.each([
    ["INSERT INTO projects(name) VALUES ('same'), ('same')", 'unique', 'UNIQUE constraint failed'],
    ["INSERT INTO issues(title, project_id) VALUES ('A', 999)", 'foreign_key', 'FOREIGN KEY constraint failed'],
    ["INSERT INTO issues(title, status) VALUES ('A', 'wrong')", 'check', 'CHECK constraint failed'],
    ['INSERT INTO issues(title) VALUES (NULL)', 'not_null', 'NOT NULL constraint failed'],
    ['SELECT * FROM no_such_table', 'query', 'Database query failed'],
  ])('normalizes database error: %s', async (sql, code, message) => {
    await expect(db.prepare(sql).run()).rejects.toMatchObject({ name: 'DatabaseError', code, message });
  });

  it('rejects unsupported parameter types consistently', () => {
    for (const value of [true, undefined, {}, NaN, Infinity]) {
      expect(() => db.prepare('SELECT ?').bind(value as SqlValue)).toThrow(DatabaseError);
    }
  });

  it('rejects a statement from another connection before writing', async () => {
    const other = await createDatabase();
    try {
      await expect(db.batch([db.prepare("INSERT INTO issues(title) VALUES ('A')"), other.db.prepare('SELECT 1')]))
        .rejects.toMatchObject({ message: 'Statement belongs to another database' });
      expect(await db.prepare('SELECT * FROM issues').first()).toBeNull();
    } finally { await other.close(); }
  });

  it('a middle batch failure rolls back data and history, skips later statements, and allows recovery', async () => {
    await db.prepare("INSERT INTO issues(title) VALUES ('original')").run();
    await expect(db.batch([
      db.prepare("UPDATE issues SET title = 'changed' WHERE number = 1"),
      db.prepare("INSERT INTO issue_events(issue_number, field, actor) VALUES (1, 'title', 'test')"),
      db.prepare("INSERT INTO issue_events(issue_number, field, actor) VALUES (999, 'title', 'test')"),
      db.prepare("INSERT INTO comments(issue_number, author, body) VALUES (1, 'test', 'must not run')"),
    ])).rejects.toMatchObject({ code: 'foreign_key' });
    expect(await db.prepare('SELECT title FROM issues').first('title')).toBe('original');
    expect(await db.prepare('SELECT * FROM issue_events').first()).toBeNull();
    expect(await db.prepare('SELECT * FROM comments').first()).toBeNull();
    await db.batch([db.prepare("UPDATE issues SET title = 'recovered' WHERE number = 1")]);
    expect(await db.prepare('SELECT title FROM issues').first('title')).toBe('recovered');
  });

  it('API multi-field PATCH rolls back issue and earlier history when a later event fails', async () => {
    expect((await api('POST', '/issues', { title: 'original', status: 'Todo' })).status).toBe(201);
    const before: unknown = await (await api('GET', '/issues/1')).json();
    await db.prepare(`CREATE TRIGGER reject_status_event BEFORE INSERT ON issue_events
      WHEN NEW.field = 'status' BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: test event'); END`).run();
    const failed = await api('PATCH', '/issues/1', { title: 'changed', status: 'Done', actor: 'test' });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: '資料不符合限制' });
    expect(await (await api('GET', '/issues/1')).json()).toEqual(before);
    expect(await (await api('GET', '/issues/1/events')).json()).toEqual({ events: [] });
    await db.prepare('DROP TRIGGER reject_status_event').run();
    expect((await api('PATCH', '/issues/1', { title: 'changed', status: 'Done' })).status).toBe(200);
  });

  it('concurrent batches keep successful writes and histories while failed batches leave neither', async () => {
    const batches = Array.from({ length: 8 }, (_, i) => db.batch([
      db.prepare('INSERT INTO issues(number, title) VALUES (?, ?)').bind(i + 1, `issue ${String(i)}`),
      db.prepare('INSERT INTO issue_events(issue_number, field, actor) VALUES (?, ?, ?)').bind(i + 1, i % 2 === 0 ? 'title' : 'invalid', 'test'),
    ]));
    const results = await Promise.allSettled(batches);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled', 'rejected']);
    expect((await db.prepare('SELECT number FROM issues ORDER BY number').all()).results).toEqual([{ number: 1 }, { number: 3 }, { number: 5 }, { number: 7 }]);
    expect((await db.prepare('SELECT issue_number FROM issue_events ORDER BY issue_number').all()).results).toEqual([{ issue_number: 1 }, { issue_number: 3 }, { issue_number: 5 }, { issue_number: 7 }]);
  });
});
