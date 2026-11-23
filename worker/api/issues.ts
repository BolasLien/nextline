import type { Database, PreparedStatement } from '../core/database';
import {
  type Body,
  bool,
  HttpError,
  has,
  json,
  now,
  nullableDate,
  nullableInt,
  nullableStr,
  nullableTimestamp,
  oneOf,
  queryInt,
  readBody,
  requiredStr,
  str,
  timestamp,
  toTimestamp,
} from './http';
import { extractNextStep } from '../web/classify';
import { getProject } from './projects';
import { getSprint } from './sprints';

// In Review 介面顯示「待驗收」。順序就是看板欄的順序。
export const ISSUE_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
// 沒做完的票。
export const OPEN_ISSUE_STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review'] as const satisfies readonly IssueStatus[];

// 第二版先只有一個 workspace（migrations/0002）。
export const DEFAULT_WORKSPACE = 1;

// 看板排序：同一欄（同一個狀態）裡 position 小的在上。整數、間隔 1024；
// 插到兩張中間取中間值，沒空隙（相差小於 2）時把整欄重新編號成 1024、2048、…再算一次。
export const POSITION_STEP = 1024;
const COLUMN_ORDER = 'position ASC, number DESC';

const COLS =
  'number, legacy_identifier, title, description, status, position, project_id, sprint_id, due_date, created_at, updated_at, completed_at, canceled_at, archived_at';

interface IssueRow {
  number: number;
  legacy_identifier: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  position: number;
  project_id: number | null;
  sprint_id: number | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  canceled_at: string | null;
  // 封存時間；NULL＝沒封存（NX-160）
  archived_at: string | null;
}

interface IssueSummaryRow {
  number: number;
  legacy_identifier: string | null;
  title: string;
  status: IssueStatus;
}

export function identifier(number: number): string {
  return `NX-${String(number)}`;
}

function toIssue<T extends { number: number }>(row: T): T & { identifier: string } {
  return { identifier: identifier(row.number), ...row };
}

const LEGACY = /^[A-Z][A-Z0-9]*-\d+$/;

// 票的參照：NX-12、12 都是 NX 編號；其他「字母-數字」（例如 ABC-150）當成舊編號查。不分大小寫。
export async function resolveIssue(db: Database, ref: string): Promise<IssueRow> {
  const upper = ref.trim().toUpperCase();
  const nx = /^(?:NX-)?(\d+)$/.exec(upper)?.[1];
  let row: IssueRow | null = null;
  if (nx !== undefined) {
    row = await db.prepare(`SELECT ${COLS} FROM issues WHERE number = ?`).bind(Number(nx)).first<IssueRow>();
  } else if (LEGACY.test(upper)) {
    row = await db.prepare(`SELECT ${COLS} FROM issues WHERE legacy_identifier = ?`).bind(upper).first<IssueRow>();
  }
  if (row === null) throw new HttpError(404, `找不到票 ${ref}`);
  return row;
}

// 參照到別張票（blocked_by、before、after）找不到時是請求內容錯，回 400。
async function resolveOther(db: Database, ref: string): Promise<IssueRow> {
  try {
    return await resolveIssue(db, ref);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(400, e.message);
    throw e;
  }
}

async function blockerLists(db: Database, number: number) {
  const [blockedBy, blocks] = await db.batch<IssueSummaryRow>([
    db
      .prepare(
        `SELECT i.number, i.legacy_identifier, i.title, i.status
         FROM issue_blockers b JOIN issues i ON i.number = b.blocked_by_number
         WHERE b.issue_number = ? ORDER BY i.number`,
      )
      .bind(number),
    db
      .prepare(
        `SELECT i.number, i.legacy_identifier, i.title, i.status
         FROM issue_blockers b JOIN issues i ON i.number = b.issue_number
         WHERE b.blocked_by_number = ? ORDER BY i.number`,
      )
      .bind(number),
  ]);
  return {
    blocked_by: (blockedBy?.results ?? []).map(toIssue),
    blocks: (blocks?.results ?? []).map(toIssue),
  };
}

