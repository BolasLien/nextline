# Nextline 第二版：設計系統

> NX-148（Project「Nextline 第二版：可商用」）。2026-11-03。只做設計，不改 `worker/`。
> 依據：品牌方向 A「定線 Steady」（NX-169，2026-11-04 從方向 B「接力」改過來：B 顏色比較鮮豔，長時間看眼睛吃力）（[../brand/directions.html](../brand/directions.html)）、資訊架構（[../ia/README.md](../ia/README.md)、[../ia/flows.md](../ia/flows.md)、[../ia/wireframes.html](../ia/wireframes.html)）、產品定位的五條產品原則（內部文件，未收進本 repo）。
> 同資料夾：[tokens.ts](tokens.ts)（正本）、[tokens.css](tokens.css)（產生的）、[overview.html](overview.html)（所有 tokens 與元件狀態，直接用瀏覽器打開）、`build.mjs`、`contrast.mjs`。

## 怎麼用

```
tokens.ts（改這裡）
   │ node docs/design/system/build.mjs
   ├──▶ tokens.css           React 入口 import 一次
   ├──▶ overview.html        內嵌同一份 tokens，打開就能看
   └──▶ contrast.mjs --write 對比結果寫進本檔最後一段；有不及格就失敗
```

- **樣式一律用 CSS 變數**：`var(--color-surface)`、`var(--space-3)`。深淺色自動切換，React 不用知道現在是哪個主題。TypeScript 端只在拿不到 CSS 的地方（canvas、圖表、拖曳時算位置）讀 `tokens.ts`，或用 `cssVar('color-primary')` 拿變數字串。
- **深淺色**：預設跟系統；設定頁「偏好」把選擇寫在 `<html data-theme="light|dark">`。`data-theme` 也能放在任何容器上，只影響那一塊（overview 的色票就是這樣並排深淺色）。
- **不要寫死顏色**：元件裡出現 `#` 色碼或 `rgb()`，就是少了一個 token；先加進 `tokens.ts`、跑 build，再用。
- **狀態色三件組**：每個票狀態、session 狀態都有 `fg`（文字與圖示，對比 ≥4.5）、`solid`（色點、欄頂圖示，≥3）、`soft`（徽章底色）。例：`--status-in-review-fg`。
- **元件命名**：overview 的參考 CSS 用 `.nl-<元件>`、修飾 `--<變體>`；強制狀態類別（`.is-hover`、`.is-focus`、`.is-active`、`.is-loading`）只是展示用，React 實作用 `:hover`、`:focus-visible`、`:active`、`aria-busy`。React 元件建議照 colocation 放在 `web/src/ui/<Component>/`（元件、樣式、測試同一個資料夾）。

## 品牌規則摘要（方向 A「定線 Steady」）

| 項目 | 規則 |
|---|---|
| 色彩 | 墨藍 `#1E3A5F`＝人、主要動作；青綠＝agent（品牌色 `#0E8F80`，當文字用加深一階 `#0B7568`）；冷灰底 `#F5F7FA`、深墨字 `#0F1B2D`。狀態用方向 A 的藍（進行中 `#2563EB`）、琥珀（等你 `#B45309`）、綠（完成 `#15803D`）、紅（出錯 `#C62828`）、灰（太久沒更新 `#6B7280`）。目標是長時間看不刺眼：大面積的底色（背景、側欄、hover、選取、soft 徽章底、待驗收欄）都是低彩度，鮮豔的顏色只留給小面積的色點與文字。深色模式是「暗灰」（底 `#1F242C`、表面 `#282E37`、字 `#D5DBE3`），不是接近黑的深墨，見下方「深色模式：暗灰」 |
| 字體 | 英文數字 Inter（fallback SF Pro Text），中文蘋方／思源黑體，票號與張數 JetBrains Mono（數字等寬，張數變動不會跳）。字型不內嵌，沒裝的電腦顯示 fallback |
| 字重 | 只用 400／600：內文 400，強調與標題 600（`font-weight-semibold`、`font-weight-bold` 都是 600）。下面元件寫的「700」「800」都是指這兩個 token，實際是 600 |
| 圓角 | 方角容器：`radius-xs` 2（同圖示轉角）、`radius-sm` 4（按鈕、輸入框、徽章、晶片、分段切換、選單項目）、`radius-md` 6（卡片、選單、toast）、`radius-lg` 8（欄、對話框、指令面板）。膠囊只留給張數計數；人頭像正圓、FAB 正圓 |
| 陰影 | 冷色、貼近表面；每層陰影帶一圈 1px 淡邊，卡片邊緣清楚但不靠深陰影分層；深色模式改用黑色陰影＋白色 4～6% 細邊 |
| 圖示 | 24px 格、線寬 1.5px、轉角半徑 2px、圓頭端點、`currentColor` |
| Logo | 方角容器（淺色 `#1E3A5F`、深色 `#2A4568`）裡兩條橫線：上面短的白線是人，下面往右縮排、比較長的青綠線（`#2DD4BF`）是 agent。favicon 同一個圖（`app/public/favicon.svg`） |
| 語氣 | 冷靜、少話，像一份排版精準的工作日誌。按鈕寫動作（「建立票」「移回待驗收」）；空狀態一句事實（「這一欄沒有票。」）；錯誤寫「什麼失敗：原因」＋東西還在不在（「儲存失敗：連線中斷。修改已保留，恢復連線後會自動送出。」）；toast 寫結果（「NX-146 已移到「待驗收」」）。不用口語（「好像」「還空著」「出了點問題」） |

## Done 與復原（2026-11-03 Bolas 決定）

人和 agent 都能把票移到 Done；做錯了再移回來。所以設計系統把「移回」當成一級動作：

```
誰移到 Done          怎麼移回來
自己（拖拉、按鈕） ─▶ toast「復原」10 秒（duration-toast-undo）
agent             ─▶ Done 欄卡片標「claude-nextline 移到 Done」＋「移回待驗收」
任何人、任何時候   ─▶ 票詳細頁／預覽面板的變更紀錄，每筆「還原」一鍵改回
```

- 每一個會改變票的動作，都要在 toast 或變更紀錄裡找得到改回去的路；不靠確認對話框擋。確認對話框只留給「一次影響多張票」或「刪掉範例」這種範圍大的動作。
- 「還原」是寫一筆新的變更（「Bolas 還原了 claude-nextline 的狀態變更」），不刪舊紀錄；被還原的那筆加刪除線、標「已還原」。

---

## 元件

每個元件寫：用途、組成、尺寸、狀態、鍵盤、無障礙。狀態沒有列出的，代表該元件沒有那個狀態（例如徽章沒有 hover）。所有可互動元件的 focus 一律是 `2px solid var(--color-focus)`、`outline-offset: 2px`（列表列、選單項目、側欄項目改 `-2px`，畫在內側），只在 `:focus-visible` 出現。

### 1. 按鈕

- **用途**：觸發動作。主要（一個畫面最多一顆：建立票、回覆、建立）、次要（取消、清除篩選）、文字（複製開工指令、還原、移回待驗收、打開）、危險（只在確認對話框：取消這張票、清掉範例）、icon（更多、關閉、展開、欄標題的＋）。
- **組成**：〔左 icon〕＋文字＋〔快捷鍵 `nl-kbd`〕。icon 按鈕只有圖示。
- **尺寸**：高 `size-control-sm` 28／`md` 36（預設）／`lg` 44（手機底部固定按鈕、觸控目標）。左右 padding 12／16／20；文字按鈕 10。icon 按鈕正方形，寬＝高。圓角 `radius-sm`。字 `font-size-md`（sm 用 `font-size-sm`）、600。icon 16px。
- **狀態**：
  | 狀態 | 主要 | 次要 | 文字 | 危險 | icon |
  |---|---|---|---|---|---|
  | default | `primary` 底、`on-primary` 字、`shadow-button` | `surface` 底、1.5px `line-strong` 內框 | 透明底、`link` 字 | `danger` 底、`on-danger` 字 | 透明、`text-muted` |
  | hover | `primary-hover` | `hover` 底、框變 `border-input` | `primary-soft` 底 | `danger-hover` | `hover` 底、`text` |
  | focus | 加焦點框 | 同 | 同 | 同 | 同 |
  | active | `primary-active`、下移 1px、去陰影 | `surface-2`、下移 1px | 下移 1px | 下移 1px | `surface-2` |
  | disabled | `surface-2` 底、`text-disabled` 字、`cursor:not-allowed` | 同 | 透明底、`text-disabled` | 同主要 | 同文字 |
  | loading | 文字隱藏、寬度不變，中間 16px 轉圈；`aria-busy="true"`，不能再按 | 同（轉圈用 `text`） | 同（轉圈用 `link`） | 同 | 同 |
  | error | 按鈕本身沒有錯誤狀態；動作失敗用 toast 或欄位錯誤訊息 | | | | |
- **動效**：底色 `duration-fast` `ease-standard`。
- **鍵盤**：Tab 可到；Enter、Space 觸發。快捷鍵寫在按鈕上（`C`、`⌘↵`），也寫進 `aria-keyshortcuts`。
- **無障礙**：用 `<button>`，不用 `<div>`；連到別頁的用 `<a>` 套同樣樣式。icon 按鈕必填 `aria-label`（例：「更多動作」「關閉預覽（Esc）」），並有 tooltip。disabled 但需要說明原因時用 `aria-disabled="true"`（仍可 focus、tooltip 說原因，例：「做完的 session 不能停止」），不要用 `disabled` 讓它從 Tab 順序消失。最小觸控目標：手機 44×44，桌面 28 時周圍留 8px 以上間距。

### 2. 輸入框

- **用途**：單行文字：票標題、篩選、view 名稱、搜尋。
- **組成**：〔label〕＋輸入框＋〔說明文字或錯誤訊息〕。開票對話框的標題用無框大字版（`nl-title-input`，`font-size-xl` 800）。
- **尺寸**：高 36（手機 44）、左右 padding 12、圓角 `radius-sm` 4、邊框 1.5px `border-input`、字 `font-size-md`。label 13／700，說明與錯誤 13。label 與框距 6px。
- **狀態**：default（`border-input`）／hover（框變 `text-muted`）／focus（框變 `focus`＋外框 1px）／disabled（`surface-2` 底、`line-strong` 框、`text-disabled` 字）／error（框 `danger`，下方紅字＋警示 icon）／loading（右側 16px 轉圈，`aria-busy`，用在遠端驗證或搜尋中）。
- **鍵盤**：一般文字輸入；Esc 在篩選框清空內容，再按一次離開；`/` 從任何地方聚焦篩選列。
- **無障礙**：一定有 `<label>`（視覺上不顯示時用 `aria-label`）。錯誤用 `aria-invalid="true"`＋`aria-describedby` 指到錯誤訊息；錯誤訊息不只靠紅色，前面有 icon，文字寫要怎麼改（「標題必填」）。placeholder 不當 label 用。

### 3. textarea

- **用途**：票描述、comment、待驗收的回覆。
- **組成、尺寸、狀態**：同輸入框；最小高 96，`line-height-normal`，可往下拉長（`resize: vertical`）。內容空白時送出按鈕 disabled。
- **鍵盤**：`Cmd/Ctrl+Enter` 送出；Enter 換行；Esc 不清空（避免打一半的字消失）。
- **無障礙**：同輸入框；必填在 label 寫「（必填）」並加 `aria-required="true"`。

### 4. select／combobox

- **用途**：從清單選一個值。select：狀態、分組。combobox（可打字篩選）：代做 agent、Project、篩選條件的值。
- **組成**：觸發按鈕（外觀同輸入框：〔頭像或色點〕＋目前值＋下箭頭）＋浮層（`nl-popover`：〔搜尋框〕＋選項列＋〔分隔線＋「移除代做 agent」這類清除選項〕）。
- **尺寸**：觸發按鈕同輸入框。浮層最小寬 220、圓角 `radius-md`、`shadow-lg`、內距 6；選項高 36、圓角 `radius-sm`、頭像 20。最多顯示 8 項，其餘捲動。
- **狀態**：觸發按鈕 default／hover／focus／disabled／error 同輸入框；未選時顯示 `text-muted` 的提示（「還沒交給 agent」）。浮層選項：default／hover 與鍵盤選中（`hover` 底）／已選（右側 `primary` 打勾）／disabled（`text-disabled`）。浮層 loading：搜尋框右側轉圈＋兩列 skeleton。沒結果：一句話＋下一步（「沒有叫「gemini」的 agent。到 設定 → 成員與 agent 加一個。」）。
- **動效**：浮層 `duration-base` `ease-enter` 淡入＋從觸發點方向位移 4px；關閉 `duration-fast` `ease-exit`。
- **鍵盤**：觸發按鈕上 Enter／Space／↓ 打開；打開後游標在搜尋框，打字即篩選；↑↓ 移動，Enter 選定並關閉，Esc 關閉不改值，Tab 選定目前項並移到下一個欄位。快捷鍵直接開對應 combobox：`S` 狀態、`D` 代做 agent、`P` Project。（產品不放 Sprint，NX-160）
- **無障礙**：照 WAI-ARIA combobox 模式：搜尋框 `role="combobox"`、`aria-expanded`、`aria-controls`、`aria-activedescendant`；清單 `role="listbox"`、選項 `role="option"`＋`aria-selected`。焦點留在搜尋框，不移到選項上。選定後用 toast 或 live region 讀出結果。

