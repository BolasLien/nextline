# 自架備份、還原與更新

先依 [README](../README.md) 安裝 Node 22.23.4、`npm ci`、建置及初始化。正式執行只使用 Node 與 SQLite；Cloudflare 帳號、Keychain、`.dev.vars` 都不需要。使用者與 agent 共用同一份資料，登入密碼和 agent token 各自獨立。

```text
程式版本目錄（可換）         私人資料目錄（保留）
  dist / migrations   →    nextline.sqlite + WAL
                                ↓ 一致性快照
                           備份新目錄
                                ↓ 還原
                           新資料目錄 → 停機後切換
```

## 資料與權限

`NEXTLINE_DATA_DIR` 必須是 Nextline 專用的本機目錄，不要設成家目錄、原始碼根目錄或網路磁碟。目錄 0700、DB 0600；有其他檔案、DB 捷徑或資料目錄捷徑時拒絕啟動，避免誤改原始檔與權限。預設是 `$HOME/.local/share/nextline`。程式更新、建置與資料各自獨立，不要在更新時搬走或覆蓋資料目錄。

密碼雜湊、token 雜湊、session 也在 DB，備份和正式 DB 一樣私密。`.gitignore` 排除 SQLite、WAL、`.env*`、`.dev.vars*`、key/pem；憑證與備份仍應放 repo 外的私人目錄。服務不記錄 request body、Authorization 或 cookie；不要自行開啟代理的敏感 header/body debug logging。

## 備份

建立備份的父目錄，目的地必須尚未存在：

```sh
export NEXTLINE_DATA_DIR="$HOME/.local/share/nextline"
mkdir -p "$HOME/nextline-backups"
npm run selfhost:backup -- "$HOME/nextline-backups/before-update-01"
```

成功會顯示「備份完成，完整性與關聯驗證通過」。備份目錄有一個 `nextline.sqlite`，可把整個目錄移到安全儲存位置。命令使用 SQLite online backup，包含已提交 WAL；可在服務運作時備份，不要直接 `cp` 活躍的 DB 主檔。產出先寫 `.partial`，只有通過 `integrity_check`、外鍵與 migration 版本驗證才改成正式檔名；失敗目錄保留供診斷，換新目的地重試，不把 `.partial` 當可用備份。

## 還原演練

先停止服務，保留當前資料。以下命令只寫新目錄，不會覆蓋當前資料或備份：

```sh
# 前景服務按 Ctrl+C；Supervisor 用下節的 stop 指令
npm run selfhost:restore -- "$HOME/nextline-backups/before-update-01" "$HOME/.local/share/nextline-restored-01"
export NEXTLINE_DATA_DIR="$HOME/.local/share/nextline-restored-01"
npm run selfhost:init
npm start
```

另開終端機 `curl --fail http://127.0.0.1:3000/health`，再登入看板確認一張已知票、留言、blocked by、變更紀錄，並讓 MCP client `get_issue`／`list_comments` 讀同張票。舊備份的 schema 會由 `selfhost:init` 升級；密碼與 token 回到備份當時的版本，已撤銷憑證也可能恢復有效。若是外洩後復原，服務開放前先重設密碼與旋轉 token。不要同時讓新舊服務接收寫入。

## 更新與失敗復原

1. 記下目前版本（`git rev-parse HEAD`）、資料目錄、服務設定。將新版本放到另一個程式目錄，執行 `npm ci`、`npm run build`，保留舊程式目錄。
2. 暫停使用並停止 Node 服務，確認程序退出。執行上面的備份命令，記下備份路徑；備份成功前不更新。
3. 在新程式目錄設定同一個 `NEXTLINE_DATA_DIR`，執行 `npm run selfhost:init`，再啟動服務。Supervisor 需將 `NEXTLINE_ROOT` 更新到新程式目錄，停止再啟動 supervisor，確保環境變數重新載入。
4. 檢查 health、登入、已知票／留言／關聯／history，以及 API/MCP 讀寫。通過後恢復正常使用；保留舊程式與備份。
5. 失敗時先停止新服務，保留失敗後的資料目錄。回到舊程式目錄，以 `selfhost:restore` 把更新前備份還原到**另一個新目錄**，設定該目錄後啟動舊服務、重做第 4 步。不能只退程式而繼續讀已升級 DB。

初始化以交易一次套用所有待執行 migrations，並記錄檔名與 SHA-256；已套用 SQL 不可修改。SQL 失敗會顯示「已撤回」，未提交的資料／schema／版本紀錄整批回滾。程序突然中斷時，由 SQLite 在下次開啟恢復；原程式可讀取舊版本，再修正未套用 migration 的原因後重跑。較新的 DB、既有 migration checksum 改動或版本順序不符，均拒絕啟動。不要刪版本表、改 hash 或修改舊 SQL 來繞過檢查。

已開始接收新資料才決定回復時，先保留新版本 DB；回到舊快照會失去備份之後的寫入。此版沒有自動合併或跨 SQLite／D1 搬家，須先逐項整理這些新增資料再決定恢復服務的版本。

