import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Config } from './config';

export const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS local_owner (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL, token_hash TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS local_sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS local_login_limit (id INTEGER PRIMARY KEY CHECK(id=1), attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
`;

export function migrationFiles(config: Config) {
  return readdirSync(config.migrationsDir).filter((file) => /^\d+.*\.sql$/.test(file)).sort().map((name) => {
    const sql = readFileSync(join(config.migrationsDir, name), 'utf8');
    return { name, sql, hash: createHash('sha256').update(sql).digest('hex') };
  });
}

export function checkVersions(db: DatabaseSync, config: Config): number {
  const migrations = migrationFiles(config);
  const applied = db.prepare('SELECT name, hash FROM local_migrations ORDER BY name').all();
  if (applied.some((row, i) => row.name !== migrations[i]?.name || row.hash !== migrations[i]?.hash)) throw new Error('資料庫版本較新、順序不符或 migration 已改動；拒絕啟動。');
  return applied.length;
}

function protectDirectory(directory: string): void {
  if (existsSync(directory)) {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('資料目錄不能是捷徑或檔案。');
    if (readdirSync(directory).some((name) => !/^nextline\.sqlite(?:-wal|-shm|-journal)?$/.test(name))) throw new Error('請使用只存放 Nextline SQLite 的專用資料目錄，不能使用家目錄或原始碼目錄。');
    for (const name of readdirSync(directory)) if (!lstatSync(join(directory, name)).isFile()) throw new Error('資料檔不能是捷徑或資料夾。');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function openDatabase(config: Config, initialize = false): DatabaseSync {
  const file = join(config.dataDir, 'nextline.sqlite');
  if (!initialize && !existsSync(file)) throw new Error('尚未初始化。請先執行 npm run selfhost:init。');
  protectDirectory(config.dataDir);
  const db = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    const migrations = migrationFiles(config);
    if (initialize) db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL);');
    if (!initialize && checkVersions(db, config) !== migrations.length) throw new Error('資料庫需要更新。請停止服務、備份後執行初始化指令。');
    if (initialize) {
      // One transaction for all pending schema changes; failed migration leaves no partial version.
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const migration of migrations.slice(checkVersions(db, config))) {
          db.exec(migration.sql);
          db.prepare('INSERT INTO local_migrations VALUES (?, ?)').run(migration.name, migration.hash);
        }
        db.exec(AUTH_SCHEMA);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw new Error('Migration 未完成，所有待套用變更已撤回；修正原因後可重跑初始化。', { cause: error }); }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