### 5. 徽章（票狀態、agent session 狀態）

- **用途**：票狀態徽章：列表、預覽面板、手機卡片上告訴你票在哪一步（看板上已由欄位表達，卡片不重複放）。session 徽章：卡片角落告訴你 agent 有沒有在動（產品原則 2）。
- **組成**：票狀態＝狀態圖示（14px）＋名稱；session＝色點（7px）＋名稱＋〔`・`附加資訊：時間、輪數〕。另有無底色版（`--bare`），用在表格欄位與選單。
- **尺寸**：高 22、左右 padding 9、圓角 `radius-sm`、字 `font-size-xs` 600。
- **票狀態**（顏色＋形狀，色盲也分得出）：

  | 狀態 | 介面名稱 | 圖示 | token |
  |---|---|---|---|
  | backlog | Backlog | 虛線圓 | `status-backlog-*`（中性灰） |
  | todo | Todo | 空心圓 | `status-todo-*`（深中性） |
  | in-progress | In Progress | 半滿圓 | `status-in-progress-*`（藍） |
  | in-review | 待驗收 | 四分之三滿圓 | `status-in-review-*`（琥珀） |
  | done | Done | 實心圓＋勾 | `status-done-*`（綠） |
  | canceled | Canceled | 空心圓＋叉 | `status-canceled-*`（中性灰） |

- **session 狀態**（IA README 第 2 段的 8 種；色點形狀也不同）：

  | 狀態 | 徽章文字 | 色 | 色點 |
  |---|---|---|---|
  | pending | 等 agent 接手（超過 30 分鐘改「還沒開工」，改用琥珀，因為進了「等你」） | agent 青綠 | 空心 |
  | active | 進行中・〈最後活動時間〉 | 藍 | 實心、1.6 秒呼吸 |
  | awaiting-input | 等你回覆 | 琥珀 | 實心 |
  | error | 出錯 | 紅 | 菱形 |
  | stale | 太久沒更新・〈分鐘〉 | 中性灰 | 實心 |
  | stopping | 停止中… | 紅 | 實心、1 秒呼吸 |
  | stopped | 已停止 | 深中性 | 方形 |
  | complete | 做完了 | 綠 | 實心 |

  琥珀在系統裡只代表「輪到你」：待驗收欄、等你回覆、還沒開工都用它，跟品牌 C 方向「主色＝輪到你」的優點取一半，但不跟主色搶。退回後的新一輪寫成「第 2 輪・等 agent 接手」。
- **狀態**：只有 default。呼吸動畫在 `prefers-reduced-motion` 時停。
- **鍵盤**：徽章本身不可 focus；有更多資訊（出錯的第一行、停止時間）時，由外層卡片或列 focus 後的 tooltip 顯示。
- **無障礙**：文字一定在（不只色點）；色點與圖示 `aria-hidden`。session 狀態改變時不主動朗讀（避免 agent 每分鐘更新一直打斷），只有變成「等你回覆」「出錯」「做完了」時，用 `aria-live="polite"` 的區域讀一次「NX-148：claude-nextline 等你回覆」。

### 6. 頭像（人、agent）

- **用途**：卡片、列表、變更紀錄、選單裡標出「誰」。人和 agent 要一眼分得出來（產品原則 1）。
- **組成**：人＝實心正圓、`primary` 底、`on-primary` 的名字第一個字。agent＝空心圓角方形（圓角 30%）、`agent-soft` 底＋1.5px `agent` 內框＋機器人圖示。跟 logo 同一個語言：實心是人、空心是 agent。還沒交給 agent＝虛框方形＋「＋」。
- **尺寸**：`size-avatar-sm` 20（卡片、列表）／`md` 24（預覽面板）／`lg` 32（設定頁成員列表）。字＝尺寸 × 0.46、800；圖示＝尺寸 × 0.62。
- **組合**：卡片上固定「負責人 → 代做 agent」：人頭像＋箭頭＋agent 頭像＋agent 名稱（名字太長省略）。
- **狀態**：default；可點時（卡片上的「＋」開 combobox）有 hover（`hover` 底）與 focus。agent 被停用時頭像 50% 透明＋tooltip「已停用」。
- **鍵盤**：頭像本身不可 focus，除非它是按鈕（「＋ 交給 agent」）。
- **無障礙**：單獨出現時 `role="img"`＋`aria-label`（「負責人 Bolas」「代做 agent claude-nextline」）；旁邊已有名字時 `aria-hidden`。人與 agent 的區分不只靠形狀：`aria-label` 寫出身分。

### 7. 票卡片

- **用途**：看板上的一張票。回答「這張是什麼、誰負責、agent 有沒有在動」。
- **組成**（照 IA 的「卡片固定四樣」）：第一行 票號（mono）＋Project 色點與名稱；標題（最多 3 行，超過省略）；底列 負責人 → 代做 agent＋session 徽章。依情況多一行：等你回覆時寫 agent 的問題第一行、待驗收時寫摘要第一行（引言樣式，左邊 3px 狀態色線）。滑過時右上角「⋯」。選取時左上角勾選框。
- **尺寸**：寬跟欄（`size-board-col` 296 − 內距）、內距 10／12／12、圓角 `radius-md` 6、卡片間距 8。標題 `font-size-md` 700、`line-height-snug`。
- **狀態**：
  | 狀態 | 樣子 |
  |---|---|
  | default | `surface` 底、`shadow-sm`、沒有邊框 |
  | hover | `shadow-md`、上移 1px、顯示「⋯」 |
  | focus | 焦點框（鍵盤 J／K 或方向鍵移到這張） |
  | active／dragging | 抓起時旋轉 1.5°、放大 1.02、`shadow-drag`；原位置留 2px 虛框的放置位置 |
  | selected | `selected` 底＋2px `primary` 內框＋左上角勾選 |
  | 剛更新 | agent 改過：2px `agent` 內框＋上方一行「claude-nextline 移到待驗收・剛剛」，5 秒（`duration-updated-flash`）後淡出 |
  | agent 移到 Done | Done 欄裡：標題改 `text-muted`；上方「claude-nextline 移到 Done・3 分鐘前」；底部「做錯了？ 移回待驗收」文字按鈕（保留到使用者看過或 24 小時） |
  | error | 2px `danger` 內框＋底部「儲存失敗：〈原因〉 重試」；卡片回到原欄 |
  | disabled | Canceled 的票：標題刪除線、`aria-disabled`、不能拖 |
  | loading | skeleton（票號、標題兩行、兩個頭像） |
- **動效**：移欄、放下 `duration-slow` `ease-spring`；hover `duration-fast`。
- **鍵盤**：卡片是一個 focus 點（roving tabindex：整個看板只有一張卡片在 Tab 順序裡，其他用方向鍵）。←→ 換欄、↑↓ 同欄移動、Enter 打開預覽、Space 或 X 選取、`S`／`D`／`P`／`Y` 改欄位、`Cmd+←/→` 把卡片移到左右欄（鍵盤版拖拉）。
- **無障礙**：卡片 `aria-label`＝「NX-148 05 設計系統…，In Progress，負責人 Bolas，代做 claude-nextline，進行中」。拖拉一定有鍵盤替代（上面的 `Cmd+←/→` 與狀態選單）；移欄後 live region 讀「NX-148 移到待驗收」。手機不拖拉，用狀態按鈕。

### 8. 看板欄

- **用途**：一個狀態一欄；欄的位置就是票在哪一步。
- **組成**：欄標題（狀態圖示＋名稱＋張數＋〔＋開票〕）＋卡片列。Done 標題寫「Done・7 天」。
- **尺寸**：寬 `size-board-col` 296、內距 10、圓角 `radius-lg` 8、底 `surface-2`、欄距 12。收起的欄只有一行（圖示＋名稱＋張數＋▸），寬度依內容。
- **狀態**：
  | 狀態 | 樣子 |
  |---|---|
  | default | `surface-2` 底 |
  | 待驗收 | `review-col` 底＋2px 琥珀虛線框（`review-col` 是幾乎中性的淡灰，只靠虛線框標出來） |
  | 收起 | Backlog、Canceled 預設收起；點或 Enter 展開 |
  | drop target（拖曳中可放） | `primary-soft` 底＋2px `primary` 虛線框；收起的欄拖曳時自動展開成放置區 |
  | 空 | 一句話的虛框：「拖一張票過來」；待驗收欄寫「agent 做完的票會出現在這裡」。不放插圖 |
  | loading | 3 張卡片 skeleton |
  | hover／focus | 欄本身不可 focus；收起的欄是按鈕，有 hover（`hover` 底）與焦點框 |
- **鍵盤**：見票卡片；收起的欄 Enter 展開、展開後焦點到第一張卡片。
- **無障礙**：欄是 `<section aria-label="待驗收，2 張">`；收起的欄是 `<button aria-expanded="false">`。看板整體 `role="region" aria-label="看板：全部沒做完的票"`。

### 9. 列表列

- **用途**：「全部的票」（含「已封存」）、Project 的列表版面、`/me` 桌面版。
- **組成**：勾選框｜票號｜標題｜Project｜頭像（負責人＋代做）｜session 徽章｜更新時間。分組列（狀態圖示＋名稱＋張數）。底部浮出批次操作列（見 flows.md 次要流程 3）。
- **尺寸**：高 44（分組列 34）、左右 padding 12、欄距 10、字 13（標題 15／700）。手機寬度改兩行：第一行票號＋徽章、第二行標題。
- **狀態**：default／hover（`hover` 底）／focus（內側焦點框）／selected（`selected` 底＋左側 3px `primary` 條＋勾選）／loading（skeleton 列）／error（同卡片：左側 3px `danger` 條＋列尾「重試」）。disabled 不用（Canceled 的列只是標題刪除線）。
- **鍵盤**：J／K 或 ↑↓ 移動、Enter 打開預覽、X 選取、Shift＋點或 Shift＋↑↓ 選範圍、`Cmd/Ctrl+A` 全選、Esc 取消選取。
- **無障礙**：整個列表 `role="grid"`，列 `role="row"`＋`aria-selected`；只有一列在 Tab 順序裡（roving tabindex）。勾選框 `role="checkbox"`＋`aria-label="選取 NX-148"`。

### 10. 側欄

- **用途**：桌面的主要導覽：去哪裡找票（IA 第 1 段網站地圖）。
- **組成**：logo＋名稱；搜尋（⌘K）與＋建立票；「等你」（張數用 `primary` 膠囊）；看板；全部的票；Project 群組（Project 色點）；設定。（三區、Sprint、我的 view 在 NX-160 拿掉）
- **尺寸**：寬 `size-sidebar` 248、內距 12、底 `sidebar`。項目高 34、圓角 `radius-sm`、圖示 18、字 15。群組標題 12／800 `text-muted`。
- **狀態**：default／hover（`hover` 底）／focus（內側焦點框）／目前頁（`surface` 底＋`shadow-sm`＋700 字＋圖示變 `primary`＋左側 3px `primary` 條）。張數為 0 時「等你」不顯示膠囊。
- **鍵盤**：Tab 依序；`G` 然後 `B`／`I`／`M`／`Z` 直接跳。群組可收合（Enter）。
- **無障礙**：`<nav aria-label="主要">`；目前頁 `aria-current="page"`；張數膠囊 `aria-label="3 張"`，讓螢幕閱讀器讀成「等你，3 張」。

### 11. 底部分頁列（手機）

