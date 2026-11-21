// 網頁上的「人」是誰（NX-244）：comment 作者、移票等變更紀錄的 actor 都用伺服器設定的名字
// （GET /app-api/owner，見 worker/api/owner.ts）。後端只把這個名字的 comment 當成人在回覆待驗收的票。
// App 一開就抓一次（api/ApiProvider.tsx）；還沒抓到或抓失敗時用預設值，跟伺服器沒設定時相同。
import type { ApiClient } from '../api/client';
import { DEFAULT_OWNER_NAME } from '../../../worker/api/owner';

let current = DEFAULT_OWNER_NAME;

export function actor(): string {
  return current;
}

export async function loadOwner(api: Pick<ApiClient, 'getOwner'>): Promise<void> {
  try {
    const name = (await api.getOwner()).name.trim();
    if (name !== '') current = name;
  } catch {
    // 抓不到就沿用目前的名字（預設值）；下次開 App 再抓
  }
}

// 測試用：還原成預設值
export function resetOwner(): void {
  current = DEFAULT_OWNER_NAME;
}
