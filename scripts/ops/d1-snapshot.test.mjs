import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot, snapshotSqlite, summary } from './d1-snapshot.mjs';

mkdirSync(resolve('.scratch/nx196'), { recursive: true });
const dir = mkdtempSync(resolve('.scratch/nx196/snapshot-test-'));

describe('offline D1 snapshots', () => {
  it('defers forward event links for the entire import and retains literal escapes exactly', () => {
    const sql = "PRAGMA defer_foreign_keys=TRUE; CREATE TABLE events(id INTEGER PRIMARY KEY, link INTEGER REFERENCES events(id), body TEXT); INSERT INTO events VALUES(1,2,'literal \\n and real\nnewline'); INSERT INTO events VALUES(2,1,'revert');";
    const file = join(dir, 'forward.sql'); writeFileSync(file, sql);
    const oldImporter = new DatabaseSync(':memory:');
    try { expect(() => oldImporter.exec(sql)).toThrow(/FOREIGN KEY/); } finally { oldImporter.close(); }
    const expected = snapshot(file);
    expect(JSON.parse(expected.tables.events[0]).body).toBe('literal \\n and real\nnewline');
    const sqlite = join(dir, 'restored.sqlite');
    const db = new DatabaseSync(sqlite);
    db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;'); db.exec(sql); db.exec('COMMIT'); db.close();
    expect(snapshotSqlite(sqlite)).toEqual(expected);
    const changed = join(dir, 'changed.sql'); writeFileSync(changed, sql.replace('\\n', '\n'));
    expect(summary(snapshot(changed))).not.toEqual(summary(expected));
  });
  it('still rejects genuine dangling references', () => {
    const file = join(dir, 'invalid.sql');
    writeFileSync(file, 'PRAGMA defer_foreign_keys=TRUE; CREATE TABLE events(id INTEGER PRIMARY KEY, link INTEGER REFERENCES events(id)); INSERT INTO events VALUES(1,999);');
    expect(() => snapshot(file)).toThrow();
  });
});
