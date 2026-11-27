import type { Database, PreparedStatement } from '../core/database';
import {
  type Body,
  bool,
  HttpError,
  json,
  now,
  readBody,
  requiredInt,
  requiredStr,
  str,
  timestamp,
  nullableStr,
} from './http';

// last_activity_at（NX-162）：Project 本身、底下任一張票（含已封存）的 updated_at、底下任一張票最新 comment 的 created_at，
// 取最新的一個。時間都是同格式的 ISO 8601 UTC 字串，直接比字串就是比時間。不存欄位，每次查詢即時算。
const SELECT = `SELECT p.id, p.name, p.description, p.linear_id, p.created_at, p.updated_at, p.pinned_at,
  MAX(
    p.updated_at,
    COALESCE((SELECT MAX(i.updated_at) FROM issues i WHERE i.project_id = p.id), ''),
    COALESCE((SELECT MAX(c.created_at) FROM comments c JOIN issues i ON i.number = c.issue_number WHERE i.project_id = p.id), '')
  ) AS last_activity_at
FROM projects p`;

// 預設排序（NX-162）：釘選的在最上面（彼此照 pinned_at 新到舊），其餘照 last_activity_at 新到舊；同時間照名稱。
const ORDER = 'ORDER BY p.pinned_at IS NULL, p.pinned_at DESC, last_activity_at DESC, p.name';

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  linear_id: string | null;
  created_at: string;
  updated_at: string;
  pinned_at: string | null;
  last_activity_at: string;
}

export async function getProject(db: Database, id: number): Promise<ProjectRow> {
  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<ProjectRow>();
  if (row === null) throw new HttpError(404, `找不到 Project ${String(id)}`);
  return row;
}

export async function listProjects(db: Database): Promise<Response> {
  // NX-165：Project 沒有狀態了；舊的 ?status= 篩選拿掉，帶了也不管（跟 POST／PATCH 忽略 status 一致）。
  const { results } = await db.prepare(`${SELECT} ${ORDER}`).all<ProjectRow>();
  return json({ projects: results });
}

async function ensureUnique(db: Database, body: { name?: string | undefined; linear_id?: string | null | undefined }, selfId?: number): Promise<void> {
  if (body.name !== undefined) {
    const dup = await db.prepare('SELECT id FROM projects WHERE name = ?').bind(body.name).first<{ id: number }>();
    if (dup !== null && dup.id !== selfId) throw new HttpError(409, `Project 名稱「${body.name}」已存在`, { id: dup.id });
  }
  if (typeof body.linear_id === 'string') {
    const dup = await db.prepare('SELECT id FROM projects WHERE linear_id = ?').bind(body.linear_id).first<{ id: number }>();
    if (dup !== null && dup.id !== selfId) throw new HttpError(409, `linear_id ${body.linear_id} 已存在`, { id: dup.id });
  }
}

// 帶了會忽略、不回 400 的欄位（見下一段）；其他不認得的欄位回 400（NX-248）。
const IGNORED = ['status', 'state'];

