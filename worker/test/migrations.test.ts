// migrations/0002：舊資料（0001 的 schema）套用後要完整保留，position、workspace_id 要正確補值。
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openSqlite, toD1 } from './d1';
import worker, { type Env } from '../index';

const TOKEN = 'test-token';

function seedV1() {
  const db = openSqlite(1);
  db.exec(`
    INSERT INTO projects (id, name, status) VALUES (1, 'Nextline', 'started');
    INSERT INTO sprints (id, number, starts_at, ends_at) VALUES (1, 1, '2026-11-02T00:00:00.000Z', '2026-11-16T00:00:00.000Z');
    INSERT INTO issues (number, legacy_identifier, title, description, status, project_id, sprint_id, due_date, created_at, updated_at, completed_at)
    VALUES
      (1, 'BOL-1', '舊的 Todo', '說明', 'Todo', 1, 1, '2026-11-10', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NULL),
      (2, NULL, '新的 Todo', '', 'Todo', NULL, NULL, NULL, '2026-10-02T00:00:00.000Z', '2026-10-20T00:00:00.000Z', NULL),
      (3, NULL, '中間的 Todo', '', 'Todo', NULL, NULL, NULL, '2026-10-03T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
      (5, NULL, '做完', '', 'Done', 1, NULL, NULL, '2026-10-04T00:00:00.000Z', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z');
    INSERT INTO comments (id, issue_number, author, body, linear_id) VALUES (1, 1, 'Bolas', '下一步：看', 'lin-1'), (2, 5, '阿澈', '完成', NULL);
    INSERT INTO issue_blockers (issue_number, blocked_by_number, created_at) VALUES (2, 1, '2026-10-02T00:00:00.000Z');
    INSERT INTO issue_events (id, issue_number, field, from_value, to_value, actor, created_at)
    VALUES (1, 5, 'status', 'Todo', 'Done', 'api', '2026-10-05T00:00:00.000Z');
  `);
  return db;
}

describe('migration 0002', () => {
  it('舊資料數量與內容不變，position 依更新時間新到舊、workspace 補 1', () => {
    const db = seedV1();
    const count = (t: string) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c;
    const before = ['issues', 'comments', 'issue_blockers', 'issue_events', 'projects', 'sprints'].map(count);
    const issuesBefore = db.prepare('SELECT number, legacy_identifier, title, description, status, project_id, sprint_id, due_date, created_at, updated_at, completed_at, canceled_at FROM issues ORDER BY number').all();
    db.exec(MIGRATIONS[1] ?? '');
    expect(['issues', 'comments', 'issue_blockers', 'issue_events', 'projects', 'sprints'].map(count)).toEqual(before);
    expect(
      db.prepare('SELECT number, legacy_identifier, title, description, status, project_id, sprint_id, due_date, created_at, updated_at, completed_at, canceled_at FROM issues ORDER BY number').all(),
    ).toEqual(issuesBefore);

    const todo = db.prepare("SELECT number, position FROM issues WHERE status = 'Todo' ORDER BY position").all();
    expect(todo.map((r) => r.number)).toEqual([2, 3, 1]);
    expect(todo.map((r) => r.position)).toEqual([1024, 2048, 3072]);
    expect(db.prepare("SELECT position FROM issues WHERE status = 'Done'").get()?.position).toBe(1024);

    for (const t of ['issues', 'comments', 'issue_blockers', 'issue_events', 'projects', 'sprints']) {
      expect(db.prepare(`SELECT DISTINCT workspace_id AS w FROM ${t}`).all().map((r) => r.w)).toEqual([1]);
    }
    expect(db.prepare('SELECT id, name FROM workspaces').all()).toEqual([{ id: 1, name: 'Bolas' }]);
    // 子表的外鍵指向新的 issues（沒有殘留 issues_new），外鍵檢查沒有問題。
    expect(db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%issues_new%' OR sql LIKE '%events_new%'").all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('migration 後 API 照常：舊編號查得到、comment 與 blocked by 都在、新票接著編號並放欄頂、外鍵 cascade 仍有效', async () => {
    const sqlite = seedV1();
    sqlite.exec(MIGRATIONS[1] ?? '');
    // API 用的是最新的 schema，後面的 migration 也套上
    for (const m of MIGRATIONS.slice(2)) sqlite.exec(m);
    const env: Env = { DB: toD1(sqlite), API_TOKEN: TOKEN };
    const call = async (method: string, path: string, body?: unknown) => {
      const init: RequestInit = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await worker.fetch(new Request(`https://x${path}`, init) as Request<unknown, IncomingRequestCfProperties>, env);
      return { status: res.status, body: await res.json<Record<string, unknown>>() };
    };
    const old = await call('GET', '/api/issues/BOL-1');
    expect(old.body).toMatchObject({ number: 1, title: '舊的 Todo', blocks: [expect.objectContaining({ number: 2 })] });
    expect(((await call('GET', '/api/issues/NX-1/comments')).body.comments as unknown[]).length).toBe(1);
    expect((await call('GET', '/api/issues/NX-5/events')).body.events).toEqual([
      expect.objectContaining({ id: 1, field: 'status', to_value: 'Done', revert_of_event_id: null, reverted_by_event_id: null }),
    ]);
    const created = await call('POST', '/api/issues', { title: '新票', status: 'Todo' });
    expect(created.body).toMatchObject({ number: 6, position: 0 });
    // 舊的變更紀錄也能還原
    expect((await call('POST', '/api/issues/NX-5/events/1/revert')).body.issue).toMatchObject({ status: 'Todo' });
    // 外鍵 ON DELETE CASCADE 還在（新表指向改名後的 issues）
    sqlite.exec('DELETE FROM issues WHERE number = 1');
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM comments WHERE issue_number = 1').get()?.c).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM issue_blockers').get()?.c).toBe(0);
  });
});

