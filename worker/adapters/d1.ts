import { databaseError, DatabaseError, validateValues, type Database, type PreparedStatement, type QueryResult, type Row, type SqlValue } from '../core/database';

function result<T>(value: D1Result<T>): QueryResult<T> {
  return { success: true, results: value.results, meta: { changes: value.meta.changes, last_row_id: value.meta.last_row_id } };
}

class D1Statement implements PreparedStatement {
  constructor(readonly owner: D1Adapter, readonly raw: D1PreparedStatement) {}

  bind(...values: SqlValue[]): PreparedStatement {
    validateValues(values);
    return new D1Statement(this.owner, this.raw.bind(...values));
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    try {
      return await (column === undefined ? this.raw.first<T>() : this.raw.first<T>(column));
    } catch (error) {
      throw databaseError(error);
    }
  }

  async all<T = Row>(): Promise<QueryResult<T>> {
    try {
      return result(await this.raw.all<T>());
    } catch (error) {
      throw databaseError(error);
    }
  }

  async run<T = Row>(): Promise<QueryResult<T>> {
    try {
      return result(await this.raw.run<T>());
    } catch (error) {
      throw databaseError(error);
    }
  }
}

export class D1Adapter implements Database {
  constructor(private readonly db: D1Database) {}

  prepare(sql: string): PreparedStatement {
    return new D1Statement(this, this.db.prepare(sql));
  }

  async batch<T = Row>(statements: PreparedStatement[]): Promise<QueryResult<T>[]> {
    const raw = statements.map((statement) => {
      if (!(statement instanceof D1Statement) || statement.owner !== this) {
        throw new DatabaseError('query', 'Statement belongs to another database');
      }
      return statement.raw;
    });
    if (raw.length === 0) return [];
    try {
      return (await this.db.batch<T>(raw)).map(result);
    } catch (error) {
      throw databaseError(error);
    }
  }
}