// 每張票最新一則 comment 的內文；沒有 comment 的票不在 Map 裡。
// 票號用一個 JSON 參數帶進去（json_each），D1 一個查詢最多 100 個參數，列表一頁最多 200 張。
async function latestComments(db: Database, numbers: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (numbers.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT c.issue_number AS n, c.body FROM comments c
       WHERE c.issue_number IN (SELECT value FROM json_each(?1))
         AND c.id = (SELECT c2.id FROM comments c2 WHERE c2.issue_number = c.issue_number ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1)`,
    )
    .bind(JSON.stringify(numbers))
    .all<{ n: number; body: string }>();
  for (const r of results) out.set(r.n, r.body);
  return out;
}

// 只能讀的欄位 next_step：最新一則 comment 的「下一步：」，最新那則沒寫就是 null（規則在 ../web/classify.ts）。
function withDerived<T extends { number: number; status: IssueStatus }>(row: T, latest: Map<number, string>) {
  return { ...toIssue(row), next_step: extractNextStep(latest.get(row.number) ?? null) };
}

async function issueDetail(db: Database, row: IssueRow) {
  const latest = await latestComments(db, [row.number]);
  return { ...withDerived(row, latest), ...(await blockerLists(db, row.number)) };
}

// ---- 票 ----

export async function getIssue(db: Database, ref: string): Promise<Response> {
  return json(await issueDetail(db, await resolveIssue(db, ref)));
}

// 篩選：status（可重複或用逗號分隔）、project、sprint（id，或 none 代表沒設定）、
// updated_since／updated_before（ISO 時間，含下界、不含上界），limit／offset 分頁。
// archived：預設不含已封存的票；include＝都要，only＝只要已封存的（NX-160）。
// 排序 sort：updated（預設，更新時間新到舊）或 position（看板順序，同一欄 position 小的在上）。
export async function listIssues(db: Database, url: URL): Promise<Response> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const q = url.searchParams;

  const statuses = q
    .getAll('status')
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (statuses.length > 0) {
    for (const s of statuses) {
      if (!(ISSUE_STATUSES as readonly string[]).includes(s)) {
        throw new HttpError(400, `status 必須是 ${ISSUE_STATUSES.join('、')} 其中之一`);
      }
    }
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }

  for (const [key, column] of [
    ['project', 'project_id'],
    ['sprint', 'sprint_id'],
  ] as const) {
    const v = q.get(key);
    if (v === null || v === '') continue;
    if (v === 'none') {
      where.push(`${column} IS NULL`);
    } else if (/^\d+$/.test(v)) {
      where.push(`${column} = ?`);
      params.push(Number(v));
    } else {
      throw new HttpError(400, `${key} 必須是 id 或 none`);
    }
  }

  const archived = q.get('archived') ?? '';
  if (archived === '' || archived === 'exclude') where.push('archived_at IS NULL');
  else if (archived === 'only') where.push('archived_at IS NOT NULL');
  else if (archived !== 'include') throw new HttpError(400, 'archived 必須是 exclude、include 或 only');

  const since = q.get('updated_since');
  if (since !== null && since !== '') {
    where.push('updated_at >= ?');
    params.push(toTimestamp(since, 'updated_since'));
  }
  const before = q.get('updated_before');
  if (before !== null && before !== '') {
    where.push('updated_at < ?');
    params.push(toTimestamp(before, 'updated_before'));
  }

  const sort = q.get('sort') ?? 'updated';
  let order: string;
  if (sort === 'updated' || sort === '') {
    order = 'updated_at DESC, number DESC';
  } else if (sort === 'position') {
    // 欄的順序照 ISSUE_STATUSES，欄內照 position。
    order = `CASE status ${ISSUE_STATUSES.map((s, i) => `WHEN '${s}' THEN ${String(i)}`).join(' ')} END, ${COLUMN_ORDER}`;
  } else {
    throw new HttpError(400, 'sort 必須是 updated 或 position');
  }

  const limit = queryInt(url, 'limit', 50, 1, 200);
  const offset = queryInt(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
  const sql = `SELECT ${COLS} FROM issues ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${order} LIMIT ? OFFSET ?`;
  const { results } = await db
    .prepare(sql)
    .bind(...params, limit + 1, offset)
    .all<IssueRow>();
  const page = results.slice(0, limit);
  const latest = await latestComments(db, page.map((r) => r.number));
  return json({
    issues: page.map((r) => withDerived(r, latest)),
    limit,
    offset,
    has_more: results.length > limit,
  });
}

async function checkRefs(db: Database, projectId: number | null | undefined, sprintId: number | null | undefined) {
  try {
    if (typeof projectId === 'number') await getProject(db, projectId);
    if (typeof sprintId === 'number') await getSprint(db, sprintId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(400, e.message);
    throw e;
  }
}

// ---- 看板排序 ----

// 要放在哪裡：直接給 position，或放在某張票的上面（before）／下面（after）。
export type Placement = { position: number } | { before: string } | { after: string };

function readPlacement(body: Body): Placement | undefined {
  const given = (['position', 'before', 'after'] as const).filter((k) => has(body, k) && body[k] !== null);
  if (given.length === 0) return undefined;
  if (given.length > 1) throw new HttpError(400, 'position、before、after 只能帶一個');
  const key = given[0];
  const v = body[key as string];
  if (key === 'position') {
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new HttpError(400, 'position 必須是整數');
    return { position: v };
  }
  const ref = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (ref === '') throw new HttpError(400, `${String(key)} 必須是票號（例如 NX-3）`);
  return key === 'before' ? { before: ref } : { after: ref };
}

// 某一欄最上面的位置（不算 self）。空欄回 0。
async function topPosition(db: Database, status: IssueStatus, self: number): Promise<number> {
  const row = await db
    .prepare('SELECT MIN(position) AS p FROM issues WHERE workspace_id = ? AND status = ? AND number <> ?')
    .bind(DEFAULT_WORKSPACE, status, self)
    .first<{ p: number | null }>();
  return row?.p == null ? 0 : row.p - POSITION_STEP;
}

// 整欄重新編號，順序不變。
function rebalance(db: Database, status: IssueStatus): PreparedStatement {
  return db
    .prepare(
      // 用 UPDATE … FROM：寫成相關子查詢時，SQLite 會把外層條件推進子查詢，ROW_NUMBER 只算到一列。
      `UPDATE issues SET position = r.rn * ${String(POSITION_STEP)}
       FROM (
         SELECT number AS n, ROW_NUMBER() OVER (ORDER BY ${COLUMN_ORDER}) AS rn
         FROM issues WHERE workspace_id = ?1 AND status = ?2
       ) AS r
       WHERE issues.number = r.n`,
    )
    .bind(DEFAULT_WORKSPACE, status);
}

// 算出 self 放進 status 那一欄、指定位置時的 position。self 是 0 代表新票。
async function resolvePosition(db: Database, self: number, status: IssueStatus, placement: Placement): Promise<number> {
  if ('position' in placement) return placement.position;
  const before = 'before' in placement;
  const target = await resolveOther(db, before ? placement.before : placement.after);
  if (target.number === self) throw new HttpError(400, '不能放在自己的前後');
  if (target.status !== status) {
    throw new HttpError(400, `${identifier(target.number)} 在 ${target.status} 欄，不在 ${status} 欄`);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await db.prepare('SELECT position FROM issues WHERE number = ?').bind(target.number).first<{ position: number }>();
    if (t === null) throw new HttpError(400, `找不到票 ${identifier(target.number)}`);
    // before：找 target 上面那一張；after：找 target 下面那一張（同一欄、不算 self）。
    const neighbor = await db
      .prepare(
        before
          ? `SELECT position FROM issues WHERE workspace_id = ? AND status = ? AND number NOT IN (?, ?)
               AND (position < ?5 OR (position = ?5 AND number > ?4)) ORDER BY position DESC, number ASC LIMIT 1`
          : `SELECT position FROM issues WHERE workspace_id = ? AND status = ? AND number NOT IN (?, ?)
               AND (position > ?5 OR (position = ?5 AND number < ?4)) ORDER BY ${COLUMN_ORDER} LIMIT 1`,
      )
      .bind(DEFAULT_WORKSPACE, status, self, target.number, t.position)
      .first<{ position: number }>();
    if (neighbor === null) return before ? t.position - POSITION_STEP : t.position + POSITION_STEP;
    const [lo, hi] = before ? [neighbor.position, t.position] : [t.position, neighbor.position];
    if (hi - lo >= 2) return Math.floor((lo + hi) / 2);
    await rebalance(db, status).run();
  }
  throw new Error('重新編號後還是沒有空隙');
}

// ---- 新增 ----

// POST／PATCH 認得的欄位；其他欄位回 400（http.ts 的 readBody）。新增帶 archived 照文件忽略（開好再封存）。
const ISSUE_CREATE_FIELDS = [
  'title', 'description', 'status', 'project_id', 'sprint_id', 'due_date', 'position', 'before', 'after',
  'legacy_identifier', 'created_at', 'updated_at', 'completed_at', 'canceled_at', 'archived',
] as const;
const ISSUE_UPDATE_FIELDS = [
  'title', 'description', 'status', 'project_id', 'sprint_id', 'due_date', 'archived', 'position', 'before', 'after', 'actor',
] as const;

// 新開的票自動編號（NX-<n>），放在那一欄最上面（或照 position／before／after）。
// legacy_identifier、created_at 等欄位給搬家腳本保留 Linear 的舊資料。
export async function createIssue(db: Database, request: Request): Promise<Response> {
  const body = await readBody(request, ISSUE_CREATE_FIELDS);
  const title = requiredStr(body, 'title');
  const description = str(body, 'description') ?? '';
  const status = oneOf(body, 'status', ISSUE_STATUSES) ?? 'Backlog';
  const projectId = nullableInt(body, 'project_id') ?? null;
  const sprintId = nullableInt(body, 'sprint_id') ?? null;
  const dueDate = nullableDate(body, 'due_date') ?? null;
  const placement = readPlacement(body);
  const legacyRaw = nullableStr(body, 'legacy_identifier');
  const legacy = typeof legacyRaw === 'string' ? legacyRaw.trim().toUpperCase() : null;
  if (legacy !== null && (!LEGACY.test(legacy) || legacy.startsWith('NX-'))) {
    throw new HttpError(400, 'legacy_identifier 必須像 ABC-150（不能是 NX 編號）');
  }
  const createdAt = timestamp(body, 'created_at') ?? now();
  const updatedAt = timestamp(body, 'updated_at') ?? createdAt;
  const completedAt = nullableTimestamp(body, 'completed_at') ?? (status === 'Done' ? updatedAt : null);
  const canceledAt = nullableTimestamp(body, 'canceled_at') ?? (status === 'Canceled' ? updatedAt : null);

  await checkRefs(db, projectId, sprintId);
  if (legacy !== null) {
    const dup = await db.prepare('SELECT number FROM issues WHERE legacy_identifier = ?').bind(legacy).first<{ number: number }>();
    if (dup !== null) {
      throw new HttpError(409, `${legacy} 已經是 ${identifier(dup.number)}`, { number: dup.number, identifier: identifier(dup.number) });
    }
  }
  const position = placement === undefined ? await topPosition(db, status, 0) : await resolvePosition(db, 0, status, placement);

  const row = await db
    .prepare(
      `INSERT INTO issues (workspace_id, legacy_identifier, title, description, status, position, project_id, sprint_id, due_date,
                           created_at, updated_at, completed_at, canceled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
    )
    .bind(
      DEFAULT_WORKSPACE,
      legacy,
      title,
      description,
      status,
      position,
      projectId,
      sprintId,
      dueDate,
      createdAt,
      updatedAt,
      completedAt,
      canceledAt,
    )
    .first<IssueRow>();
  if (row === null) throw new Error('INSERT issues 沒有回傳資料');
  return json(await issueDetail(db, row), 201);
}

// ---- 修改與變更紀錄 ----

// 會寫進變更紀錄的欄位。position 不記。
export const EVENT_FIELDS = ['title', 'description', 'status', 'project', 'sprint', 'due_date', 'blocked_by', 'archived'] as const;
export type EventField = (typeof EVENT_FIELDS)[number];

const FIELD_NAME: Record<EventField, string> = {
  title: '標題',
  description: '描述',
  status: '狀態',
  project: 'Project',
  sprint: 'Sprint',
  due_date: '到期日',
  blocked_by: 'blocked by',
  archived: '封存',
};

interface PendingEvent {
  field: EventField;
  from: string | null;
  to: string | null;
}

interface IssueChanges {
  title?: string | undefined;
  description?: string | undefined;
  status?: IssueStatus | undefined;
  project_id?: number | null | undefined;
  sprint_id?: number | null | undefined;
  due_date?: string | null | undefined;
  // 封存時間；null＝取消封存。PATCH 的 archived: true 換成現在的時間（已封存就不變）。
  archived_at?: string | null | undefined;
  placement?: Placement | undefined;
}

function idText(id: number | null): string | null {
  return id === null ? null : String(id);
}

function insertEvent(
  db: Database,
  number: number,
  e: PendingEvent,
  actor: string,
  ts: string,
  revertOf: number | null,
): PreparedStatement {
  return db
    .prepare(
      `INSERT INTO issue_events (workspace_id, issue_number, field, from_value, to_value, actor, revert_of_event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(DEFAULT_WORKSPACE, number, e.field, e.from, e.to, actor, revertOf, ts);
}

// 還原時，把被還原的那筆指回新寫的那筆（同一個 batch，用 revert_of_event_id 找到新的 id）。
function markReverted(db: Database, eventId: number): PreparedStatement {
  return db
    .prepare(
      `UPDATE issue_events SET reverted_by_event_id = (SELECT id FROM issue_events WHERE revert_of_event_id = ?1)
       WHERE id = ?1 AND reverted_by_event_id IS NULL`,
    )
    .bind(eventId);
}

// 改票的共同流程（PATCH 與還原都走這裡）：只改真的有變的欄位，每個欄位各寫一筆變更紀錄，跟修改同一個 batch。
// 只改 position 不寫紀錄、不更新 updated_at。狀態換欄又沒指定位置時，放到新那一欄最上面。
async function applyChanges(
  db: Database,
  current: IssueRow,
  ch: IssueChanges,
  actor: string,
  revertOf: number | null = null,
): Promise<void> {
  const ts = now();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const events: PendingEvent[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (ch.title !== undefined && ch.title !== current.title) {
    set('title', ch.title);
    events.push({ field: 'title', from: current.title, to: ch.title });
  }
  if (ch.description !== undefined && ch.description !== current.description) {
    set('description', ch.description);
    events.push({ field: 'description', from: current.description, to: ch.description });
  }
  if (ch.due_date !== undefined && ch.due_date !== current.due_date) {
    set('due_date', ch.due_date);
    events.push({ field: 'due_date', from: current.due_date, to: ch.due_date });
  }
  const statusChanged = ch.status !== undefined && ch.status !== current.status;
  const status = ch.status ?? current.status;
  if (statusChanged) {
    set('status', status);
    set('completed_at', status === 'Done' ? ts : null);
    set('canceled_at', status === 'Canceled' ? ts : null);
    events.push({ field: 'status', from: current.status, to: status });
  }
  if (ch.project_id !== undefined && ch.project_id !== current.project_id) {
    set('project_id', ch.project_id);
    events.push({ field: 'project', from: idText(current.project_id), to: idText(ch.project_id) });
  }
  if (ch.sprint_id !== undefined && ch.sprint_id !== current.sprint_id) {
    set('sprint_id', ch.sprint_id);
    events.push({ field: 'sprint', from: idText(current.sprint_id), to: idText(ch.sprint_id) });
  }
  if (ch.archived_at !== undefined && (ch.archived_at === null) !== (current.archived_at === null)) {
    set('archived_at', ch.archived_at);
    events.push({ field: 'archived', from: current.archived_at, to: ch.archived_at });
  }
  if (events.length > 0) set('updated_at', ts);

  let position: number | undefined;
  if (ch.placement !== undefined) position = await resolvePosition(db, current.number, status, ch.placement);
  else if (statusChanged) position = await topPosition(db, status, current.number);
  if (position !== undefined && position !== current.position) set('position', position);

  if (sets.length === 0) return;
  await db.batch([
    db.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE number = ?`).bind(...params, current.number),
    ...events.map((e) => insertEvent(db, current.number, e, actor, ts, revertOf)),
    ...(revertOf === null ? [] : [markReverted(db, revertOf)]),
  ]);
}

