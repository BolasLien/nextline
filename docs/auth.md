# 驗證方式：哪些路徑走哪一種

下表是 Cloudflare 跑法：人用瀏覽器走 Cloudflare Access；agent 用 token。Node 自架的獨立登入見本頁最後一節，兩種跑法共用業務路由，驗證各自在入口處理。

| 路徑 | 誰用 | 驗證 | 在哪裡擋 |
| --- | --- | --- | --- |
| `GET /health` | 部署檢查 | 不驗證（公開，只回 `ok` 與 D1 是否可用，不帶資料） | — |
| `/api/*` | agent、腳本（curl） | `Authorization: Bearer <token>` | Worker 比對 secret `API_TOKEN` |
| `/mcp` | Claude Code、Codex 的遠端 MCP | `Authorization: Bearer <token>` | Worker 比對 secret `API_TOKEN` |
| `/app-api/*` | 使用者的瀏覽器（React App 呼叫 API） | Cloudflare Access，只放行自己的 email；寫入另外防 CSRF | Access（邊緣）＋ Worker 驗 `Cf-Access-Jwt-Assertion` |
| `/legacy/*` | 舊書籤（第一版的伺服器端網頁，NX-158 移除） | 不驗證：只 301 轉到新網頁對應的路徑（`/`、`/issues/:ref`、`/projects/:id`，其他 `/`），不帶資料；轉過去的路徑照常驗 Access | Worker（`worker/web/legacy.ts`） |
| 其他所有路徑（React App 的網頁與靜態檔：`/`、`/issues`、`/assets/*`…） | 使用者的瀏覽器 | 同上 | 同上 |

## 規則

- token 只放在 wrangler secret（`wrangler secret put API_TOKEN`）與使用端的環境變數；不寫進 git、規則檔或對話。本機開發用 `.dev.vars`（已被 `.gitignore` 排除）。
- 網頁與 `/app-api` 不接受 token，`/api`、`/mcp` 不接受 Access JWT／cookie。前端不帶 token，一律打 `/app-api`。
- `/app-api/*` 的路徑、參數、回應跟 `/api/*` 完全相同（`docs/api.md`），兩邊共用 `worker/api/` 的同一套路由（`routeApi`），只有驗證不同。後端加一個功能，人和 agent 同時拿到。
- `/health` 以外的路徑，Worker 一律預設拒絕；新增路徑時要在這張表登記屬於哪一種。

## Access 怎麼設定

1. Worker 設定 → Domains & Routes → `workers.dev` 開啟 Cloudflare Access，整個 `<你的 Worker>.workers.dev` 預設都要登入；policy 只放行自己的 email。
2. 另外建一個 self-hosted Access application，涵蓋 `/health`、`/api/*`、`/mcp`，policy 設成 **Bypass**（路徑比較精確的 application 優先），讓 agent 不會被導去登入頁；這些路徑改由 Worker 驗 token。
3. Worker 對網頁路徑再驗一次 `Cf-Access-Jwt-Assertion`（`worker/web/access.ts`：RS256 簽章、`iss`、`aud`、`exp`／`nbf`，公鑰取自 `<team domain>/cdn-cgi/access/certs`），避免有人繞過 Access 直接打到 Worker。需要的值放在 `wrangler.jsonc` 的 `vars`：
   - `ACCESS_TEAM_DOMAIN`：`https://<team 名稱>.cloudflareaccess.com`
   - `ACCESS_AUD`：Zero Trust → Access controls → Applications → 第 1 步那個 application → Configure → Additional settings 的 **Application Audience (AUD) Tag**

   兩個值任何一個是空的，網頁路徑一律回 `403`、`/app-api` 回 `401`（fail closed）；`/health`、`/api/*`、`/mcp` 不受影響。

`/app-api` 不在第 2 步的 Bypass 裡，所以落在第 1 步的 application，由 Access 在邊緣擋、並補上 `Cf-Access-Jwt-Assertion`。**不用改 Cloudflare 後台**；只要之後不要把 `/app-api` 加進 Bypass。

本機開發：`.dev.vars` 加一行 `DEV_SKIP_ACCESS=1`，`npm run dev:cloudflare` 後開 `http://127.0.0.1:5173`（或 `http://localhost:8787`）就不驗 Access。這個開關只對 `localhost`／`127.0.0.1` 的請求有效（網頁與 `/app-api`），正式網址就算誤設也照樣驗；不要把它放進 `wrangler.jsonc` 或 wrangler secret。Node 自架完全不讀這個開關。

## 瀏覽器怎麼呼叫 API（NX-151）

React App（`app/`）讀寫資料一律打 `/app-api/*`，不打 `/api/*`：

```
瀏覽器 ──fetch /app-api/issues──▶ Access（邊緣，workers.dev application）
                                   │ 沒登入／過期 → 401（請求帶 X-Requested-With）
                                   ▼ 有登入 → 補上 Cf-Access-Jwt-Assertion
                                 Worker：驗 JWT → 寫入再檢查 Origin → routeApi（跟 /api 同一套）
```

