// 「人」的名字（NX-244）：網頁上的 comment 作者、移票紀錄的 actor 都用這個名字；
// 只有這個名字在待驗收的票寫 comment 才會把票交回 agent（issues.ts 的 handBackToAgent）。
// Worker 用 wrangler vars `OWNER_NAME`，Node 自架用環境變數 `NEXTLINE_OWNER_NAME`；沒設定就是預設值。
// 前端從 GET /app-api/owner 拿（app/src/owner/owner.ts）。
// 公開版預設用中性的「你」；自己架的人設成自己的名字。
export const DEFAULT_OWNER_NAME = '你';

export interface OwnerEnv {
  OWNER_NAME?: string | undefined;
}

export function ownerName(env: OwnerEnv): string {
  const name = env.OWNER_NAME?.trim();
  return name === undefined || name === '' ? DEFAULT_OWNER_NAME : name;
}