function actorOf(body: Body, fallback = 'api'): string {
  return str(body, 'actor')?.trim() || fallback;
}

// 修改票。改了哪些欄位就各寫一筆 issue_events（actor 預設 api）。archived: true／false 封存或取消封存。
// position、before、after 調整看板順序（不寫變更紀錄）。
export async function updateIssue(db: Database, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, ISSUE_UPDATE_FIELDS);
  const current = await resolveIssue(db, ref);
  const title = str(body, 'title')?.trim();
  if (title === '') throw new HttpError(400, 'title 不可以是空的');
  const projectId = nullableInt(body, 'project_id');
  const sprintId = nullableInt(body, 'sprint_id');
  const archived = bool(body, 'archived');
  const changes: IssueChanges = {
    title,
    description: str(body, 'description'),
    due_date: nullableDate(body, 'due_date'),
    status: oneOf(body, 'status', ISSUE_STATUSES),
    project_id: projectId,
    sprint_id: sprintId,
    archived_at: archived === undefined ? undefined : archived ? (current.archived_at ?? now()) : null,
    placement: readPlacement(body),
  };
  await checkRefs(db, projectId, sprintId);
  await applyChanges(db, current, changes, actorOf(body));
  return json(await issueDetail(db, await resolveIssue(db, String(current.number))));
}

