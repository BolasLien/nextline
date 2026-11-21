// 前端唯一的 API client。打 /app-api（瀏覽器的 Cloudflare Access JWT，見 docs/auth.md），
// 路徑、參數、回應跟 agent 用的 /api 一樣（docs/api.md），所以後端每加一個功能，人和 agent 同時拿到。
//
// 錯誤統一變成 ApiError：
// - 401：Access 登入過期（或還沒登入）。呼叫 onUnauthorized，讓畫面請 Bolas 重新整理登入。
//   請求帶 X-Requested-With: XMLHttpRequest，Access 在 session 過期時會回 401 而不是轉址到登入頁：
//   https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#ajax
//   萬一還是被轉址（redirect: 'manual' 會拿到 opaqueredirect），也當成 401。
// - 連不上（fetch 丟例外）：status 0，訊息說網路的問題。
// - 其他：用 API 回的 { error } 當訊息；409 等的額外欄位放在 extra。
import type {
  Blockers,
  Comment,
  IssueCreate,
  IssueDetail,
  IssueEvent,
  IssueList,
  IssueListQuery,
  IssueUpdate,
  Owner,
  Project,
  ProjectCreate,
  ProjectUpdate,
  RevertResult,
  Sprint,
  SprintCreate,
  SprintUpdate,
} from './types';

export const APP_API_BASE = '/app-api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export const MESSAGES = {
  unauthorized: '登入已過期。請重新整理頁面並登入。',
  network: '無法連線到 Nextline：連線中斷。恢復連線後請再試一次。',
  unknown: '伺服器錯誤。請稍後再試。',
} as const;

type Query = Record<string, string | number | readonly (string | number)[] | undefined>;

export interface ApiClientOptions {
  base?: string;
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
}

function buildQuery(query: Query | undefined): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 不是 JSON（例如邊緣回的 HTML）就用預設訊息
  }
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const { error, ...extra } = body as Record<string, unknown>;
    if (typeof error === 'string' && error !== '') return new ApiError(res.status, error, extra);
  }
  return new ApiError(res.status, res.status === 401 ? MESSAGES.unauthorized : MESSAGES.unknown);
}

export function createApiClient(options: ApiClientOptions = {}) {
  const base = options.base ?? APP_API_BASE;
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    const init: RequestInit = { method, headers, credentials: 'same-origin', redirect: 'manual' };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}${buildQuery(opts.query)}`, init);
    } catch {
      throw new ApiError(0, MESSAGES.network);
    }
    if (res.type === 'opaqueredirect' || res.status === 401) {
      options.onUnauthorized?.();
      throw res.status === 401 ? await errorFrom(res) : new ApiError(401, MESSAGES.unauthorized);
    }
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as T;
  }

  return {
    // 網頁上的人是誰（NX-244，app/src/owner/owner.ts）
    getOwner: () => request<Owner>('GET', '/owner'),
    // 票
    listIssues: (q: IssueListQuery = {}) =>
      request<IssueList>('GET', '/issues', {
        query: {
          status: q.status,
          project: q.project,
          sprint: q.sprint,
          sort: q.sort,
          updated_since: q.updated_since,
          updated_before: q.updated_before,
          archived: q.archived,
          limit: q.limit,
          offset: q.offset,
        },
      }),
    getIssue: (ref: string) => request<IssueDetail>('GET', `/issues/${seg(ref)}`),
    createIssue: (body: IssueCreate) => request<IssueDetail>('POST', '/issues', { body }),
    updateIssue: (ref: string, body: IssueUpdate) => request<IssueDetail>('PATCH', `/issues/${seg(ref)}`, { body }),
    listIssueEvents: (ref: string) => request<{ events: IssueEvent[] }>('GET', `/issues/${seg(ref)}/events`),
    revertIssueEvent: (ref: string, eventId: number, actor?: string) =>
      request<RevertResult>('POST', `/issues/${seg(ref)}/events/${seg(eventId)}/revert`, { body: actor === undefined ? {} : { actor } }),

    // blocked by
    listBlockers: (ref: string) => request<Blockers>('GET', `/issues/${seg(ref)}/blockers`),
    addBlocker: (ref: string, blockedBy: string, actor?: string) =>
      request<Blockers>('POST', `/issues/${seg(ref)}/blockers`, { body: actor === undefined ? { blocked_by: blockedBy } : { blocked_by: blockedBy, actor } }),
    removeBlocker: (ref: string, blockerRef: string, actor?: string) =>
      request<Blockers>('DELETE', `/issues/${seg(ref)}/blockers/${seg(blockerRef)}`, { query: { actor } }),

    // comment
    listComments: (ref: string) => request<{ comments: Comment[] }>('GET', `/issues/${seg(ref)}/comments`),
    createComment: (ref: string, body: { author: string; body: string }) =>
      request<Comment>('POST', `/issues/${seg(ref)}/comments`, { body }),
    getComment: (id: number) => request<Comment>('GET', `/comments/${seg(id)}`),
    updateComment: (id: number, body: string) => request<Comment>('PATCH', `/comments/${seg(id)}`, { body: { body } }),

    // Project
    listProjects: () => request<{ projects: Project[] }>('GET', '/projects'),
    getProject: (id: number) => request<Project>('GET', `/projects/${seg(id)}`),
    createProject: (body: ProjectCreate) => request<Project>('POST', '/projects', { body }),
    updateProject: (id: number, body: ProjectUpdate) => request<Project>('PATCH', `/projects/${seg(id)}`, { body }),

    // Sprint
    listSprints: () => request<{ sprints: Sprint[] }>('GET', '/sprints'),
    getSprint: (id: number) => request<Sprint>('GET', `/sprints/${seg(id)}`),
    createSprint: (body: SprintCreate) => request<Sprint>('POST', '/sprints', { body }),
    updateSprint: (id: number, body: SprintUpdate) => request<Sprint>('PATCH', `/sprints/${seg(id)}`, { body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
