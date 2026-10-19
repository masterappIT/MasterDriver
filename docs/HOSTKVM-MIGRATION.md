# 搬遷計畫：正式環境由 Google Cloud 搬到 HostKVM

> 狀態：**已切換**（2026-10-19 06:09 UTC）。正式環境已在 HostKVM 運行；使用者指示「直接部署完切流量」「不要預演」，所以第 2、3、5 步（測試網域、負載平衡器過渡、之後再改 DNS）都沒做，改為一次切換：
> - 05:43 `DEPLOY_ENABLED` 改為 `false`。05:56 舊 API（Cloud Run）改為只接受內部流量，停止寫入（Cloud SQL 不支援整個執行個體設成唯讀，所以只能停 API）。停機約 13 分鐘。
> - 用 `gcloud sql export sql` 匯出（不需要資料庫密碼），`masterdriver-import-database` 匯入；bucket 的 14 個檔案用 `masterdriver-import-media` 複製。映像是 b401f35 由 workflow 建置的摘要；migration 沒有待執行的。
> - 06:09 兩筆 A 紀錄改指 `45.134.82.239`（TTL 5 分鐘），Caddy 取得 Let's Encrypt 證書。Google、Cloudflare、阿里 DNS 都已解析到新 IP。
> - 已驗證：兩個網域的 HTTPS 與 `/api/health/ready`、名片頁連結預覽與分享圖、`robots.txt`、站內通知未登入回 401、API 能連外網、用戶真實 IP 經 Caddy 與 nginx 傳到 API、備份上傳與恢復測試（46 個表、14 個檔案全部找得到）。
> - **還沒驗證**：內地手機在微信內打開（紅線 2）、WhatsApp 內操作、登入與簡訊、出單搶單、客服上傳、後台登入（第 7 節）。
> - `deploy-production.yml` 已改為經 SSH 叫伺服器做備份、API、前端三步（5.1），伺服器的 host key 寫死在 workflow；其餘步驟不變，最後多一步檢查公開網址的 `/api/health/ready`。部署帳號的限制已在伺服器上測過（只能執行 `masterdriver-deploy`、格式不對的參數一律拒絕、不能用 Docker）。2026-10-19 06:23 第一次由 workflow 發布（9d0cc4a，手動執行）成功：GitHub 的金鑰與 host key 連得上，部署前備份、migration、API 與前端都由 a 槽切到 b 槽，公開網址正常；`DEPLOY_ENABLED` 已改回 `true`，之後推送 `main` 就部署到伺服器。Google Cloud 的資源保留到穩定（第 6 步）。
> - **回退**：兩筆 A 紀錄改回 `34.144.204.172`，並把 Cloud Run 的 `masterdriver-api` 改回接受所有流量（`--ingress all`）。切換後寫入伺服器的資料要先搬回 Cloud SQL。
> 本倉庫公開：本文件不寫任何密碼、金鑰或 Secret 的值。

## 1. 目標與原則

- **新環境**：公司共用的 HostKVM 伺服器 `45.134.82.239`。伺服器上已有共用的 Caddy（80/443，自動 HTTPS）和 Postgres 16，MasterDriver 直接使用。MasterDriver 在伺服器上需要的檔案都放在本倉庫（4.2）。
- **部署方式按 MasterDriver 自己的需要設計**，不照搬其他產品的做法。**只改換環境必需的部分**：不是項目必要的改動（例如換映像倉庫、改 workflow 結構、清理程式）都不做。
- **發布流程不變**：推送 `main` → 品質閘門 → 建置不可變映像 → 備份資料庫 → migration → 候選版本先不接流量、檢查通過才切換 → 前端同樣先檢查再切換；每次改動正式環境前，都確認這個 commit 仍是 `main` 的最新一筆。
- **搬遷不影響運營**：
  - 用戶不換網址，登入狀態保留，已發出的派單、乘客確認、名片頁、預約連結全部照常可用。
  - 只有一次約 3 到 5 分鐘的「暫停寫入」，期間頁面照常可以打開和讀取，只有出單、搶單等操作暫時失敗；安排在流量最低的時段。
  - 不經 DNS 切換流量，所以沒有「一部分人連新環境、一部分人連舊環境」的情況，也可以隨時一鍵切回。
- **已完成的功能不能壞**：第 7 節列出每一項要逐條驗收的功能，切換前在測試網域先驗收一次，切換後再驗收一次。

