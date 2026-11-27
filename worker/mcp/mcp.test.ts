import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp as worker, type TestEnv as Env } from '../test/app';
import { createDatabase, type TestDatabase } from '../test/database';

const TOKEN = 'test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
let env: Env;
let nextId = 1;

let database: TestDatabase;
beforeEach(async () => {
  database = await createDatabase();
  env = { DB: database.db, API_TOKEN: TOKEN };
});
afterEach(async () => { await database.close(); });

type Json = Record<string, unknown>;

async function post(body: unknown, headers: Record<string, string> = AUTH): Promise<Response> {
  const req = new Request('https://x/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  return worker.fetch(req, env);
}

async function rpc(method: string, params: Json = {}): Promise<Json> {
  const res = await post({ jsonrpc: '2.0', id: nextId++, method, params });
  expect(res.status).toBe(200);
  const body = await res.json<{ result?: Json; error?: unknown }>();
  expect(body.error).toBeUndefined();
  return body.result as Json;
}

// tools/call 成功時回傳解析後的 JSON；isError 時回傳錯誤文字。
async function callTool(name: string, args: Json = {}): Promise<{ isError: boolean; data: unknown; text: string }> {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = (result.content as { text: string }[])[0]?.text ?? '';
  const isError = result.isError === true;
  return { isError, text, data: isError ? null : JSON.parse(text) };
}

async function tool<T = Json>(name: string, args: Json = {}): Promise<T> {
  const r = await callTool(name, args);
  expect(r.isError, r.text).toBe(false);
  return r.data as T;
}

interface Issue {
  id: string;
  title: string;
  status: string;
  statusType: string;
  project: string | null;
  cycle: number | null;
  description?: string;
  relations?: { blockedBy: { id: string }[]; blocks: { id: string }[] };
}

describe('連線與驗證', () => {
  it('initialize 回 server 資訊與 tools capability', async () => {
    const result = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0' },
    });
    expect(result.serverInfo).toMatchObject({ name: 'nextline' });
    expect(result.capabilities).toHaveProperty('tools');
  });

  it('tools/list 列出 9 個跟 Linear MCP 同名的工具，加上 Nextline 自己的變更紀錄 2 個、跨票列 comment 1 個', async () => {
    const result = await rpc('tools/list');
    const names = (result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_issue',
        'get_project',
        'list_comments',
        'list_recent_comments',
        'list_cycles',
        'list_issues',
        'list_projects',
        'merge_project',
        'save_comment',
        'save_issue',
        'save_project',
        'list_issue_events',
        'revert_issue_event',
      ].sort(),
    );
    const saveIssue = (result.tools as { name: string; inputSchema: { properties: Json } }[]).find((t) => t.name === 'save_issue');
    expect(Object.keys(saveIssue?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['id', 'title', 'description', 'state', 'project', 'cycle', 'dueDate', 'blockedBy']),
    );
  });

  it('沒帶 token、token 錯誤、沒設 API_TOKEN 都回 401', async () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const none = await post(msg, {});
    expect(none.status).toBe(401);
    expect(none.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect((await post(msg, { Authorization: 'Bearer wrong' })).status).toBe(401);
    env = { DB: env.DB };
    expect((await post(msg)).status).toBe(401);
  });

  it('沒帶 token 不能寫入', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_issue', arguments: { title: 'x' } } },
      {},
    );
    expect(res.status).toBe(401);
    expect((await tool<{ issues: unknown[] }>('list_issues')).issues).toEqual([]);
  });

  it('GET 回 405', async () => {
    const res = await worker.fetch(new Request('https://x/mcp', { headers: AUTH }), env);
    expect(res.status).toBe(405);
  });
});

