import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp as worker, type TestEnv as Env } from '../test/app';
import { createDatabase, type TestDatabase } from '../test/database';

const TOKEN = 'test-token';
let env: Env;

let database: TestDatabase;
beforeEach(async () => {
  database = await createDatabase();
  env = { DB: database.db, API_TOKEN: TOKEN };
});
afterEach(async () => { await database.close(); });

interface Json {
  [key: string]: unknown;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
): Promise<{ status: number; body: Json; res: Response }> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await worker.fetch(new Request(`https://x${path}`, init), env);
  const text = await res.text();
  const isJson = res.headers.get('Content-Type')?.includes('application/json') ?? false;
  return { status: res.status, body: (isJson ? JSON.parse(text) : {}) as Json, res };
}

async function newIssue(fields: Json = {}): Promise<Json> {
  const { status, body } = await call('POST', '/api/issues', { title: '一張票', ...fields });
  expect(status).toBe(201);
  return body;
}

async function newProject(name = 'Nextline'): Promise<number> {
  const { status, body } = await call('POST', '/api/projects', { name });
  expect(status).toBe(201);
  return body.id as number;
}

async function newSprint(number = 1): Promise<number> {
  const { status, body } = await call('POST', '/api/sprints', {
    number,
    starts_at: '2026-11-02T00:00:00Z',
    ends_at: '2026-11-16T00:00:00Z',
  });
  expect(status).toBe(201);
  return body.id as number;
}

function numbers(body: Json): number[] {
  return (body.issues as { number: number }[]).map((i) => i.number);
}

