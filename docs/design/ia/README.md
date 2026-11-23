# Nextline 第二版：資訊架構

> NX-147（Project「Nextline 第二版：可商用」）。2026-11-03 初稿。只做設計，不改 `worker/`。
> 依據：產品定位（主推「一人公司＋多個 AI agent」、五條產品原則）與第二版調查報告（內部文件，未收進本 repo），以及本 repo 的 `docs/api.md`、`docs/mcp.md`、`migrations/0001_initial.sql`。
> 已定的決策：首頁是看板；全部的票、單一 Project 都是可切換的 view；前端改 React；人是負責人、agent 代做；狀態依序 Backlog、Todo、In Progress、待驗收、Done、Canceled。2026-11-03 Bolas 再定：**人和 agent 都能把票移到 Done，做錯了再移回來**（靠 toast「復原」、Done 卡片「移回」、變更紀錄一鍵還原，見第 4 段）。
> 2026-11-04 Bolas：產品不放 Sprint，首頁看板顯示全部沒做完的票（Sprint 會增加管理票的複雜度；API、MCP、資料庫的 sprint 照舊保留給阿澈的 Sprint 會議）。不做 view 功能（「我的 view」與 `/views/:id` 拿掉）。不做永久刪除，改成「封存」（第 4 段）。（NX-160）
> 2026-11-03 Bolas：三區是晨報的邏輯，不放進產品。（NX-160：拿掉 `/zones` 與 API 的 `zone`；側欄「等你」改成待驗收的票，階段二再加上「指派給我」。）
> 同資料夾：[flows.md](flows.md)（流程與每一步的畫面回饋）、[wireframes.html](wireframes.html)（低保真線框，桌面＋手機）。

## 白話結論

整個網站只有一個主畫面：**看板**。左邊側欄是「去哪裡找票」，看板的欄是「票在哪一步」，卡片上的兩個頭像是「誰負責、哪個 agent 在做」，卡片角落的徽章是「agent 有沒有在動」。驗收不用另外找：輪到你的票都在側欄「等你」，agent 做完的票自己跑到「待驗收」欄；agent 確定沒問題的票也可以直接移到 Done，做錯了再移回來。

使用者要記的只有四個動作：

```
找票            往前推              交給 agent              驗收
側欄／Cmd+K ─▶  拖到下一欄     ─▶   卡片上選「代做 agent」 ─▶ 「待驗收」欄 → 回覆（狀態交給 agent）
```

---

## 1. 網站地圖

```
Nextline
├─ 側欄（桌面固定在左；手機收成底部分頁列＋右下角「開票」按鈕）
│  ├─ 搜尋（Cmd+K）
│  ├─ ＋ 開票（C）
│  ├─ 等你 (n)  ─────────────────────▶ /issues?status=in_review   待驗收的票（/me 轉到這裡；階段二加上「指派給我」）
│  ├─ 看板（首頁）  ──────────────────▶ /               全部沒做完的票（Backlog、Canceled 收在標題列）
│  ├─ 全部的票  ──────────────────────▶ /issues          列表
│  ├─ Project
│  │  ├─ 〈釘選的在前、其餘照最後更新，最多 7 個〉 ▶ /projects/:id    看板／列表／說明 三個分頁（Project 沒有狀態，NX-165）
│  │  └─ 全部 Project  ───────────────▶ /projects        全部 Project（含票都做完的），每列有最後更新時間
│  └─ 設定  ──────────────────────────▶ /settings
│     ├─ 成員與 agent  ───────────────▶ /settings/members   加 agent、看每個 agent 的 token 與最近活動
│     ├─ API token 與 MCP 連線  ───────▶ /settings/connect   複製 Claude Code／Codex 的設定指令
│     └─ 偏好  ───────────────────────▶ /settings/prefs     深淺色、看板預設收起哪幾欄
├─ 票詳細頁  ────────────────────────▶ /issues/NX-12
│  （從列表或看板點卡片：桌面先開右側預覽 ?peek=NX-12，按 Enter 或「展開」進完整頁；手機直接進完整頁）
├─ 開票對話框（任何畫面按 C 或「＋」；網址 ?new=1，可帶預填值，見第 3 段）
└─ Cmd+K 指令面板（任何畫面；不改網址）
```

