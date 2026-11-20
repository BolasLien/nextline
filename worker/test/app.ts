import type { ApiEnv } from '../api';
import { routeRequest } from '../core/router';

export type TestEnv = ApiEnv;
// API/MCP tests target the portable router. Worker-specific auth/static routes
// remain covered separately by routes.test.ts and web.test.ts.
export const testApp = {
  fetch(request: Request, env: TestEnv): Promise<Response> {
    return routeRequest(request, env, {
      browserApi: () => Promise.resolve(new Response(null, { status: 401 })),
      page: () => Promise.resolve(new Response(null, { status: 403 })),
    });
  },
};