## 2. 為什麼這些功能搬過去不會變

| 功能 | 依賴 | 搬遷後 |
|---|---|---|
| 名片頁、搶單、乘客確認的分享圖（連結預覽） | API 映像檔裏的 sharp 和 Noto CJK 字型，每次請求即時繪製；網址由 `PUBLIC_BASE_URL` 產生；web 的 nginx 依 User-Agent 把聊天軟體的抓取轉給 API，iOS 分享時用 SSI 換上該連結的標籤 | 同一個映像檔、同一份 `web.conf`、同一個 `PUBLIC_BASE_URL`。分享圖網址完全不變，微信、WhatsApp 已快取的預覽照樣有效 |
| 名片頁的車輛照片、客服的圖片和影片 | 檔案存在私有 bucket（`profile/`、`support/`），資料庫只存 `storageKey` | 檔案原樣複製到伺服器磁碟，路徑（`storageKey`）不變 |
| 派單群二維碼、Logo、站點設定、付款方式 | 存在資料庫 | 隨資料庫一起搬 |
| 付款與簡訊金鑰（加密存放） | `DATA_ENCRYPTION_KEY` | 從 Secret Manager 原樣抄過去，在測試網域先確認解得開 |
| 驗證碼 | `OTP_PEPPER` | 原樣抄過去 |
| 登入狀態 | session 存在資料庫 | 隨資料庫一起搬，用戶不用重新登入 |
| 站內通知（server-sent events，90 秒換一條） | 經 web 的 nginx 轉發 | 轉發設定不變。這一層超時要至少 120 秒（見 4.3） |
| 數據流監控的地區、限流用的用戶 IP | `X-Forwarded-For` | 見 4.3，與現在的行為相同 |

## 3. 新環境的架構

```
用戶 ─▶ Caddy（共用，唯一對外）
          ├─ masterdriverapp.masterappinc.com   ─▶ web-a / web-b    （nginx + 司機與乘客網頁）
          └─ masterdriveradmin.masterappinc.com ─▶ admin-a / admin-b（nginx + 平台後台）
                                                     │ /api
                                                     ▼
                                               api-a / api-b（NestJS）
                                                     │
                                       Postgres 16（共用，資料庫 master_driver）
                                       /srv/apps/masterdriver/media（客服與名片頁檔案）
```

- API 不直接對外，只經 web 和 admin 同一網域的 `/api` 轉發。和現在一樣，cookie 是同站的，不需要 CORS。
- 每個服務有 a、b 兩個槽，平時只有一個在跑。發布時新版本用另一個槽啟動，檢查通過才接流量，之後停掉舊的（見 5.2）。這樣才能保留現在「候選版本先不接流量」的流程，發布時不中斷搶單。
- 網絡：
  - API 只接 `data`（資料庫）和 MasterDriver 自己的內部網絡。
  - web 和 admin 接 `edge`（給 Caddy 轉發）和內部網絡。
  - 其他產品的容器連不到 MasterDriver 的 API。
- 記憶體上限：API 每個 1 GB（和現在 Cloud Run 相同；發布時兩個槽短暫同時運行）；web、admin 各 128 MB。過去 7 天三個服務合計高峰約 570 MB。
- 現在 Cloud Run 最多 3 個執行個體、每個 80 個並行請求，所以同時在線上限約 240 人（`DECISIONS.md` 2026-10-14 站內通知）。搬到一個 Node 程序後沒有這個上限。

### 3.1 檔案存放（2026-10-19 你決定：伺服器磁碟，每日備份）

- 位置：`/srv/apps/masterdriver/media`，掛進 API 容器，由容器的 `node` 帳號擁有。
- 程式改動：目前 `backend/src/config.ts` 在正式環境不使用本機目錄（理由是 Cloud Run 的磁碟會消失），這一點在伺服器上不成立。
  - 改為正式環境也可以設定 `SUPPORT_MEDIA_DIR`。
  - 設定了 bucket 時仍優先用 bucket，所以搬遷前 Cloud Run 的行為不變，這個改動可以先上線。
  - 現有的本機儲存（`LocalMediaStorage`）已有測試。