- **用途**：手機取代側欄（寬度 < `breakpoint-md` 760）。
- **組成**：5 格：看板、等你（張數）、全部、搜尋、更多（Project、外觀、設定）。右下角浮動「開票」按鈕（`nl-fab`，52px 正圓 `primary`）。
- **尺寸**：高 `size-tabbar` 56（加上 iOS `env(safe-area-inset-bottom)`）、每格等寬、圖示 22、字 12／700。張數膠囊在圖示右上。
- **狀態**：default（`text-muted`）／目前頁（`primary` 圖示與字）／focus（內側焦點框）／按下（`hover` 底）。
- **鍵盤**：Tab 依序；外接鍵盤時同桌面快捷鍵。
- **無障礙**：`<nav aria-label="主要">`，目前頁 `aria-current="page"`。每格觸控目標至少 44×44。FAB 有 `aria-label="建立票"`，不擋住列表最後一張（列表底部多留 80px）。

### 12. Cmd+K 指令面板

- **用途**：任何畫面找票、跳頁、對選取的票做動作（flows.md 次要流程 2）。
- **組成**：輸入框（搜尋圖示＋輸入＋〔目前對象晶片「NX-148」〕）＋結果（分組：對這張票／跳到／票）＋底列（↑↓ 移動、↵ 執行、esc 關閉）。每個動作右邊顯示快捷鍵。
- **尺寸**：寬 `size-palette` 640（手機滿版、上方 8px）、圓角 `radius-lg`、`shadow-overlay`、距頂 12vh。輸入 17px、內距 14／16。結果最高 340 捲動。
- **狀態**：空輸入（顯示三組預設）／輸入中（即時篩選，最佳在上，選中項 `hover` 底）／沒結果（一句話＋建議：「找不到「甘特圖」。試試票號（例如 148）或頁面名稱。」）／loading（輸入框右側轉圈＋skeleton 列；超過 300ms 才顯示）／第二層（例：「交給 agent」→ agent 清單；左上出現返回，Backspace 在空輸入時回上一層）。
- **動效**：開 `duration-base` `ease-enter`（淡入＋縮放 0.98→1），關 `duration-fast` `ease-exit`。
- **鍵盤**：`Cmd/Ctrl+K` 開關；↑↓ 移動、Enter 執行、Esc 關閉（第二層時回上一層）、Tab 不離開面板。
- **無障礙**：`role="dialog" aria-modal="true" aria-label="指令面板"`；輸入框 `role="combobox"`＋`aria-activedescendant`；結果 `role="listbox"`、分組 `role="group"`＋`aria-label`。關閉後焦點回到開啟前的元素。執行動作的結果用 toast（同滑鼠操作）。

### 13. Modal

- **用途**：開票對話框；確認對話框（只給影響多張票或範圍大的動作，例：清掉範例、批次取消）。一般的移到 Done、取消單張票不用確認，用 toast「復原」。
- **組成**：標題列（標題＋關閉）＋內容＋底列（〔左側選項，例：繼續開下一張〕＋次要＋主要按鈕）。開票對話框內容（由上到下，Tab 順序相同，NX-161）：大字標題輸入、描述（標題列左邊「描述」、右邊編輯／預覽切換）、欄位晶片（Project、狀態、代做 agent，預填目前畫面的值）。
- **尺寸**：寬 `size-modal-md` 600（確認對話框 `size-modal-sm` 420）、圓角 `radius-lg`、`shadow-overlay`、底下 `scrim`。內距 20；手機改成從底部升起的整頁 sheet。
- **狀態**：開啟／送出中（主要按鈕 loading、其他欄位 disabled）／錯誤（欄位錯誤顯示在欄位下；網路錯誤顯示在底列上方，內容保留）。
- **動效**：`duration-slower` `ease-enter`：scrim 淡入、modal 上移 8px＋淡入；關閉 `duration-base` `ease-exit`。
- **鍵盤**：開啟後焦點到第一個輸入（確認對話框到「不危險」的那顆，例「先留著」）；Tab 循環在 modal 內；Esc 關閉（開票對話框有內容時先問「要丟掉這張草稿嗎？」）；`Cmd/Ctrl+Enter` 送出。
- **無障礙**：`role="dialog"`（確認用 `alertdialog`）＋`aria-modal="true"`＋`aria-labelledby` 指標題、`aria-describedby` 指說明。背景 `inert`。關閉後焦點回到開啟它的按鈕。

### 14. 右側預覽面板

- **用途**：從看板或列表點卡片，不離開畫面看一張票（網址 `?peek=NX-12`）。待驗收的票在這裡回覆（NX-239：沒有通過／退回，狀態交給 agent）；變更紀錄在這裡還原。
- **組成**（由上到下，第一屏要看到「等你回覆」、session 與停止、變更紀錄，產品原則 4）：標題列（Project ／ 票號、「⋯」更多動作（封存）、展開、關閉）→ 已封存列（只在封存的票：「已封存」＋取消封存）→ 「等你回覆」（只在待驗收：直接以 Markdown 完整渲染最新一則 comment，含作者與時間，長文預設限高 240px＋底部漸層收尾與「展開全文／收合」按鈕，短文直接全顯示不出現展開鈕；沒有 comment 時退回顯示 `next_step` 或預設提示；待驗收時不另外顯示「下一步」區塊；下面是回覆框＋「回覆」。comment 區在待驗收時不放輸入框）→ 標題（可就地編輯）→ 欄位（狀態、負責人、代做 agent、Project、到期日、blocked by）→ session 面板（第 N 輪＋徽章＋停止＋最近活動）→ 變更紀錄（每筆：誰的頭像＋「把狀態從 A 改成 B」＋時間＋「還原」）→ comment。
- **尺寸**：寬 `size-peek` 480（視窗 < 1024 時蓋在看板上、≥1024 時推開看板）、滿高、`shadow-overlay`、內距 16。手機不開預覽，直接進完整頁。
- **狀態**：開啟／loading（標題與欄位 skeleton）／找不到票（空狀態「NX-999 不存在或已刪除」）／欄位儲存中（該欄位旁轉圈）／欄位儲存失敗（欄位下紅字＋重試，值改回原本）。變更紀錄每筆：default（「還原」文字按鈕）／還原中（按鈕 loading）／已還原（整筆 `text-muted`＋刪除線＋「已還原」）／不能還原（例：票已刪除，按鈕 `aria-disabled`＋tooltip 說原因）。停止按鈕：session 進行中可按；做完或已停止時 `aria-disabled`。
- **動效**：從右滑入 `duration-slower` `ease-enter`；關閉 `duration-base` `ease-exit`。
- **鍵盤**：Enter 從卡片開、再按 Enter 展開成完整頁、Esc 關閉；↑↓（焦點不在輸入框時）換上一張／下一張票，面板保持開著。回覆框裡 `Cmd/Ctrl+Enter`＝送出回覆。
- **無障礙**：`<aside role="dialog" aria-labelledby>`，不設 `aria-modal`（看板仍可操作）；開啟時焦點到面板標題，關閉時回到原卡片。變更紀錄是 `role="list"`；每個「還原」的 `aria-label` 寫清楚還原什麼（「還原：狀態改回 In Progress」）。

### 15. Toast

- **用途**：動作的結果與「改回去」的入口。flows.md 回饋的共通規則：一般 4 秒；會讓票離開目前畫面的變更（移到 Done、取消、封存、批次）帶「復原」10 秒。
- **組成**：〔icon〕＋訊息＋〔一個動作：復原／打開／重試／複製開工指令〕＋〔關閉〕＋〔有「復原」時底部倒數條〕。一則 toast 最多一個動作。
- **尺寸**：最寬 `size-toast` 420、圓角 `radius-md`、內距 10／8／10／14、`inverse-bg` 底、`inverse-text` 字、動作 `inverse-action` 700。桌面右下角距邊 16，手機底部分頁列上方、滿寬減 16 邊距。最多同時 3 則，新的在下。
- **狀態**：一般（`role="status"`）／帶復原（倒數條從滿到空，滑鼠移上或 focus 時暫停）／錯誤（左側 4px `danger` 條、`role="alert"`、不自動消失，直到重試成功或關閉）／復原後（同一則改成「已復原」1.5 秒後消失）。
- **動效**：從下方 8px 滑入 `duration-base` `ease-enter`；離開 `duration-fast` `ease-exit`。
- **鍵盤**：`Cmd/Ctrl+Z` 等於按最近一則的「復原」（10 秒內）。toast 不搶焦點；`F6` 或 Tab 到 toast 區可操作。
- **無障礙**：容器 `aria-live="polite"`（錯誤 `assertive`）。帶動作的 toast 時間不夠時可延長：滑過或 focus 時暫停計時（WCAG 2.2.1）。動作也一定有其他入口（變更紀錄的「還原」），toast 消失不會讓人失去改回去的機會。

### 16. 空狀態

- **用途**：沒有內容時告訴你第一步（產品原則 5）。
- **組成**：〔44px 圖示方塊〕＋一句標題＋一句說明＋〔一顆按鈕〕。欄內的空狀態只有一句話的虛框，不放圖示與按鈕。
- **尺寸**：內距 28／16、置中、1.5px `line-strong` 虛框、圓角 `radius-lg`。標題 17／800，說明 13 `text-muted`、最寬 340。
- **文案**（方向 A 語氣）：看板「沒有票」＋「按 C 建立票。」；看板欄「這一欄沒有票。」；篩選「沒有符合的票」＋「調整條件，或清除篩選。」
- **狀態**：只有 default；按鈕照按鈕規則。
- **無障礙**：標題用該區塊的下一層標題（`h2`／`h3`），按鈕是頁面上唯一的主要動作時焦點可以直接給它。

### 17. loading skeleton

- **用途**：第一次載入、換頁時佔位，讓版面不跳動。
- **組成**：跟真實內容同大小的圓角方塊（票號 48×10、標題 90%×14、頭像 20 圓／圓角方、徽章 64×20 方角）。
- **規則**：超過 300ms 才顯示（避免閃一下）；重新抓資料（每 60 秒、視窗回到焦點）不用 skeleton，直接替換。
- **樣子**：`skeleton` 底、`skeleton-shine` 由右往左掃光 1.4 秒；`prefers-reduced-motion` 時不掃光。
- **無障礙**：容器 `aria-busy="true"`＋`aria-label="載入中"`，skeleton 本身 `aria-hidden`。

### 18. tooltip

- **用途**：補充說明：icon 按鈕的名稱與快捷鍵、頭像的身分、徽章的細節（出錯第一行、停止時間）、disabled 的原因。不放必要資訊。
- **組成**：文字＋〔快捷鍵，`inverse-muted` mono〕＋箭頭。
- **尺寸**：最寬 `size-tooltip` 280、內距 6／10、圓角 `radius-sm`、字 13、`inverse-bg` 底。與目標距 6px，預設在上方，空間不夠翻到下方。
- **狀態**：滑過 500ms 出現、移開 100ms 消失；鍵盤 focus 立即出現。`duration-base` 淡入。
- **鍵盤**：Esc 關閉（焦點不動）。
- **無障礙**：`role="tooltip"`，目標用 `aria-describedby` 連過去（icon 按鈕的名稱另外用 `aria-label`，tooltip 只是視覺）。滑鼠可以移到 tooltip 上不消失（WCAG 1.4.13）。觸控裝置不靠 tooltip：同樣的資訊在長按選單或詳細頁找得到。

### 19. 選單

- **用途**：狀態選單（`S`）、卡片「更多」選單（右鍵或 ⋯）、篩選列的「＋ 篩選」。
- **組成**：同 combobox 的浮層：〔搜尋框〕＋項目（〔icon〕＋名稱＋〔右側：打勾、快捷鍵、說明〕）＋分隔線＋〔危險項目放最後〕。
- **尺寸**：最小寬 220、項目高 36、圓角 `radius-md`、`shadow-lg`。
- **狀態**：項目 default／hover 與鍵盤選中（`hover` 底）／focus（內側焦點框）／已選（`primary` 打勾，`menuitemradio aria-checked`）／disabled（`text-disabled`，右側寫原因：「沒有進行中的 session」）／危險（`danger` 字，點了開確認對話框，名稱後加「…」）。
- **動效**：同 combobox 浮層。
- **鍵盤**：↑↓ 移動、Enter 執行、Esc 關閉並回到觸發元素、打字篩選；狀態選單數字鍵 1～6 直接選。右鍵選單 `Shift+F10` 也能開。
- **無障礙**：`role="menu"`＋`menuitem`／`menuitemradio`；觸發按鈕 `aria-haspopup="menu"`＋`aria-expanded`。disabled 項目用 `aria-disabled`（仍可移到，讀得到原因）。

