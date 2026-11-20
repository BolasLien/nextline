import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configFromEnv } from './config';
import { openDatabase } from './database';
import { snapshot } from './backup';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'nextline-operations-'));
  return { root, config: configFromEnv({ NEXTLINE_DATA_DIR: join(root, 'data') }) };
}

describe('backup and upgrade', () => {
  it('backs up committed WAL and restores all tables into a new directory, preserving source and credentials', async () => {
    const { root, config } = setup();
    const db = openDatabase(config, true);
    try {
      db.exec("INSERT INTO projects(name) VALUES ('project'); INSERT INTO issues(title,project_id) VALUES ('one',1),('two',1); INSERT INTO comments(issue_number,author,body) VALUES(1,'test','body'); INSERT INTO issue_blockers(issue_number,blocked_by_number) VALUES(2,1); INSERT INTO issue_events(issue_number,field,from_value,to_value,actor) VALUES(1,'status','Backlog','Todo','test'); INSERT INTO local_owner VALUES(1,'password-hash','token-hash');");
      const tables = ['projects', 'issues', 'comments', 'issue_blockers', 'issue_events', 'local_owner', 'local_migrations'];
      const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
      await snapshot(config, join(config.dataDir, 'nextline.sqlite'), join(root, 'backup'));
      await snapshot(config, join(root, 'backup/nextline.sqlite'), join(root, 'restored'));
      const restored = openDatabase({ ...config, dataDir: join(root, 'restored') });
      try { expect(tables.map((table) => restored.prepare(`SELECT * FROM ${table}`).all())).toEqual(before); } finally { restored.close(); }
      expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
      expect(statSync(join(root, 'backup')).mode & 0o777).toBe(0o700);
      expect(statSync(join(root, 'backup/nextline.sqlite')).mode & 0o777).toBe(0o600);
      await expect(snapshot(config, join(root, 'backup/nextline.sqlite'), config.dataDir)).rejects.toThrow(/已存在/);
    } finally { db.close(); }
  });

  it('upgrades actual schema 0001 with related data, reruns safely, rejects downgrade and restores old snapshot', async () => {
    const { root, config } = setup();
    const migrationsDir = join(root, 'old-migrations'); mkdirSync(migrationsDir);
    const first = readdirSync(config.migrationsDir).sort()[0];
    if (!first) throw new Error('Missing migrations');
    writeFileSync(join(migrationsDir, first), readFileSync(join(config.migrationsDir, first)));
    const oldConfig = { ...config, migrationsDir };
    const old = openDatabase(oldConfig, true);
    old.exec("INSERT INTO projects(name) VALUES ('old project'); INSERT INTO sprints(number,starts_at,ends_at) VALUES(1,'2026-01-01','2026-01-15'); INSERT INTO issues(number,title,project_id,sprint_id) VALUES(41,'old one',1,1),(42,'old two',1,1); INSERT INTO comments(issue_number,author,body) VALUES(41,'test','old comment'); INSERT INTO issue_blockers(issue_number,blocked_by_number) VALUES(42,41); INSERT INTO issue_events(issue_number,field,from_value,to_value,actor) VALUES(41,'status','Backlog','Todo','test');");
    old.close();
    await snapshot(oldConfig, join(config.dataDir, 'nextline.sqlite'), join(root, 'before-update'));
    expect(() => openDatabase(config)).toThrow(/需要更新/);
    for (let round = 0; round < 2; round++) {
      const db = openDatabase(config, true);
      try {
        expect(db.prepare('SELECT number,project_id,sprint_id FROM issues WHERE number IN (41,42) ORDER BY number').all()).toEqual([{ number: 41, project_id: 1, sprint_id: 1 }, { number: 42, project_id: 1, sprint_id: 1 }]);
        expect(db.prepare('SELECT body FROM comments').get()?.body).toBe('old comment');
        expect(db.prepare('SELECT issue_number,blocked_by_number FROM issue_blockers').get()).toEqual({ issue_number: 42, blocked_by_number: 41 });
        expect(db.prepare('SELECT actor FROM issue_events').get()?.actor).toBe('test');
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(db.prepare("INSERT INTO issues(title) VALUES('next') RETURNING number").get()?.number).toBe(43 + round);
      } finally { db.close(); }
    }
    expect(() => openDatabase(oldConfig)).toThrow(/版本/);
    await snapshot(oldConfig, join(root, 'before-update/nextline.sqlite'), join(root, 'rollback'));
    const rolledBack = openDatabase({ ...oldConfig, dataDir: join(root, 'rollback') });
    expect(rolledBack.prepare('SELECT count(*) AS n FROM issues').get()?.n).toBe(2);
    rolledBack.close();
  });

  it('rejects arbitrary directories, symlink DB, corrupt backups and future schemas without replacing data', async () => {
    const { root, config } = setup();
    expect(() => openDatabase({ ...config, dataDir: resolve('.') }, true)).toThrow(/專用/);
    mkdirSync(config.dataDir);
    writeFileSync(join(root, 'unrelated'), 'private');
    symlinkSync(join(root, 'unrelated'), join(config.dataDir, 'nextline.sqlite'));
    expect(() => openDatabase(config, true)).toThrow(/捷徑/);
    await expect(snapshot(config, join(root, 'unrelated'), join(root, 'bad'))).rejects.toThrow();
    const future = new DatabaseSync(join(root, 'future.sqlite'));
    future.exec("CREATE TABLE local_migrations(name TEXT, hash TEXT); INSERT INTO local_migrations VALUES('9999.sql','x');"); future.close();
    await expect(snapshot(config, join(root, 'future.sqlite'), join(root, 'future'))).rejects.toThrow(/版本/);
  });
});
