import type { Database } from '../core/database';
// MCP 工具：名稱與參數照 Linear MCP，讓 Skill 換工具前綴就能用；底層呼叫 worker/api 的函式，不另寫資料存取。
// 跟 Linear MCP 不一樣的地方列在 docs/mcp.md。
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HttpError, toHttpError, toTimestamp } from '../api/http';
import {
  ISSUE_STATUSES,
  type IssueStatus,
  addBlocker,
  createComment,
  createIssue,
  getComment,
  getIssue,
  listComments,
  listRecentComments,
  listEvents,
  listIssues,
  removeBlocker,
  resolveIssue,
  revertEvent,
  updateComment,
  updateIssue,
} from '../api/issues';
import { createProject, getProject, listProjects, updateProject } from '../api/projects';
import { listSprints } from '../api/sprints';

// ---- API 回傳的 JSON ----

interface ApiIssue {
  number: number;
  identifier: string;
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
  archived_at: string | null;
}

interface ApiEvent {
  id: number;
  issue_number: number;
  field: string;
  from_value: string | null;
  to_value: string | null;
  actor: string;
  revert_of_event_id: number | null;
  reverted_by_event_id: number | null;
  created_at: string;
}

interface ApiIssueSummary {
  identifier: string;
  legacy_identifier: string | null;
  title: string;
  status: IssueStatus;
}

interface ApiIssueDetail extends ApiIssue {
  blocked_by: ApiIssueSummary[];
  blocks: ApiIssueSummary[];
}

interface ApiComment {
  id: number;
  issue_number: number;
  author: string;
  body: string;
  created_at: string;
  updated_at: string;
}

interface ApiProject {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  pinned_at: string | null;
  last_activity_at: string;
}