定案的取捨：

| 決定 | 理由 |
|---|---|
| 首頁看板顯示全部沒做完的票 | 2026-11-04 Bolas：產品不放 Sprint，首頁看板顯示全部沒做完的票（取代 11-03 的「目前 Sprint」）。Backlog 欄收在標題列，所以上百張也不會把看板撐長 |
| 不做 view 功能 | 2026-11-04 Bolas：不做存起來的 view；側欄沒有「我的 view」，`/views/:id` 轉回看板 |
| 不做永久刪除，改成封存 | 2026-11-04 Bolas：不要的票封存（看板、列表、Project 頁、側欄張數都不算），列表的「已封存」可以取消封存；封存寫變更紀錄、可還原 |
| Backlog、Canceled 兩欄預設收起，只顯示張數 | 每天會動的是 Todo、In Progress、待驗收、Done；收起的欄拖曳時會自動展開成放置區 |
| Done 欄只顯示最近 7 天完成的 | 讓欄位長度穩定；看全部用「全部的票」並篩 `status=Done` |
| 「等你」是側欄第一個導覽項，不是另一頁通知中心 | 產品原則 3：先在看板和側欄標出來，不先做獨立通知頁；收件匣是階段三 |
| 三區不放進產品 | 2026-11-03 Bolas：三區是晨報的邏輯，不放進產品。「輪到你」改用側欄「等你」（現在是待驗收，第 4 段） |
| 「agent」不另開一頁 | 每個 agent 在做什麼，階段二有代做 agent 欄位後再決定放在哪裡（不做 view，見上）；設定頁只管新增 agent 與 token |
| 手機不做看板拖拉 | 手機看板改成「一次看一欄」的狀態分頁；換狀態用卡片上的狀態按鈕。手機的主要用途是看「等你」和驗收 |

## 2. 物件模型

```
                     ┌──────────────┐
                     │   Sprint     │  兩週一期；number、starts_at、ends_at
                     └──────┬───────┘
                            │ 0..1
┌──────────────┐  0..1 ┌────┴─────────────────────────────┐  0..*  ┌───────────────┐
│   Project    ├───────┤               票                  ├───────┤   comment     │
│ 名稱、狀態、   │       │ NX-n、標題、描述、狀態、到期日、    │        │ 作者＝成員     │
│ 長篇說明      │       │ 看板排序位置                       │        └───────────────┘
└──────────────┘       │                                  │  0..*  ┌───────────────┐
                       │ 負責人 ──────────▶ 成員（人）  1    ├───────┤ 變更紀錄       │
                       │ 代做 agent ──────▶ 成員（agent）0..1│        │ 欄位、舊值、新值、│
                       │ blocked by ──────▶ 票         0..* │        │ 誰改的＝成員    │
                       └────┬─────────────────────────────┘        └───────────────┘
                            │ 0..*（一輪一筆，新的在上）
                     ┌──────┴────────────────┐  0..*  ┌─────────────────────────┐
                     │    agent session      ├───────┤        活動              │
                     │ 哪個 agent、狀態、     │        │ 想法／動作／問人／回覆／錯誤 │
                     │ 開始、最後活動、        │        └─────────────────────────┘
                     │ 被要求停止的時間        │
                     └───────────────────────┘
成員：kind = 人 或 agent。第二版只有一個人（Bolas），其餘都是 agent（阿澈、各 repo 的專案 agent）。
```

