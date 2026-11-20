# NX-195 自架驗收紀錄

驗證日期：2026-11-08（Asia/Taipei）。基準 835bf4e；修改前 checkpoint a2cf173。NX-195 階段未變更正式站、D1 正式資料、Access、DNS 與遠端 secrets，沒有部署或 push。以下結果只代表列出的實測環境。

## 環境

| 平台 | 隔離方式 | 執行身分與工具 |
| --- | --- | --- |
| macOS 26.3.1 (25D771280a)、arm64 | 全新 source、全新 HOME、`env -i` 白名單環境；不帶 `.dev.vars`／原機設定 | uid 501，Node 22.23.4，Playwright 1.62.1＋現有 Google Chrome binary |
| Debian GNU/Linux 12 bookworm、arm64，Linux 6.12.76-linuxkit | `node:22-slim` 隔離 container，全新 `/work-clean`、`/clean-home`；不掛入主機 HOME／Keychain | uid 1000(node)，Node 22.23.4，Chromium 156.0.8078.79，Playwright 1.62.1，Caddy 2.6.2，Supervisor 4.2.5，fonts-noto-cjk |

Linux 的 root 只安裝 OS 測試相依與設定目錄所有權；安裝 npm、服務、資料操作、HTTPS 及所有測試均以 uid 1000 執行。Node 自架不用 Cloudflare 帳號；開發測試 D1 使用本機 workerd。未驗 Windows、Linux x64、其他 Node 版本、公開網域 ACME 或整台 VM reboot，不宣稱這些已驗證。容器只用於測試，沒有產出或發布 Docker 產品。

## 實際指令

來源使用 `git ls-files --cached --others --exclude-standard -z` 列出的檔案，macOS 使用 `.scratch/nx195/source.tar`；Linux 修正封裝以 `COPYFILE_DISABLE=1 tar --no-xattrs --null -T -` 產生 `source-clean.tar`。兩份都沒有 `.git`、node_modules、dist、憑證、既有 DB 或 `.dev.vars`。macOS 的獨立原始碼目錄為 `.scratch/nx195/macos/source`，HOME 為同層 `home`；Linux 原始碼 `/work-clean`、HOME `/clean-home`。

```sh
# macOS，在獨立 source 執行；Node binary 明確指定，不載入 nvm 或原 HOME 設定
env -i PATH="$HOME/.nvm/versions/node/v22.23.4/bin":/usr/bin:/bin \
  HOME="$PWD/.scratch/nx195/macos/home" sh

# Linux，同一組驗收以 node 使用者執行
docker exec -u node nextline-nx195 env -i \
  PATH=/usr/local/bin:/usr/bin:/bin HOME=/clean-home sh
cd /work-clean

# 兩平台各自執行
npm ci
npm run build
npm run verify
node scripts/e2e/operations.mjs
node scripts/e2e/transport.mjs
PLAYWRIGHT_MODULE=<Playwright 1.62.1 的 index.mjs> CHROMIUM_PATH=<該平台瀏覽器> node scripts/e2e/selfhost.mjs

# Node 驗完才在測試 source 產生此非秘密開關，只供本機 Worker UI
printf 'DEV_SKIP_ACCESS=1\n' > .dev.vars
PLAYWRIGHT_MODULE=<同上> CHROMIUM_PATH=<同上> node scripts/e2e/core-flow.mjs

# Linux
node scripts/e2e/https.mjs
```

runner 以 `dist/server/cli.mjs init/rotate-token/backup/restore` 與 `dist/server/main.mjs` 執行 README npm scripts 的相同入口；密碼以 stdin 輸入，token 只保留在程序記憶體。Linux 測試相依安裝指令為 `apt-get install -y --no-install-recommends chromium caddy supervisor ca-certificates curl fonts-noto-cjk`；Playwright 安裝在獨立 `/tools`，沒有更改產品 lockfile。

## 驗收 checklist

