# Nextline API（`/api/*`）

網頁、MCP 和搬家腳本都透過這套 API 讀寫資料。

- 每個請求都要帶 `Authorization: Bearer <token>`，Worker 比對 secret `API_TOKEN`（見 `docs/auth.md`）。沒帶、帶錯或 Worker 沒設 `API_TOKEN`，一律回 `401`。
- 網頁（`app/` 的 React App）打 `/app-api/*`：底下的路徑、參數、回應跟本頁完全相同，只是改驗 Cloudflare Access 的登入（不收 token），寫入要同源（見 `docs/auth.md`「瀏覽器怎麼呼叫 API」）。前端的 client 在 `app/src/api/client.ts`。
- 請求與回應都是 JSON。錯誤格式：`{ "error": "說明" }`；`409` 會多帶已存在資料的 `id`（票是 `number`、`identifier`），方便搬家腳本重跑時接續。
- 時間是 ISO 8601（例如 `2026-11-02T08:29:53.024Z`），存進去前一律轉成 UTC 的 `toISOString()` 格式；日期（`due_date`）是 `YYYY-MM-DD`。
- Node 自架：依 [README](../README.md) 初始化與產生 token，API 網址為 `http://127.0.0.1:3000/api/*`；網頁的 `/app-api/*` 改驗本機 session，API 契約相同。Cloudflare 本機測試：`.dev.vars` 放一行 `API_TOKEN=<自己定的值>`，`npm run dev:cloudflare` 後用 `curl -H "Authorization: Bearer <值>" localhost:8787/api/issues`。

## 票的參照 `:ref`

`NX-12`、`12` 都是 NX 編號；其他「字母-數字」（例如 `ABC-150`）當成搬過來的舊編號查。不分大小寫。