- 每日清除超過 180 天的客服檔案：伺服器上的 cron，每天 04:30（香港時間）在運行中的 API 容器內執行 `node dist/cli/support-media.js --purge`。取代 Cloud Scheduler 加 Cloud Run Job。
- **每日備份**（本倉庫的 cron，不依賴伺服器上其他備份）：
  - 每天香港時間 03:00，`pg_dump` 備份 `master_driver`，同時把 `media` 打包成一個帶日期的壓縮檔，兩者一起上傳到 GCS 的備份 bucket（例如 `master-driver-511510-backups`）。伺服器上只放一把只能新增、不能刪除的服務帳戶金鑰。
  - bucket 設保留期限（例如 35 天）自動刪除。不用逐檔同步：保留期限按上傳時間算，逐檔同步會讓很久以前上傳、仍在使用的檔案被刪掉。
  - 伺服器上保留最近 7 天，以便快速還原。
  - 恢復測試要同時還原資料庫和檔案，並核對資料庫裏的 `storageKey` 都找得到檔案。

## 4. 程式與設定的改動

### 4.1 本倉庫（搬遷前就上線，對 Cloud Run 沒有影響）

| 改動 | 檔案 |
|---|---|
| 正式環境可用本機目錄存檔案（bucket 仍然優先） | `backend/src/config.ts`、`backend/src/storage/media-storage.ts` 和測試 |
| 前端的 nginx 映像固定一個支援 `resolve` 的版本（1.27.3 以上） | `deploy/frontend/Dockerfile` |
| 發布 workflow：只把「備份、migration 與 API、前端」三個部署步驟改為呼叫伺服器（見 5.1），其他步驟不變 | `.github/workflows/deploy-production.yml`（切換時才改，見第 4 步） |
| 文件 | `docs/PRODUCTION-DEPLOYMENT.md`、`docs/DECISIONS.md` |

workflow 在切換時才改，因為改了之後推送 `main` 就不再部署 Cloud Run。第 2 步在測試網域用手動執行部署腳本的方式驗證（見第 2 步）。

`web.conf`、`admin.conf` 不用改：
- 在伺服器上，`API_ORIGIN` 設為 `http://masterdriver_api`。
- 另外掛一個檔案進 nginx 的 `conf.d/`，定義 `masterdriver_api` 指向 `api-a`、`api-b`。用 Docker 的 DNS 動態解析，容器換了 IP 也不用重啟 nginx。
- Cloud Run 不掛這個檔案，行為不變。

### 4.2 伺服器上的檔案（放在本倉庫 `deploy/hostkvm/`）

- `compose.yaml`：三個服務的 a、b 槽、網絡、記憶體上限、檔案目錄。
- `api-upstream.conf`：給前端 nginx 的 `masterdriver_api` 定義（4.1）。
- `masterdriver.caddy`：兩個網域的 Caddy 設定；`caddy-site.sh` 填入網域、寫到伺服器的 Caddy 網站設定目錄，驗證通過才 reload，失敗就放回原本的設定。
- `setup.sh`：首次安裝，可以重跑。建立資料庫帳號與資料庫、`app.env`、檔案目錄、部署帳號、cron，並把下列腳本裝成 `masterdriver-*` 指令。
- `deploy.sh`：部署腳本（5.2）；`forced-command.sh`：部署帳號只能執行它。
- `backup.sh`：每日備份（3.1）；`restore-test.sh`：恢復測試；`purge.sh`：每日清除過期客服檔案。
- `import-database.sh`、`import-media.sh`：第 2、4 步匯入 Cloud SQL 的副本與 bucket 的檔案；匯入後列出每個表的行數，給核對用。
- `lib.sh`：各腳本共用的設定與函式。
- `cron`：每日備份、每日清除過期客服檔案。
- 品質閘門現有的「部署腳本檢查」加上這個目錄。

### 4.3 轉發與用戶 IP

- **直接連伺服器時（DNS 切換之後）**：
  - Caddy 不採信用戶送來的 `X-Forwarded-For`，改寫成對方的真實 IP；web 的 nginx 再附加一層。
  - API 的 `trust proxy` 取最左邊的值，就是用戶的真實 IP，而且不能偽造，比現在可靠。
- **經 Google 負載平衡器轉到伺服器時（過渡期）**：
  - Caddy 要信任 Google 負載平衡器的來源網段（`35.191.0.0/16`、`130.211.0.0/22`），保留它帶來的 `X-Forwarded-For`。
  - 否則所有用戶都會被看成同幾個 Google IP：同一 IP 的驗證碼限流和訪客客服限流會擋住正常用戶，數據流監控的地區也會全變成香港。
  - 過渡期的行為和現在 Cloud Run 上相同。