interface ApiSprint {
  id: number;
  number: number;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

// ---- 呼叫 worker/api ----

const BASE = 'https://nextline.internal/';

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): Request {
  return new Request(BASE, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function query(params: Record<string, string | number | undefined>): URL {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url;
}

async function data<T>(response: Promise<Response>): Promise<T> {
  const body: unknown = await (await response).json();
  return body as T;
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

// 已知的錯誤（找不到、參數不對、重複）回 isError 讓 agent 看得到原因；其他錯誤照常丟出。
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return text(await fn());
  } catch (e) {
    const err = toHttpError(e);
    if (err === null) throw e;
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

function badRequest(e: unknown): never {
  if (e instanceof HttpError && e.status === 404) throw new HttpError(400, e.message);
  throw e;
}

// ---- 狀態：收名稱或 Linear 的 state type，不分大小寫 ----

const ISSUE_STATE_TYPE: Record<IssueStatus, string> = {
  Backlog: 'backlog',
  Todo: 'unstarted',
  'In Progress': 'started',
  // 待驗收。Linear 的 In Review 也屬於 started。
  'In Review': 'started',
  Done: 'completed',
  Canceled: 'canceled',
};

function statusesOf(value: string): IssueStatus[] {
  const v = value.trim().toLowerCase();
  const byName = ISSUE_STATUSES.filter((s) => s.toLowerCase() === v);
  const found = byName.length > 0 ? byName : ISSUE_STATUSES.filter((s) => ISSUE_STATE_TYPE[s] === v);
  if (found.length === 0) {
    throw new HttpError(400, `state 必須是 ${ISSUE_STATUSES.join('、')} 其中之一（或 Linear 的 state type）`);
  }
  return found;
}

// 寫入用：名稱優先；給 state type 時取那一類的第一個（started → In Progress）。
function issueStatus(value: string): IssueStatus {
  return statusesOf(value)[0] as IssueStatus;
}

// 查詢用：逗號分隔可以一次查多種（例如「Backlog,Todo,In Progress,In Review」列出沒做完的票）；
// state type 會展開成那一類的全部狀態（started → In Progress、In Review）。
function issueStatuses(value: string): IssueStatus[] {
  const all = value
    .split(',')
    .filter((s) => s.trim() !== '')
    .flatMap(statusesOf);
  return [...new Set(all)];
}

// ---- Project、Sprint 的參照：名稱或 id ----

async function allProjects(db: Database): Promise<ApiProject[]> {
  return (await data<{ projects: ApiProject[] }>(listProjects(db))).projects;
}

async function allSprints(db: Database): Promise<ApiSprint[]> {
  return (await data<{ sprints: ApiSprint[] }>(listSprints(db))).sprints;
}

async function resolveProject(db: Database, ref: string): Promise<ApiProject> {
  const v = ref.trim();
  if (/^\d+$/.test(v)) return getProject(db, Number(v));
  const found = (await allProjects(db)).find((p) => p.name.toLowerCase() === v.toLowerCase());
  if (found === undefined) throw new HttpError(404, `找不到 Project ${ref}`);
  return found;
}

// 數字先當 Sprint 編號（number）找，找不到再當 id；也可以用名稱。
function findSprint(sprints: ApiSprint[], ref: string): ApiSprint {
  const v = ref.trim();
  const n = /^\d+$/.test(v) ? Number(v) : null;
  const found =
    (n !== null ? (sprints.find((s) => s.number === n) ?? sprints.find((s) => s.id === n)) : undefined) ??
    sprints.find((s) => s.name !== null && s.name.toLowerCase() === v.toLowerCase());
  if (found === undefined) throw new HttpError(404, `找不到 Cycle ${ref}`);
  return found;
}

// ---- 轉成 Linear MCP 的欄位名稱 ----

interface Lookup {
  projects: Map<number, string>;
  sprints: Map<number, number>;
}

async function lookup(db: Database): Promise<Lookup> {
  const [projects, sprints] = await Promise.all([allProjects(db), allSprints(db)]);
  return {
    projects: new Map(projects.map((p) => [p.id, p.name])),
    sprints: new Map(sprints.map((s) => [s.id, s.number])),
  };
}

function idText(id: number | null): string | null {
  return id === null ? null : String(id);
}

function summary(i: ApiIssueSummary) {
  return { id: i.identifier, legacyIdentifier: i.legacy_identifier, title: i.title, status: i.status };
}

function issueOut(i: ApiIssue, l: Lookup, withDescription: boolean) {
  return {
    id: i.identifier,
    legacyIdentifier: i.legacy_identifier,
    title: i.title,
    ...(withDescription ? { description: i.description } : {}),
    status: i.status,
    statusType: ISSUE_STATE_TYPE[i.status],
    project: i.project_id === null ? null : (l.projects.get(i.project_id) ?? null),
    projectId: idText(i.project_id),
    cycle: i.sprint_id === null ? null : (l.sprints.get(i.sprint_id) ?? null),
    cycleId: idText(i.sprint_id),
    dueDate: i.due_date,
    position: i.position,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    completedAt: i.completed_at,
    canceledAt: i.canceled_at,
    archivedAt: i.archived_at,
  };
}

function eventOut(e: ApiEvent) {
  return {
    id: String(e.id),
    issueId: `NX-${String(e.issue_number)}`,
    field: e.field,
    from: e.from_value,
    to: e.to_value,
    actor: e.actor,
    revertOf: e.revert_of_event_id === null ? null : String(e.revert_of_event_id),
    revertedBy: e.reverted_by_event_id === null ? null : String(e.reverted_by_event_id),
    createdAt: e.created_at,
  };
}

function issueDetailOut(i: ApiIssueDetail, l: Lookup) {
  return {
    ...issueOut(i, l, true),
    relations: { blockedBy: i.blocked_by.map(summary), blocks: i.blocks.map(summary) },
  };
}

function commentOut(c: ApiComment) {
  return {
    id: String(c.id),
    issueId: `NX-${String(c.issue_number)}`,
    author: c.author,
    body: c.body,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function projectOut(p: ApiProject, withDescription: boolean) {
  return {
    id: String(p.id),
    name: p.name,
    ...(withDescription ? { description: p.description } : {}),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    pinnedAt: p.pinned_at,
    lastActivityAt: p.last_activity_at,
  };
}

function cycleOut(s: ApiSprint) {
  return { id: String(s.id), number: s.number, name: s.name, startsAt: s.starts_at, endsAt: s.ends_at };
}

// ---- 時間：ISO 時間、YYYY-MM-DD，或 Linear 的相對時間（-P1D、-P2W、-PT12H） ----

const DURATION = /^-P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i;

function since(value: string, key: string): string {
  const v = value.trim();
  const d = DURATION.exec(v);
  if (d !== null && v.length > 2 && !/T$/i.test(v)) {
    const [w, day, h, m, s] = d.slice(1).map((x: string | undefined) => Number(x ?? 0)) as [number, number, number, number, number];
    const ms = ((((w * 7 + day) * 24 + h) * 60 + m) * 60 + s) * 1000;
    return new Date(Date.now() - ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return toTimestamp(`${v}T00:00:00Z`, key);
  return toTimestamp(v, key);
}

// ---- 工具 ----

const nullableString = z.string().nullable();
const issueRefs = z.array(z.string());

async function issueById(db: Database, ref: string) {
  const [detail, l] = await Promise.all([data<ApiIssueDetail>(getIssue(db, ref)), lookup(db)]);
  return issueDetailOut(detail, l);
}

export function registerTools(server: McpServer, db: Database, owner: string): void {
  server.registerTool(
    'list_issues',
    {
      description:
        '列出票，預設依更新時間新到舊（orderBy: position 是看板順序）。state 可用逗號一次查多種（例如 "Backlog,Todo,In Progress,In Review" 列出沒做完的票；In Review 是待驗收）。回傳不含 description，要看內容用 get_issue。預設不含已封存的票（includeArchived: true 才會列出）。',
      inputSchema: {
        state: z
          .string()
          .optional()
          .describe('狀態名稱（Backlog、Todo、In Progress、In Review、Done、Canceled）或 state type（started 含 In Progress 與 In Review）；可逗號分隔'),
        orderBy: z
          .enum(['updatedAt', 'position'])
          .optional()
          .describe('updatedAt（預設，新到舊）或 position（看板順序：依狀態欄、欄內由上到下）'),
        project: z.string().optional().describe('Project 名稱或 id；none 代表沒有 Project'),
        cycle: z.string().optional().describe('Cycle（Sprint）編號、名稱或 id；none 代表沒有 Cycle'),
        updatedAt: z.string().optional().describe('這個時間之後更新的：ISO 時間或相對時間（例如 -P1D）'),
        includeArchived: z.boolean().optional().describe('要不要包含已封存的票（預設 false，跟 Linear 同名參數）'),
        team: z.string().optional().describe('相容 Linear 用，Nextline 只有一個 team，會忽略'),
        limit: z.number().int().min(1).max(250).optional().describe('每頁筆數，預設 50，最多 200（超過以 200 計）'),
        cursor: z.string().optional().describe('上一頁回傳的 cursor'),
      },
    },
    async (args) =>
      run(async () => {
        let project: string | undefined;
        if (args.project !== undefined) {
          project = args.project.trim().toLowerCase() === 'none' ? 'none' : String((await resolveProject(db, args.project)).id);
        }
        let sprint: string | undefined;
        if (args.cycle !== undefined) {
          sprint = args.cycle.trim().toLowerCase() === 'none' ? 'none' : String(findSprint(await allSprints(db), args.cycle).id);
        }
        if (args.cursor !== undefined && !/^\d+$/.test(args.cursor)) throw new HttpError(400, 'cursor 不正確');
        const url = query({
          status: args.state === undefined ? undefined : issueStatuses(args.state).join(','),
          project,
          sprint,
          updated_since: args.updatedAt === undefined ? undefined : since(args.updatedAt, 'updatedAt'),
          sort: args.orderBy === 'position' ? 'position' : undefined,
          archived: args.includeArchived === true ? 'include' : undefined,
          limit: Math.min(args.limit ?? 50, 200),
          offset: args.cursor,
        });
        const [page, l] = await Promise.all([
          data<{ issues: ApiIssue[]; limit: number; offset: number; has_more: boolean }>(listIssues(db, url)),
          lookup(db),
        ]);
        return {
          issues: page.issues.map((i) => issueOut(i, l, false)),
          hasNextPage: page.has_more,
          ...(page.has_more ? { cursor: String(page.offset + page.limit) } : {}),
        };
      }),
  );

  server.registerTool(
    'get_issue',
    {
      description: '讀一張票的完整內容，含 description 與 blocked by／blocks。',
      inputSchema: { id: z.string().describe('票號：NX-12、12，或舊編號 ABC-150') },
    },
    async (args) => run(() => issueById(db, args.id)),
  );

  server.registerTool(
    'save_issue',
    {
      description:
        '不帶 id 是新增票（要 title），帶 id 是修改，只改有帶的欄位。blockedBy／blocks 只會新增關係，要拿掉用 removeBlockedBy／removeBlocks。要人看過的票送 In Review（待驗收）。每個改到的欄位都會寫進變更紀錄，做錯了用 revert_issue_event 還原。不做永久刪除：不要的票用 archived: true 封存（看板、列表都看不到，archived: false 取消封存）。',
      inputSchema: {
        id: z.string().optional().describe('要修改的票號（NX-12 或 ABC-150）；新增時不要帶'),
        title: z.string().optional().describe('標題（新增時必填）'),
        description: z.string().optional().describe('Markdown 內容'),
        state: z
          .string()
          .optional()
          .describe('狀態名稱（Backlog、Todo、In Progress、In Review、Done、Canceled）或 state type（started 是 In Progress）；新增預設 Backlog'),
        before: z.string().optional().describe('看板上放在這張票的上面（同一欄的票號）；新票與換欄的票預設放最上面'),
        after: z.string().optional().describe('看板上放在這張票的下面（同一欄的票號）'),
        position: z.number().int().optional().describe('直接指定看板位置（小的在上）；before、after、position 只能帶一個'),
        project: nullableString.optional().describe('Project 名稱或 id；null 移出 Project'),
        cycle: nullableString.optional().describe('Cycle（Sprint）編號、名稱或 id；null 移出 Cycle'),
        dueDate: nullableString.optional().describe('YYYY-MM-DD；null 清掉'),
        blockedBy: issueRefs.optional().describe('擋住這張票的票號，只新增'),
        removeBlockedBy: issueRefs.optional().describe('不再擋住這張票的票號'),
        blocks: issueRefs.optional().describe('這張票擋住的票號，只新增'),
        removeBlocks: issueRefs.optional().describe('這張票不再擋住的票號'),
        archived: z.boolean().optional().describe('true 封存、false 取消封存（只能用在修改；會寫進變更紀錄，可還原）'),
        actor: z.string().optional().describe('誰改的，寫進變更紀錄（預設 mcp）'),
        team: z.string().optional().describe('相容 Linear 用，會忽略'),
      },
    },
    async (args) =>
      run(async () => {
        if (args.id === undefined && args.archived !== undefined) throw new HttpError(400, '新增票時不能帶 archived；開好再封存');
        // 先把所有參照查好，任何一個不存在就整個不寫。
        const projectId =
          args.project === undefined
            ? undefined
            : args.project === null
              ? null
              : (await resolveProject(db, args.project).catch(badRequest)).id;
        const cycle = args.cycle;
        const sprintId =
          cycle === undefined
            ? undefined
            : cycle === null
              ? null
              : (await allSprints(db).then((all) => findSprint(all, cycle)).catch(badRequest)).id;
        const refs = async (list: string[] | undefined) =>
          Promise.all((list ?? []).map(async (r) => (await resolveIssue(db, r).catch(badRequest)).number));
        const [blockedBy, removeBlockedBy, blocks, removeBlocks] = await Promise.all([
          refs(args.blockedBy),
          refs(args.removeBlockedBy),
          refs(args.blocks),
          refs(args.removeBlocks),
        ]);

        const fields: Record<string, unknown> = {
          title: args.title,
          description: args.description,
          status: args.state === undefined ? undefined : issueStatus(args.state),
          project_id: projectId,
          sprint_id: sprintId,
          due_date: args.dueDate,
          before: args.before,
          after: args.after,
          position: args.position,
        };
        if (args.archived !== undefined) fields.archived = args.archived;

        const actor = args.actor ?? 'mcp';
        let number: number;
        if (args.id === undefined) {
          number = (await data<ApiIssue>(createIssue(db, jsonRequest('POST', fields)))).number;
        } else {
          number = (await resolveIssue(db, args.id)).number;
          await updateIssue(db, String(number), jsonRequest('PATCH', { ...fields, actor }));
        }
        const self = String(number);
        for (const b of blockedBy) await addBlocker(db, self, jsonRequest('POST', { blocked_by: b, actor }));
        for (const b of blocks) await addBlocker(db, String(b), jsonRequest('POST', { blocked_by: number, actor }));
        for (const b of removeBlockedBy) await removeBlocker(db, self, String(b), actor).catch(ignoreNotFound);
        for (const b of removeBlocks) await removeBlocker(db, String(b), self, actor).catch(ignoreNotFound);
        return issueById(db, self);
      }),
  );

  server.registerTool(
    'list_issue_events',
    {
      description:
        '列出一張票的變更紀錄，舊到新：每筆是一個欄位（title、description、status、project、sprint、due_date、blocked_by、archived）的舊值 from 與新值 to、誰改的。revertOf 是「這筆還原了第幾筆」，revertedBy 不是 null 代表已經被還原。',
      inputSchema: { issueId: z.string().describe('票號：NX-12 或 ABC-150') },
    },
    async (args) =>
      run(async () => {
        const { events } = await data<{ events: ApiEvent[] }>(listEvents(db, args.issueId));
        return { events: events.map(eventOut) };
      }),
  );

  server.registerTool(
    'revert_issue_event',
    {
      description:
        '把一筆變更紀錄的欄位改回舊值（例如誤把票移到 Done，還原那筆狀態變更），並寫一筆「還原了第 N 筆」的新紀錄。已經還原過、或之後同一個欄位又被改過時會失敗並說明原因。',
      inputSchema: {
        issueId: z.string().describe('票號：NX-12 或 ABC-150'),
        eventId: z.string().describe('要還原的變更紀錄 id（list_issue_events 的 id）'),
        actor: z.string().optional().describe('誰還原的，寫進變更紀錄（預設 mcp）'),
      },
    },
    async (args) =>
      run(async () => {
        const id = Number(args.eventId);
        if (!/^\d+$/.test(args.eventId) || !Number.isSafeInteger(id) || id <= 0) {
          throw new HttpError(404, `找不到變更紀錄 ${args.eventId}`);
        }
        const res = await revertEvent(db, args.issueId, id, jsonRequest('POST', { actor: args.actor ?? 'mcp' }));
        const body: unknown = await res.json();
        const out = body as { issue: ApiIssueDetail; event: ApiEvent; reverted_event: ApiEvent };
        return {
          issue: issueDetailOut(out.issue, await lookup(db)),
          event: eventOut(out.event),
          revertedEvent: eventOut(out.reverted_event),
        };
      }),
  );

  server.registerTool(
    'list_comments',
    {
      description: '列出一張票的 comment，舊到新。',
      inputSchema: { issueId: z.string().describe('票號：NX-12 或 ABC-150') },
    },
    async (args) =>
      run(async () => {
        const { comments } = await data<{ comments: ApiComment[] }>(listComments(db, args.issueId));
        return { comments: comments.map(commentOut) };
      }),
  );

  server.registerTool(
    'list_recent_comments',
    {
      description:
        '跨所有票列出某個時間之後新增的 comment，舊到新；包含 Done、Canceled 與已封存的票。每則有 issueId（票號）、author、body、createdAt。用來一次找出「上次看過之後誰在哪些票留言」，不用逐張 list_comments。',
      inputSchema: {
        createdAt: z.string().describe('這個時間（含）之後新增的：ISO 時間、YYYY-MM-DD 或相對時間（例如 -P1D）'),
        limit: z.number().int().min(1).max(250).optional().describe('每頁筆數，預設 50，最多 200（超過以 200 計）'),
        cursor: z.string().optional().describe('上一頁回傳的 cursor'),
      },
    },
    async (args) =>
      run(async () => {
        if (args.cursor !== undefined && !/^\d+$/.test(args.cursor)) throw new HttpError(400, 'cursor 不正確');
        const url = query({
          created_since: since(args.createdAt, 'createdAt'),
          limit: Math.min(args.limit ?? 50, 200),
          offset: args.cursor,
        });
        const page = await data<{ comments: ApiComment[]; limit: number; offset: number; has_more: boolean }>(
          listRecentComments(db, url),
        );
        return {
          comments: page.comments.map(commentOut),
          hasNextPage: page.has_more,
          ...(page.has_more ? { cursor: String(page.offset + page.limit) } : {}),
        };
      }),
  );

  server.registerTool(
    'save_comment',
    {
      description:
        `不帶 id 是在 issueId 的票上新增 comment，帶 id 是修改那則 comment 的內容。新增時票在 In Review 而 author 是 ${owner}（人），票會同時移到 In Progress（寫進變更紀錄，可還原）；agent 的 author 不會改狀態。`,
      inputSchema: {
        id: z.string().optional().describe('要修改的 comment id；新增時不要帶'),
        issueId: z.string().optional().describe('票號（新增時必填）'),
        body: z.string().describe('Markdown 內容'),
        author: z.string().optional().describe('誰寫的（預設 mcp），例如 阿澈、nextline agent'),
      },
    },
    async (args) =>
      run(async () => {
        if (args.id !== undefined) {
          const id = Number(args.id);
          if (!/^\d+$/.test(args.id) || !Number.isSafeInteger(id)) throw new HttpError(404, `找不到 comment ${args.id}`);
          await getComment(db, id);
          return commentOut(await data<ApiComment>(updateComment(db, id, jsonRequest('PATCH', { body: args.body }))));
        }
        if (args.issueId === undefined) throw new HttpError(400, '新增 comment 要帶 issueId');
        const created = createComment(db, args.issueId, jsonRequest('POST', { author: args.author ?? 'mcp', body: args.body }), owner);
        return commentOut(await data<ApiComment>(created));
      }),
  );

  server.registerTool(
    'list_projects',
    {
      description:
        '列出 Project：釘選的在最上面（照釘選時間新到舊），其餘照 lastActivityAt（Project、底下的票、底下票的 comment 最新時間）新到舊。回傳不含 description，要看內容用 get_project。',
      inputSchema: {
        state: z.string().optional().describe('相容 Linear 用，會忽略（Nextline 的 Project 沒有狀態）'),
        query: z.string().optional().describe('名稱包含這段文字（不分大小寫）'),
        team: z.string().optional().describe('相容 Linear 用，會忽略'),
      },
    },
    async (args) =>
      run(async () => {
        const { projects } = await data<{ projects: ApiProject[] }>(listProjects(db));
        const q = args.query?.trim().toLowerCase();
        return {
          projects: projects
            .filter((p) => q === undefined || q === '' || p.name.toLowerCase().includes(q))
            .map((p) => projectOut(p, false)),
        };
      }),
  );

  server.registerTool(
    'get_project',
    {
      description: '讀一個 Project，含長篇 description。',
      inputSchema: { query: z.string().describe('Project 名稱或 id') },
    },
    async (args) => run(async () => projectOut(await resolveProject(db, args.query), true)),
  );

  server.registerTool(
    'save_project',
    {
      description: '不帶 id 是新增 Project（要 name），帶 id 是修改，只改有帶的欄位。',
      inputSchema: {
        id: z.string().optional().describe('要修改的 Project 名稱或 id；新增時不要帶'),
        name: z.string().optional().describe('名稱（新增時必填，不可重複）'),
        description: z.string().optional().describe('Markdown 內容'),
        state: z.string().optional().describe('相容 Linear 用，會忽略（Nextline 的 Project 沒有狀態）'),
        pinned: z.boolean().optional().describe('true 釘選在側欄最上方、false 取消釘選；只能修改時帶'),
      },
    },
    async (args) =>
      run(async () => {
        const fields = {
          name: args.name,
          description: args.description,
        };
        if (args.id === undefined) {
          if (args.pinned !== undefined) throw new HttpError(400, 'pinned 只能修改時帶（先建立 Project 再釘選）');
          return projectOut(await data<ApiProject>(createProject(db, jsonRequest('POST', fields))), true);
        }
        const current = await resolveProject(db, args.id);
        const patch = { ...fields, pinned: args.pinned };
        return projectOut(await data<ApiProject>(updateProject(db, current.id, jsonRequest('PATCH', patch))), true);
      }),
  );

  server.registerTool(
    'list_cycles',
    {
      description: '列出 Cycle（Nextline 叫 Sprint），依編號新到舊；type 可只取目前、上一期或下一期。',
      inputSchema: {
        teamId: z.string().optional().describe('相容 Linear 用，會忽略'),
        type: z.enum(['current', 'previous', 'next']).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const sprints = await allSprints(db);
        if (args.type === undefined) return { cycles: sprints.map(cycleOut) };
        const t = new Date().toISOString();
        const byStart = [...sprints].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        let picked: ApiSprint | undefined;
        if (args.type === 'current') picked = byStart.find((s) => s.starts_at <= t && t < s.ends_at);
        if (args.type === 'previous') picked = byStart.filter((s) => s.ends_at <= t).at(-1);
        if (args.type === 'next') picked = byStart.find((s) => s.starts_at > t);
        return { cycles: picked === undefined ? [] : [cycleOut(picked)] };
      }),
  );
}

function ignoreNotFound(e: unknown): undefined {
  if (e instanceof HttpError && e.status === 404) return undefined;
  throw e;
}