const EVENT_COLS =
  'id, issue_number, field, from_value, to_value, actor, revert_of_event_id, reverted_by_event_id, created_at';

interface EventRow {
  id: number;
  issue_number: number;
  field: EventField;
  from_value: string | null;
  to_value: string | null;
  actor: string;
  revert_of_event_id: number | null;
  reverted_by_event_id: number | null;
  created_at: string;
}

export async function listEvents(db: Database, ref: string): Promise<Response> {
  const issue = await resolveIssue(db, ref);
  const { results } = await db
    .prepare(`SELECT ${EVENT_COLS} FROM issue_events WHERE issue_number = ? ORDER BY created_at, id`)
    .bind(issue.number)
    .all<EventRow>();
  return json({ events: results });
}

async function getEventRow(db: Database, id: number): Promise<EventRow | null> {
  return db.prepare(`SELECT ${EVENT_COLS} FROM issue_events WHERE id = ?`).bind(id).first<EventRow>();
}

// 欄位現在的值，格式跟變更紀錄的 to_value 一樣。blocked_by 看那一個關係還在不在。
async function currentValue(db: Database, issue: IssueRow, ev: EventRow): Promise<string | null> {
  switch (ev.field) {
    case 'title':
      return issue.title;
    case 'description':
      return issue.description;
    case 'status':
      return issue.status;
    case 'project':
      return idText(issue.project_id);
    case 'sprint':
      return idText(issue.sprint_id);
    case 'due_date':
      return issue.due_date;
    case 'archived':
      return issue.archived_at;
    case 'blocked_by': {
      const blocker = Number(ev.to_value ?? ev.from_value);
      const row = await db
        .prepare('SELECT 1 AS x FROM issue_blockers WHERE issue_number = ? AND blocked_by_number = ?')
        .bind(issue.number, blocker)
        .first();
      return row === null ? null : String(blocker);
    }
  }
}

