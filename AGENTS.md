# AGENTS.md

給在這個 repo 工作的人與 coding agent 看的說明。

Nextline：一個人＋幾個 AI agent 共用的任務系統。票號 `NX-<n>`（`legacy_identifier` 可存從其他系統搬來的舊編號）。TypeScript；同一份核心可跑在 Node＋SQLite 或 Cloudflare Workers＋D1，介面用繁體中文。程式碼與文件裡的 `NX-<n>` 是當初開發這個功能的票號，用來追溯設計理由。

- 驗證方式（哪些路徑走 Access、哪些驗 token）：`docs/auth.md`。新增路徑前先在那張表登記。
- Cloudflare 跑法：`wrangler.jsonc` 的 Access 與 D1 值是佔位值，部署前換成自己的；D1 資料庫名稱 `nextline`。

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | Node 自架開發：Node :3000＋Vite http://127.0.0.1:5173，兩端重載；先依 README 初始化，登入同正式 Node 跑法。`scripts/dev-node.mjs` |
| `npm run dev:cloudflare` | 原 Worker＋Vite 開發流程：Wrangler :8787＋Vite http://127.0.0.1:5173；`.dev.vars` 設定見 docs/auth.md。`scripts/dev.mjs` |
| `npm run dev:worker`／`npm run dev:app` | 只跑其中一個 |
| `npm run build` | 前端到 `dist/client`，Node 入口與 CLI 到 `dist/server`。`wrangler dev`／`wrangler deploy` 會先自動跑（`wrangler.jsonc` 的 `build`） |
| `npm run build:site` | 官網與文件站：`site/` 的頁面片段套上共用版面，輸出純靜態檔到 `dist/site/`（`scripts/build-site.mjs`，目錄在檔內 `NAV`）。內容以程式碼實際行為為準，不寫私人票號與內部說法（`scripts/build-site.test.mjs` 會擋） |
| `npm run typecheck` | `tsc --noEmit`（含 worker、core、app、node） |
| `npm run lint` | ESLint（typescript-eslint strictTypeChecked，含 `app/`） |
| `npm test` | Vitest（worker、node、app）；SQLite、HTTP／MCP、備份升級測試 |
| `npm run verify` | typecheck + lint + test + test:d1（真正 workerd D1） |
| `npm run selfhost:backup -- <全新目錄>`／`selfhost:restore -- <備份目錄> <全新資料目錄>` | SQLite 一致性快照及新目錄還原；操作順序見 `docs/self-host.md` |
| `node scripts/e2e/operations.mjs`／`transport.mjs`／`https.mjs` | CLI 備份／還原／中斷復原、雙引擎真 MCP 並行與回滾、Linux Caddy＋Supervisor HTTPS／程序重啟；證據在 `.scratch/nx195/` |
| `PLAYWRIGHT_MODULE=<playwright 的 index.mjs> [CHROMIUM_PATH=…] node scripts/e2e/board.mjs` | 看板端對端測試：自己起 `wrangler dev`（:8788，`.dev.vars` 要有 `DEV_SKIP_ACCESS=1`）和一份新的本機 D1（`.scratch/e2e-board/`），灌資料後用 Playwright 拖拉、復原、手機「移到…」，截圖與結果在 `.scratch/screenshots/board/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/detail.mjs` | 票詳細端對端測試（:8789、`.scratch/e2e-detail/`）：從看板開預覽、就地編輯、comment、blocked by、變更紀錄還原與 409、待驗收只有「等你回覆」（沒有通過／退回，NX-239）、回覆自動交回 In Progress 與復原（NX-221）、展開整頁、手機整頁；截圖與結果在 `.scratch/screenshots/detail/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/views.mjs` | 全部的票／Project 頁／「等你」端對端測試（:8790、`.scratch/e2e-views/`，灌 170 張票）：篩選 Project 與狀態、重新整理後還在、點一列開預覽、Project 三個分頁（說明防 XSS）、「等你」（In Review）與側欄張數、拿掉的 `/zones` 轉回看板、手機 375、捲動每格畫面時間；截圖與結果在 `.scratch/screenshots/views/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/create.mjs` | 開票端對端測試（:8791、`.scratch/e2e-create/`）：看板按 C → Cmd+Enter → 卡片在 Todo 頂端、API 查得到、「等你」+1；欄標題＋預填狀態；Esc 有草稿先問；繼續開下一張；Project 頁、列表頁預填；手機 FAB 全螢幕；截圖與結果在 `.scratch/screenshots/create/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/core-flow.mjs` | 上線前核心流程（:8793、`.scratch/e2e-core-flow/`）：`/legacy` 舊網址轉址；看板按 C 開票 → 拖到 In Progress → 拖到待驗收 → 預覽沒有「通過」、用狀態選單移到 Done → toast 復原回待驗收，對照 API 與變更紀錄；看板、全部的票、票詳細、等你 × 1280／375 × 淺色／深色截圖；截圖與結果在 `.scratch/screenshots/golive/`。只跑本機，正式站不跑（會開票） |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/feedback.mjs` | 第一次試用回饋（NX-160，:8794、`.scratch/e2e-feedback/`）：Project 頁開預覽拖卡片不空白、toast「復原」300ms 內變「已復原」、描述／comment／開票描述自動長高、網頁新增與修改 Project、封存（「⋯」、Cmd+K、復原、「已封存」取消封存、直接打開有提示）、`/zones`／`/sprints/:n`／`/views/:id` 轉回看板、手機沒有鍵盤提示；截圖與結果在 `.scratch/screenshots/nx160/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/nx161.mjs` | 第二次試用回饋（NX-161，:8796、`.scratch/e2e-nx161/`）：開票對話框由上到下是標題 → 描述（編輯／預覽在描述標題列）→ 欄位晶片、Tab 順序一致（桌面與手機全螢幕）；375 寬淺色／深色，下一步、描述、comment 含長路徑與網址時待驗收整頁、進行中整頁、看板、列表都沒有元素橫向溢出（量 `scrollWidth`）；待驗收沒有獨立的「下一步」區塊、進行中有。`E2E_LABEL=before` 只截圖不中斷（修改前對照）；截圖與結果在 `.scratch/screenshots/nx161/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/nx162.mjs` | 側欄 Project 排序與釘選（NX-162，:8797、`.scratch/e2e-nx162/`）：改票、寫 comment 後那個 Project 不重新整理就移到側欄最上面；hover 才出現圖釘、釘選固定在最上方、改其他 Project 的票還在最上方、重新整理還在、`/projects` 順序一致；API 失敗退回＋toast；取消後照時間排；手機「更多」與 Project 頁頁首釘選；截圖與結果在 `.scratch/screenshots/nx162/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/nx165.mjs` | 拿掉 Project 狀態（NX-165，:8798、`.scratch/e2e-nx165/`）：API 沒有 `status`；看板、`/projects`、Project 頁頁首、新增與編輯對話框都沒有狀態；`/projects` 有最後更新時間（相對時間＋title 完整時間）；側欄不看票的狀態、新增的 Project 馬上出現、釘選的在最前、9 個 Project 只列 7 個（手機「更多」相同）；`/projects` 1280／375 × 淺色／深色與側欄截圖；截圖與結果在 `.scratch/screenshots/nx165/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] [E2E_LABEL=before] node scripts/e2e/nx169.mjs` | 品牌方向 A「定線 Steady」（NX-169，:8799、`.scratch/e2e-nx169/`）：看板、票詳細、`/projects` × 1280／375 × 淺色／深色截圖且沒有整頁橫向捲動；色票（墨藍、青綠、冷灰）、字型 Inter／JetBrains Mono、圖示線寬 1.5、logo 兩條橫線、favicon、按鈕與空狀態文案。`E2E_LABEL=before` 只截圖（檔名加 `before-`，改版前對照）；截圖與結果在 `.scratch/screenshots/nx169/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/nx239.mjs` | 「等我」只剩回覆（NX-239，:8800、`.scratch/e2e-nx239/`）：待驗收的預覽與整頁頂端是「等你回覆」＋回覆框，沒有通過／退回、手機底部列，comment 區不放第二個輸入框；最新 comment 有「要你決定：」＋編號選項時照原文列出（純文字），之後有新 comment 就不列；手機回覆作者是網頁上的人（預設「你」）、移 In Progress、可復原；1280 預覽／整頁與 375 × 淺色／深色截圖且沒有橫向捲動；截圖與結果在 `.scratch/screenshots/nx239/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/palette.mjs` | 指令面板與快捷鍵端對端測試（:8792、`.scratch/e2e-palette/`）：Cmd+K 打票號 → Enter 開預覽、舊票號、中文片段；開著預覽「改狀態成 In Progress」→ API → 列表頁 Cmd+Z 復原；Esc 先關最上層；G 接 I／B；輸入框裡 C 不開票；? 說明；側欄「搜尋」與最近用過；手機底部「搜尋」；截圖與結果在 `.scratch/screenshots/palette/` |
| `PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node scripts/e2e/site.mjs` | 官網與文件站（:8801）：建站後每一頁 × 1280／375 × 淺色／深色量測沒有橫向溢出，操作搜尋、手機目錄、深淺色切換；截圖與結果在 `.scratch/screenshots/site/` |
| `npm run db:migrate:local` | 本機 D1 套用 `migrations/` |
| `npm run db:migrate:remote` | 遠端 D1 套用 `migrations/`（要先登入 Cloudflare） |
| `npm run deploy` | `wrangler deploy` |

## 架構

- `worker/index.ts`：Worker 進入點與路由：`GET /health`（查一次 D1 `SELECT 1`）、`/api/*` 交給 `worker/api/`（token）、`/mcp` 交給 `worker/mcp/`、`/app-api/*` 交給 `worker/api/browser.ts`（瀏覽器，Access JWT）、`/legacy/*` 交給 `worker/web/legacy.ts`（第一版的舊網頁 NX-158 已移除，只 301 轉到新網頁對應路徑），其他路徑交給 `worker/web/spa.ts`（React App 的靜態檔）。驗證方式見 `docs/auth.md`。
- `app/`：網頁（Vite + React + TypeScript，router 用 `react-router`），建置成靜態檔由同一個 Worker 提供（`wrangler.jsonc` 的 `assets`，SPA fallback）。照 DDD／colocation 分資料夾，元件、樣式、測試放一起：`api/`（唯一的 API client，打 `/app-api`，型別對應 `docs/api.md`，統一處理錯誤與 401）、`shell/`（側欄、手機底部分頁列＋FAB、「更多」sheet）、`owner/`（網頁上的人是誰：comment 作者、變更紀錄 actor 用 `GET /app-api/owner` 的名字，後端在 `worker/api/owner.ts`，Worker vars `OWNER_NAME`／Node `NEXTLINE_OWNER_NAME`，預設「你」，NX-244）、`toast/`（toast 與「復原」倒數）、`theme/`（跟系統／淺色／深色，記在 localStorage，`public/theme-init.js` 在畫面出來前先套上）、`ui/`（圖示、按鈕、選單、空狀態、skeleton、錯誤）、`board/`（首頁看板：欄位分組與排序 `columns.ts`、寫回與復原 `moves.ts`、資料與 60 秒重抓 `useBoardData.ts`；拖拉用 dnd-kit；點卡片桌面開 `?peek=NX-n`、手機進整頁）、`issues/`（「全部的票」列表 `/issues`（`?archived=1` 是「已封存」，列上可取消封存，`archive.ts`）、整個 App 共用的「全部沒做完的票」`OpenIssuesProvider.tsx`（側欄「等你」＝In Review 張數、Project 張數從這裡算；三區在 NX-160 拿掉），Project 頁的列表分頁也用它：篩選、分組、排序與網址同步在 `listQuery.ts`，資料 `useIssues.ts` 一次抓完所有頁、60 秒重抓；列用 CSS `content-visibility: auto`，不分頁、不用 JS 虛擬化）、`projects/`（`/projects` 列表（每列有最後更新時間，NX-165）與 `/projects/:id`；Project 沒有狀態（NX-165），側欄不看票的狀態，全部 Project 排好後最多列 7 個（`projects.ts` 的 `sidebarProjects`、`SIDEBAR_LIMIT`，手機「更多」相同，其餘在「全部 Project」）；側欄、`/projects` 的順序是釘選的在上、其餘照 `last_activity_at`（`projects.ts` 的 `sortProjects`），釘選按鈕 `PinButton.tsx`，樂觀更新與票改了／寫了 comment 往上推在 `ProjectsProvider.tsx`（NX-162）；看板分頁用 `board/BoardPage` 的 `project` 參數、列表分頁用 `issues/` 固定 Project、說明用 `issue/Markdown`）、`issue/`（票詳細：右側預覽面板 `IssuePeek.tsx`（由 `shell/AppShell.tsx` 依 `?peek` 放在主內容右邊）與整頁 `IssuePage.tsx` 共用 `IssueDetail.tsx`；寫入、樂觀更新、復原、還原、待驗收的回覆、封存在 `edits.ts`；待驗收頂端「等你回覆」與「要你決定」的選項解析在 `decision.ts`（NX-239）；右上「⋯」選單放封存；看板與詳細頁互相同步用 `issueSync.ts`；Markdown 用 `worker/web/markdown.ts` 同一份轉換（跳脫所有原始 HTML））、`create/`（開票對話框：C 鍵、側欄「開票」、看板頂端主按鈕與欄標題＋、手機 FAB 都由 `shell/AppShell.tsx` 打開；依目前畫面預填在 `prefill.ts`，草稿判斷、送出與 issueSync 同步在 `draft.ts`）、`palette/`（Cmd+K 指令面板與「?」快捷鍵說明：模糊比對 `fuzzy.ts`、項目與分組排序 `items.ts`、最近用過（localStorage）`recent.ts`；「改狀態成…」「移回…」透過 `activeIssue.ts` 拿目前打開那張票的 `issue/edits.ts` 寫入流程）、`pages/`。全域快捷鍵（C、G 接 B／I／M／Z、?、Cmd/Ctrl+K）的判斷在 `shell/shortcuts.ts`，Cmd/Ctrl+Z 在 `toast/ToastProvider.tsx`。樣式只用 `docs/design/system/tokens.css` 的變數，元件照 `docs/design/system/components.md`；網址照 `docs/design/ia/README.md` 第 3 段。
- 新功能做法：後端在 `worker/api/` 加路由（`/api` 和 `/app-api` 自動同時有），前端在 `app/src/api/client.ts` 加對應的方法；agent 用 `/api`／MCP，人用網頁，拿到同一套邏輯。
- `worker/web/`：網頁與 API 共用的伺服器端模組。Access JWT 驗證在 `access.ts`（見 `docs/auth.md`）；防 CSRF 在 `csrf.ts`；從 comment 抓「下一步：」在 `classify.ts`（API 的 `next_step`；三區在 NX-160 拿掉）；Markdown 轉 HTML（跳脫所有原始 HTML，前端 `issue/Markdown.tsx` 也用）在 `markdown.ts`；`spa.ts` 先驗 Access JWT 再把請求交給 `env.ASSETS`；`legacy.ts` 把舊網址 `/legacy`、`/legacy/issues/:ref`、`/legacy/projects/:id` 轉到 `/`、`/issues/:ref`、`/projects/:id`，其他轉到 `/`。第一版的伺服器端網頁（`/legacy`）在 NX-158 移除。本機看網頁要在 `.dev.vars` 加 `DEV_SKIP_ACCESS=1`。
- `worker/api/`：票、comment、Project、Sprint、blocked by 的共用 API；路徑與參數見 `docs/api.md`。`index.ts` 的 `routeApi` 是 `/api`（token）與 `/app-api` 共用的路由。Worker 瀏覽器驗 Access JWT＋CSRF；Node 驗本機 session＋CSRF。只有 `npm run dev:cloudflare` 讀 `.dev.vars` 的 `API_TOKEN`。
- `node/`：自架入口、SQLite 版本與生命週期、CLI 初始化／密碼重設／token 旋轉、session 登入與靜態檔；操作先讀 `README.md`，新增入口先對照 `docs/auth.md` 的 Node 矩陣。Node 與 Worker 共用 core/API/MCP，不複製業務邏輯；自架不讀 `DEV_SKIP_ACCESS`。
- `worker/mcp/`：遠端 MCP（Streamable HTTP，無狀態），工具名稱與參數照 Linear MCP，底層呼叫 `worker/api/` 的函式；工具清單、Claude Code／Codex 連線設定與跟 Linear MCP 的差異見 `docs/mcp.md`。
- `worker/test/d1.ts`：測試用 D1，用 Node 內建 `node:sqlite` 跑 `migrations/` 的真 schema。
- `migrations/`：D1 schema，用 `wrangler d1 migrations` 管理；已套用的檔案不改，要改 schema 就新增下一號檔案。
- 資料表（`migrations/0001_initial.sql`，`0002` 起的變動見各檔開頭註解）：`issues`（`number` 即 NX 編號、`legacy_identifier` 存搬來的舊編號、`position` 看板同欄順序、`archived_at` 封存時間（`0003`，不做永久刪除））、`comments`（`author` 記誰寫的）、`issue_events`（所有欄位的變更紀錄，可還原）、`projects`（含長篇 `description`、`pinned_at` 釘選時間（`0004`）；`status` 在 `0005` 刪掉（NX-165）；API 的 `last_activity_at` 即時算，不存欄位）、`sprints`、`issue_blockers`（blocked by）、`workspaces`（目前只有 1；主要資料表都有 `workspace_id`）。`linear_id` 欄位給從 Linear 匯入資料時做重跑去重（匯入工具不在本 repo）。
- 狀態固定六種：`Backlog`、`Todo`、`In Progress`、`In Review`（待驗收）、`Done`、`Canceled`，與 Linear 同名，讓 Skill 少改。
- 測試與實作放在同一資料夾（`*.test.ts`）。

## 規則

- 一次改一件事；commit 訊息說清楚改了什麼與為什麼。
- token 只放 wrangler secret 或環境變數（本機用 `.dev.vars`），不寫進 git、規則檔或對話。
- 部署與遠端 migration 需要自己的 Cloudflare 帳號登入（`npx wrangler login`）。
- D1 一次寫入大量資料要分批。

## 驗收

- 完成前 `npm run verify` 全綠。
- 動到 schema：`npm run db:migrate:local` 成功；自己有部署的話再跑 `npm run db:migrate:remote`。
- 動到 Worker：自己有部署的話，用 `curl -i https://<你的網址>/health` 確認 200。
- 動到前端：`npm run build` 成功；`.dev.vars` 設 `DEV_SKIP_ACCESS=1` 跑 `wrangler dev`，用 Playwright 截 1280／375 寬、淺色／深色，量測沒有橫向捲動，截圖放 `.scratch/screenshots/<票或畫面>/`。
- 證據（指令輸出、截圖路徑）附在 PR 或對應的票。