describe('token 驗證', () => {
  it('沒帶 token 回 401', async () => {
    const r = await call('GET', '/api/issues', undefined, {});
    expect(r.status).toBe(401);
    expect(r.res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('token 錯誤回 401', async () => {
    expect((await call('GET', '/api/issues', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await call('GET', '/api/issues', undefined, { Authorization: TOKEN })).status).toBe(401);
  });

  it('寫入也會被擋，而且不會寫進資料庫', async () => {
    expect((await call('POST', '/api/issues', { title: 'x' }, {})).status).toBe(401);
    expect(numbers((await call('GET', '/api/issues')).body)).toEqual([]);
  });

  it('沒設定 API_TOKEN 時一律回 401', async () => {
    env = { DB: env.DB };
    expect((await call('GET', '/api/issues')).status).toBe(401);
    expect((await call('GET', '/api/issues', undefined, { Authorization: 'Bearer ' })).status).toBe(401);
  });

  it('未知的 /api 路徑也要先驗 token', async () => {
    expect((await call('GET', '/api/nope', undefined, {})).status).toBe(401);
    expect((await call('GET', '/api/nope')).status).toBe(404);
  });

  it('/health 不需要 token', async () => {
    expect((await call('GET', '/health', undefined, {})).status).toBe(200);
  });
});

describe('新增票', () => {
  it('自動編號 NX-1、NX-2', async () => {
    const a = await newIssue({ title: '第一張' });
    const b = await newIssue({ title: '第二張' });
    expect(a).toMatchObject({ number: 1, identifier: 'NX-1', title: '第一張', status: 'Backlog', blocked_by: [], blocks: [] });
    expect(b).toMatchObject({ number: 2, identifier: 'NX-2' });
  });

  it('可以指定狀態、Project、Sprint、到期日', async () => {
    const projectId = await newProject();
    const sprintId = await newSprint();
    const issue = await newIssue({
      status: 'Done',
      project_id: projectId,
      sprint_id: sprintId,
      due_date: '2026-11-30',
      description: '說明',
    });
    expect(issue).toMatchObject({ status: 'Done', project_id: projectId, sprint_id: sprintId, due_date: '2026-11-30' });
    expect(issue.completed_at).toEqual(expect.any(String));
  });

  it('缺 title、狀態錯誤、Project 不存在時回 400', async () => {
    expect((await call('POST', '/api/issues', {})).status).toBe(400);
    expect((await call('POST', '/api/issues', { title: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/issues', { title: 'x', status: 'Doing' })).status).toBe(400);
    expect((await call('POST', '/api/issues', { title: 'x', project_id: 99 })).status).toBe(400);
    expect((await call('POST', '/api/issues', { title: 'x', due_date: '11/30' })).status).toBe(400);
    const bad = await worker.fetch(
      new Request('https://x/api/issues', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{' }),
      env,
    );
    expect(bad.status).toBe(400);
  });

  it('搬家用的欄位：保留舊編號與時間', async () => {
    const issue = await newIssue({
      legacy_identifier: 'abc-150',
      created_at: '2026-01-02T03:04:05Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    });
    expect(issue).toMatchObject({
      identifier: 'NX-1',
      legacy_identifier: 'ABC-150',
      created_at: '2026-01-02T03:04:05.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    });
  });

  it('同一個舊編號重複新增回 409，並告知已存在的 NX 編號', async () => {
    await newIssue({ legacy_identifier: 'ABC-150' });
    const r = await call('POST', '/api/issues', { title: 'again', legacy_identifier: 'ABC-150' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ identifier: 'NX-1' });
    expect((await call('POST', '/api/issues', { title: 'x', legacy_identifier: 'NX-3' })).status).toBe(400);
  });
});

describe('查詢單張票', () => {
  it('用 NX-n、n、舊編號都查得到', async () => {
    await newIssue();
    await newIssue({ title: '舊票', legacy_identifier: 'ABC-150' });
    for (const ref of ['NX-2', 'nx-2', '2', 'ABC-150', 'abc-150']) {
      const r = await call('GET', `/api/issues/${ref}`);
      expect(r.status, ref).toBe(200);
      expect(r.body).toMatchObject({ number: 2, identifier: 'NX-2', title: '舊票', legacy_identifier: 'ABC-150' });
    }
  });

  it('不存在的票回 404', async () => {
    expect((await call('GET', '/api/issues/NX-9')).status).toBe(404);
    expect((await call('GET', '/api/issues/ABC-9')).status).toBe(404);
    expect((await call('GET', '/api/issues/hello')).status).toBe(404);
    expect((await call('GET', '/api/issues/%E0%A4%A')).status).toBe(404);
  });
});

describe('修改票與變更紀錄', () => {
  it('改標題、說明、到期日各寫一筆變更紀錄（舊值、新值、actor）', async () => {
    await newIssue({ description: '舊說明' });
    const r = await call('PATCH', '/api/issues/NX-1', {
      title: '新標題',
      description: '新說明',
      due_date: '2026-11-20',
      actor: 'claude-nextline',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: '新標題', description: '新說明', due_date: '2026-11-20' });
    expect((await call('GET', '/api/issues/NX-1/events')).body.events).toEqual([
      expect.objectContaining({ field: 'title', from_value: '一張票', to_value: '新標題', actor: 'claude-nextline' }),
      expect.objectContaining({ field: 'description', from_value: '舊說明', to_value: '新說明', actor: 'claude-nextline' }),
      expect.objectContaining({ field: 'due_date', from_value: null, to_value: '2026-11-20', actor: 'claude-nextline' }),
    ]);
  });

  it('狀態、Project、Sprint 變動時各寫一筆紀錄', async () => {
    const projectId = await newProject();
    const sprintId = await newSprint();
    const before = await newIssue();
    // 時間戳記到毫秒，同一毫秒內修改會拿到相同的 updated_at
    await new Promise((resolve) => setTimeout(resolve, 5));
    const r = await call('PATCH', '/api/issues/NX-1', {
      status: 'In Progress',
      project_id: projectId,
      sprint_id: sprintId,
      actor: '阿澈',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'In Progress', project_id: projectId, sprint_id: sprintId });
    expect(r.body.updated_at).not.toBe(before.updated_at);

    const events = (await call('GET', '/api/issues/NX-1/events')).body.events;
    expect(events).toEqual([
      expect.objectContaining({ field: 'status', from_value: 'Backlog', to_value: 'In Progress', actor: '阿澈' }),
      expect.objectContaining({ field: 'project', from_value: null, to_value: String(projectId), actor: '阿澈' }),
      expect.objectContaining({ field: 'sprint', from_value: null, to_value: String(sprintId), actor: '阿澈' }),
    ]);
  });

  it('值沒變就不寫紀錄；移出 Project 記成 null；沒帶 actor 記成 api', async () => {
    const projectId = await newProject();
    await newIssue({ project_id: projectId, status: 'Todo' });
    await call('PATCH', '/api/issues/NX-1', { status: 'Todo', project_id: projectId });
    expect((await call('GET', '/api/issues/NX-1/events')).body.events).toEqual([]);

    const r = await call('PATCH', '/api/issues/NX-1', { project_id: null });
    expect(r.body.project_id).toBeNull();
    expect((await call('GET', '/api/issues/NX-1/events')).body.events).toEqual([
      expect.objectContaining({ field: 'project', from_value: String(projectId), to_value: null, actor: 'api' }),
    ]);
  });

  it('改成 Done／Canceled 會填完成／取消時間，改回來會清掉', async () => {
    await newIssue();
    const done = (await call('PATCH', '/api/issues/NX-1', { status: 'Done' })).body;
    expect(done.completed_at).toEqual(expect.any(String));
    const canceled = (await call('PATCH', '/api/issues/NX-1', { status: 'Canceled' })).body;
    expect(canceled.completed_at).toBeNull();
    expect(canceled.canceled_at).toEqual(expect.any(String));
    const todo = (await call('PATCH', '/api/issues/NX-1', { status: 'Todo' })).body;
    expect(todo).toMatchObject({ completed_at: null, canceled_at: null });
    expect(((await call('GET', '/api/issues/NX-1/events')).body.events as unknown[]).length).toBe(3);
  });

  it('用舊編號也能修改', async () => {
    await newIssue({ legacy_identifier: 'ABC-150' });
    const r = await call('PATCH', '/api/issues/ABC-150', { status: 'Todo' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ identifier: 'NX-1', status: 'Todo' });
  });

  it('錯誤的值回 400，不改資料也不寫紀錄', async () => {
    await newIssue();
    expect((await call('PATCH', '/api/issues/NX-1', { status: 'Doing' })).status).toBe(400);
    expect((await call('PATCH', '/api/issues/NX-1', { status: 'Todo', sprint_id: 42 })).status).toBe(400);
    expect((await call('PATCH', '/api/issues/NX-1', { title: '' })).status).toBe(400);
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('Backlog');
    expect((await call('GET', '/api/issues/NX-1/events')).body.events).toEqual([]);
    expect((await call('PATCH', '/api/issues/NX-9', { status: 'Todo' })).status).toBe(404);
  });
});

describe('列表篩選', () => {
  async function seed() {
    const p1 = await newProject('P1');
    const p2 = await newProject('P2');
    const s1 = await newSprint(1);
    await newIssue({ status: 'Todo', project_id: p1, sprint_id: s1, updated_at: '2026-10-01T00:00:00Z' }); // NX-1
    await newIssue({ status: 'In Progress', project_id: p1, updated_at: '2026-10-05T00:00:00Z' }); // NX-2
    await newIssue({ status: 'Done', project_id: p2, sprint_id: s1, updated_at: '2026-10-10T00:00:00Z' }); // NX-3
    await newIssue({ status: 'Backlog', updated_at: '2026-10-15T00:00:00Z' }); // NX-4
    return { p1, p2, s1 };
  }

  it('沒有篩選時依更新時間新到舊', async () => {
    await seed();
    const r = await call('GET', '/api/issues');
    expect(r.status).toBe(200);
    expect(numbers(r.body)).toEqual([4, 3, 2, 1]);
    expect((r.body.issues as Json[])[0]).toMatchObject({ identifier: 'NX-4' });
  });

  it('依狀態（單一、多個、逗號分隔）', async () => {
    await seed();
    expect(numbers((await call('GET', '/api/issues?status=Todo')).body)).toEqual([1]);
    expect(numbers((await call('GET', '/api/issues?status=Todo&status=Done')).body)).toEqual([3, 1]);
    expect(numbers((await call('GET', '/api/issues?status=In%20Progress,Backlog')).body)).toEqual([4, 2]);
    expect((await call('GET', '/api/issues?status=Doing')).status).toBe(400);
  });

  it('依 Project、Sprint（含 none）', async () => {
    const { p1, p2, s1 } = await seed();
    expect(numbers((await call('GET', `/api/issues?project=${String(p1)}`)).body)).toEqual([2, 1]);
    expect(numbers((await call('GET', `/api/issues?project=${String(p2)}`)).body)).toEqual([3]);
    expect(numbers((await call('GET', '/api/issues?project=none')).body)).toEqual([4]);
    expect(numbers((await call('GET', `/api/issues?sprint=${String(s1)}`)).body)).toEqual([3, 1]);
    expect(numbers((await call('GET', '/api/issues?sprint=none')).body)).toEqual([4, 2]);
    expect((await call('GET', '/api/issues?project=abc')).status).toBe(400);
  });

  it('依更新時間（updated_since 含、updated_before 不含）', async () => {
    await seed();
    expect(numbers((await call('GET', '/api/issues?updated_since=2026-10-05T00:00:00Z')).body)).toEqual([4, 3, 2]);
    expect(numbers((await call('GET', '/api/issues?updated_before=2026-10-05T00:00:00Z')).body)).toEqual([1]);
    expect(
      numbers((await call('GET', '/api/issues?updated_since=2026-10-02T00:00:00Z&updated_before=2026-10-12T00:00:00Z')).body),
    ).toEqual([3, 2]);
    expect((await call('GET', '/api/issues?updated_since=yesterday')).status).toBe(400);
  });

  it('條件可以組合，並支援分頁', async () => {
    const { p1, s1 } = await seed();
    expect(
      numbers((await call('GET', `/api/issues?project=${String(p1)}&sprint=${String(s1)}&status=Todo`)).body),
    ).toEqual([1]);
    const page1 = (await call('GET', '/api/issues?limit=3')).body;
    expect(numbers(page1)).toEqual([4, 3, 2]);
    expect(page1.has_more).toBe(true);
    const page2 = (await call('GET', '/api/issues?limit=3&offset=3')).body;
    expect(numbers(page2)).toEqual([1]);
    expect(page2.has_more).toBe(false);
    expect((await call('GET', '/api/issues?limit=0')).status).toBe(400);
  });

  it('修改後更新時間變新，排到最前面', async () => {
    await seed();
    await call('PATCH', '/api/issues/NX-1', { status: 'In Progress' });
    expect(numbers((await call('GET', '/api/issues')).body)[0]).toBe(1);
  });
});

describe('blocked by', () => {
  it('加入、查詢、雙向顯示、移除', async () => {
    await newIssue({ title: 'A' });
    await newIssue({ title: 'B', legacy_identifier: 'ABC-7' });
    await newIssue({ title: 'C' });

    const add = await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'ABC-7' });
    expect(add.status).toBe(201);
    expect(add.body.blocked_by).toEqual([expect.objectContaining({ identifier: 'NX-2', title: 'B' })]);
    expect((await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 3 })).status).toBe(201);

    const a = (await call('GET', '/api/issues/NX-1')).body;
    expect((a.blocked_by as Json[]).map((i) => i.identifier)).toEqual(['NX-2', 'NX-3']);
    const b = (await call('GET', '/api/issues/NX-2')).body;
    expect((b.blocks as Json[]).map((i) => i.identifier)).toEqual(['NX-1']);
    expect(b.blocked_by).toEqual([]);

    const list = (await call('GET', '/api/issues/NX-1/blockers')).body;
    expect((list.blocked_by as Json[]).length).toBe(2);

    const del = await call('DELETE', '/api/issues/NX-1/blockers/NX-2');
    expect(del.status).toBe(200);
    expect((del.body.blocked_by as Json[]).map((i) => i.identifier)).toEqual(['NX-3']);
    expect((await call('DELETE', '/api/issues/NX-1/blockers/NX-2')).status).toBe(404);
  });

  it('重複加入回 200 不重複；擋自己、票不存在、缺參數回 400', async () => {
    await newIssue();
    await newIssue();
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2' });
    const again = await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2' });
    expect(again.status).toBe(200);
    expect((again.body.blocked_by as Json[]).length).toBe(1);
    expect((await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-1' })).status).toBe(400);
    expect((await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-99' })).status).toBe(400);
    expect((await call('POST', '/api/issues/NX-1/blockers', {})).status).toBe(400);
    expect((await call('POST', '/api/issues/NX-99/blockers', { blocked_by: 'NX-1' })).status).toBe(404);
  });
});

describe('comment', () => {
  it('新增、列出、修改', async () => {
    await newIssue({ legacy_identifier: 'ABC-150' });
    const c1 = await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: '第一則' });
    expect(c1.status).toBe(201);
    expect(c1.body).toMatchObject({ issue_number: 1, author: 'Bolas', body: '第一則' });
    await call('POST', '/api/issues/ABC-150/comments', { author: '阿澈', body: '第二則' });

    const list = (await call('GET', '/api/issues/NX-1/comments')).body.comments as Json[];
    expect(list.map((c) => c.body)).toEqual(['第一則', '第二則']);

    const id = String(c1.body.id);
    const edited = await call('PATCH', `/api/comments/${id}`, { body: '改過了' });
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe('改過了');
    expect((await call('GET', `/api/comments/${id}`)).body.body).toBe('改過了');
  });

  it('人（你）在待驗收的票留言 → 移到 In Progress，寫一筆變更紀錄，可以還原（NX-221）', async () => {
    await newIssue({ status: 'In Review' });
    expect((await call('POST', '/api/issues/NX-1/comments', { author: '你', body: '1.1 2.1' })).status).toBe(201);
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Progress');
    const events = (await call('GET', '/api/issues/NX-1/events')).body.events as Json[];
    const moved = events.filter((e) => e.field === 'status');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ from_value: 'In Review', to_value: 'In Progress', actor: '你' });

    const reverted = await call('POST', `/api/issues/NX-1/events/${String(moved[0]?.id)}/revert`, { actor: '你' });
    expect(reverted.status).toBe(200);
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Review');
  });

  it('agent 留言、搬家匯入、不是待驗收的票留言 → 狀態不變（NX-221）', async () => {
    await newIssue({ status: 'In Review' });
    for (const author of ['nextline agent', '阿澈', 'mcp', 'api']) {
      await call('POST', '/api/issues/NX-1/comments', { author, body: `${author} 的回報` });
    }
    await call('POST', '/api/issues/NX-1/comments', { author: '你', body: '從 Linear 搬來', linear_id: 'lin-1' });
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Review');

    for (const status of ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled']) {
      const issue = await newIssue({ status });
      await call('POST', `/api/issues/${String(issue.identifier)}/comments`, { author: '你', body: '看一下' });
      expect((await call('GET', `/api/issues/${String(issue.identifier)}`)).body.status).toBe(status);
    }
    const statusEvents = (await call('GET', '/api/issues/NX-1/events')).body.events as Json[];
    expect(statusEvents.filter((e) => e.field === 'status')).toHaveLength(0);
  });

  it('GET /api/owner：沒設定 OWNER_NAME 時是中性的「你」（NX-244）', async () => {
    expect((await call('GET', '/api/owner')).body).toEqual({ name: '你' });
    env = { ...env, OWNER_NAME: '  ' };
    expect((await call('GET', '/api/owner')).body).toEqual({ name: '你' });
  });

  it('沒設定 OWNER_NAME 時，作者寫 Bolas 的留言不會把待驗收的票交回（NX-244）', async () => {
    await newIssue({ status: 'In Review' });
    await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: '好' });
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Review');
  });

  it('設定 OWNER_NAME 後，只有這個名字回覆待驗收的票會交回 In Progress；Bolas、agent 不會（NX-244）', async () => {
    env = { ...env, OWNER_NAME: ' Alice ' };
    expect((await call('GET', '/api/owner')).body).toEqual({ name: 'Alice' });
    await newIssue({ status: 'In Review' });
    for (const author of ['Bolas', 'nextline agent', 'mcp']) {
      await call('POST', '/api/issues/NX-1/comments', { author, body: `${author} 的回報` });
    }
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Review');
    await call('POST', '/api/issues/NX-1/comments', { author: 'Alice', body: '選 1' });
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Progress');
    const moved = ((await call('GET', '/api/issues/NX-1/events')).body.events as Json[]).filter((e) => e.field === 'status');
    expect(moved).toEqual([expect.objectContaining({ from_value: 'In Review', to_value: 'In Progress', actor: 'Alice' })]);
  });

  it('GET /api/comments?created_since 跨所有票列出（含 Done、Canceled、封存），跟逐張查的結果一致', async () => {
    await newIssue();
    await newIssue({ status: 'Done' });
    await newIssue({ status: 'Canceled' });
    await newIssue();
    expect((await call('PATCH', '/api/issues/NX-4', { archived: true })).status).toBe(200);
    const T = (h: number) => `2026-11-10T${String(h).padStart(2, '0')}:00:00.000Z`;
    await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: '太舊', created_at: T(1) });
    await call('POST', '/api/issues/NX-2/comments', { author: 'Bolas', body: 'Done 的票', created_at: T(3) });
    await call('POST', '/api/issues/NX-4/comments', { author: 'Bolas', body: '封存的票', created_at: T(4) });
    await call('POST', '/api/issues/NX-3/comments', { author: '阿澈', body: 'Canceled 的票', created_at: T(5) });
    await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: '剛好在下界', created_at: T(2) });

    const res = await call('GET', `/api/comments?created_since=${T(2)}`);
    expect(res.status).toBe(200);
    const listed = res.body.comments as Json[];
    expect(listed.map((c) => [c.identifier, c.author, c.body, c.created_at])).toEqual([
      ['NX-1', 'Bolas', '剛好在下界', T(2)],
      ['NX-2', 'Bolas', 'Done 的票', T(3)],
      ['NX-4', 'Bolas', '封存的票', T(4)],
      ['NX-3', '阿澈', 'Canceled 的票', T(5)],
    ]);
    expect(res.body).toMatchObject({ limit: 50, offset: 0, has_more: false });

    // 逐張查 GET /api/issues/:ref/comments、只留 created_at >= 下界的，結果一樣。
    const perIssue: Json[] = [];
    for (const n of [1, 2, 3, 4]) {
      perIssue.push(...((await call('GET', `/api/issues/NX-${String(n)}/comments`)).body.comments as Json[]));
    }
    const expected = perIssue
      .filter((c) => (c.created_at as string) >= T(2))
      .sort((a, b) => (a.created_at as string).localeCompare(b.created_at as string) || (a.id as number) - (b.id as number));
    expect(listed.map((c) => c.identifier)).toEqual(expected.map((c) => `NX-${String(c.issue_number)}`));
    expect(listed.map((c) => ({ ...c, identifier: undefined }))).toEqual(expected.map((c) => ({ ...c, identifier: undefined })));
  });

  it('GET /api/comments：created_before、分頁、缺少或格式錯誤回 400', async () => {
    await newIssue();
    for (let h = 1; h <= 5; h++) {
      await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: `第 ${String(h)} 則`, created_at: `2026-11-10T0${String(h)}:00:00Z` });
    }
    const between = await call('GET', '/api/comments?created_since=2026-11-10T02:00:00Z&created_before=2026-11-10T04:00:00Z');
    expect((between.body.comments as Json[]).map((c) => c.body)).toEqual(['第 2 則', '第 3 則']);
    const p1 = await call('GET', '/api/comments?created_since=2026-11-10T00:00:00Z&limit=2');
    expect((p1.body.comments as Json[]).map((c) => c.body)).toEqual(['第 1 則', '第 2 則']);
    expect(p1.body.has_more).toBe(true);
    const p3 = await call('GET', '/api/comments?created_since=2026-11-10T00:00:00Z&limit=2&offset=4');
    expect((p3.body.comments as Json[]).map((c) => c.body)).toEqual(['第 5 則']);
    expect(p3.body.has_more).toBe(false);
    expect((await call('GET', '/api/comments')).status).toBe(400);
    expect((await call('GET', '/api/comments?created_since=昨天')).status).toBe(400);
    expect((await call('GET', '/api/comments?created_since=2026-11-10T00:00:00Z&limit=0')).status).toBe(400);
    expect((await call('POST', '/api/comments', {})).status).toBe(405);
  });

  it('缺 author／body 回 400；票不存在回 404；linear_id 重複回 409', async () => {
    await newIssue();
    expect((await call('POST', '/api/issues/NX-1/comments', { body: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas' })).status).toBe(400);
    expect((await call('POST', '/api/issues/NX-9/comments', { author: 'Bolas', body: 'x' })).status).toBe(404);
    const first = await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: 'x', linear_id: 'lin-1' });
    expect(first.status).toBe(201);
    const dup = await call('POST', '/api/issues/NX-1/comments', { author: 'Bolas', body: 'x', linear_id: 'lin-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.id).toBe(first.body.id);
    expect((await call('GET', '/api/comments/999')).status).toBe(404);
  });

  it('票的 next_step：取最新一則 comment 的「下一步：」，最新那則沒寫就是 null', async () => {
    await newIssue();
    await newIssue();
    await newIssue();
    expect((await call('GET', '/api/issues/NX-1')).body.next_step).toBeNull();
    await call('POST', '/api/issues/NX-1/comments', { author: '阿澈', body: '做完了\n下一步：Bolas 驗收' });
    await call('POST', '/api/issues/NX-2/comments', { author: '阿澈', body: '下一步：舊的', created_at: '2026-11-01T00:00:00Z' });
    await call('POST', '/api/issues/NX-2/comments', { author: 'Bolas', body: '**下一步：** 派給 agent', created_at: '2026-11-02T00:00:00Z' });
    await call('POST', '/api/issues/NX-3/comments', { author: '阿澈', body: '下一步：被蓋掉', created_at: '2026-11-01T00:00:00Z' });
    await call('POST', '/api/issues/NX-3/comments', { author: 'Bolas', body: '只是補充', created_at: '2026-11-02T00:00:00Z' });

    expect((await call('GET', '/api/issues/NX-1')).body.next_step).toBe('Bolas 驗收');
    const list = (await call('GET', '/api/issues?sort=position')).body.issues as Json[];
    expect(Object.fromEntries(list.map((i) => [i.identifier, i.next_step]))).toEqual({
      'NX-1': 'Bolas 驗收',
      'NX-2': '派給 agent',
      'NX-3': null,
    });
  });

  it('票不帶 zone（三區是晨報的邏輯，NX-160 拿掉）：列表、單張、PATCH 回應都沒有', async () => {
    await newIssue({ status: 'Todo' });
    const list = (await call('GET', '/api/issues')).body.issues as Json[];
    expect(list[0]).not.toHaveProperty('zone');
    expect((await call('GET', '/api/issues/NX-1')).body).not.toHaveProperty('zone');
    expect((await call('PATCH', '/api/issues/NX-1', { status: 'In Review' })).body).not.toHaveProperty('zone');
  });
});

describe('Project', () => {
  it('新增、列出、查詢、修改', async () => {
    const created = await call('POST', '/api/projects', { name: 'Nextline', description: '# 計劃書', status: 'started' });
    expect(created.status).toBe(201);
    // NX-165：Project 沒有狀態；帶 status 忽略，回傳也沒有 status
    expect(created.body).toMatchObject({ name: 'Nextline', description: '# 計劃書' });
    expect(created.body).not.toHaveProperty('status');
    const id = String(created.body.id);

    await newProject('Another');
    expect(((await call('GET', '/api/projects')).body.projects as Json[]).map((p) => p.name)).toEqual(['Another', 'Nextline']);
    // 舊的 ?status= 篩選拿掉了：帶了也回全部
    const filtered = (await call('GET', '/api/projects?status=started')).body.projects as Json[];
    expect(filtered.map((p) => p.name)).toEqual(['Another', 'Nextline']);
    expect(filtered[0]).not.toHaveProperty('status');
    expect(filtered[0]).toHaveProperty('last_activity_at');

    expect((await call('GET', `/api/projects/${id}`)).body.name).toBe('Nextline');
    const updated = await call('PATCH', `/api/projects/${id}`, { status: 'completed', description: '新說明' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ description: '新說明' });
    expect(updated.body).not.toHaveProperty('status');
  });

  it('名稱重複回 409；帶 status（任何值）忽略；不存在回 404', async () => {
    await newProject('Nextline');
    expect((await call('POST', '/api/projects', { name: 'Nextline' })).status).toBe(409);
    expect((await call('POST', '/api/projects', { name: 'X', status: 'done' })).status).toBe(201);
    expect((await call('GET', '/api/projects/99')).status).toBe(404);
    expect((await call('GET', '/api/projects/abc')).status).toBe(404);
  });

  // NX-162
  const T = (d: number) => `2026-10-${String(d).padStart(2, '0')}T00:00:00.000Z`;
  async function projectAt(name: string, day: number): Promise<number> {
    const { body } = await call('POST', '/api/projects', { name, created_at: T(day), updated_at: T(day) });
    return body.id as number;
  }
  const order = async () => ((await call('GET', '/api/projects')).body.projects as Json[]).map((p) => p.name);

  it('last_activity_at：Project、底下的票、底下票的 comment 取最新；預設照它新到舊排', async () => {
    const a = await projectAt('A', 1);
    const b = await projectAt('B', 2);
    await projectAt('C', 3);
    expect(await order()).toEqual(['C', 'B', 'A']);
    const list = (await call('GET', '/api/projects')).body.projects as Json[];
    expect(list[0]).toMatchObject({ pinned_at: null, last_activity_at: T(3) });

    // 票的 updated_at 較新 → A 上去
    await newIssue({ project_id: a, created_at: T(5), updated_at: T(5) });
    expect(await order()).toEqual(['A', 'C', 'B']);
    expect((await call('GET', `/api/projects/${String(a)}`)).body.last_activity_at).toBe(T(5));

    // comment 比票新 → B 上去（票本身是舊的）
    await newIssue({ project_id: b, created_at: T(2), updated_at: T(2) });
    await call('POST', '/api/issues/NX-2/comments', { author: 'test', body: '新進度', created_at: T(9) });
    expect(await order()).toEqual(['B', 'A', 'C']);
    expect((await call('GET', `/api/projects/${String(b)}`)).body.last_activity_at).toBe(T(9));

    // 現在改票（updated_at = 現在）→ A 回到最上面
    await call('PATCH', '/api/issues/NX-1', { title: '改標題' });
    expect((await order())[0]).toBe('A');
  });

  it('pinned：釘選的固定在最上面（彼此照釘選時間新到舊），不算更新；取消後回到照時間排', async () => {
    const a = await projectAt('A', 1);
    const b = await projectAt('B', 2);
    const c = await projectAt('C', 3);
    const pinA = await call('PATCH', `/api/projects/${String(a)}`, { pinned: true });
    expect(pinA.status).toBe(200);
    expect(typeof pinA.body.pinned_at).toBe('string');
    expect(pinA.body.updated_at).toBe(T(1));
    expect(await order()).toEqual(['A', 'C', 'B']);

    // 其他 Project 的票更新，A 還是在最上面
    await newIssue({ project_id: c });
    expect(await order()).toEqual(['A', 'C', 'B']);

    // 再釘 B（較晚釘）→ B 在 A 上面
    await new Promise((r) => setTimeout(r, 5));
    await call('PATCH', `/api/projects/${String(b)}`, { pinned: true });
    expect(await order()).toEqual(['B', 'A', 'C']);

    // 已釘選再釘一次不改釘選時間
    const before = (await call('GET', `/api/projects/${String(a)}`)).body.pinned_at;
    expect((await call('PATCH', `/api/projects/${String(a)}`, { pinned: true })).body.pinned_at).toBe(before);

    // 取消釘選
    expect((await call('PATCH', `/api/projects/${String(b)}`, { pinned: false })).body.pinned_at).toBeNull();
    expect((await call('PATCH', `/api/projects/${String(a)}`, { pinned: false })).body.pinned_at).toBeNull();
    expect(await order()).toEqual(['C', 'B', 'A']);

    expect((await call('PATCH', `/api/projects/${String(a)}`, { pinned: 'yes' })).status).toBe(400);
  });
});

describe('Sprint', () => {
  it('新增、列出、查詢、修改', async () => {
    const id = String(await newSprint(1));
    await newSprint(2);
    expect(((await call('GET', '/api/sprints')).body.sprints as Json[]).map((s) => s.number)).toEqual([2, 1]);
    expect((await call('GET', `/api/sprints/${id}`)).body).toMatchObject({
      number: 1,
      starts_at: '2026-11-02T00:00:00.000Z',
      ends_at: '2026-11-16T00:00:00.000Z',
    });
    const updated = await call('PATCH', `/api/sprints/${id}`, { name: 'Sprint 1', ends_at: '2026-11-20T00:00:00Z' });
    expect(updated.body).toMatchObject({ name: 'Sprint 1', ends_at: '2026-11-20T00:00:00.000Z' });
  });

  it('編號重複回 409；結束早於開始回 400', async () => {
    await newSprint(1);
    expect(
      (await call('POST', '/api/sprints', { number: 1, starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-15T00:00:00Z' }))
        .status,
    ).toBe(409);
    expect(
      (await call('POST', '/api/sprints', { number: 2, starts_at: '2026-12-15T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' }))
        .status,
    ).toBe(400);
    expect((await call('POST', '/api/sprints', { number: 2 })).status).toBe(400);
  });
});

describe('路由', () => {
  it('不支援的方法回 405 並列出 Allow', async () => {
    const r = await call('DELETE', '/api/issues');
    expect(r.status).toBe(405);
    expect(r.res.headers.get('Allow')).toBe('GET, POST');
  });

  it('/api 以外、像 /apix 的路徑不算 API', async () => {
    // 不算 API 就是網頁路徑：測試環境沒設定 Access，回 403 而不是 /api 的 401。
    expect((await call('GET', '/apix', undefined, {})).status).toBe(403);
  });
});

describe('待驗收 In Review', () => {
  it('可以新增、改成 In Review，列表可以篩選、跟其他沒做完的狀態一起查', async () => {
    await newIssue({ status: 'Todo' }); // NX-1
    await newIssue({ status: 'In Review' }); // NX-2
    await newIssue({ status: 'Done' }); // NX-3
    const r = await call('PATCH', '/api/issues/NX-1', { status: 'In Review', actor: 'claude-nextline' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'In Review', completed_at: null });
    expect(numbers((await call('GET', '/api/issues?status=In%20Review')).body).sort()).toEqual([1, 2]);
    expect(numbers((await call('GET', '/api/issues?status=Backlog,Todo,In%20Progress,In%20Review')).body).sort()).toEqual([1, 2]);
    expect((await call('GET', '/api/issues/NX-1/events')).body.events).toEqual([
      expect.objectContaining({ field: 'status', from_value: 'Todo', to_value: 'In Review', actor: 'claude-nextline' }),
    ]);
  });
});

describe('看板排序 position', () => {
  async function column(status = 'Todo'): Promise<number[]> {
    return numbers((await call('GET', `/api/issues?status=${encodeURIComponent(status)}&sort=position`)).body);
  }

  it('新票放在欄頂；不同欄各自排', async () => {
    await newIssue({ status: 'Todo' });
    await newIssue({ status: 'Todo' });
    await newIssue({ status: 'Backlog' });
    await newIssue({ status: 'Todo' });
    expect(await column()).toEqual([4, 2, 1]);
    // sort=position 依看板欄的順序（Backlog 在 Todo 前面）
    expect(numbers((await call('GET', '/api/issues?sort=position')).body)).toEqual([3, 4, 2, 1]);
    expect((await call('GET', '/api/issues?sort=random')).status).toBe(400);
  });

  it('移到某張票之前、之後，或直接給位置；只改位置不寫紀錄、不更新 updated_at', async () => {
    for (let i = 0; i < 4; i++) await newIssue({ status: 'Todo' });
    expect(await column()).toEqual([4, 3, 2, 1]);
    const before = (await call('GET', '/api/issues/NX-1')).body;
    expect((await call('PATCH', '/api/issues/NX-1', { before: 'NX-3' })).status).toBe(200);
    expect(await column()).toEqual([4, 1, 3, 2]);
    await call('PATCH', '/api/issues/NX-4', { after: 'NX-2' });
    expect(await column()).toEqual([1, 3, 2, 4]);
    await call('PATCH', '/api/issues/NX-2', { before: 1 });
    expect(await column()).toEqual([2, 1, 3, 4]);
    const p = (await call('PATCH', '/api/issues/NX-3', { position: -999999 })).body;
    expect(p.position).toBe(-999999);
    expect(await column()).toEqual([3, 2, 1, 4]);
    const after = (await call('GET', '/api/issues/NX-1')).body;
    expect(after.updated_at).toBe(before.updated_at);
    expect((await call('GET', '/api/issues/NX-1/events')).body.events).toEqual([]);
  });

  it('換欄時放到新欄最上面，也可以同時指定位置', async () => {
    await newIssue({ status: 'Todo' }); // 1
    await newIssue({ status: 'In Progress' }); // 2
    await newIssue({ status: 'In Progress' }); // 3
    await call('PATCH', '/api/issues/NX-1', { status: 'In Progress' });
    expect(await column('In Progress')).toEqual([1, 3, 2]);
    await call('PATCH', '/api/issues/NX-1', { status: 'In Review' });
    await call('PATCH', '/api/issues/NX-1', { status: 'In Progress', after: 'NX-2' });
    expect(await column('In Progress')).toEqual([3, 2, 1]);
  });

  it('沒有空隙時整欄重新編號，順序不變', async () => {
    await newIssue({ status: 'Todo', position: 10 }); // 1
    await newIssue({ status: 'Todo', position: 11 }); // 2
    await newIssue({ status: 'Todo', position: 12 }); // 3
    await call('PATCH', '/api/issues/NX-3', { before: 'NX-2' });
    expect(await column()).toEqual([1, 3, 2]);
    const positions = ((await call('GET', '/api/issues?status=Todo&sort=position')).body.issues as Json[]).map((i) => i.position);
    expect(new Set(positions).size).toBe(3);
  });

  it('不合法的排序參數回 400', async () => {
    await newIssue({ status: 'Todo' });
    await newIssue({ status: 'Done' });
    expect((await call('PATCH', '/api/issues/NX-1', { before: 'NX-2' })).body.error).toContain('Done');
    expect((await call('PATCH', '/api/issues/NX-1', { before: 'NX-1' })).status).toBe(400);
    expect((await call('PATCH', '/api/issues/NX-1', { before: 'NX-99' })).status).toBe(400);
    expect((await call('PATCH', '/api/issues/NX-1', { before: 'NX-2', position: 1 })).status).toBe(400);
    expect((await call('PATCH', '/api/issues/NX-1', { position: 1.5 })).status).toBe(400);
  });
});

describe('變更紀錄：blocked by 與還原', () => {
  async function events(ref = 'NX-1'): Promise<Json[]> {
    return (await call('GET', `/api/issues/${ref}/events`)).body.events as Json[];
  }

  it('blocked by 加入、移除各寫一筆（記在被擋住的票），重複加入不寫', async () => {
    await newIssue();
    await newIssue();
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2', actor: '阿澈' });
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2', actor: '阿澈' });
    await call('DELETE', '/api/issues/NX-1/blockers/NX-2?actor=Bolas');
    expect(await events()).toEqual([
      expect.objectContaining({ field: 'blocked_by', from_value: null, to_value: '2', actor: '阿澈' }),
      expect.objectContaining({ field: 'blocked_by', from_value: '2', to_value: null, actor: 'Bolas' }),
    ]);
    expect(await events('NX-2')).toEqual([]);
  });

  it('還原狀態：改回舊值、寫一筆還原紀錄、原本那筆標成已還原', async () => {
    await newIssue({ status: 'In Review' });
    await call('PATCH', '/api/issues/NX-1', { status: 'Done', actor: 'claude-nextline' });
    const [done] = await events();
    const r = await call('POST', `/api/issues/NX-1/events/${String(done?.id)}/revert`, { actor: 'Bolas' });
    expect(r.status).toBe(200);
    expect(r.body.issue).toMatchObject({ status: 'In Review', completed_at: null });
    expect(r.body.event).toMatchObject({ field: 'status', from_value: 'Done', to_value: 'In Review', actor: 'Bolas', revert_of_event_id: done?.id });
    expect(r.body.reverted_event).toMatchObject({ id: done?.id, reverted_by_event_id: (r.body.event as Json).id });
    expect(await events()).toHaveLength(2);
  });

  it('每個欄位都能還原：title、description、due_date、project、sprint、blocked_by', async () => {
    const projectId = await newProject();
    const sprintId = await newSprint();
    await newIssue({ title: '舊標題', description: '舊說明' });
    await newIssue();
    await call('PATCH', '/api/issues/NX-1', {
      title: '新標題',
      description: '新說明',
      due_date: '2026-12-01',
      project_id: projectId,
      sprint_id: sprintId,
    });
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2' });
    for (const e of await events()) {
      const r = await call('POST', `/api/issues/NX-1/events/${String(e.id)}/revert`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const issue = (await call('GET', '/api/issues/NX-1')).body;
    expect(issue).toMatchObject({ title: '舊標題', description: '舊說明', due_date: null, project_id: null, sprint_id: null, blocked_by: [] });
    const all = await events();
    expect(all).toHaveLength(12);
    expect(all.slice(0, 6).every((e) => e.reverted_by_event_id !== null)).toBe(true);
    expect(all.slice(6).map((e) => e.actor)).toEqual(Array(6).fill('api'));
  });

  it('還原移除的 blocked by 會加回來', async () => {
    await newIssue();
    await newIssue();
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2' });
    await call('DELETE', '/api/issues/NX-1/blockers/NX-2');
    const removed = (await events())[1];
    expect((await call('POST', `/api/issues/NX-1/events/${String(removed?.id)}/revert`)).status).toBe(200);
    expect(((await call('GET', '/api/issues/NX-1')).body.blocked_by as Json[]).map((b) => b.number)).toEqual([2]);
  });

  it('已經還原過回 409', async () => {
    await newIssue();
    await call('PATCH', '/api/issues/NX-1', { status: 'Todo' });
    const id = String((await events())[0]?.id);
    expect((await call('POST', `/api/issues/NX-1/events/${id}/revert`)).status).toBe(200);
    const again = await call('POST', `/api/issues/NX-1/events/${id}/revert`);
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('已經');
    expect(again.body.reverted_by_event_id).toBeTypeOf('number');
  });

  it('之後同一個欄位又被改過回 409 並說明；別的欄位改過不影響', async () => {
    await newIssue();
    await call('PATCH', '/api/issues/NX-1', { status: 'Todo' });
    await call('PATCH', '/api/issues/NX-1', { title: '別的欄位' });
    await call('PATCH', '/api/issues/NX-1', { status: 'In Progress', actor: '阿澈' });
    const [first, , third] = await events();
    const r = await call('POST', `/api/issues/NX-1/events/${String(first?.id)}/revert`);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain(`第 ${String(third?.id)} 筆`);
    expect(r.body.error).toContain('阿澈');
    expect(r.body.conflict_event_id).toBe(third?.id);
    expect((await call('GET', '/api/issues/NX-1')).body.status).toBe('In Progress');
    // 先還原後面那筆，就可以再還原前面那筆（像連按兩次復原）。
    expect((await call('POST', `/api/issues/NX-1/events/${String(third?.id)}/revert`)).status).toBe(200);
    expect((await call('POST', `/api/issues/NX-1/events/${String(first?.id)}/revert`)).status).toBe(200);
    expect((await call('GET', '/api/issues/NX-1')).body).toMatchObject({ status: 'Backlog', title: '別的欄位' });
  });

  it('blocked by 只看同一張擋住的票', async () => {
    await newIssue();
    await newIssue();
    await newIssue();
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-2' });
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-3' });
    const [first] = await events();
    expect((await call('POST', `/api/issues/NX-1/events/${String(first?.id)}/revert`)).status).toBe(200);
    await call('DELETE', '/api/issues/NX-1/blockers/NX-3');
    await call('POST', '/api/issues/NX-1/blockers', { blocked_by: 'NX-3' });
    const second = (await events())[1];
    expect((await call('POST', `/api/issues/NX-1/events/${String(second?.id)}/revert`)).status).toBe(409);
  });

  it('找不到的紀錄、別張票的紀錄回 404', async () => {
    await newIssue();
    await newIssue();
    await call('PATCH', '/api/issues/NX-2', { status: 'Todo' });
    const id = String((await events('NX-2'))[0]?.id);
    expect((await call('POST', `/api/issues/NX-1/events/${id}/revert`)).status).toBe(404);
    expect((await call('POST', '/api/issues/NX-1/events/999/revert')).status).toBe(404);
    expect((await call('POST', '/api/issues/NX-1/events/abc/revert')).status).toBe(404);
    expect((await call('GET', `/api/issues/NX-2/events/${id}/revert`)).status).toBe(405);
  });
});

describe('封存（NX-160，不做永久刪除）', () => {
  it('PATCH archived: true 封存、寫變更紀錄；列表預設不含，archived=only／include 查得到；單張照樣查得到', async () => {
    await newIssue({ title: '留著' });
    await newIssue({ title: '要封存' });
    const res = await call('PATCH', '/api/issues/NX-2', { archived: true, actor: 'Bolas' });
    expect(res.status).toBe(200);
    expect(typeof res.body.archived_at).toBe('string');
    expect(numbers((await call('GET', '/api/issues')).body)).toEqual([1]);
    expect(numbers((await call('GET', '/api/issues?archived=only')).body)).toEqual([2]);
    expect(numbers((await call('GET', '/api/issues?archived=include')).body).sort()).toEqual([1, 2]);
    expect((await call('GET', '/api/issues/NX-2')).body).toMatchObject({ title: '要封存', archived_at: res.body.archived_at });
    expect((await call('GET', '/api/issues/NX-1')).body).toMatchObject({ archived_at: null });
    const { events } = (await call('GET', '/api/issues/NX-2/events')).body as { events: Json[] };
    expect(events).toEqual([expect.objectContaining({ field: 'archived', from_value: null, to_value: res.body.archived_at, actor: 'Bolas' })]);
  });

  it('再封存一次不變、不寫紀錄；archived: false 取消封存並寫紀錄', async () => {
    await newIssue();
    const first = (await call('PATCH', '/api/issues/NX-1', { archived: true })).body;
    expect((await call('PATCH', '/api/issues/NX-1', { archived: true })).body.archived_at).toBe(first.archived_at);
    const back = await call('PATCH', '/api/issues/NX-1', { archived: false });
    expect(back.body.archived_at).toBeNull();
    const { events } = (await call('GET', '/api/issues/NX-1/events')).body as { events: Json[] };
    expect(events.map((e) => [e.field, e.from_value === null, e.to_value === null])).toEqual([
      ['archived', true, false],
      ['archived', false, true],
    ]);
    expect(numbers((await call('GET', '/api/issues')).body)).toEqual([1]);
  });

  it('封存可以用還原改回來（復原），還原的那筆也能再還原', async () => {
    await newIssue();
    await call('PATCH', '/api/issues/NX-1', { archived: true });
    const ev = ((await call('GET', '/api/issues/NX-1/events')).body.events as Json[])[0] as Json;
    const r = await call('POST', `/api/issues/NX-1/events/${String(ev.id)}/revert`, { actor: 'Bolas' });
    expect(r.status).toBe(200);
    expect((r.body.issue as Json).archived_at).toBeNull();
    expect(numbers((await call('GET', '/api/issues')).body)).toEqual([1]);
    const again = await call('POST', `/api/issues/NX-1/events/${String((r.body.event as Json).id)}/revert`);
    expect((again.body.issue as Json).archived_at).toBe(ev.to_value);
  });

  it('archived 不是 true／false、列表的 archived 參數錯誤回 400', async () => {
    await newIssue();
    expect((await call('PATCH', '/api/issues/NX-1', { archived: 'yes' })).status).toBe(400);
    expect((await call('GET', '/api/issues?archived=all')).status).toBe(400);
    expect((await call('GET', '/api/issues/NX-1')).body.archived_at).toBeNull();
  });
});
