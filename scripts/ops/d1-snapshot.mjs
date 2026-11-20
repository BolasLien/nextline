// Inspect a trusted Wrangler SQL export offline; never connects to Cloudflare.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

function collect(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(r => r.name);
  const tables = Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(r => JSON.stringify(r)).sort()]));
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY type,name").all();
  return { schema, tables };
}

export function snapshot(sqlFile) {
  const db = new DatabaseSync(':memory:');
  try {
    // Wrangler exports defer_foreign_keys without BEGIN. Self-referencing event
    // pairs can point forward, so keep deferral alive across the entire import.
    db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
    db.exec(readFileSync(sqlFile, 'utf8'));
    const result = collect(db);
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}
// Only use on a stopped, isolated local D1; never on a live database file.
export function snapshotSqlite(sqliteFile) {
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try { return collect(db); } finally { db.close(); }
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function summary(data) {
  return { schemaSha256: digest(data.schema), tables: Object.fromEntries(Object.entries(data.tables).map(([name, rows]) => [name, { rows: rows.length, sha256: digest(rows) }])) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [beforeFile, afterFile, sqliteFile] = process.argv.slice(2);
  assert.ok(beforeFile, 'Usage: node scripts/ops/d1-snapshot.mjs before.sql [after.sql | --restored-sqlite stopped-local-d1.sqlite]');
  const before = summary(snapshot(beforeFile));
  if (!afterFile) console.log(JSON.stringify(before, null, 2));
  else {
    const after = summary(afterFile === '--restored-sqlite' ? snapshotSqlite(sqliteFile) : snapshot(afterFile));
    const equal = JSON.stringify(before) === JSON.stringify(after);
    console.log(JSON.stringify({ equal, before, after }, null, 2));
    if (!equal) process.exitCode = 1;
  }
}
