# Nextline 遠端 MCP（`/mcp`）

給 Claude Code、Codex 讀寫 Nextline 的票。工具名稱和參數照 Linear MCP，Skill 換工具前綴（`mcp__linear__` → `mcp__nextline__`）就能用；不一樣的地方見最後一張表。

- 網址：Node 自架預設是 `http://127.0.0.1:3000/mcp`（部署到 HTTPS 或 Cloudflare 時換成自己的網址），Streamable HTTP，只收 `POST`（`GET`、`DELETE` 回 `405`）。
- 驗證跟 `/api` 一樣：`Authorization: Bearer <token>`，比對 secret `API_TOKEN`（見 `docs/auth.md`）。沒帶、帶錯或 Worker 沒設 `API_TOKEN`，回 `401`。
- 無狀態：不發 session id，每個請求各自處理，回 JSON（不開 SSE）。
- 實作：`worker/mcp/`，用官方 `@modelcontextprotocol/sdk` 的 `WebStandardStreamableHTTPServerTransport`；工具直接呼叫 `worker/api/` 的函式。
- 工具回傳：成功時 `content[0].text` 是 JSON；找不到、參數不對、名稱重複時 `isError: true`，`text` 是中文錯誤說明。

## 連線設定

token 只放環境變數 `NEXTLINE_API_TOKEN`（例如寫在 `~/.zshenv`），不要寫進設定檔、repo 或對話。值是 `npm run --silent selfhost:token` 印出的 token（Cloudflare 跑法則是 Worker 的 secret `API_TOKEN`）。

### Claude Code

用單引號，讓 `${NEXTLINE_API_TOKEN}` 原樣存進設定，連線時才由 Claude Code 展開（不會把 token 寫進 `~/.claude.json`）：

```sh
claude mcp add --transport http --scope user nextline http://127.0.0.1:3000/mcp \
  --header 'Authorization: Bearer ${NEXTLINE_API_TOKEN}'
```

或在專案的 `.mcp.json`：

```json
{
  "mcpServers": {
    "nextline": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${NEXTLINE_API_TOKEN}" }
    }
  }
}
```

確認：`claude mcp list` 看到 `nextline` 是 connected；工具名稱是 `mcp__nextline__list_issues` 等。

參考：https://code.claude.com/docs/en/mcp（`--header`、headers 的 `${VAR}` 展開）

### Codex

`~/.codex/config.toml`：

```toml
[mcp_servers.nextline]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "NEXTLINE_API_TOKEN"
```

Codex 會讀這個環境變數，自己加上 `Authorization: Bearer ...`。確認：`codex mcp list`。

參考：https://learn.chatgpt.com/docs/extend/mcp?surface=cli（`bearer_token_env_var`）

### 本機測試

Node 自架依 [README](../README.md) 初始化，`npm run --silent selfhost:token` 產生憑證，上面的範例網址就是 `npm start` 的預設；`npm run dev` 開發流程使用 `http://127.0.0.1:5173/mcp`。Node 不讀 `.dev.vars`。

Cloudflare 本機測試：`npm run dev:cloudflare` 前在 `.dev.vars` 放 `API_TOKEN=<自己定的值>`，網址改成 `http://localhost:8787/mcp`。

## 工具

票號參數（`id`、`issueId`、`blockedBy` 等）都收 `NX-12`、`12` 或舊編號 `BOL-150`，不分大小寫。回傳的票 `id` 一律是 `NX-<n>`，舊編號在 `legacyIdentifier`。