- 負載平衡器到伺服器這一段的超時要設 120 秒，預設的 30 秒會截斷站內通知的連線。

## 5. 發布流程（搬遷後）

### 5.1 GitHub Actions（`deploy-production.yml`，結構不變）

| 步驟 | 搬遷後 |
|---|---|
| 品質閘門 | 不變 |
| 確認 commit 仍是 `main` 最新一筆（共 4 次） | 不變 |
| 以 Workload Identity Federation 登入 Google Cloud | 不變（只用來推映像） |
| 建置三個映像檔，推到 Artifact Registry，以 sha256 摘要指定 | 不變 |
| 建立 Cloud SQL 備份 | 改為經 SSH 叫伺服器備份資料庫 |
| migration、API 候選版本、檢查、切流量 | 改為經 SSH 叫伺服器做同樣的事 |
| 部署 `web`、`admin`，先檢查再切換 | 改為經 SSH 叫伺服器做同樣的事 |
| 倉庫變數 `DEPLOY_ENABLED` 開關部署 | 不變 |

- 伺服器拉映像：公司伺服器已用只讀的 `masterapp-prod-vm` 帳號登入 Artifact Registry，只要給它 MasterDriver 映像倉庫的只讀權限。
- 部署帳號 `deploy-masterdriver` 只能執行部署腳本，不能開 shell、不能轉發連線，並逐個檢查參數格式；映像必須來自 `asia-east2-docker.pkg.dev/master-driver-511510/masterdriver/`。
- 私鑰只放在本倉庫 `production` 環境的 Secret；伺服器的 host key 寫死在 workflow 裏。

### 5.2 伺服器上的部署腳本

三個指令，分別對應 workflow 原有的三個部署步驟，所以每一步之前的「commit 是否最新」檢查都保留：

- `backup <commit>`：`pg_dump` 備份 `master_driver`，保留最近 5 份，失敗就停止。
- `api <commit> <api 摘要>`：見下面第 2 到 5 點。
- `frontends <commit> <web 摘要> <admin 摘要>`：見下面第 6 點。

1. 加鎖，同一時間只跑一個指令。
2. 拉映像檔。
3. （`api`）用新的 API 映像檔執行 `prisma migrate deploy`，失敗就停止，舊版繼續運行。migration 必須向後相容，這條規則不變。
4. （`api`）檢查方式和現在的 `deploy/cloud-run/smoke-test.sh` 相同。
5. （`api`）在另一個槽啟動新的 API：
   - 先**不接流量**，在容器內檢查 `/api/health/live` 和 `/api/health/ready`。
   - 通過才把它接進內部網絡讓 nginx 找到，之後停掉舊的 API。
   - 舊的停止時先不再接新連線，進行中的請求做完才結束；站內通知的連線由網頁自動重連。
6. （`frontends`）前端同樣做法：
   - 新的 web、admin 在另一個槽啟動，只在內部網絡檢查 `/healthz` 和經它轉發的 `/api`。
   - 通過才接到 `edge` 讓 Caddy 轉發，之後停掉舊的。
7. 任何一步檢查失敗，就停掉新槽，舊版不受影響。
8. 每個被停掉的容器先把日誌存到 `/srv/apps/masterdriver/logs/`（保留 30 天）再刪除。否則每次發布都會失去 `client-load` 等日誌（現在 Cloud Logging 保留 30 天）。
9. **回滾**：用部署腳本重新部署上一版的三個摘要，同樣先檢查再切換。

## 6. 搬遷步驟

每一步驗收後才做下一步。第 1 到第 3 步對線上沒有任何影響。

### 第 1 步：準備程式與伺服器

1. 完成 4.1 的程式改動，上線到 Cloud Run，確認行為不變。
2. 完成 4.2 的伺服器檔案。在伺服器建立：資料庫帳號和 `master_driver` 資料庫（新密碼）、`app.env`（權限 600）、檔案目錄、部署帳號、cron。
   - `app.env`：`NODE_ENV=production`、`PORT=8080`、`PUBLIC_BASE_URL=https://masterdriverapp.masterappinc.com`、`SESSION_COOKIE_SECURE=true`、`SUPPORT_MEDIA_DIR`、新的 `DATABASE_URL`。
   - `OTP_PEPPER` 和 `DATA_ENCRYPTION_KEY` 從 Secret Manager 原樣抄過去。
