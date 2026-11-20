# 共用核心與資料庫契約（NX-193）

同一套 API／MCP 邏輯可接 Workers D1 或 Node SQLite。NX-193 提供轉接與路由組裝，NX-194 提供 Node server、獨立登入與初始化，NX-195 提供備份、還原與更新驗證。直接自架的啟動指令見 [README](../README.md)，操作維護見 [自架文件](self-host.md)。Cloudflare 跑法的設定見 [驗證方式](auth.md)。

```text
Worker 入口 worker/index.ts
  ├─ D1Adapter → D1 binding
  ├─ Access、CSRF、ASSETS
  └─ routeRequest（標準 Request／Response）
       ├─ health／legacy
       ├─ API → worker/api（任務與 SQL）
       ├─ MCP → worker/mcp → 同一套 API 函式
       └─ browserApi／page → 入口提供的驗證與靜態檔 handler

Node 入口 node/main.ts
  ├─ SqliteAdapter → node:sqlite DatabaseSync
  ├─ 自架登入、CSRF、靜態檔（NX-194）
  └─ 同一個 routeRequest
```

## 邊界

- `worker/core/database.ts` 是專案自己的最小 SQL 契約，不是 D1 型別別名。現有 API／MCP 仍放在原路徑，以降低搬移與前端共用模組的變動。
- 共用入口 `worker/core/router.ts` 只依賴標準 Web API；`browserApi` 與 `page` 必須由入口明確注入，沒有跳過驗證的預設值。
- `worker/adapters/d1.ts` 才知道 `D1Database`／`D1PreparedStatement`。Worker 的 Access 與 ASSETS 留在既有入口組裝層。
- `worker/adapters/sqlite.ts` 才依賴 `node:sqlite`。呼叫方負責開關連線及 migrations；轉接啟用外鍵與 5 秒 busy timeout。`node/database.ts` 管理資料目錄、WAL、版本與交易初始化，`node/backup.ts` 管理一致性備份及還原。
- `worker/core/tsconfig.json` 用標準 DOM 型別編譯整個核心相依圖；`core-boundary.test.ts` 追蹤程式匯入與識別字，防止引入環境專屬模組或型別。

## 資料契約

`prepare`、不可變的 `bind`、`first`、`all`、`run`、`batch` 僅涵蓋現有使用方式。

| 項目 | 契約 |
| --- | --- |
| 參數 | 字串、有限數字、null；其他型別拒絕 |
| `first<T>()` | 第一列或 null；指定 column 可取單欄，沒有該欄為 query error |
| `all<T>()`／`run<T>()` | `{ success: true, results: T[], meta: { changes, last_row_id } }`；支援 `RETURNING` |
| 查無資料 | first 為 null，results 為空陣列 |
| meta | changes 是本次執行的實際變更數，讀取為 0；last_row_id 是該連線 SQLite 的最近 insert rowid。duration、region、rows_read 等環境遙測不屬於核心契約 |
| 資料錯誤 | `DatabaseError`：unique、foreign_key、check、not_null、query；錯誤訊息在兩種轉接正規化，既有 API／MCP 中文錯誤與 HTTP 狀態不變 |
| batch | 順序執行、整批交易、任一句失敗全部回滾且不執行後續語句；空批次回空陣列；不能混用另一個資料庫的 statement |

SQLite batch 使用 `BEGIN IMMEDIATE`／`COMMIT`／`ROLLBACK`，同步執行期間不 await，避免同一連線的另一個請求插進交易。D1 直接使用 binding 的 batch 交易。此契約不把整個含多次讀取／多批次寫入的 HTTP 或 MCP 呼叫宣稱為單一交易，也不在本票改寫既有業務的並行控制。

## 重跑驗證

```sh
npm run verify
npm run build
```

`verify` 包含一般測試與 `npm run test:d1`。API／MCP 原有 77 個案例與資料契約 13 個案例使用同一份測試，分別跑：

- 一般測試：正式 `SqliteAdapter` ＋ Node SQLite，使用全部既有 migrations。
- `test:d1`：正式 `D1Adapter` ＋ Miniflare 啟動的真正 workerd D1 binding，使用相同 migrations；不是 `worker/test/d1.ts` 的 SQLite 假 D1。
- `worker/test/d1.ts` 的舊假 D1 僅保留給 Worker 路由／Access／schema 回歸測試；不當成雙環境證據。

契約案例包含 meta、scalar／null、錯誤、外鍵、batch RETURNING、跨連線拒絕、批次中段失敗與恢復、API 多欄位 PATCH 寫第二筆 event 失敗時整批撤回，以及同時提交成功／失敗 batches 後票與 history 一致。

Worker 本機端對端流程沿用 `scripts/e2e/core-flow.mjs`：每次建立獨立本機 D1，建置／啟動 Worker，在 Chrome 引擎操作開票、拖拉、通過與復原，保留畫面及 API 查核。這些測試不呼叫正式站，不部署，不做遠端 migration。

## 依據

- [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)：有序交易，語句失敗時整批回滾。
- [Node 22 SQLite](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)：DatabaseSync、prepared statements、changes 與 lastInsertRowid。此機實測 Node 22.23.4，型別使用 @types/node 22.20.5。
- [SQLite total_changes](https://www.sqlite.org/c3ref/total_changes.html)：比較執行前後的變更計數，避免純 SELECT 沿用上一筆 changes()。
