// The portable SQL subset used by Nextline. Adapters own runtime types and errors.
export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface QueryResult<T = Row> {
  success: true;
  results: T[];
  // Runtime telemetry (duration, rows scanned, region) is deliberately not a contract.
  meta: { changes: number; last_row_id: number };
}

export interface PreparedStatement {
  bind(...values: SqlValue[]): PreparedStatement;
  first<T = Row>(column?: string): Promise<T | null>;
  all<T = Row>(): Promise<QueryResult<T>>;
  run<T = Row>(): Promise<QueryResult<T>>;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  // Ordered, atomic execution. Every statement must belong to this database.
  batch<T = Row>(statements: PreparedStatement[]): Promise<QueryResult<T>[]>;
}

export class DatabaseError extends Error {
  constructor(readonly code: 'unique' | 'foreign_key' | 'check' | 'not_null' | 'query', message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export function databaseError(error: unknown): DatabaseError {
  const message = error instanceof Error ? error.message : String(error);
  for (const [needle, code] of [
    ['UNIQUE constraint failed', 'unique'],
    ['FOREIGN KEY constraint failed', 'foreign_key'],
    ['CHECK constraint failed', 'check'],
    ['NOT NULL constraint failed', 'not_null'],
  ] as const) {
    if (message.includes(needle)) return new DatabaseError(code, needle);
  }
  return new DatabaseError('query', 'Database query failed');
}

export function validateValues(values: SqlValue[]): void {
  if (values.some((value) => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) {
    throw new DatabaseError('query', 'Unsupported SQL parameter');
  }
}