| 工具 | 參數 | 回傳 |
| --- | --- | --- |
| `list_issues` | `state`、`project`、`cycle`、`updatedAt`、`orderBy`、`includeArchived`、`limit`、`cursor`、`team`（忽略） | `{ issues, hasNextPage, cursor? }`，預設依更新時間新到舊，不含 `description`、不含已封存的票 |
| `get_issue` | `id`（必填） | 票的全部欄位，含 `description`、`position` 與 `relations.blockedBy`／`relations.blocks` |
| `save_issue` | `id`（帶了是修改）、`title`（新增必填）、`description`、`state`、`project`、`cycle`、`dueDate`、`before`、`after`、`position`、`blockedBy`、`removeBlockedBy`、`blocks`、`removeBlocks`、`archived`（只能修改時帶）、`actor`、`team`（忽略） | 存完的票（同 `get_issue`） |
| `list_issue_events` | `issueId`（必填） | `{ events }`，舊到新；每筆 `id`、`field`、`from`、`to`、`actor`、`revertOf`、`revertedBy`、`createdAt` |
| `revert_issue_event` | `issueId`、`eventId`（必填）、`actor` | `{ issue, event, revertedEvent }`：還原後的票、新寫的「還原了第 N 筆」、被還原的那筆 |
| `list_comments` | `issueId`（必填） | `{ comments }`，舊到新 |
| `save_comment` | `id`（帶了是修改）、`issueId`（新增必填）、`body`（必填）、`author` | 存完的 comment。新增時票在 In Review 而 `author` 是 `Bolas`，票同時移到 In Progress（寫進變更紀錄，可還原）；agent 的 `author` 不觸發（NX-221） |
| `list_recent_comments` | `createdAt`（必填）、`limit`、`cursor` | `{ comments, hasNextPage, cursor? }`：跨所有票這個時間（含）之後新增的 comment，舊到新，含 Done、Canceled、已封存的票；每則 `id`、`issueId`、`author`、`body`、`createdAt`、`updatedAt`（Nextline 自己的工具，NX-206） |
| `list_projects` | `query`、`state`（忽略）、`team`（忽略） | `{ projects }`，釘選的在最上面（照釘選時間新到舊），其餘照 `lastActivityAt` 新到舊，不含 `description`；每個有 `pinnedAt`（`null`＝沒釘選）與 `lastActivityAt`（Project、底下的票、底下票的 comment 最新時間） |
| `get_project` | `query`（必填，名稱或 id） | Project，含 `description` |
| `save_project` | `id`（名稱或 id，帶了是修改）、`name`（新增必填）、`description`、`pinned`（`true` 釘選、`false` 取消，只能修改時帶）、`state`（忽略） | 存完的 Project |
| `list_cycles` | `type`（`current`、`previous`、`next`）、`teamId`（忽略） | `{ cycles }`，依編號新到舊 |

參數細節：

- `state`（票）：`Backlog`、`Todo`、`In Progress`、`In Review`（待驗收）、`Done`、`Canceled`，或 Linear 的 state type（`backlog`、`unstarted`、`started`、`completed`、`canceled`），不分大小寫。新增預設 `Backlog`。`In Review` 的 type 跟 Linear 一樣是 `started`：`save_issue` 帶 `started` 存成 `In Progress`；`list_issues` 帶 `started` 會同時查 `In Progress` 與 `In Review`。列出沒做完的票用 `Backlog,Todo,In Progress,In Review`（以前查 `In Progress` 的 Skill 要檢查是否也要查 `In Review`）。
- `orderBy`：`updatedAt`（預設）或 `position`（看板順序：先依狀態欄，欄內由上到下）。
- `before`、`after`、`position`：看板位置，放在某張同一欄的票上面／下面，或直接給整數；一次只能帶一個。新票、換狀態又沒指定時放在那一欄最上面。細節見 `docs/api.md`「看板排序」。
- 變更紀錄：`save_issue` 改到的每個欄位（`title`、`description`、`status`、`project`、`sprint`、`due_date`、`blocked_by`、`archived`）各寫一筆，`actor` 是誰改的；看板位置不記。`revert_issue_event` 的失敗原因（已經還原過、之後同一個欄位又被改過、現在的值已經不同）見 `docs/api.md`「變更紀錄與還原」，會以 `isError` 回中文說明。
- `state`（Project）：Nextline 的 Project 沒有狀態（NX-165），`list_projects`、`save_project` 帶了會忽略，回傳也沒有 `status`／`statusType`。
- 封存（NX-160，不做永久刪除）：`save_issue` 帶 `archived: true` 封存、`false` 取消封存；會寫變更紀錄，可以用 `revert_issue_event` 還原。`list_issues` 預設不含已封存的票，`includeArchived: true` 才列出（參數名稱與預設 `false` 都跟 Linear MCP 一樣）。票的 `archivedAt` 是封存時間，沒封存是 `null`。
- `project`：Project 名稱（不分大小寫）或 id；`save_issue` 帶 `null` 移出 Project。
- `cycle`：數字先當 Sprint 編號找，找不到再當 id；也收名稱。`save_issue` 帶 `null` 移出。
- `updatedAt`（`list_issues`）、`createdAt`（`list_recent_comments`）：ISO 時間、`YYYY-MM-DD`，或相對時間 `-P1D`、`-P2W`、`-PT12H`。
- `limit`：預設 50，最多 200（Linear 的 250 會以 200 計）。`cursor` 用上一頁回傳的值。
- `save_issue` 會先檢查所有參照（Project、Cycle、blockedBy 等票號）都存在才寫入；任何一個不存在就整個不寫，回 `isError`。