## 票

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /api/issues` | 列表，預設依 `updated_at` 新到舊 |
| `POST /api/issues` | 新增，自動編號 `NX-<n>`，回 `201` |
| `GET /api/issues/:ref` | 單張票，含 `blocked_by`、`blocks` |
| `PATCH /api/issues/:ref` | 修改，只改有帶的欄位；也用來調整看板順序 |
| `GET /api/issues/:ref/events` | 變更紀錄（所有欄位），舊到新 |
| `POST /api/issues/:ref/events/:id/revert` | 還原第 `:id` 筆變更（見下面「變更紀錄與還原」） |

狀態依看板欄的順序：`Backlog`、`Todo`、`In Progress`、`In Review`（介面顯示「待驗收」）、`Done`、`Canceled`。沒做完的票是前四種。

列表參數（可以組合）：

| 參數 | 說明 |
| --- | --- |
| `status` | 上面六種；可重複（`status=Todo&status=Done`）或逗號分隔 |
| `sort` | `updated`（預設，`updated_at` 新到舊）或 `position`（看板順序：先依狀態欄，欄內 `position` 小的在上） |
| `project` | Project id；`none` 代表沒有 Project |
| `sprint` | Sprint id；`none` 代表沒有 Sprint |
| `updated_since` | `updated_at >=` 這個時間 |
| `updated_before` | `updated_at <` 這個時間 |
| `archived` | 封存（NX-160）：沒帶（或 `exclude`）不含已封存的票；`include` 都要；`only` 只要已封存的 |
| `limit`、`offset` | 分頁，`limit` 預設 50、最多 200；回應的 `has_more` 表示後面還有 |

回應：`{ "issues": [...], "limit": 50, "offset": 0, "has_more": false }`。

票的欄位：`number`、`identifier`（`NX-<n>`）、`legacy_identifier`、`title`、`description`、`status`、`position`、`project_id`、`sprint_id`、`due_date`、`created_at`、`updated_at`、`completed_at`、`canceled_at`、`archived_at`、`next_step`。

- `archived_at`：封存時間，沒封存是 `null`（NX-160）。單張票（`GET /api/issues/:ref`）不管有沒有封存都查得到。

- `next_step`：最新一則 comment 裡「下一步：」後面的文字（`worker/web/classify.ts` 的 `extractNextStep`）；沒有 comment、或最新那則沒寫「下一步：」就是 `null`。只能讀，看板卡片用它顯示下一步。
- 原本的 `zone`（三區歸類）在 NX-160（2026-11-03）拿掉：三區是 Bolas 晨報的邏輯，不放進產品。列表、單張、`PATCH` 與還原的回應都不再有這個欄位；網頁側欄「等你」改成待驗收（`In Review`）的票。

`POST` 內容：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `title` | 是 | |
| `description` | | Markdown，預設空字串 |
| `status` | | 預設 `Backlog` |
| `project_id`、`sprint_id` | | 不存在回 `400` |
| `due_date` | | `YYYY-MM-DD` |
| `position`、`before`、`after` | | 看板位置，見下面「看板排序」；沒帶就放在那一欄最上面 |
| `legacy_identifier` | | 搬家用，例如 `ABC-150`；已存在回 `409` |
| `created_at`、`updated_at`、`completed_at`、`canceled_at` | | 搬家用，保留 Linear 的時間；沒帶就用現在（`Done`／`Canceled` 會自動填完成／取消時間） |

`PATCH` 內容：`title`、`description`、`status`、`project_id`（`null` 移出）、`sprint_id`（`null` 移出）、`due_date`（`null` 清掉）、`archived`（`true` 封存、`false` 取消封存）、`position`／`before`／`after`（看板位置），以及 `actor`（誰改的，寫進變更紀錄，預設 `api`）。

- 每個值真的有變的欄位各寫一筆 `issue_events`；與修改同一個 batch，不會只改一半。
- 改成 `Done` 填 `completed_at`、改成 `Canceled` 填 `canceled_at`，改成其他狀態就清掉。
- 有欄位變動才更新 `updated_at`；只改位置不更新、也不寫變更紀錄。
- 新增票不寫變更紀錄（起始值看 `created_at` 與票本身）。

### 看板排序

同一欄（同一個狀態）裡 `position` 小的在上。三種指定方式，一次只能帶一個（帶兩個以上回 `400`）：

| 欄位 | 說明 |
| --- | --- |
| `before` | 放在這張票的上面（票號，例如 `"NX-3"`） |
| `after` | 放在這張票的下面 |
| `position` | 直接給整數 |

- 新票、換欄（改 `status`）又沒指定位置時，放到那一欄最上面。換欄同時帶 `before`／`after`，就放到新欄的那個位置。
- `before`／`after` 的票要在同一欄（換欄時是新的那一欄），否則回 `400`；指定自己、或票不存在也回 `400`。
- 做法：整數、間隔 1024。插到兩張中間取中間值；兩張相差不到 2 時，先把整欄重新編號成 1024、2048、…（順序不變）再算。選整數間隔而不是 fractional index（字串）的理由：SQL 直接用數字排序、不用另外裝套件、值看得懂；只有一個人和幾個 agent 在拖，偶爾重新編號一欄（最多幾十張）成本很低。

### 封存

不做永久刪除（NX-160，2026-11-04 Bolas）：不要的票用 `PATCH { "archived": true }` 封存，看板、列表、Project 頁、側欄張數都不算它；`{ "archived": false }` 取消封存。

- 選 `PATCH` 的 `archived` 欄位、不另開 `/archive`、`/unarchive`：封存跟其他欄位走同一條寫入流程，自動寫變更紀錄（`field = archived`）、能用下面的還原改回來；MCP 的 `save_issue` 也只要多一個參數。
- 已經封存再送 `archived: true` 不變（不改 `archived_at`、不寫紀錄）；取消封存也一樣。
- 封存不改狀態與看板位置；取消封存後回到原本那一欄原本的位置。
- `archived` 不是 `true`／`false` 回 `400`。新增票帶 `archived` 會被忽略（開好再封存）。

## 變更紀錄與還原

`GET /api/issues/:ref/events` 回 `{ "events": [...] }`，每筆：

| 欄位 | 說明 |
| --- | --- |
| `id` | 第幾筆 |
| `field` | `title`、`description`、`status`、`project`、`sprint`、`due_date`、`blocked_by`、`archived` |
| `from_value`、`to_value` | 舊值、新值，都是文字，`null` 代表空。`status` 是狀態名；`project`、`sprint` 是 id；`blocked_by` 是擋住這張票的票號數字（加入 `null` → `"3"`，移除 `"3"` → `null`）；`archived` 是封存時間（封存 `null` → 時間，取消封存 時間 → `null`） |
| `actor` | 誰改的 |
| `revert_of_event_id` | 這筆是「還原了第 N 筆」時的 N，平常是 `null` |
| `reverted_by_event_id` | 這筆已經被還原時，是還原它的那一筆；沒還原是 `null` |
| `created_at` | |

`POST /api/issues/:ref/events/:id/revert`：把第 `:id` 筆的欄位改回 `from_value`，寫一筆 `revert_of_event_id = :id` 的新紀錄，並把第 `:id` 筆標成已還原（同一個 batch）。內容可以不帶，或帶 `{ "actor": "Bolas" }`（預設 `api`）。

- 成功回 `200`：`{ "issue": 還原後的票, "event": 新寫的那筆, "reverted_event": 被還原的那筆 }`。
- 還原狀態跟一般改狀態一樣：`completed_at`／`canceled_at` 會跟著改，票放到那一欄最上面。
- `404`：票不存在，或那筆紀錄不屬於這張票。
- `409`（`error` 寫原因）：
  - 已經還原過，多帶 `reverted_by_event_id`。
  - 之後同一個欄位又被改過（`blocked_by` 只看同一張擋住的票），多帶 `conflict_event_id`。已經被還原掉的變更、以及「還原」本身不算，所以先還原後面那筆，就能再還原前面那筆（像連按兩次復原）。
  - 欄位現在的值已經不是那筆改完的值。

## blocked by

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /api/issues/:ref/blockers` | `{ "blocked_by": [...], "blocks": [...] }` |
| `POST /api/issues/:ref/blockers` | 內容 `{ "blocked_by": "NX-3", "actor": "阿澈" }`（也可以用舊編號或數字；`actor` 預設 `api`）；新加入回 `201`，已存在回 `200` |
| `DELETE /api/issues/:ref/blockers/:blockerRef` | 移除；本來就沒有回 `404`。誰移除的用 `?actor=` 帶 |

