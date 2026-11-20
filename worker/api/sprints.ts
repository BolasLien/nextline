import type { Database } from '../core/database';
import { HttpError, json, now, nullableStr, readBody, requiredInt, requiredTimestamp, timestamp } from './http';

const COLS = 'id, number, name, starts_at, ends_at, linear_id, created_at';

export interface SprintRow {
  id: number;
  number: number;
  name: string | null;
  starts_at: string;
  ends_at: string;
  linear_id: string | null;
  created_at: string;
}

export async function getSprint(db: Database, id: number): Promise<SprintRow> {
  const row = await db.prepare(`SELECT ${COLS} FROM sprints WHERE id = ?`).bind(id).first<SprintRow>();
  if (row === null) throw new HttpError(404, `找不到 Sprint ${String(id)}`);
  return row;
}

export async function listSprints(db: Database): Promise<Response> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM sprints ORDER BY number DESC`).all<SprintRow>();
  return json({ sprints: results });
}

function checkRange(startsAt: string, endsAt: string): void {
  if (endsAt <= startsAt) throw new HttpError(400, 'ends_at 必須晚於 starts_at');
}

export async function createSprint(db: Database, request: Request): Promise<Response> {
  const body = await readBody(request);
  const number = requiredInt(body, 'number');
  const name = nullableStr(body, 'name') ?? null;
  const startsAt = requiredTimestamp(body, 'starts_at');
  const endsAt = requiredTimestamp(body, 'ends_at');
  const linearId = nullableStr(body, 'linear_id') ?? null;
  const createdAt = timestamp(body, 'created_at') ?? now();
  checkRange(startsAt, endsAt);
  const dup = await db.prepare('SELECT id FROM sprints WHERE number = ?').bind(number).first<{ id: number }>();
  if (dup !== null) throw new HttpError(409, `Sprint ${String(number)} 已存在`, { id: dup.id });
  if (linearId !== null) {
    const dupLinear = await db.prepare('SELECT id FROM sprints WHERE linear_id = ?').bind(linearId).first<{ id: number }>();
    if (dupLinear !== null) throw new HttpError(409, `linear_id ${linearId} 已存在`, { id: dupLinear.id });
  }
  const row = await db
    .prepare(
      `INSERT INTO sprints (number, name, starts_at, ends_at, linear_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
    )
    .bind(number, name, startsAt, endsAt, linearId, createdAt)
    .first<SprintRow>();
  return json(row, 201);
}

export async function updateSprint(db: Database, id: number, request: Request): Promise<Response> {
  const body = await readBody(request);
  const current = await getSprint(db, id);
  const name = nullableStr(body, 'name');
  const startsAt = timestamp(body, 'starts_at') ?? current.starts_at;
  const endsAt = timestamp(body, 'ends_at') ?? current.ends_at;
  checkRange(startsAt, endsAt);
  const row = await db
    .prepare(`UPDATE sprints SET name = ?, starts_at = ?, ends_at = ? WHERE id = ? RETURNING ${COLS}`)
    .bind(name === undefined ? current.name : name, startsAt, endsAt, id)
    .first<SprintRow>();
  return json(row);
}