describe('票', () => {
  it('開票：預設 Backlog，可帶 project 名稱與 cycle 編號', async () => {
    await tool('save_project', { name: 'Nextline' });
    await env.DB.prepare(
      "INSERT INTO sprints (number, starts_at, ends_at, created_at) VALUES (5, '2026-11-02T00:00:00.000Z', '2026-11-16T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
    ).run();
    const a = await tool<Issue>('save_issue', { title: '第一張', team: 'Bolas Dev' });
    expect(a).toMatchObject({ id: 'NX-1', title: '第一張', status: 'Backlog', statusType: 'backlog', project: null });
    const b = await tool<Issue>('save_issue', { title: '第二張', description: '內容', state: 'Todo', project: 'nextline', cycle: '5' });
    expect(b).toMatchObject({ id: 'NX-2', status: 'Todo', project: 'Nextline', cycle: 5, description: '內容' });
  });

  it('改狀態：收狀態名稱或 state type，id 可以用舊編號', async () => {
    await env.DB.prepare(
      "INSERT INTO issues (legacy_identifier, title, status, created_at, updated_at) VALUES ('ABC-150', '舊票', 'Todo', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
    ).run();
    const started = await tool<Issue>('save_issue', { id: 'ABC-150', state: 'In Progress' });
    expect(started).toMatchObject({ id: 'NX-1', status: 'In Progress' });
    const done = await tool<Issue & { completedAt: string | null }>('save_issue', { id: 'nx-1', state: 'completed' });
    expect(done.status).toBe('Done');
    expect(done.completedAt).not.toBeNull();
    // 變更紀錄寫在 issue_events，actor 預設 mcp。
    const { results } = await env.DB.prepare('SELECT to_value, actor FROM issue_events ORDER BY id').all();
    expect(results).toEqual([
      { to_value: 'In Progress', actor: 'mcp' },
      { to_value: 'Done', actor: 'mcp' },
    ]);
  });

  it('blockedBy 新增、removeBlockedBy 移除；不存在的票整個不寫', async () => {
    await tool('save_issue', { title: 'A' });
    const b = await tool<Issue>('save_issue', { title: 'B', blockedBy: ['NX-1'] });
    expect(b.relations?.blockedBy.map((x) => x.id)).toEqual(['NX-1']);
    const a = await tool<Issue>('get_issue', { id: 'NX-1' });
    expect(a.relations?.blocks.map((x) => x.id)).toEqual(['NX-2']);
    const removed = await tool<Issue>('save_issue', { id: 'NX-2', removeBlockedBy: ['NX-1'] });
    expect(removed.relations?.blockedBy).toEqual([]);

    const bad = await callTool('save_issue', { title: 'C', blockedBy: ['NX-99'] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('NX-99');
    expect((await tool<{ issues: unknown[] }>('list_issues')).issues).toHaveLength(2);
  });

  it('列出沒做完的票：state 用逗號一次查多種', async () => {
    for (const [title, state] of [
      ['待辦', 'Todo'],
      ['做中', 'In Progress'],
      ['做完', 'Done'],
      ['不做', 'Canceled'],
      ['之後', 'Backlog'],
    ]) {
      await tool('save_issue', { title, state });
    }
    const { issues } = await tool<{ issues: Issue[]; hasNextPage: boolean }>('list_issues', { state: 'Backlog,Todo,In Progress' });
    expect(issues.map((i) => i.title).sort()).toEqual(['之後', '做中', '待辦'].sort());
    expect(issues[0]).not.toHaveProperty('description');

    const page = await tool<{ issues: Issue[]; hasNextPage: boolean; cursor?: string }>('list_issues', { limit: 2 });
    expect(page.hasNextPage).toBe(true);
    const next = await tool<{ issues: Issue[]; hasNextPage: boolean }>('list_issues', { limit: 2, cursor: page.cursor });
    expect(next.issues).toHaveLength(2);
    expect(next.issues.map((i) => i.id)).not.toContain(page.issues[0]?.id);
  });

  it('updatedAt 收相對時間', async () => {
    await tool('save_issue', { title: '剛開' });
    expect((await tool<{ issues: Issue[] }>('list_issues', { updatedAt: '-P1D' })).issues).toHaveLength(1);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await tool<{ issues: Issue[] }>('list_issues', { updatedAt: future })).issues).toHaveLength(0);
  });

  it('找不到的票、不正確的 state 回 isError', async () => {
    const missing = await callTool('get_issue', { id: 'NX-404' });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toContain('找不到票');
    const bad = await callTool('save_issue', { title: 'x', state: 'Doing' });
    expect(bad.isError).toBe(true);
  });
});