擋自己、或 `blocked_by` 的票不存在，回 `400`。有變動時在被擋住的那張票寫一筆 `blocked_by` 變更紀錄。

## workspace

所有主要資料表（`issues`、`comments`、`issue_events`、`issue_blockers`、`projects`、`sprints`）都有 `workspace_id`，目前固定是 `1`（`workspaces` 表只有一筆）。API 還不收也不回這個欄位，行為跟以前一樣。

## 人（owner）

`GET /api/owner`：回 `{ "name": "你" }`，網頁上那個人的名字（NX-244）。網頁寫 comment 的 `author`、改票的 `actor` 都用它，comment 交回 agent（見下面 comment）也只認這個名字。Worker 用 wrangler vars `OWNER_NAME`、Node 自架用環境變數 `NEXTLINE_OWNER_NAME` 設定，沒設定是 `你`（`worker/api/owner.ts`）。

## comment

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /api/issues/:ref/comments` | 依 `created_at` 舊到新 |
| `POST /api/issues/:ref/comments` | 內容 `author`（必填，誰寫的）、`body`（必填）、`linear_id`、`created_at`、`updated_at`（後三個搬家用）；`linear_id` 重複回 `409`。票在 `In Review` 而 `author` 是人（`GET /api/owner` 的名字，預設 `你`）時，票同時移到 `In Progress`，寫一筆 `status` 變更紀錄（`actor` 是那個名字，可還原）；agent 的 `author`（`阿澈`、`<repo> agent`、`mcp`、`api` 等）、帶 `linear_id` 的搬家資料、其他狀態的票都不動狀態（NX-221）。回傳仍是 comment |
| `GET /api/comments?created_since=<ISO>` | 跨所有票列出這個時間（含）之後新增的 comment（NX-206），不論票的狀態，Done、Canceled、已封存的票都列。`created_since` 必填；`created_before`（不含）選填；`limit`（預設 50，最多 200）、`offset` 分頁。依 `created_at` 舊到新（同時間照 `id`）。回 `{ "comments": [...], "limit", "offset", "has_more" }`，每則是 comment 的欄位再加 `identifier`（票號 `NX-<n>`）。看的是新增時間：修改 comment 不會讓它出現在這裡 |
| `GET /api/comments/:id` | 單則 |
| `PATCH /api/comments/:id` | 內容 `body` |

## Project

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /api/projects` | 釘選的在最上面（彼此照 `pinned_at` 新到舊），其餘照 `last_activity_at` 新到舊，同時間照名稱。Project 沒有狀態（NX-165），以前的 `?status=` 篩選拿掉，帶了也回全部 |
| `POST /api/projects` | 內容 `name`（必填、不可重複）、`description`、`linear_id`、`created_at`、`updated_at`。帶 `status` 會忽略（見下方） |
| `GET /api/projects/:id` | 單一 Project（含長篇 `description`） |
| `PATCH /api/projects/:id` | 內容 `name`、`description`、`pinned`（`true` 釘選、`false` 取消；已經是這個狀態就不動，也不改 `updated_at`） |

Project 的欄位：`id`、`name`、`description`、`linear_id`、`created_at`、`updated_at`、`pinned_at`（釘選時間，`null`＝沒釘選）、`last_activity_at`（NX-162：Project 的 `updated_at`、底下任一張票（含已封存）的 `updated_at`、底下任一張票最新 comment 的 `created_at`，取最新的一個；查詢時即時算，不能寫入）。

Project 沒有狀態（NX-165，2026-11-04 Bolas）：回傳沒有 `status`；`POST`／`PATCH` 帶 `status` 一律忽略、照常成功，不回 400。理由：舊的 agent、Skill 或照 Linear 習慣帶 status 的呼叫不會因此壞掉，而 status 已經沒有任何作用，丟掉不會讓資料錯。網頁側欄不看票的狀態：全部 Project 照這裡的順序（釘選的在前，其餘照 `last_activity_at`）取前 7 個（手機「更多」相同），其餘都在 `/projects` 找得到。

## Sprint

網頁不顯示 Sprint（2026-11-04 Bolas：產品不放 Sprint，NX-160）；API、MCP 與資料庫照舊保留，給阿澈的 Sprint 會議用。

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /api/sprints` | 依 `number` 新到舊 |
| `POST /api/sprints` | 內容 `number`（必填、不可重複）、`starts_at`、`ends_at`（必填，結束要晚於開始）、`name`、`linear_id`、`created_at` |
| `GET /api/sprints/:id` | 單一 Sprint |
| `PATCH /api/sprints/:id` | 內容 `name`、`starts_at`、`ends_at` |

## 不做

刪除票、Project、Sprint、comment（不要的票改成 `Canceled` 或封存）。
