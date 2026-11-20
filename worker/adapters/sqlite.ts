/* eslint-disable @typescript-eslint/require-await -- Async contract, synchronous execution keeps each transaction indivisible. */
import { DatabaseSync } from 'node:sqlite';
import { databaseError, DatabaseError, validateValues, type Database, type PreparedStatement, type QueryResult, type Row, type SqlValue } from '../core/database';

class SqliteStatement implements PreparedStatement {
  constructor(readonly owner: SqliteAdapter, private readonly sql: string, private readonly values: SqlValue[] = []) {}

  bind(...values: SqlValue[]): PreparedStatement {
    validateValues(values);
    return new SqliteStatement(this.owner, this.sql, values);
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const row = this.execute<Row>().results[0];
    if (row === undefined) return null;
    if (column !== undefined && !Object.hasOwn(row, column)) throw new DatabaseError('query', 'Database query failed');
    return (column === undefined ? row : row[column]) as T;
  }

  async all<T = Row>(): Promise<QueryResult<T>> { return this.execute<T>(); }
  async run<T = Row>(): Promise<QueryResult<T>> { return this.execute<T>(); }

  // No await inside a transaction: other requests cannot enter this connection midway.
  execute<T>(): QueryResult<T> {
    try {
      const before = this.owner.connection.prepare('SELECT total_changes() AS n').get();
      const rows = this.owner.connection.prepare(this.sql).all(...this.values);
      const meta = this.owner.connection.prepare('SELECT total_changes() AS n, last_insert_rowid() AS last_row_id').get();
      return { success: true, results: rows.map((row) => ({ ...row }) as T), meta: { changes: Number(meta?.n) - Number(before?.n), last_row_id: Number(meta?.last_row_id) } };
    } catch (error) {
      throw databaseError(error);
    }
  }
}

// Connection lifecycle and migrations belong to the Node entry point, not the core.
export class SqliteAdapter implements Database {
  constructor(readonly connection: DatabaseSync) {
    connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  prepare(sql: string): PreparedStatement { return new SqliteStatement(this, sql); }

  async batch<T = Row>(statements: PreparedStatement[]): Promise<QueryResult<T>[]> {
    const owned = statements.map((statement) => {
      if (!(statement instanceof SqliteStatement) || statement.owner !== this) throw new DatabaseError('query', 'Statement belongs to another database');
      return statement;
    });
    if (owned.length === 0) return [];
    try {
      this.connection.exec('BEGIN IMMEDIATE');
    } catch (error) {
      throw databaseError(error);
    }
    try {
      const results = owned.map((statement) => statement.execute<T>());
      this.connection.exec('COMMIT');
      return results;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