// 把第 id 筆變更的欄位改回舊值，寫一筆 revert_of_event_id = id 的新紀錄，並把第 id 筆標成已還原。
// 409：已經還原過；之後同一個欄位又被改過（還原掉的、以及「還原」本身不算）；或欄位現在的值已經不是那筆改完的值。
export async function revertEvent(db: Database, ref: string, eventId: number, request: Request): Promise<Response> {
  const body = await readOptionalBody(request, ['actor']);
  const actor = actorOf(body);
  const issue = await resolveIssue(db, ref);
  const ev = await getEventRow(db, eventId);
  if (ev === null || ev.issue_number !== issue.number) {
    throw new HttpError(404, `${identifier(issue.number)} 沒有第 ${String(eventId)} 筆變更紀錄`);
  }
  const label = FIELD_NAME[ev.field];
  if (ev.reverted_by_event_id !== null) {
    throw new HttpError(409, `第 ${String(ev.id)} 筆已經在第 ${String(ev.reverted_by_event_id)} 筆還原過了`, {
      reverted_by_event_id: ev.reverted_by_event_id,
    });
  }

  // blocked_by 只看同一張擋住的票；其他欄位看同一個欄位。
  const sameKey = ev.field === 'blocked_by' ? 'AND (from_value = ?4 OR to_value = ?4)' : 'AND ?4 IS NOT NULL';
  const later = await db
    .prepare(
      `SELECT id, actor, created_at FROM issue_events
       WHERE issue_number = ?1 AND field = ?2 AND id > ?3 ${sameKey}
         AND reverted_by_event_id IS NULL AND revert_of_event_id IS NULL
       ORDER BY id LIMIT 1`,
    )
    .bind(issue.number, ev.field, ev.id, ev.to_value ?? ev.from_value ?? '')
    .first<{ id: number; actor: string; created_at: string }>();
  if (later !== null) {
    throw new HttpError(
      409,
      `第 ${String(ev.id)} 筆之後，${label}又在第 ${String(later.id)} 筆被改過（${later.actor}，${later.created_at}），不能直接還原；要改回去請先還原第 ${String(later.id)} 筆，或直接修改${label}`,
      { conflict_event_id: later.id },
    );
  }
  if ((await currentValue(db, issue, ev)) !== ev.to_value) {
    throw new HttpError(409, `${label}現在的值已經不是第 ${String(ev.id)} 筆改完的值，不能直接還原；請直接修改${label}`);
  }

  if (ev.field === 'blocked_by') {
    const blocker = Number(ev.to_value ?? ev.from_value);
    await changeBlocker(db, issue.number, blocker, ev.to_value === null ? 'add' : 'remove', actor, ev.id);
  } else {
    const old = ev.from_value;
    const ch: IssueChanges = {};
    if (ev.field === 'title') ch.title = old ?? '';
    if (ev.field === 'description') ch.description = old ?? '';
    if (ev.field === 'due_date') ch.due_date = old;
    if (ev.field === 'status') ch.status = old as IssueStatus;
    if (ev.field === 'project') ch.project_id = old === null ? null : Number(old);
    if (ev.field === 'sprint') ch.sprint_id = old === null ? null : Number(old);
    if (ev.field === 'archived') ch.archived_at = old;
    await checkRefs(db, ch.project_id, ch.sprint_id);
    await applyChanges(db, issue, ch, actor, ev.id);
  }

  const reverted = await getEventRow(db, ev.id);
  const created = reverted?.reverted_by_event_id == null ? null : await getEventRow(db, reverted.reverted_by_event_id);
  return json({
    issue: await issueDetail(db, await resolveIssue(db, String(issue.number))),
    event: created,
    reverted_event: reverted,
  });
}

