import type { Database } from '../core/database';
// /api/* 路由。路徑與參數清單見 docs/api.md；驗證方式見 docs/auth.md。
import { hasValidToken } from './auth';
import { errorResponse, parseId, toHttpError } from './http';
import {
  addBlocker,
  createComment,
  createIssue,
  getComment,
  getIssue,
  listBlockers,
  listComments,
  listEvents,
  listIssues,
  listRecentComments,
  removeBlocker,
  revertEvent,
  updateComment,
  updateIssue,
} from './issues';
import { createProject, getProject, listProjects, updateProject } from './projects';
import { createSprint, getSprint, listSprints, updateSprint } from './sprints';

export interface ApiEnv {
  DB: Database;
  API_TOKEN?: string;
  API_TOKEN_SHA256?: string;
}

type Handler = () => Promise<Response>;
type Routes = Partial<Record<string, Handler>>;

export async function handleApi(request: Request, env: ApiEnv, url: URL): Promise<Response> {
  if (!(await hasValidToken(request, env.API_TOKEN, env.API_TOKEN_SHA256))) {
    return new Response(JSON.stringify({ error: '需要有效的 token（Authorization: Bearer <token>）' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    });
  }
  return routeApi(request, env.DB, url);
}

// 驗證過後的路由，/api（token）與 /app-api（瀏覽器的 Access JWT，見 ./browser.ts）共用同一套。
// 路徑的第一段（api 或 app-api）在 match 裡略過，所以兩邊的子路徑完全相同。
export async function routeApi(request: Request, db: Database, url: URL): Promise<Response> {
  try {
    const routes = match(request, db, url);
    if (routes === null) return errorResponse(404, '找不到這個 API 路徑');
    const handler = routes[request.method];
    if (handler === undefined) {
      return new Response(JSON.stringify({ error: '不支援這個方法' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: Object.keys(routes).join(', ') },
      });
    }
    return await handler();
  } catch (e) {
    const err = toHttpError(e);
    if (err !== null) return errorResponse(err.status, err.message, err.extra);
    throw e;
  }
}

function match(request: Request, db: Database, url: URL): Routes | null {
  const parts = url.pathname
    .replace(/\/+$/, '')
    .split('/')
    .slice(2)
    .map(safeDecode);
  if (parts.includes(null)) return null;
  const [resource, id, sub, subId, action] = parts as string[];

  switch (resource) {
    case 'issues':
      if (id === undefined) {
        return { GET: () => listIssues(db, url), POST: () => createIssue(db, request) };
      }
      if (sub === undefined) {
        return { GET: () => getIssue(db, id), PATCH: () => updateIssue(db, id, request) };
      }
      if (parts.length === 3 && sub === 'comments') {
        return { GET: () => listComments(db, id), POST: () => createComment(db, id, request) };
      }
      if (parts.length === 3 && sub === 'events') {
        return { GET: () => listEvents(db, id) };
      }
      if (parts.length === 5 && sub === 'events' && subId !== undefined && action === 'revert') {
        return { POST: () => revertEvent(db, id, parseId(subId, '變更紀錄'), request) };
      }
      if (sub === 'blockers') {
        if (parts.length === 3) return { GET: () => listBlockers(db, id), POST: () => addBlocker(db, id, request) };
        if (parts.length === 4 && subId !== undefined) {
          return { DELETE: () => removeBlocker(db, id, subId, url.searchParams.get('actor') ?? 'api') };
        }
      }
      return null;
    case 'comments':
      if (id === undefined) return { GET: () => listRecentComments(db, url) };
      if (parts.length !== 2) return null;
      return {
        GET: () => getComment(db, parseId(id, ' comment')),
        PATCH: () => updateComment(db, parseId(id, ' comment'), request),
      };
    case 'projects':
      if (id === undefined) return { GET: () => listProjects(db), POST: () => createProject(db, request) };
      if (parts.length !== 2) return null;
      return {
        GET: async () => Response.json(await getProject(db, parseId(id, ' Project'))),
        PATCH: () => updateProject(db, parseId(id, ' Project'), request),
      };
    case 'sprints':
      if (id === undefined) return { GET: () => listSprints(db), POST: () => createSprint(db, request) };
      if (parts.length !== 2) return null;
      return {
        GET: async () => Response.json(await getSprint(db, parseId(id, ' Sprint'))),
        PATCH: () => updateSprint(db, parseId(id, ' Sprint'), request),
      };
    default:
      return null;
  }
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