describe('comment', () => {
  it('寫 comment、列出、修改', async () => {
    await tool('save_issue', { title: '有 comment 的票' });
    const c = await tool<{ id: string; issueId: string; author: string; body: string }>('save_comment', {
      issueId: 'NX-1',
      body: '做到一半\n\n下一步：跑測試',
      author: '阿澈',
    });
    expect(c).toMatchObject({ issueId: 'NX-1', author: '阿澈', body: '做到一半\n\n下一步：跑測試' });
    await tool('save_comment', { issueId: 'NX-1', body: '第二則' });
    const edited = await tool<{ body: string }>('save_comment', { id: c.id, body: '改過' });
    expect(edited.body).toBe('改過');
    const { comments } = await tool<{ comments: { body: string; author: string }[] }>('list_comments', { issueId: 'NX-1' });
    expect(comments.map((x) => [x.author, x.body])).toEqual([
      ['阿澈', '改過'],
      ['mcp', '第二則'],
    ]);
  });

  it('人（你）在待驗收的票留言 → In Progress；agent 留言、其他狀態不變（NX-221）', async () => {
    await tool('save_issue', { title: '待驗收', state: 'In Review' });
    await tool('save_issue', { title: 'Todo 的票', state: 'Todo' });
    await tool('save_comment', { issueId: 'NX-1', body: '證據在這\n\n下一步：你驗收', author: 'nextline agent' });
    await tool('save_comment', { issueId: 'NX-1', body: '預設 author' });
    expect((await tool<Issue>('get_issue', { id: 'NX-1' })).status).toBe('In Review');
    await tool('save_comment', { issueId: 'NX-2', body: '先看看', author: '你' });
    expect((await tool<Issue>('get_issue', { id: 'NX-2' })).status).toBe('Todo');

    await tool('save_comment', { issueId: 'NX-1', body: '1.1 2.1 3.1', author: '你' });
    expect((await tool<Issue>('get_issue', { id: 'NX-1' })).status).toBe('In Progress');
    const { events } = await tool<{ events: { field: string; from: string | null; to: string | null; actor: string }[] }>('list_issue_events', { issueId: 'NX-1' });
    expect(events.filter((e) => e.field === 'status').map((e) => [e.from, e.to, e.actor])).toEqual([['In Review', 'In Progress', '你']]);
  });

  it('設定 OWNER_NAME 後，save_comment 只有這個名字會把待驗收的票交回 In Progress（NX-244）', async () => {
    env = { ...env, OWNER_NAME: 'Alice' };
    await tool('save_issue', { title: '待驗收', state: 'In Review' });
    await tool('save_comment', { issueId: 'NX-1', body: '舊的名字', author: 'Bolas' });
    await tool('save_comment', { issueId: 'NX-1', body: '回報', author: 'nextline agent' });
    expect((await tool<Issue>('get_issue', { id: 'NX-1' })).status).toBe('In Review');
    await tool('save_comment', { issueId: 'NX-1', body: '選 1', author: 'Alice' });
    expect((await tool<Issue>('get_issue', { id: 'NX-1' })).status).toBe('In Progress');
  });

  it('list_recent_comments：跨票列出某個時間之後的 comment（含 Done、封存），跟逐張 list_comments 一致', async () => {
    type C = { id: string; issueId: string; author: string; body: string; createdAt: string };
    await tool('save_issue', { title: '進行中' });
    await tool('save_issue', { title: '做完了', state: 'Done' });
    await tool('save_issue', { title: '要封存' });
    await tool('save_comment', { issueId: 'NX-1', body: '比下界早', author: 'Bolas' });
    await new Promise((r) => setTimeout(r, 5));
    const boundary = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await tool('save_comment', { issueId: 'NX-2', body: 'Done 的票', author: 'Bolas' });
    await tool('save_comment', { issueId: 'NX-3', body: '封存的票', author: 'Bolas' });
    await tool('save_comment', { issueId: 'NX-1', body: '進行中的票', author: '阿澈' });
    await tool('save_issue', { id: 'NX-3', archived: true });

    const res = await tool<{ comments: C[]; hasNextPage: boolean }>('list_recent_comments', { createdAt: boundary });
    expect(res.comments.map((c) => [c.issueId, c.author, c.body])).toEqual([
      ['NX-2', 'Bolas', 'Done 的票'],
      ['NX-3', 'Bolas', '封存的票'],
      ['NX-1', '阿澈', '進行中的票'],
    ]);
    expect(res.hasNextPage).toBe(false);

    const perIssue: C[] = [];
    for (const issueId of ['NX-1', 'NX-2', 'NX-3']) {
      perIssue.push(...(await tool<{ comments: C[] }>('list_comments', { issueId })).comments);
    }
    const expected = perIssue.filter((c) => c.createdAt >= boundary).sort((a, b) => Number(a.id) - Number(b.id));
    expect(res.comments).toEqual(expected);

    const page = await tool<{ comments: C[]; hasNextPage: boolean; cursor?: string }>('list_recent_comments', { createdAt: boundary, limit: 2 });
    expect(page).toMatchObject({ hasNextPage: true, cursor: '2' });
    const next = await tool<{ comments: C[] }>('list_recent_comments', { createdAt: boundary, limit: 2, cursor: page.cursor });
    expect(next.comments.map((c) => c.body)).toEqual(['進行中的票']);
    expect((await tool<{ comments: C[] }>('list_recent_comments', { createdAt: '-P1D' })).comments).toHaveLength(4);
    expect((await callTool('list_recent_comments', { createdAt: '昨天' })).isError).toBe(true);
  });

  it('沒帶 issueId 也沒帶 id 回 isError', async () => {
    expect((await callTool('save_comment', { body: 'x' })).isError).toBe(true);
  });
});

