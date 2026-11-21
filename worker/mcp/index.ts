import type { Database } from '../core/database';
// /mcp：遠端 MCP（Streamable HTTP）。驗證與 /api 相同（docs/auth.md），工具清單與跟 Linear MCP 的差異見 docs/mcp.md。
// 無狀態模式：每個請求建一個新的 server 與 transport，回 JSON（不開 SSE），Worker 不用記 session。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { hasValidToken } from '../api/auth';
import { ownerName } from '../api/owner';
import { registerTools } from './tools';

export interface McpEnv {
  DB: Database;
  API_TOKEN?: string;
  API_TOKEN_SHA256?: string;
  OWNER_NAME?: string;
}

export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  if (!(await hasValidToken(request, env.API_TOKEN, env.API_TOKEN_SHA256))) {
    return new Response(JSON.stringify({ error: '需要有效的 token（Authorization: Bearer <token>）' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    });
  }
  // 無狀態：沒有可以接續的 SSE 串流（GET）或要關掉的 session（DELETE）。規格允許這時回 405。
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '只支援 POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST' },
    });
  }
  const server = new McpServer({ name: 'nextline', version: '0.1.0' });
  registerTools(server, env.DB, ownerName(env));
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