// 還原的內容可以不帶（沒有 body 或空字串）。
async function readOptionalBody(request: Request, allowed: readonly string[]): Promise<Body> {
  const text = await request.clone().text();
  if (text.trim() === '') return {};
  return readBody(request, allowed);
}

// ---- blocked by ----

export async function listBlockers(db: Database, ref: string): Promise<Response> {
  const issue = await resolveIssue(db, ref);
  return json(await blockerLists(db, issue.number));
}

// 加入或移除一個 blocked by，有變動才寫變更紀錄（記在被擋住的票上）。回傳有沒有變動。
async function changeBlocker(
  db: Database,
  issueNumber: number,
  blockerNumber: number,
  op: 'add' | 'remove',
  actor: string,
  revertOf: number | null = null,
): Promise<boolean> {
  const exists =
    (await db
      .prepare('SELECT 1 AS x FROM issue_blockers WHERE issue_number = ? AND blocked_by_number = ?')
      .bind(issueNumber, blockerNumber)
      .first()) !== null;
  if (exists === (op === 'add')) return false;
  const ts = now();
  const key = String(blockerNumber);
  await db.batch([
    op === 'add'
      ? db
          .prepare('INSERT INTO issue_blockers (workspace_id, issue_number, blocked_by_number, created_at) VALUES (?, ?, ?, ?)')
          .bind(DEFAULT_WORKSPACE, issueNumber, blockerNumber, ts)
      : db.prepare('DELETE FROM issue_blockers WHERE issue_number = ? AND blocked_by_number = ?').bind(issueNumber, blockerNumber),
    insertEvent(db, issueNumber, { field: 'blocked_by', from: op === 'add' ? null : key, to: op === 'add' ? key : null }, actor, ts, revertOf),
    ...(revertOf === null ? [] : [markReverted(db, revertOf)]),
  ]);
  return true;
}