## 跟 Linear MCP 不一樣的地方

| 項目 | Linear MCP | Nextline MCP |
| --- | --- | --- |
| 票號 | `BOL-123` | 新票 `NX-<n>`；搬來的票用舊編號也查得到，回傳的 `id` 是 `NX-<n>`、舊編號在 `legacyIdentifier` |
| `team`、`teamId` | 開票必填；`list_cycles` 必填 `teamId` | 只有一個 team：可以照舊帶，會忽略 |
| `list_issues` 的 `state` | 一次一種 | 可用逗號一次查多種（`Backlog,Todo,In Progress,In Review`）；state type `started` 展開成 `In Progress`、`In Review` |
| 狀態 | 每個 team 自訂 | 固定六種；`In Review`（待驗收）type 是 `started` |
| Project 的 `state`（`save_project`、`list_projects`） | 有 Project 狀態，可篩選與修改 | Project 沒有狀態：參數照舊可以帶，會忽略；回傳沒有 `status`、`statusType`（NX-165） |
| `list_issues` 的 `project`、`cycle` | 不支援「沒有」 | 可帶 `none` 查沒有 Project／Cycle 的票 |
| `list_issues` 的 `orderBy` | `createdAt`、`updatedAt` | `updatedAt`（預設）、`position`（看板順序）；不支援 `createdAt` |
| `list_issues` 的 `query`、`assignee`、`label`、`priority`、`createdAt` 等 | 支援 | 不支援，帶了會被忽略 |
| 封存 | `save_issue` 沒有封存參數 | `save_issue` 的 `archived` 封存／取消封存（`list_issues` 的 `includeArchived` 跟 Linear 一樣、預設 `false`） |
| 看板順序 | 沒有對應參數 | `save_issue` 的 `before`、`after`、`position`；回傳的票有 `position` |
| 跨票列 comment | 沒有，`list_comments` 只能查一張票 | `list_recent_comments` 列出某個時間之後所有票的新 comment（Nextline 自己的工具） |
| 變更紀錄 | 沒有工具 | `list_issue_events` 列出、`revert_issue_event` 一鍵還原單一欄位（Nextline 自己的工具） |
| `list_issues` 的 `limit` | 最多 250 | 最多 200 |
| `save_issue` 的 `assignee`、`labels`、`priority`、`estimate`、`parentId`、`relatedTo`、`duplicateOf`、`patch`、`links`、`template` 等 | 支援 | 不支援，帶了會被忽略（Nextline 沒有這些欄位） |
| 改 description 的部分內容 | `patch` | 沒有，要整份 `description` 重送 |
| 誰改的 | 由 Linear 帳號決定 | `save_issue` 的 `actor`、`save_comment` 的 `author`，沒帶記成 `mcp` |
| comment 回覆串 | `parentId` | 沒有回覆串 |
| `save_comment` 的掛載對象 | issue、project、document 等 | 只有票（`issueId`） |
| comment 的 `author` | 使用者物件 | 字串 |
| `get_issue` 的 relations | 要帶 `includeRelations` | 一律附 `relations.blockedBy`、`relations.blocks` |
| Project 參照 | 名稱、id、`P-XXX-1`、slug | 名稱或數字 id |
| Project 的 `summary`、`lead`、`teams`、`startDate`、`targetDate`、`labels` 等 | 支援 | 不支援，帶了會被忽略 |
| `cycle` 參照 | 名稱、編號或 id | 一樣，數字先當編號 |
| `list_cycles` 回傳 | 含 issue／scope 歷史 | 只有 `id`、`number`、`name`、`startsAt`、`endsAt` |
| `url`、`gitBranchName` | 有 | 沒有（網頁在 04 才做） |
| 刪除 | 有部分刪除工具 | 沒有；不要的票改成 `Canceled` |
| id 型別 | 字串 | 也是字串（`projectId`、`cycleId`、comment `id` 都是數字字串） |