| 條件 | 實際結果與證據 |
| --- | --- |
| [x] macOS／Linux 從零安裝與啟動 | 兩平台 `npm ci`、build 成功；Node UI 首次初始化、登入、開票／拖拉／留言／過期／登出及程序重啟通過。`macos/{npm-ci,build,selfhost}.log`、`linux/{npm-ci-clean,build-clean,selfhost-fonts}.log` |
| [x] 一致性備份、新目錄還原、保留原資料 | 活躍 WAL 連線未關閉時透過 CLI 備份，兩次還原後 issues/projects/sprints/comments/blockers/events/auth/migrations 全表一致；拒絕覆蓋原目錄。恢復後真正啟動 server，原 token 可讀票／留言／關聯／history，原密碼可登入。`macos/operations-final.log`、`linux/operations-final.log` |
| [x] 舊 schema 升級／重跑／失敗及中斷／舊程式拒絕新 DB | `node/backup.test.ts` 用真正 0001 schema 灌 NX-41／42、Project/Sprint/comment/blocker/event，升到 0005 後保留關聯，新票續編；重跑不重建。operations 在 migration 實際持有寫鎖時 SIGKILL，schema/data/version 全回滾；SQL 失敗訊息指出撤回，修正後可重跑；新版本已套用時舊程式拒絕，以舊快照新目錄恢復。兩平台 verify 與 operations logs |
| [x] 實際 HTTPS、程序重啟、資料／憑證保護 | uid 1000 啟動實際 Caddy＋Supervisor，explicit CA 驗證 TLS（沒有關閉驗證、沒有安裝 OS trust），Secure cookie 登入／browser 寫入；SIGKILL Node 後 PID 8313→8335 自動重啟，原票／session 保留；代理也實際重啟。log 搜測試密碼/token/cookie 無命中。`linux/artifacts/nx195/https-1794068858418/result.json` 及同層 logs |
| [x] 固定人／多 agent 並行＋故障回滾、雙引擎 | Node SQLite、真正 Worker D1 各用 4 個官方 SDK StreamableHTTP client＋browser API，同時送 24 則留言、12 次開票（共 14 張唯一票），同一張票三個不同欄位並行修改；數量、內容、關聯與 history 一致。event trigger 注入失敗，issue 與 events 全撤回。兩平台 `transport.log` 與 result.json。這是固定工作負載驗證，不宣稱整個多批次 MCP 呼叫為單一交易 |
| [x] 原有行為與新增流程驗證 | 兩平台各 `verify`：27 files／306 tests＋真 D1 3 files／90 tests；build 成功。Node UI 1280／375×light/dark、16 張畫面與重啟通過；Worker UI 各 12 步、16 張畫面，consoleErrors 空、無橫向溢出。最後 typecheck／lint／diff check 通過 |
| [x] 證據、版本與交接 | 本文件與 NX-195 comment 提供 checklist／commit；新 UI 沒有變更，NX-194 阿澈已在使用者實際 Chrome 驗日常流程。本票沒有需要使用者本人補做的技術驗收 |

## 本機證據路徑

所有路徑相對 repo `.scratch/nx195/`，驗證產物未加入 Git：

- macOS 環境與輸出：`macos/environment.json`、`versions.log`、上述 `.log`。
- macOS 還原／中斷／啟動：`macos/source/.scratch/nx195/operations-1794069008246/result.json`。
- macOS 真 MCP：`macos/source/.scratch/nx195/transport-1794068739526/result.json`。
- macOS Node UI：`macos/source/.scratch/nx194/ui-1794068742065/`；Worker：`macos/source/.scratch/screenshots/golive/`。
- Linux 環境：`linux/environment.json`、`versions.log`、`setup.log`、`fonts-setup.log`。
- Linux 還原／啟動：`linux/artifacts/nx195/operations-1794068999196/result.json`；MCP：`linux/artifacts/nx195/transport-1794068802241/result.json`。
- Linux Node UI 最終圖：`linux/artifacts/nx194/ui-1794068950778/`；Worker：`linux/artifacts/screenshots/golive/`。桌機票詳細與手機登入已實際開圖確認中文可讀。
- Linux HTTPS：`linux/https-retry.log` 與 `linux/artifacts/nx195/https-1794068858418/`。
- 清理：`linux/stopped.log`。測試 runner 關閉自己啟動的服務，容器停止並保留供追查；正式服務不變。

前兩次測試環境修正有保留證據：原 tar 帶 macOS AppleDouble 導致 Linux lint 失敗，改成不帶 xattrs 的新封裝／新目錄，不改 lint 規則；最小 Linux 瀏覽器缺 CJK 字型，安裝 fonts-noto-cjk 後只重跑 Node／Worker UI，最終以可讀截圖為準。HTTPS 測試腳本最初在 HTTP response end 才讀已被釋放的 socket，修成 response callback 保存 TLS 驗證結果後重跑成功；不以失敗輪次算通過。

## 來源與採用

- [SQLite Online Backup](https://www.sqlite.org/backup.html)：一致性快照含 WAL；不直接複製運作中的主 DB 檔。
- [Node 22 SQLite](https://nodejs.org/download/release/v22.23.0/docs/api/sqlite.html)：使用實測 Node 22.23.4 的 backup／DatabaseSync。
- [Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls)：獨立測試 CA；client 明確信任根憑證，正式網域另用可信任 TLS。
- [Supervisor configuration](https://supervisord.org/configuration.html)：專用使用者、私人 Unix socket、autorestart、明確工作目錄與環境、TERM 正常關閉。
