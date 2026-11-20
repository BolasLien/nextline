import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { env } from 'node:process';
import { D1Adapter } from '../adapters/d1';
import { SqliteAdapter } from '../adapters/sqlite';
import { openSqlite, MIGRATIONS } from './d1';
import type { Database } from '../core/database';

export interface TestDatabase {
  db: Database;
  close(): void | Promise<void>;
}

// These are different engines: workerd's actual D1 binding and node:sqlite.
export async function createDatabase(): Promise<TestDatabase> {
  if (env.NEXTLINE_TEST_DB !== 'd1') {
    const connection = openSqlite();
    return { db: new SqliteAdapter(connection), close: () => { connection.close(); } };
  }
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("test database"); } }',
    compatibilityDate: '2026-10-01',
    d1Databases: ['DB'],
  }));
  try {
    const raw = await mf.getD1Database('DB');
    for (const sql of MIGRATIONS) {
      // Our migrations contain no SQL strings with semicolons and no triggers.
      const statements = sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
      await raw.batch(statements.map((s) => raw.prepare(s)));
    }
    return { db: new D1Adapter(raw), close: () => mf.dispose() };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