describe('Project 與 Cycle', () => {
  it('新增、修改、列出、讀取 Project', async () => {
    // NX-165：Project 沒有狀態；照 Linear 習慣帶 state 會忽略，回傳也沒有 status
    const p = await tool<Record<string, unknown> & { id: string }>('save_project', { name: 'Nextline', description: '計劃書', state: 'In Progress' });
    expect(p).toMatchObject({ name: 'Nextline' });
    expect(p).not.toHaveProperty('status');
    expect(p).not.toHaveProperty('statusType');
    await tool('save_project', { name: '其他' });
    const edited = await tool<Record<string, unknown>>('save_project', { id: 'Nextline', state: 'Completed' });
    expect(edited).not.toHaveProperty('status');
    const { projects } = await tool<{ projects: Record<string, unknown>[] }>('list_projects', { state: 'completed' });
    expect(projects.map((x) => x.name).sort()).toEqual(['Nextline', '其他'].sort());
    expect(projects[0]).not.toHaveProperty('status');
    expect((await tool<{ projects: unknown[] }>('list_projects', { query: '其' })).projects).toHaveLength(1);
    const got = await tool<{ description: string }>('get_project', { query: p.id });
    expect(got.description).toBe('計劃書');
    expect((await callTool('save_project', { name: 'Nextline' })).isError).toBe(true);
  });

  it('save_project 的 pinned 釘選／取消；list_projects 回 pinnedAt、lastActivityAt，釘選的在最上面（NX-162）', async () => {
    await tool('save_project', { name: '舊的' });
    await tool('save_project', { name: '新的' });
    type P = { name: string; pinnedAt: string | null; lastActivityAt: string };
    const names = async () => (await tool<{ projects: P[] }>('list_projects', {})).projects.map((x) => x.name);
    expect(await names()).toEqual(['新的', '舊的']);
    const pinned = await tool<P>('save_project', { id: '舊的', pinned: true });
    expect(typeof pinned.pinnedAt).toBe('string');
    expect(typeof pinned.lastActivityAt).toBe('string');
    expect(await names()).toEqual(['舊的', '新的']);
    expect((await tool<P>('save_project', { id: '舊的', pinned: false })).pinnedAt).toBeNull();
    expect(await names()).toEqual(['新的', '舊的']);
    expect((await callTool('save_project', { name: '第三個', pinned: true })).isError).toBe(true);
  });

  it('list_cycles 依編號新到舊；type 取目前一期', async () => {
    const day = 86_400_000;
    const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString();
    for (const [number, start, end] of [
      [1, -30, -16],
      [2, -2, 12],
      [3, 12, 26],
    ] as const) {
      await env.DB.prepare('INSERT INTO sprints (number, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(number, iso(start), iso(end), iso(-40))
        .run();
    }
    const all = await tool<{ cycles: { number: number }[] }>('list_cycles', { teamId: 'ignored' });
    expect(all.cycles.map((c) => c.number)).toEqual([3, 2, 1]);
    for (const [type, number] of [
      ['current', 2],
      ['previous', 1],
      ['next', 3],
    ] as const) {
      expect((await tool<{ cycles: { number: number }[] }>('list_cycles', { type })).cycles.map((c) => c.number)).toEqual([number]);
    }
  });
});

describe('待驗收、看板排序、變更紀錄', () => {
  it('In Review：state type started 存成 In Progress，查詢時 started 含 In Review', async () => {
    const r = await tool<Issue>('save_issue', { title: '送驗收', state: 'In Review' });
    expect(r).toMatchObject({ status: 'In Review', statusType: 'started' });
    expect((await tool<Issue>('save_issue', { title: '開工', state: 'started' })).status).toBe('In Progress');
    await tool('save_issue', { title: '做完', state: 'Done' });
    const started = await tool<{ issues: Issue[] }>('list_issues', { state: 'started' });
    expect(started.issues.map((i) => i.status).sort()).toEqual(['In Progress', 'In Review']);
    const open = await tool<{ issues: Issue[] }>('list_issues', { state: 'Backlog,Todo,In Progress,In Review' });
    expect(open.issues).toHaveLength(2);
    expect((await tool<{ issues: Issue[] }>('list_issues', { state: 'in review' })).issues.map((i) => i.title)).toEqual(['送驗收']);
  });

  it('save_issue 的 before／after 調整順序，list_issues orderBy position 看板順序', async () => {
    for (const title of ['A', 'B', 'C']) await tool('save_issue', { title, state: 'Todo' });
    const order = async () =>
      (await tool<{ issues: Issue[] }>('list_issues', { state: 'Todo', orderBy: 'position' })).issues.map((i) => i.title);
    expect(await order()).toEqual(['C', 'B', 'A']);
    await tool('save_issue', { id: 'NX-1', before: 'NX-3' });
    expect(await order()).toEqual(['A', 'C', 'B']);
    await tool('save_issue', { id: 'NX-1', after: 'NX-2' });
    expect(await order()).toEqual(['C', 'B', 'A']);
    expect((await callTool('save_issue', { id: 'NX-1', before: 'NX-2', after: 'NX-3' })).isError).toBe(true);
  });

  it('list_issue_events 列出變更（含 blocked by 與 actor），revert_issue_event 還原', async () => {
    await tool('save_issue', { title: 'A', state: 'In Review' });
    await tool('save_issue', { title: 'B' });
    await tool('save_issue', { id: 'NX-1', state: 'Done', blockedBy: ['NX-2'], actor: 'claude-nextline' });
    const { events } = await tool<{ events: { id: string; field: string; from: string | null; to: string | null; actor: string; revertedBy: string | null }[] }>(
      'list_issue_events',
      { issueId: 'NX-1' },
    );
    expect(events.map((e) => [e.field, e.from, e.to, e.actor])).toEqual([
      ['status', 'In Review', 'Done', 'claude-nextline'],
      ['blocked_by', null, '2', 'claude-nextline'],
    ]);
    const statusEvent = events[0]?.id ?? '';
    const r = await tool<{ issue: Issue; event: { revertOf: string; actor: string }; revertedEvent: { revertedBy: string } }>(
      'revert_issue_event',
      { issueId: 'NX-1', eventId: statusEvent, actor: 'Bolas' },
    );
    expect(r.issue.status).toBe('In Review');
    expect(r.event).toMatchObject({ revertOf: statusEvent, actor: 'Bolas' });
    expect(r.revertedEvent.revertedBy).not.toBeNull();

    const again = await callTool('revert_issue_event', { issueId: 'NX-1', eventId: statusEvent });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('已經');
    await tool('save_issue', { id: 'NX-2', state: 'Todo' });
    await tool('save_issue', { id: 'NX-2', state: 'In Progress' });
    const nx2 = (await tool<{ events: { id: string }[] }>('list_issue_events', { issueId: 'NX-2' })).events;
    const conflict = await callTool('revert_issue_event', { issueId: 'NX-2', eventId: nx2[0]?.id ?? '' });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain('又在');
    expect((await callTool('revert_issue_event', { issueId: 'NX-1', eventId: 'x' })).isError).toBe(true);
  });

  it('封存：save_issue archived 封存／取消封存；list_issues 預設不含，includeArchived 才列出；可用 revert_issue_event 還原', async () => {
    await tool('save_issue', { title: '留著' });
    await tool('save_issue', { title: '不要了' });
    const archived = await tool<Issue & { archivedAt: string | null }>('save_issue', { id: 'NX-2', archived: true, actor: '阿澈' });
    expect(typeof archived.archivedAt).toBe('string');
    expect((await tool<{ issues: Issue[] }>('list_issues')).issues.map((i) => i.title)).toEqual(['留著']);
    expect((await tool<{ issues: Issue[] }>('list_issues', { includeArchived: true })).issues.map((i) => i.title).sort()).toEqual(['不要了', '留著']);
    const { events } = await tool<{ events: { id: string; field: string }[] }>('list_issue_events', { issueId: 'NX-2' });
    expect(events.map((e) => e.field)).toEqual(['archived']);
    await tool('revert_issue_event', { issueId: 'NX-2', eventId: events[0]?.id });
    expect((await tool<{ issues: Issue[] }>('list_issues')).issues).toHaveLength(2);
    await tool('save_issue', { id: 'NX-1', archived: true });
    expect((await tool<Issue & { archivedAt: string | null }>('save_issue', { id: 'NX-1', archived: false })).archivedAt).toBeNull();
    expect((await callTool('save_issue', { title: '新票', archived: true })).isError).toBe(true);
  });

  it('merge_project：可用名稱或 id 合併 Project，移轉票與說明，合併自己或找不到回 isError', async () => {
    const target = await tool<{ id: string; name: string }>('save_project', { name: '核心專案', description: '原本說明' });
    const source = await tool<{ id: string; name: string }>('save_project', { name: '第二階段', description: '階段說明' });
    await tool('save_issue', { title: '階段票', project: '第二階段' });

    const merged = await tool<{
      target: { id: string; name: string; description: string };
      mergedProjectId: string;
      mergedProjectName: string;
      movedIssues: number;
      descriptionAppended: boolean;
    }>('merge_project', { source: '第二階段', target: '核心專案' });

    expect(merged).toMatchObject({
      mergedProjectId: source.id,
      mergedProjectName: '第二階段',
      movedIssues: 1,
      descriptionAppended: true,
    });
    expect(merged.target.id).toBe(target.id);
    expect(merged.target.description).toContain('## 合併自「第二階段」');
    expect(merged.target.description).toContain('階段說明');

    const { projects } = await tool<{ projects: { id: string; name: string }[] }>('list_projects');
    expect(projects.map((p) => p.name)).toEqual(['核心專案']);
    const { issues } = await tool<{ issues: Issue[] }>('list_issues', { project: '核心專案' });
    expect(issues.map((i) => i.title)).toEqual(['階段票']);

    expect((await callTool('merge_project', { source: target.id, target: target.id })).isError).toBe(true);
    expect((await callTool('merge_project', { source: '不存在', target: '核心專案' })).isError).toBe(true);
  });
});