3. 給伺服器的 `masterapp-prod-vm` 帳號 MasterDriver 映像倉庫（`masterdriver`）的只讀權限。
   建立備份 bucket 和只能新增的備份服務帳戶（3.1）。
4. 在 Squarespace 把 `masterdriverapp`、`masterdriveradmin` 的 TTL 由 4 小時調低到 5 分鐘（給第 5 步用）。

### 第 2 步：測試網域（用真實資料的副本）

1. 在 Squarespace 新增一個臨時子網域，例如 `masterdriver-test.masterappinc.com`，指向 `45.134.82.239`。要你在 Squarespace 操作。
2. 把 Cloud SQL 的副本匯入伺服器，把 bucket 的檔案複製到伺服器，用 Artifact Registry 裏現在正式環境的映像摘要，手動執行部署腳本的三個指令。
3. 在測試網域驗收第 7 節全部功能，包括**在內地手機的微信裏打開**。這也是第一次實測這部伺服器的內地線路（紅線 2）。
   - 測試網域上產生的派單和名片頁連結仍是正式網域（`PUBLIC_BASE_URL`），這些連結會打開現在的正式環境。
   - 測試時寫入的資料會在第 4 步被正式資料覆蓋。
4. 用不同版本的映像摘要手動部署幾次，確認槽切換時不中斷（測試時持續讀寫，看有沒有失敗的請求）。

### 第 3 步：把負載平衡器接上新伺服器（還不切流量）

1. 在 `master-driver-511510` 建立指向 `45.134.82.239` 的網際網路 NEG 和後端服務（HTTPS、超時 120 秒）。
2. **先取得兩個正式網域的 HTTPS 證書**：讓負載平衡器 80 埠的 `/.well-known/acme-challenge/*` 轉到伺服器，其他照舊轉成 `https://`。Caddy 就能在 DNS 還指向負載平衡器時取得正式網域的證書，第 5 步改 DNS 時不會出現證書錯誤。
3. 用另一個臨時子網域經同一個負載平衡器轉到伺服器，驗證：
   - 負載平衡器到 Caddy 的 TLS（SNI）
   - 用戶 IP
   - 25 MB 影片上傳
   - 站內通知連線能維持 90 秒
   - 連結預覽
4. 這一步只新增資源，現有兩個網域的轉發規則不動。

### 第 4 步：切換（一次約 3 到 5 分鐘的暫停寫入）

時間：用數據流監控過去兩週的資料，挑流量最低的時段（預計凌晨 3 到 5 點）。可以先在派單群預告。

| 順序 | 做甚麼 | 用戶感受 |
|---|---|---|
| 1 | 倉庫變數 `DEPLOY_ENABLED` 改為 `false`，停止部署到 Cloud Run；這段時間不合併 `main` | 無 |
| 2 | 把 bucket 檔案增量複製到伺服器 | 無 |
| 3 | **暫停寫入**：Cloud SQL 的資料庫設為唯讀，並結束現有連線 | 頁面照常打開和讀取；出單、搶單、登入、上傳暫時失敗 |
| 4 | 匯出 Cloud SQL，匯入伺服器（約 107 MB）；逐表核對行數；檔案再增量複製一次並核對數量 | 同上 |
| 5 | 伺服器的 API 確認沒有待執行的 migration，並檢查 `/api/health/ready` | 同上 |
| 6 | **負載平衡器的兩個網域改轉到伺服器**，所有用戶即時切換（不經 DNS） | 恢復正常 |
| 7 | 驗收第 7 節的主要流程 | 無 |
| 8 | 合併 `deploy-production.yml` 的修改（5.1），`DEPLOY_ENABLED` 改回 `true`，手動執行一次 | 無 |

**回退**：
- 第 6 步前：把 Cloud SQL 改回可寫即可，沒有資料差異。
- 第 6 步後：把負載平衡器改回 Cloud Run（即時生效）。但之後寫入伺服器的資料要先用同樣的暫停寫入方式搬回 Cloud SQL。
- Google Cloud 上的所有資源保留到穩定為止。

### 第 5 步：改 DNS（不停機）

1. 切換穩定兩三天後，在 Squarespace 把兩筆 A 紀錄改為 `45.134.82.239`。
2. 新、舊 DNS 都到同一部伺服器（舊的經負載平衡器），證書在第 3 步已取得，所以沒有中斷。
3. 等舊紀錄的快取過期（TTL 已調低），再觀察一週，確認經負載平衡器的流量已經沒有。之後 Caddy 改回不採信外來的 `X-Forwarded-For`（4.3）。
4. TTL 調回正常，刪除兩個臨時子網域。

