// 測試用的 D1：用 Node 內建 SQLite 跑 migrations/ 的真 schema，實作 Worker 會用到的 D1 API。
import { DatabaseSync } from 'node:sqlite';
// 新增 migration 時在這裡加 import，並依序加進 MIGRATIONS。
import m0001 from '../../migrations/0001_initial.sql?raw';
import m0002 from '../../migrations/0002_review_position_workspace_events.sql?raw';
import m0003 from '../../migrations/0003_issue_archive.sql?raw';
import m0004 from '../../migrations/0004_project_pin.sql?raw';
import m0005 from '../../migrations/0005_drop_project_status.sql?raw';

export const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005];

type Param = string | number | null;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    for (const p of params) {
      if (p !== null && typeof p !== 'string' && typeof p !== 'number') {
        throw new Error(`D1_TYPE_ERROR: 不支援的參數型別 ${typeof p}`);
      }
    }
    return new Statement(this.db, this.sql, params as Param[]);
  }

  first(column?: string): Promise<unknown> {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(column === undefined ? { ...row } : row[column]);
  }

  all(): Promise<unknown> {
    return Promise.resolve(this.allSync());
  }

  allSync() {
    const results = this.db
      .prepare(this.sql)
      .all(...this.params)
      .map((r) => ({ ...r }));
    return { success: true, results, meta: {} };
  }

  run(): Promise<unknown> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return Promise.resolve({
      success: true,
      results: [],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    });
  }
}

// 開一個空的 SQLite，套用前 count 個 migration（預設全部）。測 migration 時先停在舊版、塞舊資料，再套下一個。
export function openSqlite(count = MIGRATIONS.length): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // D1 預設開著外鍵檢查。
  db.exec('PRAGMA foreign_keys = ON;');
  for (const sql of MIGRATIONS.slice(0, count)) db.exec(sql);
  return db;
}

export function createTestDb(): D1Database {
  return toD1(openSqlite());
}

export function toD1(db: DatabaseSync): D1Database {
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    // D1 的 batch 是一個交易：任何一句失敗就全部撤回。
    batch: (statements: Statement[]) => {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.allSync());
        db.exec('COMMIT');
        return Promise.resolve(results);
      } catch (e) {
        db.exec('ROLLBACK');
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
  };
  return d1 as unknown as D1Database;
}