// issue 被 body.blocked_by 擋住。重複加入不算錯（回 200）。
export async function addBlocker(db: Database, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, ['blocked_by', 'actor']);
  const issue = await resolveIssue(db, ref);
  const raw = body.blocked_by;
  const blockerRef = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : undefined;
  if (blockerRef === undefined || blockerRef.trim() === '') throw new HttpError(400, '缺少 blocked_by（例如 NX-3 或 ABC-150）');
  const blocker = await resolveOther(db, blockerRef);
  if (blocker.number === issue.number) throw new HttpError(400, '票不能擋住自己');
  const added = await changeBlocker(db, issue.number, blocker.number, 'add', actorOf(body));
  return json(await blockerLists(db, issue.number), added ? 201 : 200);
}

export async function removeBlocker(db: Database, ref: string, blockerRef: string, actor = 'api'): Promise<Response> {
  const issue = await resolveIssue(db, ref);
  const blocker = await resolveIssue(db, blockerRef);
  const removed = await changeBlocker(db, issue.number, blocker.number, 'remove', actor.trim() || 'api');
  if (!removed) {
    throw new HttpError(404, `${identifier(issue.number)} 沒有被 ${identifier(blocker.number)} 擋住`);
  }
  return json(await blockerLists(db, issue.number));
}

// ---- comment ----