### 第 6 步：清理 Google Cloud（穩定兩週後）

1. 最後一次備份 Cloud SQL 和 bucket，存到公司的備份 bucket。
2. 刪除會持續收費的資源：
   - 負載平衡器、證書、固定 IP（每月約 18 到 25 美元）
   - 三個 Cloud Run 服務
   - 三個 Job
   - Cloud Scheduler
   - Cloud SQL
   - 客服檔案的 bucket
3. 保留發布流程和備份要用的：Artifact Registry、Workload Identity Federation、部署帳號、備份 bucket。
4. Secret Manager 是否保留作密碼備份，到時再決定。
5. 本倉庫只更新 `docs/PRODUCTION-DEPLOYMENT.md`。不用的程式（`deploy/cloud-run/`、`GcsMediaStorage`）不影響運行，不特別清理。

## 7. 必須逐條驗收的功能

測試網域驗收一次（第 2 步），切換後再驗收一次（第 4 步第 7 項，加上之後幾天的觀察）。每一條在微信內建瀏覽器和 WhatsApp 內各做一次；內地用中國電信、移動、聯通的手機網絡各試一次。

1. **連結預覽與分享圖**：
   - 名片頁 `/p/`、搶單 `/o/`、乘客確認 `/c/` 和首頁，貼到 WhatsApp 出現正確的圖和文字。
   - iOS 分享到微信時用的是該連結自己的標題。
   - 圖片網址仍在正式網域。
2. **名片頁**：車輛照片顯示、上傳新照片、預約 `/b/`。
3. **派單與搶單**：
   - 出單、分享、搶單；兩人同時搶同一張單只有一人成功。
   - 乘客確認、標記完成、取消、改派。
4. **登入**：+86 經 Spug 收驗證碼並登入；後台登入；已登入的用戶切換後仍是登入狀態。
5. **站內通知**：鈴鐺未讀數、即時送達、提示音。
6. **客服**：文字、圖片、影片（登入後）；後台看得到並回覆；訪客客服。
7. **付款方式與簡訊設定**：後台看得到已存的設定（證明 `DATA_ENCRYPTION_KEY` 正確），發一封測試簡訊。
8. **派單群二維碼**、Logo、站點設定、`robots.txt`、後台 SEO。
9. **數據流監控**：顯示的地區是用戶真實的地區，不是香港或 Google；`client-load` 有記錄。
10. **發布後的快取**：發布新版後，開著的頁面切頁能自動重新載入（`stale-build`），`index.html` 不被快取。
11. **每日工作**：清除檔案的 cron 有執行記錄；每日備份包含資料庫和檔案，並試還原一次。

## 8. 風險

| 風險 | 處理 |
|---|---|
| 這部伺服器的線路（HKCO 優化中國電信）在內地移動、聯通網絡不夠快，微信內打開慢 | 第 2 步先在測試網域用三家網絡實測，不理想就停在第 2 步，不切換。HostKVM 的 3 天退款期到 2026-10-22 |
| 伺服器整部故障，所有產品一起停 | MasterDriver 自己的每日異地備份（資料庫與檔案）與恢復測試（3.1）；`setup.sh` 可在新機上重建，再還原備份 |
| 和其他產品共用 Postgres 與伺服器資源 | 每個容器設記憶體上限；資料庫帳號只能存取 `master_driver` |
| 暫停寫入期間正好有人出單或搶單 | 挑最低流量時段、事先預告；暫停約 3 到 5 分鐘，讀取不受影響 |
| 負載平衡器轉到伺服器時，用戶 IP 處理錯誤導致限流誤擋 | 第 3 步用臨時子網域先驗證，切換後看數據流監控的地區 |
| 檔案只在一部伺服器的磁碟上 | 每日打包備份到 GCS；伺服器 80 GB 磁碟要設用量提醒（影片每個最多 25 MB） |

## 9. 要你決定或操作的事

1. 批准這份計畫。
2. Squarespace：調低兩個網域的 TTL、新增兩個臨時子網域（第 2、3 步）。
3. 切換日期。Google Cloud 的贈送額度約在 10 月底到 11 月初用完。
4. 第 2 步在內地微信實測時，需要有人用三家網絡的手機測試。