---

## 對比檢查

`contrast.mjs` 讀 `tokens.ts`，對每一組「實際會疊在一起的前景＋背景」算 WCAG 2.2 對比（相對亮度公式，SC 1.4.3、1.4.11）。正文門檻 4.5；大字與 UI 元件（輸入框邊框、色點、狀態圖示、焦點框、按鈕底色對頁面）門檻 3。disabled 文字依 WCAG 例外不列入。toast、tooltip 的反白色也有檢查。

用法：`node docs/design/system/contrast.mjs`（有不及格就 exit 1）。`build.mjs` 每次會跑並更新下面這段。

### 從品牌方向 A 調整與補上的色值

品牌頁（directions.html）的 A 方向色碼直接拿來當文字或邊框時，有以下不及格，已調整：

| token | 品牌原值 | 問題（原值實測） | 調整後 |
|---|---|---|---|
| agent 文字 `color-agent`、`session-pending-fg` | #0E8F80 | 白底 3.99、`agent-soft` #DDF3EF 上 3.45 | #0B7568（agent-600）；色點與 logo 仍用品牌色（`session-pending-solid` #0E8F80、logo #2DD4BF） |
| 輸入框邊框 `color-border-input` | 只有 `line-strong` #C7CFDA | 白底 1.57，不到 UI 的 3 | 淺色 #7A8696、深色 #7D8796；`line-strong` 保留給裝飾分隔線 |
| 等你文字 `status-in-review-fg`、`session-awaiting-input-fg` | #B45309 | 徽章底 #F9F0E6 上 4.46 | #9A4508（色點、欄框仍用 #B45309） |
| 完成文字 `status-done-fg`、`session-complete-fg` | #15803D | 徽章底 #E8F3EC 上 4.41 | #116B33（色點仍用 #15803D） |
| 進行中文字 `status-in-progress-fg`、`session-active-fg` | #2563EB | 徽章底 #EAF0FB 上 4.52，剛好壓線 | #1D4FC4，留餘裕（色點仍用 #2563EB） |
| 太久沒更新文字 `session-stale-fg`、Backlog／Canceled 文字 | #6B7280 | 徽章底 #EEF1F5 上 4.27 | 改用次要文字色 #5B6675；色點用 #6B7280（Backlog／Canceled 色點 #7A8696） |
| 連結與焦點框 `color-link`、`color-focus` | 主色 #1E3A5F | 對比沒問題（11.5），但跟深墨字 #0F1B2D 幾乎分不出來 | #2C5282（主色亮一階），看得出是連結、焦點框也看得到 |

方向 A 沒定義、依現有 token 結構補上的：hover、選取、soft 徽章底、待驗收欄、skeleton、反白浮層、危險色的 hover 與 soft、Project 色盤、陰影。原則是大面積的底色都壓低彩度（例如淺色 hover #E6EAF0、選取 #E8EEF5、待驗收欄 #F3F2EE），Project 色盤也降低彩度、配合冷灰底。

### 深色模式：暗灰（NX-169 第二、三輪，2026-11-05 Bolas）

方向 A 原本的深色（底 #0B111A）太深，Bolas 從三個方案選了「暗灰」：整體調亮、彩度低、面與面的層次分得出。淺色不動。