describe('migration 0003（封存）', () => {
  it('票、comment、blocked by、變更紀錄數量不變；舊紀錄（含還原關係）原樣保留；archived_at 都是 NULL', () => {
    const db = openSqlite(2);
    db.exec(`
      INSERT INTO issues (number, title, status) VALUES (1, 'A', 'Todo'), (2, 'B', 'Done'), (3, 'C', 'In Review');
      INSERT INTO comments (issue_number, author, body) VALUES (1, 'Bolas', '下一步：看');
      INSERT INTO issue_blockers (issue_number, blocked_by_number) VALUES (1, 2);
      INSERT INTO issue_events (id, issue_number, field, from_value, to_value, actor) VALUES (1, 2, 'status', 'Todo', 'Done', 'api');
      INSERT INTO issue_events (id, issue_number, field, from_value, to_value, actor, revert_of_event_id) VALUES (2, 2, 'status', 'Done', 'Todo', 'api', 1);
      UPDATE issue_events SET reverted_by_event_id = 2 WHERE id = 1;
    `);
    const tables = ['issues', 'comments', 'issue_blockers', 'issue_events', 'projects', 'sprints'];
    const count = (t: string) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c;
    const before = tables.map(count);
    const byStatus = () => db.prepare('SELECT status, COUNT(*) AS c FROM issues GROUP BY status ORDER BY status').all();
    const statusBefore = byStatus();
    const eventsBefore = db.prepare('SELECT * FROM issue_events ORDER BY id').all();
    db.exec(MIGRATIONS[2] ?? '');
    expect(tables.map(count)).toEqual(before);
    expect(byStatus()).toEqual(statusBefore);
    expect(db.prepare('SELECT * FROM issue_events ORDER BY id').all()).toEqual(eventsBefore);
    expect(db.prepare('SELECT COUNT(*) AS c FROM issues WHERE archived_at IS NOT NULL').get()?.c).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%events_new%'").all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // 新的欄位名稱可以寫進變更紀錄
    db.exec("INSERT INTO issue_events (issue_number, field, from_value, to_value, actor) VALUES (1, 'archived', NULL, '2026-11-04T00:00:00.000Z', 'api')");
  });
});

describe('migration 0005（拿掉 Project 狀態，NX-165）', () => {
  it('projects.status 欄位不見；票、comment、Project、變更紀錄、blocked by 數量與 Project 其他欄位不變；外鍵沒問題', () => {
    const db = openSqlite(4);
    db.exec(`
      INSERT INTO projects (id, name, status, description, pinned_at) VALUES (1, 'A', 'started', '說明', '2026-11-01T00:00:00.000Z'), (2, 'B', 'completed', '', NULL);
      INSERT INTO issues (number, title, status, project_id) VALUES (1, 'x', 'Todo', 1), (2, 'y', 'Done', 2);
      INSERT INTO comments (issue_number, author, body) VALUES (1, 'Bolas', '下一步：看');
      INSERT INTO issue_blockers (issue_number, blocked_by_number) VALUES (1, 2);
      INSERT INTO issue_events (issue_number, field, from_value, to_value, actor) VALUES (2, 'status', 'Todo', 'Done', 'api');
    `);
    const tables = ['issues', 'comments', 'issue_blockers', 'issue_events', 'projects', 'sprints'];
    const count = (t: string) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c;
    const before = tables.map(count);
    const rest = () => db.prepare('SELECT id, name, description, linear_id, created_at, updated_at, pinned_at, workspace_id FROM projects ORDER BY id').all();
    const projectsBefore = rest();
    db.exec(MIGRATIONS[4] ?? '');
    expect(tables.map(count)).toEqual(before);
    expect(rest()).toEqual(projectsBefore);
    expect(db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name)).not.toContain('status');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec("INSERT INTO projects (name) VALUES ('C')");
  });
});