使用下節 Supervisor 範例還原時，除了 shell 變數，還要把 `docs/deploy/supervisord.conf` 的 `[program:nextline]` 中 `environment` 那行 `NEXTLINE_DATA_DIR` 改為還原後的完整路徑；它原本固定指向 `$NEXTLINE_STATE/data`。停止並重新啟動 Supervisor 後，以 API 讀已知票核對確實使用還原目錄。不要只改 shell 變數而漏掉程序設定。

## Linux HTTPS 與程序管理範例

使用 Caddy＋Supervisor，同機代理到 loopback Node。先由管理者安裝 Node 22.23.4、Caddy、Supervisor；再以專用、非 root 的部署使用者操作。以下是可在沒有公開網域時完整演練的 `localhost:8443` TLS 路徑：

```sh
export NEXTLINE_ROOT="$PWD"
export NEXTLINE_STATE="$HOME/.local/share/nextline-service"
export NEXTLINE_NODE="$(command -v node)"
export NEXTLINE_CADDY="$(command -v caddy)"
export NEXTLINE_CADDYFILE="$NEXTLINE_ROOT/docs/deploy/local.Caddyfile"
export NEXTLINE_PUBLIC_URL=https://localhost:8443
export NEXTLINE_DATA_DIR="$NEXTLINE_STATE/data"
export NEXTLINE_TRUSTED_PROXIES=127.0.0.1
mkdir -p "$NEXTLINE_STATE"
chmod 700 "$NEXTLINE_STATE"
npm run selfhost:init
supervisord -c "$NEXTLINE_ROOT/docs/deploy/supervisord.conf"
curl --fail --cacert "$NEXTLINE_STATE/caddy-data/caddy/pki/authorities/local/root.crt" https://localhost:8443/health
supervisorctl -c "$NEXTLINE_ROOT/docs/deploy/supervisord.conf" status
supervisorctl -c "$NEXTLINE_ROOT/docs/deploy/supervisord.conf" restart nextline
```

代理自簽 CA 只供這次演練，設定 `skip_install_trust`，不修改 OS 信任庫；測試 client 必須明確指定 CA，不能用 `curl -k` 或關閉 TLS 驗證。瀏覽器日常使用應換正式網域及可信任的憑證。Supervisor 的控制介面只有 0700 Unix socket，沒有公開管理 port；Node 與 Caddy 失敗會自動重啟，log 留在私人 state 目錄。

停機／備份時用：

```sh
supervisorctl -c "$NEXTLINE_ROOT/docs/deploy/supervisord.conf" stop nextline
npm run selfhost:backup -- "$HOME/nextline-backups/server-before-update-01"
# init／驗證完成再 start nextline；整組結束用 shutdown
supervisorctl -c "$NEXTLINE_ROOT/docs/deploy/supervisord.conf" start nextline
supervisorctl -c "$NEXTLINE_ROOT/docs/deploy/supervisord.conf" shutdown
```

公開網域部署改用 `docs/deploy/public.Caddyfile`、`NEXTLINE_PUBLIC_URL=https://自己的網域`，確保 DNS、80/443 與 Caddy 綁低 port 的服務權限已由管理者設定。Node port 不公開，代理仍只信任 127.0.0.1。正式開機自動啟動由主機服務管理器啟動 Supervisor；這份範例實測的是程序意外退出後重啟，不宣稱驗過整台 VM 重開或任何公開網域 ACME 發證。不得把 `local.Caddyfile` 的測試憑證當作公開部署憑證。

## 可重跑的驗收

```sh
npm run verify
npm run build
node scripts/e2e/operations.mjs
node scripts/e2e/transport.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium node scripts/e2e/selfhost.mjs
# Linux 有 Caddy/Supervisor 時：
node scripts/e2e/https.mjs
```

`operations` 實跑 CLI 備份／重複還原／更新／失敗復原，並在 migration 持有 SQLite 寫鎖時 SIGKILL 程序；`transport` 用真正 TCP 與官方 MCP client，讓 browser API、人與四個 agent 並行寫入，分別跑 Node SQLite 和 workerd D1，注入 event 寫入失敗確認整批回滾。`selfhost` 完整操作登入、開票、拖拉、留言、過期與登出。`https` 使用實際 Caddy、驗 CA／Secure cookie、殺 Node 驗 Supervisor 重啟與資料保留、重啟代理並檢查 log 無測試秘密。每次使用新資料目錄，產物在 `.scratch/nx195/`（UI 在 `.scratch/nx194/`）；不碰正式服務。

實測平台與指令、結果見 [NX-195 驗收紀錄](self-host-validation.md)。未驗的平台不宣稱支援；Linux 容器只是隔離測試環境，不是發布的 Docker 產品。

來源：[Node 22 SQLite backup](https://nodejs.org/download/release/v22.23.0/docs/api/sqlite.html#sqlitebackupsourceDb-destination-options)、[SQLite Online Backup](https://www.sqlite.org/backup.html)、[Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls)、[Supervisor 設定](https://supervisord.org/configuration.html)。