const COMMENT_COLS = 'id, issue_number, author, body, linear_id, created_at, updated_at';

interface CommentRow {
  id: number;
  issue_number: number;
  author: string;
  body: string;
  linear_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listComments(db: Database, ref: string): Promise<Response> {
  const issue = await resolveIssue(db, ref);
  const { results } = await db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE issue_number = ? ORDER BY created_at, id`)
    .bind(issue.number)
    .all<CommentRow>();
  return json({ comments: results });
}

// 跨所有票列出某個時間之後新增的 comment（NX-206）：不論票的狀態、有沒有封存都列。
// created_since 必填（含下界）、created_before 選填（不含上界），依 created_at 舊到新，limit／offset 分頁。
export async function listRecentComments(db: Database, url: URL): Promise<Response> {
  const q = url.searchParams;
  const since = q.get('created_since');
  if (since === null || since === '') throw new HttpError(400, '缺少 created_since');
  const where = ['created_at >= ?'];
  const params: (string | number)[] = [toTimestamp(since, 'created_since')];
  const before = q.get('created_before');
  if (before !== null && before !== '') {
    where.push('created_at < ?');
    params.push(toTimestamp(before, 'created_before'));
  }
  const limit = queryInt(url, 'limit', 50, 1, 200);
  const offset = queryInt(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
  const { results } = await db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE ${where.join(' AND ')} ORDER BY created_at, id LIMIT ? OFFSET ?`)
    .bind(...params, limit + 1, offset)
    .all<CommentRow>();
  const page = results.slice(0, limit);
  return json({
    comments: page.map((c) => ({ ...c, identifier: identifier(c.issue_number) })),
    limit,
    offset,
    has_more: results.length > limit,
  });
}

export async function createComment(db: Database, ref: string, request: Request, owner: string): Promise<Response> {
  const body = await readBody(request, ['author', 'body', 'linear_id', 'created_at', 'updated_at']);
  const issue = await resolveIssue(db, ref);
  const author = requiredStr(body, 'author');
  const text = requiredStr(body, 'body');
  const linearId = nullableStr(body, 'linear_id') ?? null;
  const createdAt = timestamp(body, 'created_at') ?? now();
  const updatedAt = timestamp(body, 'updated_at') ?? createdAt;
  if (linearId !== null) {
    const dup = await db.prepare('SELECT id FROM comments WHERE linear_id = ?').bind(linearId).first<{ id: number }>();
    if (dup !== null) throw new HttpError(409, `linear_id ${linearId} 已存在`, { id: dup.id });
  }
  const row = await db
    .prepare(
      `INSERT INTO comments (issue_number, author, body, linear_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COMMENT_COLS}`,
    )
    .bind(issue.number, author, text, linearId, createdAt, updatedAt)
    .first<CommentRow>();
  if (linearId === null) await handBackToAgent(db, issue, author, owner);
  return json(row, 201);
}

// 人在待驗收（In Review）的票寫 comment，票自動交回 agent：移到 In Progress（NX-221）。
// 跟「退回」一樣寫一筆 status 變更紀錄（actor＝comment 的 author），可以用還原改回去。
// 「人」只有一個，名字是設定的 owner（./owner.ts，預設「你」，NX-244）；agent 用「阿澈」「<repo> agent」「mcp」等名稱，不觸發。
// 搬家匯入（帶 linear_id）也不觸發。
async function handBackToAgent(db: Database, issue: IssueRow, author: string, owner: string): Promise<void> {
  const who = author.trim();
  if (issue.status !== 'In Review' || who !== owner) return;
  await applyChanges(db, issue, { status: 'In Progress' }, who);
}

async function getCommentRow(db: Database, id: number): Promise<CommentRow> {
  const row = await db.prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).bind(id).first<CommentRow>();
  if (row === null) throw new HttpError(404, `找不到 comment ${String(id)}`);
  return row;
}

export async function getComment(db: Database, id: number): Promise<Response> {
  return json(await getCommentRow(db, id));
}

export async function updateComment(db: Database, id: number, request: Request): Promise<Response> {
  const body = await readBody(request, ['body']);
  const current = await getCommentRow(db, id);
  const text = requiredStr(body, 'body');
  if (text === current.body) return json(current);
  const row = await db
    .prepare(`UPDATE comments SET body = ?, updated_at = ? WHERE id = ? RETURNING ${COMMENT_COLS}`)
    .bind(text, now(), id)
    .first<CommentRow>();
  return json(row);
}