為什麼不是「`/api` 加驗 `CF_Authorization` cookie」：`/api/*` 是 Bypass，Access 不會補 header；官方建議驗 `Cf-Access-Jwt-Assertion` header，不要靠 cookie，因為 cookie 不保證會帶 [¹](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。另外 Bypass 完全不套用 Access、也不記錄 [²](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#bypass)，讓瀏覽器走 Bypass 等於少了邊緣那一層。

- **登入過期**：前端每個請求帶 `X-Requested-With: XMLHttpRequest`，Access 在 session 過期時回 `401` 而不是轉址到登入頁 [³](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#ajax)；萬一還是轉址，`fetch` 用 `redirect: 'manual'` 會拿到 `opaqueredirect`，前端也當 401。畫面頂端出現「重新登入」，按下去重新整理，Access 帶去登入後回到同一頁。
- **防 CSRF**：`/app-api` 的寫入（GET／HEAD／OPTIONS 以外）要求 `Origin` 等於本站、`Sec-Fetch-Site`（有帶時）是 `same-origin`，否則回 `403`（`worker/web/csrf.ts`，照 OWASP「Verifying Origin With Standard Headers」與 Fetch Metadata）。
- **靜態檔也先驗**：`wrangler.jsonc` 的 `assets.run_worker_first = true`，所有請求都先進 Worker；網頁路徑驗過 JWT 才交給 `env.ASSETS`，找不到的路徑回 `index.html`（SPA fallback）[⁴](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)。`/api`、`/app-api`、`/mcp`、`/health`、`/legacy` 由 Worker 自己處理，不會被 SPA fallback 蓋掉。

驗收（03、04 各自實測）：無痕視窗打開 `/` 會先被要求登入；不帶 token 打 `/api/*`、`/mcp` 回 401，而且不會被導到 Access 登入頁。NX-151 起另外實測：沒登入打 `/app-api/*` 不會拿到資料。

參考：

- Access 保護 workers.dev：https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#limit-access-to-workersdev
- Access policy 的 Bypass 動作：https://developers.cloudflare.com/cloudflare-one/policies/access/#bypass
- 在 Worker 驗 Access JWT：https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

## Node 自架（NX-194）

```
瀏覽器 → 密碼登入 → HttpOnly session → /app-api → 共用核心
agent  → 獨立 Bearer token            → /api、/mcp → 共用核心
                                                       ↓
                                                   SQLite 檔案
```

所有入口都先核對設定的 Host；有 Origin 時必須與設定相同。HTTPS 模式只接受指定 socket IP 的代理，且 `X-Forwarded-Proto` 必須精確為 `https`，`X-Forwarded-Host` 若存在須等於 Host。公開 origin 不從標頭推算，不使用 `Forwarded`／`X-Forwarded-For` 取得身分。HTTP loopback 模式拒絕代理 Host／Proto 標頭。缺少必要設定拒絕啟動。

| 入口 | 授權 | 拒絕及驗證 |
| --- | --- | --- |
| `GET /login`、必要 `/assets/*.js/css/woff2/svg`、`/theme-init.js`、`/favicon.svg` | 公開空白 app shell／靜態檔，無資料 | 只允許列出的檔案格式；realpath 必須在建置根目錄內，拒絕 symlink escape 與 raw／編碼路徑穿越 |
| `POST /auth/login` | 密碼；Origin／Fetch Metadata | 錯誤 401；每分鐘部署共用最多 5 次（成功也計），超過 429；限制存在 DB，重啟不清空 |
| `GET /auth/session` | session | 無效／過期 401；有效只回 `{ok:true}`；讓 Vite 初訪也走登入流程 |
| `POST /auth/logout` | 撤銷當前 session；Origin／Fetch Metadata | 不接受跨站登出；清 cookie；之後舊 cookie 401 |
| 網頁 `/`、`/issues/*`、`/projects/*` 等既有 SPA 路由 | session | 未登入轉 `/login?returnTo=...`；登入後回原頁；任意未知路徑 404，不讓 SPA 吞掉所有入口 |
| `/app-api/*` | session，不收 agent token／Access header | 無效／過期 401；寫入須同源且 `Sec-Fetch-Site` 若存在只能是 `same-origin` |
| `/api/*`、`/mcp` | Bearer token，不收 cookie／Access header | token 缺失、錯誤、旋轉後舊值一律 401；與 Worker 共用 token 雜湊比較及業務路由 |
| `GET /health` | 公開 | 只回 ok／DB 是否可用，不列私人資料或路徑 |
| `/legacy/*` | 公開轉址 | 只轉到已知相對新路徑，不回資料 |
| 其他 `/auth/*`、未知靜態檔／其他入口 | 預設拒絕 | 404／405，不暴露檔案或例外內容 |

密碼：Node 內建 scrypt，N=2^17、r=8、p=1、128MiB memory cost、隨機 128-bit salt；只存版本化雜湊。session：隨機 256-bit、不透明值，只存 SHA-256，12 小時絕對期限，HttpOnly／SameSite=Strict／Path=/；HTTPS 加 Secure。重設密碼以交易更新密碼並清除所有 session，舊密碼驗證進行中也不能發出新 session。

Agent token：隨機 256-bit，CLI 只顯示新值一次，DB 只存 SHA-256；更換後下個請求立即拒絕舊 token。單一擁有者、共用 agent 憑證，author／actor 是記錄文字，不是身分授權。DB 與憑證共用專用私人資料目錄（0700／0600）。沒有註冊、寄信、遠端重設密碼或 `DEV_SKIP_ACCESS` 捷徑。

HTTP 回應不快取、nosniff、禁止 iframe、CSP 限同源資源（保留既有 React 行內樣式）。請求 body 最多 1MiB，headers timeout 10 秒、request timeout 15 秒。TLS 由部署者反向代理提供，Node 的代理契約有自動化驗證；本階段未替正式網域部署。

驗證：`node/server.test.ts` 以真正 TCP server 測上述矩陣、跨入口隔離、登入限流與撤銷、代理信任、路徑穿越；`scripts/e2e/selfhost.mjs` 以 Chrome 測桌機／手機登入、錯誤、開票、拖拉、留言、登出、過期回原頁與重啟。

依據：[Node 22 crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)、[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。