| 物件 | 第一版已有 | 第二版要加（給實作票的建議，不是本票的產出） |
|---|---|---|
| 票 `issues` | `number`、`title`、`description`、`status`、`project_id`、`sprint_id`、`due_date`、時間欄位 | `status` 加 `In Review`（介面顯示「待驗收」）；`assignee_id`（必填，預設 Bolas）、`delegate_id`（可空）；`position`（同欄排序）；`workspace_id`（先固定一個值，報告第 6 段） |
| 成員 `members` | 沒有；`comments.author`、`issue_events.actor` 是自由字串 | 新表：`id`、`kind`（`human`／`agent`）、`name`、`handle`（例如 `claude-nextline`）；每個 agent 一把 token，寫入時從 token 認出是誰，不再靠 `actor` 字串 |
| agent session | 沒有 | 新表：`issue_number`、`agent_id`、`state`、`started_at`、`last_activity_at`、`ended_at`、`stop_requested_at`、`summary`（做完時給驗收的人看的摘要） |
| 活動 | 沒有 | 新表：`session_id`、`kind`（`thought`／`action`／`elicitation`／`response`／`error`）、`body`。只有 `response` 和 `elicitation` 會同時寫成 comment（照 Plane 的做法 [³⁰](https://developers.plane.so/dev-tools/agents/overview)），其他只顯示在 session 面板 |
| 變更紀錄 `issue_events` | 只記狀態、Project、Sprint；`actor` 是字串 | 擴大到所有欄位；`actor` 改成成員 id；可一鍵還原單一欄位（產品原則 4） |
| 存起來的 view | 沒有 | 新表：`name`、`path`（例如 `/issues`）、`query`（網址參數原文）、`position` |

規則：

- **負責人永遠是人**。agent 只能是「代做」。照 Linear：代做的票仍算在負責人名下，換掉或移除代做 agent 不影響負責人 [²³](https://linear.app/docs/assigning-issues)。
- **一張票同時最多一個代做 agent、最多一個沒結束的 session**。退回重做時開新的一輪 session，舊的保留在歷史裡，所以看得出「第幾輪」。
- **session 狀態**（卡片徽章的來源）：

  | 狀態 | 徽章文字 | 怎麼進入 |
  |---|---|---|
  | `pending` | 等 agent 接手（超過 30 分鐘變「還沒開工」） | 人指派代做 agent 的當下 |
  | `active` | 進行中 | agent 送出第一筆活動；之後每筆想法／動作都維持 |
  | `awaiting_input` | 等你回覆 | agent 送出「問人」活動 |
  | `error` | 出錯 | agent 送出錯誤活動 |
  | `stale` | 太久沒更新 | `active` 超過 30 分鐘沒有活動（畫面計算，不寫資料庫） |
  | `stopping` → `stopped` | 停止中… → 已停止 | 人按停止 → agent 下一次呼叫 MCP 時收到停止訊號並回報 |
  | `complete` | 做完了 | agent 送出回覆活動並把票移到待驗收或 Done |

  狀態名稱與意思照 Linear Agent Session（`pending`、`active`、`awaitingInput`、`error`、`complete`、`stale`）[³¹](https://linear.app/developers/agent-interaction)，加上 Plane 的 `stopping`／`stopped` [³⁰](https://developers.plane.so/dev-tools/agents/overview)。stale 的門檻 Plane 是 5 分鐘；Claude Code 一次思考可能超過 5 分鐘才呼叫 MCP，所以定 30 分鐘。

## 3. URL 規則

原則：**看到什麼，網址就是什麼**。篩選、分組、排序、版面都寫在網址參數裡；複製網址給 agent 或存成書籤，打開就是同一個畫面（照 Linear 的 custom view [¹⁶](https://linear.app/docs/custom-views)）。

| 路徑 | 畫面 |
|---|---|
| `/` | 首頁看板：全部沒做完的票 |
| `/board` | 看板（可帶任何篩選參數） |
| `/issues` | 全部的票（列表） |
| `/me` | 等你：現在轉到 `/issues?status=in_review`（待驗收） |
| `/zones` | 已拿掉（NX-160），轉到 `/` |
| `/sprints/:number` | 已拿掉（NX-160，產品不放 Sprint），轉到 `/` |
| `/projects`、`/projects/:id` | Project 列表、單一 Project（`tab=board`（預設）／`list`／`about`） |
| `/issues/NX-12` | 票詳細頁；舊編號 `/issues/ABC-150` 轉到 NX 編號（301） |
| `/views/:id` | 已拿掉（NX-160，不做 view），轉到 `/` |
| `/issues?archived=1` | 已封存的票（可以取消封存） |
| `/settings/*` | 設定 |

篩選參數（任何列表類畫面通用；多個值用逗號；`none` 代表「沒有」）：

| 參數 | 值 | 例 |
|---|---|---|
| `status` | `backlog`、`todo`、`in_progress`、`in_review`、`done`、`canceled` | `status=in_progress,in_review` |
| `project` | Project id、`none` | `project=3` |
| `archived` | `1` | 看已封存的票 |
| `assignee` | 成員 handle、`me` | `assignee=me` |
| `agent` | agent handle、`any`、`none` | `agent=claude-nextline` |
| `session` | `pending`、`active`、`awaiting_input`、`error`、`stale`、`stopped`、`complete` | `session=awaiting_input,error` |
| `due` | `overdue`、`week`、`none` | `due=overdue` |
| `blocked` | `yes`、`no` | `blocked=yes` |
| `q` | 標題與票號關鍵字 | `q=看板` |
| `layout` | `board`、`list` | 只有 `/issues`、`/projects/*` 用；`/board` 固定看板 |
| `group` | `status`（看板預設）、`project`、`agent` | 列表的分組；看板只依狀態分欄 |
| `sort` | `position`（看板預設）、`updated`（列表預設）、`due`、`created` | |
| `peek` | 票號 | 右側預覽開著哪張票 |
| `new` | `1`，再加 `title`、`project`、`agent` 預填 | `?new=1&project=3&agent=claude-nextline`（照 Linear 用網址預填開票 [¹](https://linear.app/docs/creating-issues)） |

- 參數值一律小寫、用 `_` 連接，跟 API 的狀態名（`In Progress`）分開；前端負責對照。
- 預設值不寫進網址（看板的 `group=status&sort=position` 不出現），讓網址短。

## 4. 狀態流程

```
             人：拖拉／狀態選單          agent：save_issue
 ┌─────────┐       ┌──────┐      ┌─────────────┐   agent 做完     ┌────────┐  agent：移 Done  ┌──────┐
 │ Backlog │ ────▶ │ Todo │ ───▶ │ In Progress │ ──────────────▶ │ 待驗收  │ ──────────────▶ │ Done │
 └─────────┘ ◀──── └──────┘ ◀─── └─────────────┘ ◀────────────── └────────┘ ◀────────────── └──────┘
                                       │   人：回覆（自動交回 agent）              移回（復原／還原）▲
                                       │                                                   │
                                       └──── 人或 agent：直接完成（跳過待驗收）────────────────┘
 任何狀態 ──人：取消──▶ Canceled         Done／Canceled ──人或 agent：重新打開──▶ Todo
```

**Done 的規則（2026-11-03 Bolas 決定）**：人和 agent 都能把票移到 Done，做錯了再移回來。不靠事前擋，靠事後好改回：

```
誰移到 Done          怎麼移回來
自己（拖拉、按鈕） ─▶ toast「復原」10 秒（Cmd/Ctrl+Z 也可以）
agent             ─▶ Done 欄卡片標「claude-nextline 移到 Done・3 分鐘前」＋「移回待驗收」
任何人、任何時候   ─▶ 票詳細頁／預覽面板的變更紀錄，每筆「還原」一鍵改回
```

| 操作 | 從 | 到 | 人 | agent | 畫面回饋 |
|---|---|---|---|---|---|
| 開票 | — | Backlog（看板上從某欄的「＋」開，就是那一欄） | ✓ | ✓ | toast「已開 NX-12」＋「打開」；卡片出現在欄頂 |
| 排進計畫 | Backlog | Todo | ✓ 拖拉、狀態選單、批次 | ✓ | 卡片移欄；欄標題張數 −1／+1 |
| 開工 | Todo | In Progress | ✓ | ✓（agent 開始做時自動移） | 同上 |
| 交給 agent | 任何未結束狀態 | 不變（Todo 會自動移到 In Progress） | ✓ 卡片「代做 agent」、`D` | ✓ 只限總管 agent（阿澈）派工 | 卡片出現 agent 頭像＋「等 agent 接手」；toast 附「複製開工指令」 |
| 做完送驗收 | In Progress | 待驗收 | ✓（自己做的票也能送） | ✓ 代做 agent 送出回覆後 | 卡片移到待驗收欄；側欄「等你」+1；徽章「做完了」 |
| 通過 | 待驗收 | Done | ✓ 只能拖拉或狀態選單（票詳細不再有「通過」，NX-239） | ✓ `save_issue` 改成 Done；讀了 Bolas 的回覆判斷可以收時 | 人做的：卡片移到 Done；toast「NX-12 完成」＋「復原」10 秒。agent 做的：下次重新抓時卡片移到 Done，標「claude-nextline 移到 Done」＋「移回待驗收」。兩種都結束 session、寫進變更紀錄（可還原） |
| 退回 | 待驗收 | In Progress | 不再有「退回」按鈕（NX-239）：要改就回覆，見「回覆 agent」 | ✗ | 卡片回 In Progress；開新一輪 session（`pending`），徽章「第 2 輪・等 agent 接手」 |
| 直接完成 | In Progress（任何未結束狀態） | Done | ✓ 任何票都可以，有代做 agent 也一樣，不跳確認 | ✓ agent 判斷不用人看就能完成時 | 同「通過」 |
| 移回 | Done | 待驗收（agent 做的）／原本的狀態（自己做的） | ✓ toast「復原」、Done 卡片「移回待驗收」、變更紀錄「還原」 | ✓ 發現自己做錯時 | 卡片回原欄；變更紀錄多一筆「Bolas 還原了 claude-nextline 的狀態變更」，被還原的那筆加刪除線、標「已還原」 |
| 取消 | 任何 | Canceled | ✓ | ✗ | 卡片收進 Canceled 欄；toast＋「復原」；有 session 就同時送停止 |
| 重新打開 | Done／Canceled | Todo | ✓ | ✓ 只限 Done（Canceled 由人處理） | 卡片回 Todo |
| 停止 agent | session `active`／`awaiting_input`／`stale` | 狀態不變 | ✓ 票詳細頁「停止」 | ✗ | 徽章「停止中…」→ agent 下次呼叫 MCP 後「已停止」 |
| 移除代做 agent | — | 狀態不變 | ✓ | ✗ | agent 頭像消失；沒結束的 session 送停止 |
| 問人 | — | 狀態不變 | ✗ | ✓ | 徽章「等你回覆」；側欄「等你」+1；問題同時寫成 comment |
| 回覆 agent | 待驗收（其他狀態不變） | In Progress | ✓ 票詳細頂端「等你回覆」的回覆框（`author` 是 Bolas；待驗收時 comment 區不放輸入框） | ✗ agent 寫的 comment 不觸發 | 待驗收的票：卡片回 In Progress、側欄「等你」−1；toast「已交回 agent」＋「復原」；變更紀錄記一筆（可還原）。其他狀態只多一則 comment（NX-221） |

人和 agent 的分工：

- **人在「等我」只回覆，狀態由 agent 管**（2026-11-20 Bolas，NX-239）：待驗收的票詳細頁與預覽面板沒有「通過」「退回」，頂端是「等你回覆」＋回覆框。Bolas 只寫自己的意思，不用判斷這算通過、退回還是留言；回覆後票交回 In Progress，agent 讀了回覆再決定移 Done、繼續做或再問。agent 要 Bolas 選時，在 comment 寫「要你決定：〈問題〉」加 `1.` `2.` 編號選項，頂端會照原文列出（純文字，不做按鈕）。看板拖拉與狀態選單照留，Bolas 還是可以自己改狀態。
- **agent 不能做的只有兩件：取消、換負責人**。移到 Done 人和 agent 都可以（2026-11-03 Bolas 決定，第 6 段第 2 題）；其餘欄位、comment、開票、送驗收也都跟人一樣，符合產品原則 1。agent 自己判斷：要人看過的送待驗收，確定沒問題的直接移 Done；阿澈現在自己移 Done 的做法照舊。
- **做錯了再移回來**：任何票都可以直接移到 Done（有代做 agent 也不跳確認）。每次移到 Done 都寫進變更紀錄、標明是誰；人做的有 toast「復原」10 秒，agent 做的在 Done 欄卡片上有「移回待驗收」，任何時候都能在變更紀錄一鍵還原（產品原則 4）。
- **「等你」＝待驗收**（2026-11-03 NX-160；三區不放進產品）：側欄「等你」連到 `/issues?status=in_review`，張數就是待驗收（`In Review`）的張數。階段二有負責人、代做 agent、session 之後再擴大成：

  | 現在 | 階段二 |
  |---|---|
  | 狀態是待驗收 | 負責人是我，而且符合其一：待驗收；session 是等你回覆、出錯、太久沒更新、已停止，或等 agent 接手超過 30 分鐘（徽章「還沒開工」）；Todo／In Progress 而且沒有代做 agent |

  階段二的 `/me` 專屬頁依「等你回覆／出錯 → 待驗收 → 你自己做的」排序。
- **API／MCP 狀態名**：新增 `In Review`。對 Linear MCP 相容的 state type 是 `started`（Linear 的 In Review 也屬於 started），既有 Skill 查 `In Progress` 的地方要另外檢查是否也要查 `In Review`，列在實作票。

### 畫面更新

第二版不做即時推送（報告階段三）。看板與列表在**視窗重新取得焦點時**和**每 60 秒**重新抓一次；有變動的卡片移到新位置並短暫標示「剛更新」，標示裡寫是誰改的（例如「claude-nextline 移到待驗收」）。

## 5. 快捷鍵

照 Linear 的慣例 [¹](https://linear.app/docs/creating-issues)、[¹⁹](https://linear.app/docs/select-issues)，讓用過 Linear 的人不用重學。

| 鍵 | 動作 | 鍵 | 動作 |
|---|---|---|---|
| `Cmd/Ctrl+K` | 指令面板 | `C` | 開票 |
| `/` | 聚焦篩選列 | `X` | 選取卡片（可多選） |
| `S` | 改狀態 | `D` | 改代做 agent |
| `P` | 改 Project | | |
| `G` 然後 `B`／`I`／`M` | 跳到看板／全部的票／等你 | `?` | 快捷鍵一覽 |
| `Cmd/Ctrl+Enter` | 送出開票、送出 comment | | |

---

## 6. 要 Bolas 確認的流程問題

其餘（網站地圖、URL、session 狀態、畫面回饋、手機做法）阿澈已定案，不同意再改。

**1. 首頁看板顯示哪些票**（2026-11-03 定 A；2026-11-04 Bolas 改成 B：產品不放 Sprint，首頁看板顯示全部沒做完的票）

| 選項 | 做完長什麼樣 |
|---|---|
| **A. 目前 Sprint（推薦）** | 打開只看到這兩週排進來的票，約 10～30 張；沒排進 Sprint 的要切 Sprint 選單或去「全部的票」 |
| B. 全部沒做完的票 | 打開看到所有 Project 的票；Backlog 欄預設收起，但 Todo、In Progress 仍可能很長 |
| C. 只看輪到我的 | 首頁等於 `/me` 換成看板版面；agent 在做的票不在首頁 |

推薦 A：Sprint 是現在每兩週定好「要做什麼」的單位，看板跟 Planning 一致；B 在票數上百時看不出重點；C 看不到 agent 在動，違反承諾 1。

**2. 誰可以把票移到 Done**（已定，2026-11-03）

Bolas 決定：**人和 agent 都能移到 Done，做錯了再移回來**（接近原本的選項 C，但補上移回的路）。待驗收欄保留給「agent 覺得要人看一下」的票；改回去的方法見第 4 段「Done 的規則」：toast「復原」、Done 卡片「移回待驗收」、變更紀錄一鍵還原。原本推薦的「只有人能移到 Done」不採用。

**3. 交給 agent 之後，agent 怎麼知道要開工**

Nextline 不會主動叫醒本機的 Claude Code／Codex（它們是主動來讀寫的，報告第 3 段）。

| 選項 | 做完長什麼樣 |
|---|---|
| **A. 網頁給「複製開工指令」（推薦）** | 指派後 toast 和票詳細頁都有一顆按鈕，複製一段「請處理 NX-12，先 get_issue 讀票，開 session……」的指令，貼到該 repo 的 agent 視窗；阿澈派工時照舊用 `dispatch-ticket` 自動做這一步 |
| B. agent 開場自己查 | agent 每次啟動先查「代做 agent 是我、session 等接手」的票；Bolas 只要開一個新 session，不用貼指令，但 agent 什麼時候啟動還是要人開 |
| C. 本機常駐程式 | 電腦上跑一個小程式定時查 Nextline、自動開 agent session；全自動，但多一個要裝、要維護的東西，不在第二版範圍 |

推薦 A：不用新增任何常駐程式，跟現在派工流程一致；B 可以同時做（MCP 多一個查詢條件），兩者不衝突。