// NX-165：Project 沒有狀態。POST／PATCH 帶 status 一律忽略（不回 400）：舊的 agent、Skill、照 Linear 習慣帶 status／state 的呼叫照樣成功，
// 而 status 已經沒有任何作用，丟掉不會讓資料錯。
export async function createProject(db: Database, request: Request): Promise<Response> {
  const body = await readBody(request, ['name', 'description', 'linear_id', 'created_at', 'updated_at', ...IGNORED]);
  const name = requiredStr(body, 'name');
  const description = str(body, 'description') ?? '';
  const linearId = nullableStr(body, 'linear_id') ?? null;
  const createdAt = timestamp(body, 'created_at') ?? now();
  const updatedAt = timestamp(body, 'updated_at') ?? createdAt;
  await ensureUnique(db, { name, linear_id: linearId });
  const row = await db
    .prepare(
      `INSERT INTO projects (name, description, linear_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(name, description, linearId, createdAt, updatedAt)
    .first<{ id: number }>();
  if (row === null) throw new HttpError(500, 'Project 沒有建立成功');
  return json(await getProject(db, row.id), 201);
}

export async function updateProject(db: Database, id: number, request: Request): Promise<Response> {
  const body: Body = await readBody(request, ['name', 'description', 'pinned', ...IGNORED]);
  const current = await getProject(db, id);
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const name = str(body, 'name')?.trim();
  if (name === '') throw new HttpError(400, 'name 不可以是空的');
  if (name !== undefined && name !== current.name) {
    await ensureUnique(db, { name }, id);
    sets.push('name = ?');
    params.push(name);
  }
  const description = str(body, 'description');
  if (description !== undefined && description !== current.description) {
    sets.push('description = ?');
    params.push(description);
  }
  // 釘選（NX-162）：true 記下釘選時間（已釘選就不動），false 清掉。釘選不算 Project 有更新，不動 updated_at。
  const pinned = bool(body, 'pinned');
  const pinSet = pinned === undefined || pinned === (current.pinned_at !== null) ? null : pinned ? now() : '';
  if (sets.length === 0 && pinSet === null) return json(current);
  const statements: PreparedStatement[] = [];
  if (sets.length > 0) {
    statements.push(db.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, now(), id));
  }
  if (pinSet !== null) {
    statements.push(db.prepare('UPDATE projects SET pinned_at = ? WHERE id = ?').bind(pinSet === '' ? null : pinSet, id));
  }
  await db.batch(statements);
  return json(await getProject(db, id));
}

// 合併說明：來源說明非空時附標題與分隔線附加到目標說明尾端；來源空白回 null 表示不動目標說明。
export function mergeProjectDescription(targetDescription: string, sourceName: string, sourceDescription: string): string | null {
  const src = sourceDescription.trim();
  if (src === '') return null;
  const section = `## 合併自「${sourceName}」\n\n${src}`;
  const dst = targetDescription.trimEnd();
  return dst === '' ? section : `${dst}\n\n---\n\n${section}`;
}

export async function mergeProject(db: Database, sourceId: number, request: Request): Promise<Response> {
  const body: Body = await readBody(request, ['target_project_id', 'append_description']);
  const targetId = requiredInt(body, 'target_project_id');
  const appendDescription = bool(body, 'append_description') ?? true;
  const source = await getProject(db, sourceId);
  if (targetId === sourceId) throw new HttpError(400, '不能把 Project 合併到自己');
  const target = await getProject(db, targetId);

  const sourceIdText = String(source.id);
  const targetIdText = String(target.id);
  const mergedDescription = appendDescription
    ? mergeProjectDescription(target.description, source.name, source.description)
    : null;

  const statements: PreparedStatement[] = [
    // 同一個 batch 內移轉全部票（含已封存），不改 updated_at、不寫新 issue_events，避免汙染排序與統計。
    db.prepare('UPDATE issues SET project_id = ? WHERE project_id = ?').bind(target.id, source.id),
    // 既有的 project 變更紀錄改指向目標 id，避免刪除來源後退回顯示 Project <id>。
    db.prepare("UPDATE issue_events SET from_value = ? WHERE field = 'project' AND from_value = ?").bind(targetIdText, sourceIdText),
    db.prepare("UPDATE issue_events SET to_value = ? WHERE field = 'project' AND to_value = ?").bind(targetIdText, sourceIdText),
  ];
  if (mergedDescription !== null) {
    statements.push(
      db.prepare('UPDATE projects SET description = ?, updated_at = ? WHERE id = ?').bind(mergedDescription, now(), target.id),
    );
  }
  statements.push(db.prepare('DELETE FROM projects WHERE id = ?').bind(source.id));

  const results = await db.batch(statements);
  const movedIssues = results[0]?.meta.changes ?? 0;
  return json({
    target: await getProject(db, target.id),
    merged_project_id: source.id,
    merged_project_name: source.name,
    moved_issues: movedIssues,
    description_appended: mergedDescription !== null,
  });
}