第三輪：深色的待驗收太暗、文字有時看不清楚。WCAG 2 的公式在深色底上會高估對比，所以深色多跑一道 **APCA**（APCA-W3 0.0.98G，[apca-w3](https://github.com/Myndex/apca-w3)），門檻：內文與卡片標題 Lc ≥ 75、其他文字（次要文字、標籤、票號、徽章、按鈕字）≥ 60、圖示／色點／框線 ≥ 45；另外檢查待驗收欄不比其他欄暗。不過的一律調亮前景或調亮底色，不把底色調暗。

| 角色 | 色值 |
|---|---|
| bg／sidebar／surface／surface-2（= raised、hover） | #1F242C／#232831／#282E37／#313844 |
| line／line-strong／輸入框邊框 | #3A4250／#4A5363／#9CA4AF |
| 文字／次要文字 | #D5DBE3（頁面底 Lc 82）／#B8C0CB（頁面底 Lc 65、卡片底 Lc 64） |
| 主色／主色上的字／選取與 primary-soft | #8FB3E0（不變）／#14171C／#2F3A4A |
| agent／agent-soft | #73D0C2／#2A403F |
| 待驗收：文字／色點與欄框／徽章底 | #E8C07E／#D6A45E／#463C24（比原本的褐灰乾淨） |
| 看板待驗收欄底 | #353943（藍灰，比其他欄 #313844 亮一點，卡片 #282E37 分得出） |
| 詳細頁待驗收 block | 底 `color-review-bg` #313844＋左側 3px 琥珀邊（`shadow-review`）＋圖示 `color-review-icon` #E2B36E；淺色這三個 token 維持原樣（#F9F0E6、#B45309、沒有邊條） |
| 進行中／完成文字（色點） | #A4C2EA（#86AEE3）／#95CDA9（#74BE8E） |
| 出錯與危險色／危險按鈕上的字 | #F3ACAC（色點 #EE8C8C）／#14171C；#EE8C8C 上連純黑字都只有 Lc 57，所以危險色調亮 |
| Backlog、Canceled、太久沒更新：文字／色點 | #BAC1CC／#9CA4AF（太久沒更新色點 #9FA6B1） |
| logo 容器 | #2A4568 |

陰影比方向 A 原本的淡，Project 色盤降一點彩度。

### 結果

<!-- contrast:start -->
- 淺色：128 組，不及格 0 組。最接近門檻的三組：`color-agent` on `color-agent-soft` 4.83（門檻 4.5）、`session-pending-fg` on `session-pending-soft` 4.83（門檻 4.5）、`color-text-muted` on `color-hover` 4.83（門檻 4.5）
- 深色：128 組，不及格 0 組。最接近門檻的三組：`color-inverse-muted` on `color-inverse-bg` 5.56（門檻 4.5）、`color-inverse-action` on `color-inverse-bg` 5.72（門檻 4.5）、`status-done-fg` on `status-done-soft` 6.02（門檻 4.5）
- 深色 APCA（Lc 絕對值）：128 組，不及格 0 組。最接近門檻的三組：`session-stale-solid` on `session-stale-soft` Lc 45.0（門檻 45）、`color-on-primary` on `color-primary` Lc 60.1（門檻 60）、`status-done-fg` on `status-done-soft` Lc 60.1（門檻 60）

<details><summary>淺色：全部 128 組</summary>

| 前景 | 背景 | 用途 | 對比 | 門檻 | 結果 |
|---|---|---|---|---|---|
| `color-text` #0F1B2D | `color-bg` #F5F7FA | 正文 | 16.11 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-surface` #FFFFFF | 正文 | 17.28 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-surface-2` #EEF1F5 | 正文 | 15.26 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-sidebar` #EEF1F5 | 正文 | 15.26 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-hover` #E6EAF0 | 正文 | 14.31 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-selected` #E8EEF5 | 正文 | 14.80 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-review-col` #F3F2EE | 正文 | 15.43 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-primary-soft` #E8EEF5 | 正文 | 14.80 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-agent-soft` #DDF3EF | 正文 | 14.93 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-danger-soft` #FBEAEA | 正文 | 14.86 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-bg` #F5F7FA | 次要文字、placeholder、票號 | 5.43 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-surface` #FFFFFF | 次要文字、placeholder、票號 | 5.83 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-surface-2` #EEF1F5 | 次要文字、placeholder、票號 | 5.15 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-sidebar` #EEF1F5 | 次要文字、placeholder、票號 | 5.15 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-hover` #E6EAF0 | 次要文字、placeholder、票號 | 4.83 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-selected` #E8EEF5 | 次要文字、placeholder、票號 | 4.99 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-review-col` #F3F2EE | 次要文字、placeholder、票號 | 5.20 | 4.5 | 通過 |
| `color-on-primary` #FFFFFF | `color-primary` #1E3A5F | 主要按鈕文字、人的頭像字 | 11.50 | 4.5 | 通過 |
| `color-on-primary` #FFFFFF | `color-primary-hover` #172E4C | 主要按鈕文字、人的頭像字 | 13.71 | 4.5 | 通過 |
| `color-on-primary` #FFFFFF | `color-primary-active` #11233A | 主要按鈕文字、人的頭像字 | 15.84 | 4.5 | 通過 |
| `color-on-danger` #FFFFFF | `color-danger` #C62828 | 危險按鈕文字 | 5.62 | 4.5 | 通過 |
| `color-on-danger` #FFFFFF | `color-danger-hover` #A61F1F | 危險按鈕文字 | 7.40 | 4.5 | 通過 |
| `color-link` #2C5282 | `color-bg` #F5F7FA | 連結、文字按鈕 | 7.42 | 4.5 | 通過 |
| `color-link` #2C5282 | `color-surface` #FFFFFF | 連結、文字按鈕 | 7.97 | 4.5 | 通過 |
| `color-link` #2C5282 | `color-primary-soft` #E8EEF5 | 連結、文字按鈕 | 6.82 | 4.5 | 通過 |
| `color-agent` #0B7568 | `color-surface` #FFFFFF | agent 名稱、agent 頭像圖示 | 5.59 | 4.5 | 通過 |
| `color-agent` #0B7568 | `color-agent-soft` #DDF3EF | agent 名稱、agent 頭像圖示 | 4.83 | 4.5 | 通過 |
| `color-agent` #0B7568 | `color-bg` #F5F7FA | agent 名稱、agent 頭像圖示 | 5.21 | 4.5 | 通過 |
| `color-danger` #C62828 | `color-surface` #FFFFFF | 錯誤訊息 | 5.62 | 4.5 | 通過 |
| `color-danger` #C62828 | `color-danger-soft` #FBEAEA | 錯誤訊息 | 4.83 | 4.5 | 通過 |
| `color-danger` #C62828 | `color-bg` #F5F7FA | 錯誤訊息 | 5.24 | 4.5 | 通過 |
| `color-inverse-text` #F5F7FA | `color-inverse-bg` #0F1B2D | toast、tooltip 文字 | 16.11 | 4.5 | 通過 |
| `color-inverse-muted` #C7CFDA | `color-inverse-bg` #0F1B2D | tooltip 快捷鍵 | 11.00 | 4.5 | 通過 |
| `color-inverse-action` #8FB3E0 | `color-inverse-bg` #0F1B2D | toast「復原」「重試」 | 7.98 | 4.5 | 通過 |
| `color-text` #0F1B2D | `color-review-bg` #F9F0E6 | 待驗收 block：下一步文字 | 15.34 | 4.5 | 通過 |
| `color-text-muted` #5B6675 | `color-review-bg` #F9F0E6 | 待驗收 block：說明文字 | 5.17 | 4.5 | 通過 |
| `color-review-icon` #B45309 | `color-review-bg` #F9F0E6 | 待驗收 block：琥珀圖示 | 4.46 | 3 | 通過 |
| `color-review-icon` #B45309 | `color-surface` #FFFFFF | 待驗收 block：左側琥珀邊（對頁面卡片） | 5.02 | 3 | 通過 |
| `status-in-review-solid` #B45309 | `color-review-col` #F3F2EE | 待驗收欄：虛線框、欄頂圖示 | 4.48 | 3 | 通過 |
| `color-text` #0F1B2D | `color-review-col` #F3F2EE | 待驗收欄：欄標題 | 15.43 | 4.5 | 通過 |
| `status-backlog-fg` #5B6675 | `status-backlog-soft` #EEF1F5 | 票狀態 Backlog：徽章文字 | 5.15 | 4.5 | 通過 |
| `status-backlog-fg` #5B6675 | `color-surface` #FFFFFF | 票狀態 Backlog：卡片上的狀態文字 | 5.83 | 4.5 | 通過 |
| `status-backlog-solid` #7A8696 | `color-surface` #FFFFFF | 票狀態 Backlog：色點／圖示 | 3.70 | 3 | 通過 |
| `status-backlog-solid` #7A8696 | `color-bg` #F5F7FA | 票狀態 Backlog：欄頂色點 | 3.45 | 3 | 通過 |
| `status-todo-fg` #334458 | `status-todo-soft` #EEF1F5 | 票狀態 Todo：徽章文字 | 8.79 | 4.5 | 通過 |
| `status-todo-fg` #334458 | `color-surface` #FFFFFF | 票狀態 Todo：卡片上的狀態文字 | 9.96 | 4.5 | 通過 |
| `status-todo-solid` #334458 | `color-surface` #FFFFFF | 票狀態 Todo：色點／圖示 | 9.96 | 3 | 通過 |
| `status-todo-solid` #334458 | `color-bg` #F5F7FA | 票狀態 Todo：欄頂色點 | 9.28 | 3 | 通過 |
| `status-in-progress-fg` #1D4FC4 | `status-in-progress-soft` #EAF0FB | 票狀態 In Progress：徽章文字 | 6.19 | 4.5 | 通過 |
| `status-in-progress-fg` #1D4FC4 | `color-surface` #FFFFFF | 票狀態 In Progress：卡片上的狀態文字 | 7.08 | 4.5 | 通過 |
| `status-in-progress-solid` #2563EB | `color-surface` #FFFFFF | 票狀態 In Progress：色點／圖示 | 5.17 | 3 | 通過 |
| `status-in-progress-solid` #2563EB | `color-bg` #F5F7FA | 票狀態 In Progress：欄頂色點 | 4.82 | 3 | 通過 |
| `status-in-review-fg` #9A4508 | `status-in-review-soft` #F9F0E6 | 票狀態 待驗收：徽章文字 | 5.77 | 4.5 | 通過 |
| `status-in-review-fg` #9A4508 | `color-surface` #FFFFFF | 票狀態 待驗收：卡片上的狀態文字 | 6.50 | 4.5 | 通過 |
| `status-in-review-solid` #B45309 | `color-surface` #FFFFFF | 票狀態 待驗收：色點／圖示 | 5.02 | 3 | 通過 |
| `status-in-review-solid` #B45309 | `color-bg` #F5F7FA | 票狀態 待驗收：欄頂色點 | 4.68 | 3 | 通過 |
| `status-done-fg` #116B33 | `status-done-soft` #E8F3EC | 票狀態 Done：徽章文字 | 5.82 | 4.5 | 通過 |
| `status-done-fg` #116B33 | `color-surface` #FFFFFF | 票狀態 Done：卡片上的狀態文字 | 6.61 | 4.5 | 通過 |
| `status-done-solid` #15803D | `color-surface` #FFFFFF | 票狀態 Done：色點／圖示 | 5.02 | 3 | 通過 |
| `status-done-solid` #15803D | `color-bg` #F5F7FA | 票狀態 Done：欄頂色點 | 4.67 | 3 | 通過 |
| `status-canceled-fg` #5B6675 | `status-canceled-soft` #EEF1F5 | 票狀態 Canceled：徽章文字 | 5.15 | 4.5 | 通過 |
| `status-canceled-fg` #5B6675 | `color-surface` #FFFFFF | 票狀態 Canceled：卡片上的狀態文字 | 5.83 | 4.5 | 通過 |
| `status-canceled-solid` #7A8696 | `color-surface` #FFFFFF | 票狀態 Canceled：色點／圖示 | 3.70 | 3 | 通過 |
| `status-canceled-solid` #7A8696 | `color-bg` #F5F7FA | 票狀態 Canceled：欄頂色點 | 3.45 | 3 | 通過 |
| `session-pending-fg` #0B7568 | `session-pending-soft` #DDF3EF | session 等 agent 接手：徽章文字 | 4.83 | 4.5 | 通過 |
| `session-pending-fg` #0B7568 | `color-surface` #FFFFFF | session 等 agent 接手：卡片上的文字 | 5.59 | 4.5 | 通過 |
| `session-pending-solid` #0E8F80 | `session-pending-soft` #DDF3EF | session 等 agent 接手：徽章色點 | 3.45 | 3 | 通過 |
| `session-pending-solid` #0E8F80 | `color-surface` #FFFFFF | session 等 agent 接手：色點 | 3.99 | 3 | 通過 |
| `session-active-fg` #1D4FC4 | `session-active-soft` #EAF0FB | session 進行中：徽章文字 | 6.19 | 4.5 | 通過 |
| `session-active-fg` #1D4FC4 | `color-surface` #FFFFFF | session 進行中：卡片上的文字 | 7.08 | 4.5 | 通過 |
| `session-active-solid` #2563EB | `session-active-soft` #EAF0FB | session 進行中：徽章色點 | 4.52 | 3 | 通過 |
| `session-active-solid` #2563EB | `color-surface` #FFFFFF | session 進行中：色點 | 5.17 | 3 | 通過 |
| `session-awaiting-input-fg` #9A4508 | `session-awaiting-input-soft` #F9F0E6 | session 等你回覆：徽章文字 | 5.77 | 4.5 | 通過 |
| `session-awaiting-input-fg` #9A4508 | `color-surface` #FFFFFF | session 等你回覆：卡片上的文字 | 6.50 | 4.5 | 通過 |
| `session-awaiting-input-solid` #B45309 | `session-awaiting-input-soft` #F9F0E6 | session 等你回覆：徽章色點 | 4.46 | 3 | 通過 |
| `session-awaiting-input-solid` #B45309 | `color-surface` #FFFFFF | session 等你回覆：色點 | 5.02 | 3 | 通過 |
| `session-error-fg` #C62828 | `session-error-soft` #FBEAEA | session 出錯：徽章文字 | 4.83 | 4.5 | 通過 |
| `session-error-fg` #C62828 | `color-surface` #FFFFFF | session 出錯：卡片上的文字 | 5.62 | 4.5 | 通過 |
| `session-error-solid` #C62828 | `session-error-soft` #FBEAEA | session 出錯：徽章色點 | 4.83 | 3 | 通過 |
| `session-error-solid` #C62828 | `color-surface` #FFFFFF | session 出錯：色點 | 5.62 | 3 | 通過 |
| `session-stale-fg` #5B6675 | `session-stale-soft` #EEF1F5 | session 太久沒更新：徽章文字 | 5.15 | 4.5 | 通過 |
| `session-stale-fg` #5B6675 | `color-surface` #FFFFFF | session 太久沒更新：卡片上的文字 | 5.83 | 4.5 | 通過 |
| `session-stale-solid` #6B7280 | `session-stale-soft` #EEF1F5 | session 太久沒更新：徽章色點 | 4.27 | 3 | 通過 |
| `session-stale-solid` #6B7280 | `color-surface` #FFFFFF | session 太久沒更新：色點 | 4.83 | 3 | 通過 |
| `session-stopping-fg` #C62828 | `session-stopping-soft` #FBEAEA | session 停止中…：徽章文字 | 4.83 | 4.5 | 通過 |
| `session-stopping-fg` #C62828 | `color-surface` #FFFFFF | session 停止中…：卡片上的文字 | 5.62 | 4.5 | 通過 |
| `session-stopping-solid` #C62828 | `session-stopping-soft` #FBEAEA | session 停止中…：徽章色點 | 4.83 | 3 | 通過 |
| `session-stopping-solid` #C62828 | `color-surface` #FFFFFF | session 停止中…：色點 | 5.62 | 3 | 通過 |
| `session-stopped-fg` #334458 | `session-stopped-soft` #EEF1F5 | session 已停止：徽章文字 | 8.79 | 4.5 | 通過 |
| `session-stopped-fg` #334458 | `color-surface` #FFFFFF | session 已停止：卡片上的文字 | 9.96 | 4.5 | 通過 |
| `session-stopped-solid` #334458 | `session-stopped-soft` #EEF1F5 | session 已停止：徽章色點 | 8.79 | 3 | 通過 |
| `session-stopped-solid` #334458 | `color-surface` #FFFFFF | session 已停止：色點 | 9.96 | 3 | 通過 |
| `session-complete-fg` #116B33 | `session-complete-soft` #E8F3EC | session 做完了：徽章文字 | 5.82 | 4.5 | 通過 |
| `session-complete-fg` #116B33 | `color-surface` #FFFFFF | session 做完了：卡片上的文字 | 6.61 | 4.5 | 通過 |
| `session-complete-solid` #15803D | `session-complete-soft` #E8F3EC | session 做完了：徽章色點 | 4.41 | 3 | 通過 |
| `session-complete-solid` #15803D | `color-surface` #FFFFFF | session 做完了：色點 | 5.02 | 3 | 通過 |
| `project-1` #A8563F | `color-surface` #FFFFFF | Project 色 1：卡片上的色點 | 5.16 | 3 | 通過 |
| `project-1` #A8563F | `color-sidebar` #EEF1F5 | Project 色 1：側欄色點 | 4.56 | 3 | 通過 |
| `project-2` #94680F | `color-surface` #FFFFFF | Project 色 2：卡片上的色點 | 4.95 | 3 | 通過 |
| `project-2` #94680F | `color-sidebar` #EEF1F5 | Project 色 2：側欄色點 | 4.37 | 3 | 通過 |
| `project-3` #66722A | `color-surface` #FFFFFF | Project 色 3：卡片上的色點 | 5.24 | 3 | 通過 |
| `project-3` #66722A | `color-sidebar` #EEF1F5 | Project 色 3：側欄色點 | 4.63 | 3 | 通過 |
| `project-4` #2F7A55 | `color-surface` #FFFFFF | Project 色 4：卡片上的色點 | 5.20 | 3 | 通過 |
| `project-4` #2F7A55 | `color-sidebar` #EEF1F5 | Project 色 4：側欄色點 | 4.59 | 3 | 通過 |
| `project-5` #1D7470 | `color-surface` #FFFFFF | Project 色 5：卡片上的色點 | 5.55 | 3 | 通過 |
| `project-5` #1D7470 | `color-sidebar` #EEF1F5 | Project 色 5：側欄色點 | 4.90 | 3 | 通過 |
| `project-6` #3A64A0 | `color-surface` #FFFFFF | Project 色 6：卡片上的色點 | 5.98 | 3 | 通過 |
| `project-6` #3A64A0 | `color-sidebar` #EEF1F5 | Project 色 6：側欄色點 | 5.28 | 3 | 通過 |
| `project-7` #5A55A0 | `color-surface` #FFFFFF | Project 色 7：卡片上的色點 | 6.48 | 3 | 通過 |
| `project-7` #5A55A0 | `color-sidebar` #EEF1F5 | Project 色 7：側欄色點 | 5.72 | 3 | 通過 |
| `project-8` #8E4A82 | `color-surface` #FFFFFF | Project 色 8：卡片上的色點 | 6.08 | 3 | 通過 |
| `project-8` #8E4A82 | `color-sidebar` #EEF1F5 | Project 色 8：側欄色點 | 5.37 | 3 | 通過 |
| `project-9` #B0485F | `color-surface` #FFFFFF | Project 色 9：卡片上的色點 | 5.33 | 3 | 通過 |
| `project-9` #B0485F | `color-sidebar` #EEF1F5 | Project 色 9：側欄色點 | 4.71 | 3 | 通過 |
| `project-10` #64707E | `color-surface` #FFFFFF | Project 色 10：卡片上的色點 | 5.05 | 3 | 通過 |
| `project-10` #64707E | `color-sidebar` #EEF1F5 | Project 色 10：側欄色點 | 4.45 | 3 | 通過 |
| `color-border-input` #7A8696 | `color-bg` #F5F7FA | 輸入框、勾選框邊框 | 3.45 | 3 | 通過 |
| `color-border-input` #7A8696 | `color-surface` #FFFFFF | 輸入框、勾選框邊框 | 3.70 | 3 | 通過 |
| `color-border-input` #7A8696 | `color-surface-2` #EEF1F5 | 輸入框、勾選框邊框 | 3.26 | 3 | 通過 |
| `color-focus` #2C5282 | `color-bg` #F5F7FA | 焦點框 | 7.42 | 3 | 通過 |
| `color-focus` #2C5282 | `color-surface` #FFFFFF | 焦點框 | 7.97 | 3 | 通過 |
| `color-focus` #2C5282 | `color-surface-2` #EEF1F5 | 焦點框 | 7.03 | 3 | 通過 |
| `color-focus` #2C5282 | `color-sidebar` #EEF1F5 | 焦點框 | 7.03 | 3 | 通過 |
| `color-primary` #1E3A5F | `color-bg` #F5F7FA | 主要按鈕底色、選取指示條 | 10.72 | 3 | 通過 |
| `color-primary` #1E3A5F | `color-surface` #FFFFFF | 主要按鈕底色、選取指示條 | 11.50 | 3 | 通過 |
| `color-danger` #C62828 | `color-surface` #FFFFFF | 危險按鈕底色、錯誤框 | 5.62 | 3 | 通過 |
| `color-agent` #0B7568 | `color-surface` #FFFFFF | agent 頭像外框 | 5.59 | 3 | 通過 |
| `color-primary` #1E3A5F | `color-surface` #FFFFFF | 人的頭像底色 | 11.50 | 3 | 通過 |

</details>

<details><summary>深色：全部 128 組</summary>

| 前景 | 背景 | 用途 | 對比 | 門檻 | 結果 |
|---|---|---|---|---|---|
| `color-text` #D5DBE3 | `color-bg` #1F242C | 正文 | 11.19 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-surface` #282E37 | 正文 | 9.81 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-surface-2` #313844 | 正文 | 8.47 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-sidebar` #232831 | 正文 | 10.62 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-hover` #313844 | 正文 | 8.47 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-selected` #2F3A4A | 正文 | 8.26 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-review-col` #353943 | 正文 | 8.29 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-primary-soft` #2F3A4A | 正文 | 8.26 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-agent-soft` #2A403F | 正文 | 7.92 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-danger-soft` #45333A | 正文 | 8.43 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-bg` #1F242C | 次要文字、placeholder、票號 | 8.49 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-surface` #282E37 | 次要文字、placeholder、票號 | 7.45 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-surface-2` #313844 | 次要文字、placeholder、票號 | 6.43 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-sidebar` #232831 | 次要文字、placeholder、票號 | 8.06 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-hover` #313844 | 次要文字、placeholder、票號 | 6.43 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-selected` #2F3A4A | 次要文字、placeholder、票號 | 6.27 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-review-col` #353943 | 次要文字、placeholder、票號 | 6.29 | 4.5 | 通過 |
| `color-on-primary` #14171C | `color-primary` #8FB3E0 | 主要按鈕文字、人的頭像字 | 8.29 | 4.5 | 通過 |
| `color-on-primary` #14171C | `color-primary-hover` #A9C4E8 | 主要按鈕文字、人的頭像字 | 10.05 | 4.5 | 通過 |
| `color-on-primary` #14171C | `color-primary-active` #BFD3EC | 主要按鈕文字、人的頭像字 | 11.76 | 4.5 | 通過 |
| `color-on-danger` #14171C | `color-danger` #F3ACAC | 危險按鈕文字 | 9.67 | 4.5 | 通過 |
| `color-on-danger` #14171C | `color-danger-hover` #F7C2C2 | 危險按鈕文字 | 11.51 | 4.5 | 通過 |
| `color-link` #A9C4E8 | `color-bg` #1F242C | 連結、文字按鈕 | 8.72 | 4.5 | 通過 |
| `color-link` #A9C4E8 | `color-surface` #282E37 | 連結、文字按鈕 | 7.65 | 4.5 | 通過 |
| `color-link` #A9C4E8 | `color-primary-soft` #2F3A4A | 連結、文字按鈕 | 6.44 | 4.5 | 通過 |
| `color-agent` #73D0C2 | `color-surface` #282E37 | agent 名稱、agent 頭像圖示 | 7.51 | 4.5 | 通過 |
| `color-agent` #73D0C2 | `color-agent-soft` #2A403F | agent 名稱、agent 頭像圖示 | 6.06 | 4.5 | 通過 |
| `color-agent` #73D0C2 | `color-bg` #1F242C | agent 名稱、agent 頭像圖示 | 8.56 | 4.5 | 通過 |
| `color-danger` #F3ACAC | `color-surface` #282E37 | 錯誤訊息 | 7.36 | 4.5 | 通過 |
| `color-danger` #F3ACAC | `color-danger-soft` #45333A | 錯誤訊息 | 6.33 | 4.5 | 通過 |
| `color-danger` #F3ACAC | `color-bg` #1F242C | 錯誤訊息 | 8.39 | 4.5 | 通過 |
| `color-inverse-text` #1F242C | `color-inverse-bg` #D5DBE3 | toast、tooltip 文字 | 11.19 | 4.5 | 通過 |
| `color-inverse-muted` #4A5363 | `color-inverse-bg` #D5DBE3 | tooltip 快捷鍵 | 5.56 | 4.5 | 通過 |
| `color-inverse-action` #2C5282 | `color-inverse-bg` #D5DBE3 | toast「復原」「重試」 | 5.72 | 4.5 | 通過 |
| `color-text` #D5DBE3 | `color-review-bg` #313844 | 待驗收 block：下一步文字 | 8.47 | 4.5 | 通過 |
| `color-text-muted` #B8C0CB | `color-review-bg` #313844 | 待驗收 block：說明文字 | 6.43 | 4.5 | 通過 |
| `color-review-icon` #E2B36E | `color-review-bg` #313844 | 待驗收 block：琥珀圖示 | 6.13 | 3 | 通過 |
| `color-review-icon` #E2B36E | `color-surface` #282E37 | 待驗收 block：左側琥珀邊（對頁面卡片） | 7.10 | 3 | 通過 |
| `status-in-review-solid` #D6A45E | `color-review-col` #353943 | 待驗收欄：虛線框、欄頂圖示 | 5.13 | 3 | 通過 |
| `color-text` #D5DBE3 | `color-review-col` #353943 | 待驗收欄：欄標題 | 8.29 | 4.5 | 通過 |
| `status-backlog-fg` #BAC1CC | `status-backlog-soft` #363D49 | 票狀態 Backlog：徽章文字 | 6.03 | 4.5 | 通過 |
| `status-backlog-fg` #BAC1CC | `color-surface` #282E37 | 票狀態 Backlog：卡片上的狀態文字 | 7.54 | 4.5 | 通過 |
| `status-backlog-solid` #9CA4AF | `color-surface` #282E37 | 票狀態 Backlog：色點／圖示 | 5.43 | 3 | 通過 |
| `status-backlog-solid` #9CA4AF | `color-bg` #1F242C | 票狀態 Backlog：欄頂色點 | 6.19 | 3 | 通過 |
| `status-todo-fg` #C3CAD4 | `status-todo-soft` #363D49 | 票狀態 Todo：徽章文字 | 6.62 | 4.5 | 通過 |
| `status-todo-fg` #C3CAD4 | `color-surface` #282E37 | 票狀態 Todo：卡片上的狀態文字 | 8.28 | 4.5 | 通過 |
| `status-todo-solid` #C3CAD4 | `color-surface` #282E37 | 票狀態 Todo：色點／圖示 | 8.28 | 3 | 通過 |
| `status-todo-solid` #C3CAD4 | `color-bg` #1F242C | 票狀態 Todo：欄頂色點 | 9.44 | 3 | 通過 |
| `status-in-progress-fg` #A4C2EA | `status-in-progress-soft` #2F3B4E | 票狀態 In Progress：徽章文字 | 6.19 | 4.5 | 通過 |
| `status-in-progress-fg` #A4C2EA | `color-surface` #282E37 | 票狀態 In Progress：卡片上的狀態文字 | 7.48 | 4.5 | 通過 |
| `status-in-progress-solid` #86AEE3 | `color-surface` #282E37 | 票狀態 In Progress：色點／圖示 | 5.97 | 3 | 通過 |
| `status-in-progress-solid` #86AEE3 | `color-bg` #1F242C | 票狀態 In Progress：欄頂色點 | 6.81 | 3 | 通過 |
| `status-in-review-fg` #E8C07E | `status-in-review-soft` #463C24 | 票狀態 待驗收：徽章文字 | 6.35 | 4.5 | 通過 |
| `status-in-review-fg` #E8C07E | `color-surface` #282E37 | 票狀態 待驗收：卡片上的狀態文字 | 7.99 | 4.5 | 通過 |
| `status-in-review-solid` #D6A45E | `color-surface` #282E37 | 票狀態 待驗收：色點／圖示 | 6.07 | 3 | 通過 |
| `status-in-review-solid` #D6A45E | `color-bg` #1F242C | 票狀態 待驗收：欄頂色點 | 6.93 | 3 | 通過 |
| `status-done-fg` #95CDA9 | `status-done-soft` #2E4136 | 票狀態 Done：徽章文字 | 6.02 | 4.5 | 通過 |
| `status-done-fg` #95CDA9 | `color-surface` #282E37 | 票狀態 Done：卡片上的狀態文字 | 7.54 | 4.5 | 通過 |
| `status-done-solid` #74BE8E | `color-surface` #282E37 | 票狀態 Done：色點／圖示 | 6.18 | 3 | 通過 |
| `status-done-solid` #74BE8E | `color-bg` #1F242C | 票狀態 Done：欄頂色點 | 7.05 | 3 | 通過 |
| `status-canceled-fg` #BAC1CC | `status-canceled-soft` #363D49 | 票狀態 Canceled：徽章文字 | 6.03 | 4.5 | 通過 |
| `status-canceled-fg` #BAC1CC | `color-surface` #282E37 | 票狀態 Canceled：卡片上的狀態文字 | 7.54 | 4.5 | 通過 |
| `status-canceled-solid` #9CA4AF | `color-surface` #282E37 | 票狀態 Canceled：色點／圖示 | 5.43 | 3 | 通過 |
| `status-canceled-solid` #9CA4AF | `color-bg` #1F242C | 票狀態 Canceled：欄頂色點 | 6.19 | 3 | 通過 |
| `session-pending-fg` #73D0C2 | `session-pending-soft` #2A403F | session 等 agent 接手：徽章文字 | 6.06 | 4.5 | 通過 |
| `session-pending-fg` #73D0C2 | `color-surface` #282E37 | session 等 agent 接手：卡片上的文字 | 7.51 | 4.5 | 通過 |
| `session-pending-solid` #73D0C2 | `session-pending-soft` #2A403F | session 等 agent 接手：徽章色點 | 6.06 | 3 | 通過 |
| `session-pending-solid` #73D0C2 | `color-surface` #282E37 | session 等 agent 接手：色點 | 7.51 | 3 | 通過 |
| `session-active-fg` #A4C2EA | `session-active-soft` #2F3B4E | session 進行中：徽章文字 | 6.19 | 4.5 | 通過 |
| `session-active-fg` #A4C2EA | `color-surface` #282E37 | session 進行中：卡片上的文字 | 7.48 | 4.5 | 通過 |
| `session-active-solid` #86AEE3 | `session-active-soft` #2F3B4E | session 進行中：徽章色點 | 4.94 | 3 | 通過 |
| `session-active-solid` #86AEE3 | `color-surface` #282E37 | session 進行中：色點 | 5.97 | 3 | 通過 |
| `session-awaiting-input-fg` #E8C07E | `session-awaiting-input-soft` #463C24 | session 等你回覆：徽章文字 | 6.35 | 4.5 | 通過 |
| `session-awaiting-input-fg` #E8C07E | `color-surface` #282E37 | session 等你回覆：卡片上的文字 | 7.99 | 4.5 | 通過 |
| `session-awaiting-input-solid` #D6A45E | `session-awaiting-input-soft` #463C24 | session 等你回覆：徽章色點 | 4.83 | 3 | 通過 |
| `session-awaiting-input-solid` #D6A45E | `color-surface` #282E37 | session 等你回覆：色點 | 6.07 | 3 | 通過 |
| `session-error-fg` #F3ACAC | `session-error-soft` #45333A | session 出錯：徽章文字 | 6.33 | 4.5 | 通過 |
| `session-error-fg` #F3ACAC | `color-surface` #282E37 | session 出錯：卡片上的文字 | 7.36 | 4.5 | 通過 |
| `session-error-solid` #EE8C8C | `session-error-soft` #45333A | session 出錯：徽章色點 | 4.90 | 3 | 通過 |
| `session-error-solid` #EE8C8C | `color-surface` #282E37 | session 出錯：色點 | 5.71 | 3 | 通過 |
| `session-stale-fg` #BAC1CC | `session-stale-soft` #363D49 | session 太久沒更新：徽章文字 | 6.03 | 4.5 | 通過 |
| `session-stale-fg` #BAC1CC | `color-surface` #282E37 | session 太久沒更新：卡片上的文字 | 7.54 | 4.5 | 通過 |
| `session-stale-solid` #9FA6B1 | `session-stale-soft` #363D49 | session 太久沒更新：徽章色點 | 4.46 | 3 | 通過 |
| `session-stale-solid` #9FA6B1 | `color-surface` #282E37 | session 太久沒更新：色點 | 5.57 | 3 | 通過 |
| `session-stopping-fg` #F3ACAC | `session-stopping-soft` #45333A | session 停止中…：徽章文字 | 6.33 | 4.5 | 通過 |
| `session-stopping-fg` #F3ACAC | `color-surface` #282E37 | session 停止中…：卡片上的文字 | 7.36 | 4.5 | 通過 |
| `session-stopping-solid` #EE8C8C | `session-stopping-soft` #45333A | session 停止中…：徽章色點 | 4.90 | 3 | 通過 |
| `session-stopping-solid` #EE8C8C | `color-surface` #282E37 | session 停止中…：色點 | 5.71 | 3 | 通過 |
| `session-stopped-fg` #C3CAD4 | `session-stopped-soft` #363D49 | session 已停止：徽章文字 | 6.62 | 4.5 | 通過 |
| `session-stopped-fg` #C3CAD4 | `color-surface` #282E37 | session 已停止：卡片上的文字 | 8.28 | 4.5 | 通過 |
| `session-stopped-solid` #C3CAD4 | `session-stopped-soft` #363D49 | session 已停止：徽章色點 | 6.62 | 3 | 通過 |
| `session-stopped-solid` #C3CAD4 | `color-surface` #282E37 | session 已停止：色點 | 8.28 | 3 | 通過 |
| `session-complete-fg` #95CDA9 | `session-complete-soft` #2E4136 | session 做完了：徽章文字 | 6.02 | 4.5 | 通過 |
| `session-complete-fg` #95CDA9 | `color-surface` #282E37 | session 做完了：卡片上的文字 | 7.54 | 4.5 | 通過 |
| `session-complete-solid` #74BE8E | `session-complete-soft` #2E4136 | session 做完了：徽章色點 | 4.93 | 3 | 通過 |
| `session-complete-solid` #74BE8E | `color-surface` #282E37 | session 做完了：色點 | 6.18 | 3 | 通過 |
| `project-1` #D09482 | `color-surface` #282E37 | Project 色 1：卡片上的色點 | 5.36 | 3 | 通過 |
| `project-1` #D09482 | `color-sidebar` #232831 | Project 色 1：側欄色點 | 5.81 | 3 | 通過 |
| `project-2` #CDA96C | `color-surface` #282E37 | Project 色 2：卡片上的色點 | 6.18 | 3 | 通過 |
| `project-2` #CDA96C | `color-sidebar` #232831 | Project 色 2：側欄色點 | 6.68 | 3 | 通過 |
| `project-3` #A9B37A | `color-surface` #282E37 | Project 色 3：卡片上的色點 | 6.13 | 3 | 通過 |
| `project-3` #A9B37A | `color-sidebar` #232831 | Project 色 3：側欄色點 | 6.63 | 3 | 通過 |
| `project-4` #84BC9C | `color-surface` #282E37 | Project 色 4：卡片上的色點 | 6.28 | 3 | 通過 |
| `project-4` #84BC9C | `color-sidebar` #232831 | Project 色 4：側欄色點 | 6.80 | 3 | 通過 |
| `project-5` #7BBDB5 | `color-surface` #282E37 | Project 色 5：卡片上的色點 | 6.37 | 3 | 通過 |
| `project-5` #7BBDB5 | `color-sidebar` #232831 | Project 色 5：側欄色點 | 6.90 | 3 | 通過 |
| `project-6` #8FB3E0 | `color-surface` #282E37 | Project 色 6：卡片上的色點 | 6.31 | 3 | 通過 |
| `project-6` #8FB3E0 | `color-sidebar` #232831 | Project 色 6：側欄色點 | 6.83 | 3 | 通過 |
| `project-7` #A8A4D8 | `color-surface` #282E37 | Project 色 7：卡片上的色點 | 5.84 | 3 | 通過 |
| `project-7` #A8A4D8 | `color-sidebar` #232831 | Project 色 7：側欄色點 | 6.32 | 3 | 通過 |
| `project-8` #C99BBF | `color-surface` #282E37 | Project 色 8：卡片上的色點 | 5.81 | 3 | 通過 |
| `project-8` #C99BBF | `color-sidebar` #232831 | Project 色 8：側欄色點 | 6.29 | 3 | 通過 |
| `project-9` #D99DAC | `color-surface` #282E37 | Project 色 9：卡片上的色點 | 6.10 | 3 | 通過 |
| `project-9` #D99DAC | `color-sidebar` #232831 | Project 色 9：側欄色點 | 6.60 | 3 | 通過 |
| `project-10` #A3ADBA | `color-surface` #282E37 | Project 色 10：卡片上的色點 | 6.02 | 3 | 通過 |
| `project-10` #A3ADBA | `color-sidebar` #232831 | Project 色 10：側欄色點 | 6.51 | 3 | 通過 |
| `color-border-input` #9CA4AF | `color-bg` #1F242C | 輸入框、勾選框邊框 | 6.19 | 3 | 通過 |
| `color-border-input` #9CA4AF | `color-surface` #282E37 | 輸入框、勾選框邊框 | 5.43 | 3 | 通過 |
| `color-border-input` #9CA4AF | `color-surface-2` #313844 | 輸入框、勾選框邊框 | 4.69 | 3 | 通過 |
| `color-focus` #8FB3E0 | `color-bg` #1F242C | 焦點框 | 7.20 | 3 | 通過 |
| `color-focus` #8FB3E0 | `color-surface` #282E37 | 焦點框 | 6.31 | 3 | 通過 |
| `color-focus` #8FB3E0 | `color-surface-2` #313844 | 焦點框 | 5.45 | 3 | 通過 |
| `color-focus` #8FB3E0 | `color-sidebar` #232831 | 焦點框 | 6.83 | 3 | 通過 |
| `color-primary` #8FB3E0 | `color-bg` #1F242C | 主要按鈕底色、選取指示條 | 7.20 | 3 | 通過 |
| `color-primary` #8FB3E0 | `color-surface` #282E37 | 主要按鈕底色、選取指示條 | 6.31 | 3 | 通過 |
| `color-danger` #F3ACAC | `color-surface` #282E37 | 危險按鈕底色、錯誤框 | 7.36 | 3 | 通過 |
| `color-agent` #73D0C2 | `color-surface` #282E37 | agent 頭像外框 | 7.51 | 3 | 通過 |
| `color-primary` #8FB3E0 | `color-surface` #282E37 | 人的頭像底色 | 6.31 | 3 | 通過 |

</details>

<details><summary>深色 APCA：全部 128 組</summary>

| 前景 | 背景 | 用途 | Lc | 門檻 | 結果 |
|---|---|---|---|---|---|
| `color-text` #D5DBE3 | `color-bg` #1F242C | 正文 | 81.7 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-surface` #282E37 | 正文 | 79.8 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-surface-2` #313844 | 正文 | 77.2 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-sidebar` #232831 | 正文 | 81.0 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-hover` #313844 | 正文 | 77.2 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-selected` #2F3A4A | 正文 | 76.7 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-review-col` #353943 | 正文 | 76.8 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-primary-soft` #2F3A4A | 正文 | 76.7 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-agent-soft` #2A403F | 正文 | 75.8 | 75 | 通過 |
| `color-text` #D5DBE3 | `color-danger-soft` #45333A | 正文 | 77.1 | 75 | 通過 |
| `color-text-muted` #B8C0CB | `color-bg` #1F242C | 次要文字、placeholder、票號 | 65.4 | 60 | 通過 |
| `color-text-muted` #B8C0CB | `color-surface` #282E37 | 次要文字、placeholder、票號 | 63.6 | 60 | 通過 |
| `color-text-muted` #B8C0CB | `color-surface-2` #313844 | 次要文字、placeholder、票號 | 61.0 | 60 | 通過 |
| `color-text-muted` #B8C0CB | `color-sidebar` #232831 | 次要文字、placeholder、票號 | 64.7 | 60 | 通過 |
| `color-text-muted` #B8C0CB | `color-hover` #313844 | 次要文字、placeholder、票號 | 61.0 | 60 | 通過 |
| `color-text-muted` #B8C0CB | `color-selected` #2F3A4A | 次要文字、placeholder、票號 | 60.4 | 60 | 通過 |
| `color-text-muted` #B8C0CB | `color-review-col` #353943 | 次要文字、placeholder、票號 | 60.5 | 60 | 通過 |
| `color-on-primary` #14171C | `color-primary` #8FB3E0 | 主要按鈕文字、人的頭像字 | 60.1 | 60 | 通過 |
| `color-on-primary` #14171C | `color-primary-hover` #A9C4E8 | 主要按鈕文字、人的頭像字 | 69.5 | 60 | 通過 |
| `color-on-primary` #14171C | `color-primary-active` #BFD3EC | 主要按鈕文字、人的頭像字 | 78.0 | 60 | 通過 |
| `color-on-danger` #14171C | `color-danger` #F3ACAC | 危險按鈕文字 | 67.6 | 60 | 通過 |
| `color-on-danger` #14171C | `color-danger-hover` #F7C2C2 | 危險按鈕文字 | 76.8 | 60 | 通過 |
| `color-link` #A9C4E8 | `color-bg` #1F242C | 連結、文字按鈕 | 66.9 | 60 | 通過 |
| `color-link` #A9C4E8 | `color-surface` #282E37 | 連結、文字按鈕 | 65.0 | 60 | 通過 |
| `color-link` #A9C4E8 | `color-primary-soft` #2F3A4A | 連結、文字按鈕 | 61.9 | 60 | 通過 |
| `color-agent` #73D0C2 | `color-surface` #282E37 | agent 名稱、agent 頭像圖示 | 64.2 | 60 | 通過 |
| `color-agent` #73D0C2 | `color-agent-soft` #2A403F | agent 名稱、agent 頭像圖示 | 60.2 | 60 | 通過 |
| `color-agent` #73D0C2 | `color-bg` #1F242C | agent 名稱、agent 頭像圖示 | 66.0 | 60 | 通過 |
| `color-danger` #F3ACAC | `color-surface` #282E37 | 錯誤訊息 | 63.1 | 60 | 通過 |
| `color-danger` #F3ACAC | `color-danger-soft` #45333A | 錯誤訊息 | 60.3 | 60 | 通過 |
| `color-danger` #F3ACAC | `color-bg` #1F242C | 錯誤訊息 | 64.9 | 60 | 通過 |
| `color-inverse-text` #1F242C | `color-inverse-bg` #D5DBE3 | toast、tooltip 文字 | 81.1 | 75 | 通過 |
| `color-inverse-muted` #4A5363 | `color-inverse-bg` #D5DBE3 | tooltip 快捷鍵 | 65.5 | 60 | 通過 |
| `color-inverse-action` #2C5282 | `color-inverse-bg` #D5DBE3 | toast「復原」「重試」 | 66.0 | 60 | 通過 |
| `color-text` #D5DBE3 | `color-review-bg` #313844 | 待驗收 block：下一步文字 | 77.2 | 75 | 通過 |
| `color-text-muted` #B8C0CB | `color-review-bg` #313844 | 待驗收 block：說明文字 | 61.0 | 60 | 通過 |
| `color-review-icon` #E2B36E | `color-review-bg` #313844 | 待驗收 block：琥珀圖示 | 58.5 | 45 | 通過 |
| `color-review-icon` #E2B36E | `color-surface` #282E37 | 待驗收 block：左側琥珀邊（對頁面卡片） | 61.1 | 45 | 通過 |
| `status-in-review-solid` #D6A45E | `color-review-col` #353943 | 待驗收欄：虛線框、欄頂圖示 | 50.3 | 45 | 通過 |
| `color-text` #D5DBE3 | `color-review-col` #353943 | 待驗收欄：欄標題 | 76.8 | 75 | 通過 |
| `status-backlog-fg` #BAC1CC | `status-backlog-soft` #363D49 | 票狀態 Backlog：徽章文字 | 60.1 | 60 | 通過 |
| `status-backlog-fg` #BAC1CC | `color-surface` #282E37 | 票狀態 Backlog：卡片上的狀態文字 | 64.3 | 60 | 通過 |
| `status-backlog-solid` #9CA4AF | `color-surface` #282E37 | 票狀態 Backlog：色點／圖示 | 48.0 | 45 | 通過 |
| `status-backlog-solid` #9CA4AF | `color-bg` #1F242C | 票狀態 Backlog：欄頂色點 | 49.9 | 45 | 通過 |
| `status-todo-fg` #C3CAD4 | `status-todo-soft` #363D49 | 票狀態 Todo：徽章文字 | 65.4 | 60 | 通過 |
| `status-todo-fg` #C3CAD4 | `color-surface` #282E37 | 票狀態 Todo：卡片上的狀態文字 | 69.5 | 60 | 通過 |
| `status-todo-solid` #C3CAD4 | `color-surface` #282E37 | 票狀態 Todo：色點／圖示 | 69.5 | 45 | 通過 |
| `status-todo-solid` #C3CAD4 | `color-bg` #1F242C | 票狀態 Todo：欄頂色點 | 71.4 | 45 | 通過 |
| `status-in-progress-fg` #A4C2EA | `status-in-progress-soft` #2F3B4E | 票狀態 In Progress：徽章文字 | 60.3 | 60 | 通過 |
| `status-in-progress-fg` #A4C2EA | `color-surface` #282E37 | 票狀態 In Progress：卡片上的狀態文字 | 63.8 | 60 | 通過 |
| `status-in-progress-solid` #86AEE3 | `color-surface` #282E37 | 票狀態 In Progress：色點／圖示 | 52.5 | 45 | 通過 |
| `status-in-progress-solid` #86AEE3 | `color-bg` #1F242C | 票狀態 In Progress：欄頂色點 | 54.3 | 45 | 通過 |
| `status-in-review-fg` #E8C07E | `status-in-review-soft` #463C24 | 票狀態 待驗收：徽章文字 | 63.3 | 60 | 通過 |
| `status-in-review-fg` #E8C07E | `color-surface` #282E37 | 票狀態 待驗收：卡片上的狀態文字 | 67.5 | 60 | 通過 |
| `status-in-review-solid` #D6A45E | `color-surface` #282E37 | 票狀態 待驗收：色點／圖示 | 53.3 | 45 | 通過 |
| `status-in-review-solid` #D6A45E | `color-bg` #1F242C | 票狀態 待驗收：欄頂色點 | 55.2 | 45 | 通過 |
| `status-done-fg` #95CDA9 | `status-done-soft` #2E4136 | 票狀態 Done：徽章文字 | 60.1 | 60 | 通過 |
| `status-done-fg` #95CDA9 | `color-surface` #282E37 | 票狀態 Done：卡片上的狀態文字 | 64.3 | 60 | 通過 |
| `status-done-solid` #74BE8E | `color-surface` #282E37 | 票狀態 Done：色點／圖示 | 54.2 | 45 | 通過 |
| `status-done-solid` #74BE8E | `color-bg` #1F242C | 票狀態 Done：欄頂色點 | 56.1 | 45 | 通過 |
| `status-canceled-fg` #BAC1CC | `status-canceled-soft` #363D49 | 票狀態 Canceled：徽章文字 | 60.1 | 60 | 通過 |
| `status-canceled-fg` #BAC1CC | `color-surface` #282E37 | 票狀態 Canceled：卡片上的狀態文字 | 64.3 | 60 | 通過 |
| `status-canceled-solid` #9CA4AF | `color-surface` #282E37 | 票狀態 Canceled：色點／圖示 | 48.0 | 45 | 通過 |
| `status-canceled-solid` #9CA4AF | `color-bg` #1F242C | 票狀態 Canceled：欄頂色點 | 49.9 | 45 | 通過 |
| `session-pending-fg` #73D0C2 | `session-pending-soft` #2A403F | session 等 agent 接手：徽章文字 | 60.2 | 60 | 通過 |
| `session-pending-fg` #73D0C2 | `color-surface` #282E37 | session 等 agent 接手：卡片上的文字 | 64.2 | 60 | 通過 |
| `session-pending-solid` #73D0C2 | `session-pending-soft` #2A403F | session 等 agent 接手：徽章色點 | 60.2 | 45 | 通過 |
| `session-pending-solid` #73D0C2 | `color-surface` #282E37 | session 等 agent 接手：色點 | 64.2 | 45 | 通過 |
| `session-active-fg` #A4C2EA | `session-active-soft` #2F3B4E | session 進行中：徽章文字 | 60.3 | 60 | 通過 |
| `session-active-fg` #A4C2EA | `color-surface` #282E37 | session 進行中：卡片上的文字 | 63.8 | 60 | 通過 |
| `session-active-solid` #86AEE3 | `session-active-soft` #2F3B4E | session 進行中：徽章色點 | 49.0 | 45 | 通過 |
| `session-active-solid` #86AEE3 | `color-surface` #282E37 | session 進行中：色點 | 52.5 | 45 | 通過 |
| `session-awaiting-input-fg` #E8C07E | `session-awaiting-input-soft` #463C24 | session 等你回覆：徽章文字 | 63.3 | 60 | 通過 |
| `session-awaiting-input-fg` #E8C07E | `color-surface` #282E37 | session 等你回覆：卡片上的文字 | 67.5 | 60 | 通過 |
| `session-awaiting-input-solid` #D6A45E | `session-awaiting-input-soft` #463C24 | session 等你回覆：徽章色點 | 49.0 | 45 | 通過 |
| `session-awaiting-input-solid` #D6A45E | `color-surface` #282E37 | session 等你回覆：色點 | 53.3 | 45 | 通過 |
| `session-error-fg` #F3ACAC | `session-error-soft` #45333A | session 出錯：徽章文字 | 60.3 | 60 | 通過 |
| `session-error-fg` #F3ACAC | `color-surface` #282E37 | session 出錯：卡片上的文字 | 63.1 | 60 | 通過 |
| `session-error-solid` #EE8C8C | `session-error-soft` #45333A | session 出錯：徽章色點 | 47.8 | 45 | 通過 |
| `session-error-solid` #EE8C8C | `color-surface` #282E37 | session 出錯：色點 | 50.5 | 45 | 通過 |
| `session-stale-fg` #BAC1CC | `session-stale-soft` #363D49 | session 太久沒更新：徽章文字 | 60.1 | 60 | 通過 |
| `session-stale-fg` #BAC1CC | `color-surface` #282E37 | session 太久沒更新：卡片上的文字 | 64.3 | 60 | 通過 |
| `session-stale-solid` #9FA6B1 | `session-stale-soft` #363D49 | session 太久沒更新：徽章色點 | 45.0 | 45 | 通過 |
| `session-stale-solid` #9FA6B1 | `color-surface` #282E37 | session 太久沒更新：色點 | 49.2 | 45 | 通過 |
| `session-stopping-fg` #F3ACAC | `session-stopping-soft` #45333A | session 停止中…：徽章文字 | 60.3 | 60 | 通過 |
| `session-stopping-fg` #F3ACAC | `color-surface` #282E37 | session 停止中…：卡片上的文字 | 63.1 | 60 | 通過 |
| `session-stopping-solid` #EE8C8C | `session-stopping-soft` #45333A | session 停止中…：徽章色點 | 47.8 | 45 | 通過 |
| `session-stopping-solid` #EE8C8C | `color-surface` #282E37 | session 停止中…：色點 | 50.5 | 45 | 通過 |
| `session-stopped-fg` #C3CAD4 | `session-stopped-soft` #363D49 | session 已停止：徽章文字 | 65.4 | 60 | 通過 |
| `session-stopped-fg` #C3CAD4 | `color-surface` #282E37 | session 已停止：卡片上的文字 | 69.5 | 60 | 通過 |
| `session-stopped-solid` #C3CAD4 | `session-stopped-soft` #363D49 | session 已停止：徽章色點 | 65.4 | 45 | 通過 |
| `session-stopped-solid` #C3CAD4 | `color-surface` #282E37 | session 已停止：色點 | 69.5 | 45 | 通過 |
| `session-complete-fg` #95CDA9 | `session-complete-soft` #2E4136 | session 做完了：徽章文字 | 60.1 | 60 | 通過 |
| `session-complete-fg` #95CDA9 | `color-surface` #282E37 | session 做完了：卡片上的文字 | 64.3 | 60 | 通過 |
| `session-complete-solid` #74BE8E | `session-complete-soft` #2E4136 | session 做完了：徽章色點 | 50.0 | 45 | 通過 |
| `session-complete-solid` #74BE8E | `color-surface` #282E37 | session 做完了：色點 | 54.2 | 45 | 通過 |
| `project-1` #D09482 | `color-surface` #282E37 | Project 色 1：卡片上的色點 | 47.6 | 45 | 通過 |
| `project-1` #D09482 | `color-sidebar` #232831 | Project 色 1：側欄色點 | 48.7 | 45 | 通過 |
| `project-2` #CDA96C | `color-surface` #282E37 | Project 色 2：卡片上的色點 | 54.1 | 45 | 通過 |
| `project-2` #CDA96C | `color-sidebar` #232831 | Project 色 2：側欄色點 | 55.2 | 45 | 通過 |
| `project-3` #A9B37A | `color-surface` #282E37 | Project 色 3：卡片上的色點 | 53.6 | 45 | 通過 |
| `project-3` #A9B37A | `color-sidebar` #232831 | Project 色 3：側欄色點 | 54.8 | 45 | 通過 |
| `project-4` #84BC9C | `color-surface` #282E37 | Project 色 4：卡片上的色點 | 54.9 | 45 | 通過 |
| `project-4` #84BC9C | `color-sidebar` #232831 | Project 色 4：側欄色點 | 56.1 | 45 | 通過 |
| `project-5` #7BBDB5 | `color-surface` #282E37 | Project 色 5：卡片上的色點 | 55.6 | 45 | 通過 |
| `project-5` #7BBDB5 | `color-sidebar` #232831 | Project 色 5：側欄色點 | 56.8 | 45 | 通過 |
| `project-6` #8FB3E0 | `color-surface` #282E37 | Project 色 6：卡片上的色點 | 55.1 | 45 | 通過 |
| `project-6` #8FB3E0 | `color-sidebar` #232831 | Project 色 6：側欄色點 | 56.2 | 45 | 通過 |
| `project-7` #A8A4D8 | `color-surface` #282E37 | Project 色 7：卡片上的色點 | 51.3 | 45 | 通過 |
| `project-7` #A8A4D8 | `color-sidebar` #232831 | Project 色 7：側欄色點 | 52.5 | 45 | 通過 |
| `project-8` #C99BBF | `color-surface` #282E37 | Project 色 8：卡片上的色點 | 51.1 | 45 | 通過 |
| `project-8` #C99BBF | `color-sidebar` #232831 | Project 色 8：側欄色點 | 52.3 | 45 | 通過 |
| `project-9` #D99DAC | `color-surface` #282E37 | Project 色 9：卡片上的色點 | 53.5 | 45 | 通過 |
| `project-9` #D99DAC | `color-sidebar` #232831 | Project 色 9：側欄色點 | 54.6 | 45 | 通過 |
| `project-10` #A3ADBA | `color-surface` #282E37 | Project 色 10：卡片上的色點 | 52.7 | 45 | 通過 |
| `project-10` #A3ADBA | `color-sidebar` #232831 | Project 色 10：側欄色點 | 53.9 | 45 | 通過 |
| `color-border-input` #9CA4AF | `color-bg` #1F242C | 輸入框、勾選框邊框 | 49.9 | 45 | 通過 |
| `color-border-input` #9CA4AF | `color-surface` #282E37 | 輸入框、勾選框邊框 | 48.0 | 45 | 通過 |
| `color-border-input` #9CA4AF | `color-surface-2` #313844 | 輸入框、勾選框邊框 | 45.4 | 45 | 通過 |
| `color-focus` #8FB3E0 | `color-bg` #1F242C | 焦點框 | 57.0 | 45 | 通過 |
| `color-focus` #8FB3E0 | `color-surface` #282E37 | 焦點框 | 55.1 | 45 | 通過 |
| `color-focus` #8FB3E0 | `color-surface-2` #313844 | 焦點框 | 52.5 | 45 | 通過 |
| `color-focus` #8FB3E0 | `color-sidebar` #232831 | 焦點框 | 56.2 | 45 | 通過 |
| `color-primary` #8FB3E0 | `color-bg` #1F242C | 主要按鈕底色、選取指示條 | 57.0 | 45 | 通過 |
| `color-primary` #8FB3E0 | `color-surface` #282E37 | 主要按鈕底色、選取指示條 | 55.1 | 45 | 通過 |
| `color-danger` #F3ACAC | `color-surface` #282E37 | 危險按鈕底色、錯誤框 | 63.1 | 45 | 通過 |
| `color-agent` #73D0C2 | `color-surface` #282E37 | agent 頭像外框 | 64.2 | 45 | 通過 |
| `color-primary` #8FB3E0 | `color-surface` #282E37 | 人的頭像底色 | 55.1 | 45 | 通過 |

</details>
<!-- contrast:end -->
