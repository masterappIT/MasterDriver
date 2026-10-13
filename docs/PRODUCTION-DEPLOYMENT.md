# 正式環境部署

部署方式沿用 Master Travel：Google Cloud Run、Cloud SQL、Artifact Registry、Secret Manager、Cloud Storage，由 GitHub Actions 自動發布。兩個專案的雲端資源完全分開，MasterDriver 使用獨立的 Google Cloud 專案 `master-driver-511510`，區域 `asia-east2`（香港）。

本文件只記錄架構與操作方式，不得寫入任何密碼、金鑰或 Secret 的內容（本倉庫公開）。

**目前狀態（2026-10-13）：已部署。**「一次性設定」全部完成，第一次部署由 GitHub Actions 執行成功，資料種子已執行。`DEPLOY_ENABLED` 已是 `true`：**之後每次推送到 `main` 都會自動部署正式環境。**

| 服務 | 目前的網址（暫時，等正式網域） |
|---|---|
| 司機與乘客網頁 | `https://masterdriver-web-396289477283.asia-east2.run.app` |
| 平台後台 | `https://masterdriver-admin-396289477283.asia-east2.run.app` |
| API | 只經上面兩個網址的 `/api` 使用 |

還不能給人用，因為：

- 還沒有正式網域，`*.run.app` 在內地很可能打不開；派單連結目前也是用這個暫時的網址產生。
- 簡訊通道還沒設定，所以沒有人能登入（取得驗證碼會回 `SMS_NOT_CONFIGURED`）。
- 還沒有後台帳號（見下方「第一次部署之後」）。
- 客服檔案的每日清理排程還沒建立。

**安全備註：**GitHub 到 Google Cloud 的登入限定為本倉庫、`production` 環境、`main` 分支；部署帳戶讀不到 Secret 的內容。能推送到本倉庫 `main` 的人就能部署正式環境，所以 masterappIT 帳號的密碼、兩步驗證與權杖要妥善保管。2026-10-13 曾因 Master Travel 倉庫的 `security-audit.yml` 懷疑帳號被盜用而暫緩接上 GitHub；使用者已確認帳號沒有被盜用。

## 分支

| 分支 | 用途 | 推送後 |
|---|---|---|
| `main` | 唯一的正式部署分支 | 品質閘門 → 自動部署正式環境 |
| `develop` | 開發整合 | 只執行品質閘門，不部署 |

與 Master Travel 相同：不另外建立 develop 專用的 API、資料庫或環境。功能在 `develop` 整合並通過品質閘門後，合併到 `main` 才上線。Pull request 一律執行品質閘門。

## 架構

```mermaid
flowchart TB
    User[司機、乘客的瀏覽器<br/>微信、WhatsApp 內建瀏覽器]
    Staff[平台人員的瀏覽器]
    Web[Cloud Run：web<br/>nginx + 司機與乘客網頁]
    Admin[Cloud Run：admin<br/>nginx + 平台後台]
    API[Cloud Run：api<br/>NestJS]
    Job[Cloud Run Job：migrate]
    SQL[Cloud SQL<br/>PostgreSQL]
    Bucket[Cloud Storage<br/>客服圖片與影片，不公開]
    Secrets[Secret Manager]
    Registry[Artifact Registry]
    Actions[GitHub Actions]

    User --> Web
    Staff --> Admin
    Web -->|/api| API
    Admin -->|/api| API
    API --> SQL
    API --> Bucket
    Secrets --> API
    Secrets --> Job
    Job --> SQL
    Actions --> Registry
    Registry --> Web
    Registry --> Admin
    Registry --> API
    Registry --> Job
```

| 服務 | 內容 | 說明 |
|---|---|---|
| `web` | `web/dist` + nginx | 搶單頁、乘客確認頁、司機端、客服頁；`/api/*` 轉給 API |
| `admin` | `admin/dist` + nginx | 平台後台；固定不給搜尋引擎收錄、不能被嵌入其他網站 |
| `api` | `backend/Dockerfile` | 所有驗證、權限、收費與搶單判斷 |
| `migrate`（Job） | 與 `api` 同一個映像檔 | 只執行 `prisma migrate deploy`；API 啟動時不會改資料庫結構 |

瀏覽器只連 `web` 或 `admin` 的網域，API 經同一網域的 `/api` 轉發，所以登入 cookie 是同站的，不需要 CORS。

## 發布流程

`.github/workflows/deploy-production.yml`，推送到 `main` 或手動執行時觸發：

1. 執行品質閘門（`verify:api`、資料庫整合測試、`verify:admin`、`verify:web`、部署腳本檢查），不通過就停止。
2. 以 Workload Identity Federation 登入 Google Cloud（GitHub 不保存任何 Google 金鑰）。
3. 建置 `web`、`admin`、`api` 三個映像檔並推送，之後一律以 `名稱@sha256:摘要` 指定，不使用 `latest`。
4. 建立 Cloud SQL 備份，失敗就停止。
5. 執行 migration Job，失敗就停止，並印出執行狀態與日誌。
6. 把 API 部署成不接流量的候選 revision，檢查 `/api/health/live` 與 `/api/health/ready`。
7. 檢查通過才把流量切到新 revision，並再次核對 revision、流量 100% 與映像檔摘要。
8. 部署 `web` 與 `admin`，同樣先不接流量，核對後才切換。

每次要改動正式環境（備份、migration、切流量、前端）之前，都會確認這個 commit 仍是 `main` 的最新一筆；排隊中的舊版本不會蓋掉新版本。

### 健康檢查

| 路徑 | 用途 |
|---|---|
| `GET /api/health/live` | 程序是否活著；Cloud Run 的啟動與存活探測用這個。資料庫出問題時不會讓平台不斷重啟服務 |
| `GET /api/health/ready` | 資料庫是否有回應；發布前檢查與外部監控用這個 |
| `GET /api/health` | 同 `ready`（舊路徑） |
| `GET /healthz` | `web`、`admin` 的 nginx 容器 |

### 資料庫變更的規則

API 與 migration 分開執行，新舊版本會短暫同時存在，所以 migration 必須向後相容：先加新結構、部署相容的程式，下一版才移除舊結構。正式環境不做自動還原（down migration）。

### 回滾

程式有問題時，把流量切回上一個確認過的 revision：

```bash
PROJECT_ID=master-driver-511510 REGION=asia-east2 SERVICE_NAME=masterdriver-api REVISION=<上一個 revision> ./deploy/cloud-run/rollback.sh
```

已執行的 migration 不會跟著還原；若結構仍向後相容就保留，否則優先用新版本修正。只有在資料完整性有風險、並宣告事故後，才考慮從備份還原。

## 一次性設定

以下由有權限的人執行一次。指令裡的名稱是建議值，可以更改，但要和 GitHub 變數一致。

```bash
export PROJECT_ID=master-driver-511510
export REGION=asia-east2
gcloud config set project "$PROJECT_ID"
```

### 1. 啟用服務

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
```

### 2. 映像檔倉庫

```bash
gcloud artifacts repositories create masterdriver --repository-format=docker --location="$REGION"
```

### 3. 資料庫

```bash
gcloud sql instances create masterdriver-db --database-version=POSTGRES_16 --edition=enterprise --region="$REGION" \
  --tier=db-custom-1-3840 --storage-size=10 --storage-auto-increase --backup-start-time=19:00 \
  --enable-point-in-time-recovery --deletion-protection
gcloud sql databases create master_driver --instance=masterdriver-db
gcloud sql users create master_driver --instance=masterdriver-db --password="<自行產生的長密碼>"
```

規格是起步用的建議值，試點期間夠用；備份時間 19:00 UTC 是香港凌晨 3 點。`--edition=enterprise` 是必要的：PostgreSQL 16 預設的版本不接受自訂規格。執行個體建立後就持續計費，還沒有流量時可以先停用（`gcloud sql instances patch masterdriver-db --activation-policy=NEVER`），部署前再改回 `ALWAYS`。

### 4. Secret

```bash
# 資料庫連線：Cloud Run 以 Unix socket 連 Cloud SQL
printf 'postgresql://master_driver:<密碼>@localhost/master_driver?host=/cloudsql/%s:%s:masterdriver-db&schema=public' "$PROJECT_ID" "$REGION" \
  | gcloud secrets create masterdriver-database-url --data-file=-
# 驗證碼雜湊用的隨機字串
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create masterdriver-otp-pepper --data-file=-
# 加密付款與簡訊金鑰用的金鑰。更換後，後台已儲存的金鑰會讀不出來，所以建立後不要重新產生。
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create masterdriver-data-encryption-key --data-file=-
```

密碼若含 `@`、`/`、`:` 等符號，寫進連線字串前要先做 URL 編碼。

### 5. 客服媒體的儲存空間

```bash
gcloud storage buckets create "gs://${PROJECT_ID}-support-media" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
# 保險：程式每天清除超過 180 天的檔案，bucket 自己再在 200 天時刪除
cat > /tmp/lifecycle.json <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":200}}]}
JSON
gcloud storage buckets update "gs://${PROJECT_ID}-support-media" --lifecycle-file=/tmp/lifecycle.json
```

### 6. 服務帳戶與權限

四個帳戶各做各的事，互不通用：

| 帳戶 | 用途 | 權限 |
|---|---|---|
| `masterdriver-api` | API 執行時 | Cloud SQL Client；讀三個 Secret；客服 bucket 的 Object Admin |
| `masterdriver-migrate` | migration Job | Cloud SQL Client；只讀資料庫連線 Secret |
| `masterdriver-frontend` | `web`、`admin` 執行時 | 無 |
| `masterdriver-deploy` | GitHub Actions | 推送映像檔、更新 Cloud Run 服務與 Job、執行 Job、建立資料庫備份、讀日誌；**不能讀 Secret 的內容** |

```bash
for name in api migrate frontend deploy; do gcloud iam service-accounts create "masterdriver-$name"; done
sa() { printf 'masterdriver-%s@%s.iam.gserviceaccount.com' "$1" "$PROJECT_ID"; }

for name in api migrate; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$(sa $name)" --role=roles/cloudsql.client --condition=None
  gcloud secrets add-iam-policy-binding masterdriver-database-url --member="serviceAccount:$(sa $name)" --role=roles/secretmanager.secretAccessor
done
for secret in masterdriver-otp-pepper masterdriver-data-encryption-key; do
  gcloud secrets add-iam-policy-binding "$secret" --member="serviceAccount:$(sa api)" --role=roles/secretmanager.secretAccessor
done
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT_ID}-support-media" --member="serviceAccount:$(sa api)" --role=roles/storage.objectAdmin

for role in roles/run.admin roles/artifactregistry.writer roles/cloudsql.admin roles/logging.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$(sa deploy)" --role="$role" --condition=None
done
# 部署帳戶要能指定另外三個帳戶來執行服務
for name in api migrate frontend; do
  gcloud iam service-accounts add-iam-policy-binding "$(sa $name)" --member="serviceAccount:$(sa deploy)" --role=roles/iam.serviceAccountUser
done
```

`roles/cloudsql.admin` 是為了建立備份，範圍比需要的大；之後可以改成只含 `cloudsql.backupRuns.create` 與 `cloudsql.instances.get` 的自訂角色。

### 7. GitHub 登入 Google Cloud（Workload Identity Federation）

只接受這個倉庫、`production` 環境、`main` 分支的工作流程：

```bash
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment,attribute.ref=assertion.ref' \
  --attribute-condition="assertion.repository=='masterappIT/MasterDriver' && assertion.environment=='production' && assertion.ref=='refs/heads/main'"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$(sa deploy)" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/masterappIT/MasterDriver"
```

### 8. GitHub 設定

在倉庫建立 `production` 環境，把「可部署的分支」限定為 `main`。Master Travel 的做法是再加上必須有人核准才部署；要不要加由您決定，加了之後推送到 `main` 會等核准才部署。

`production` 環境的變數（都不是秘密）：

| 變數 | 值 |
|---|---|
| `GCP_PROJECT_ID` | `master-driver-511510` |
| `GCP_REGION` | `asia-east2` |
| `GCP_ARTIFACT_REPOSITORY` | `masterdriver` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<專案編號>/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `masterdriver-deploy@master-driver-511510.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `masterdriver-api@…` |
| `GCP_MIGRATION_SERVICE_ACCOUNT` | `masterdriver-migrate@…` |
| `GCP_FRONTEND_SERVICE_ACCOUNT` | `masterdriver-frontend@…` |
| `GCP_SQL_INSTANCE_NAME` | `masterdriver-db` |
| `GCP_CLOUD_SQL_CONNECTION_NAME` | `master-driver-511510:asia-east2:masterdriver-db`（用指令設定時整個值要加單引號：zsh 會把變數後面的 `:a` 當成修飾符而改掉內容，第一次部署就是因此失敗） |
| `GCP_DATABASE_URL_SECRET` | `masterdriver-database-url` |
| `GCP_OTP_PEPPER_SECRET` | `masterdriver-otp-pepper` |
| `GCP_DATA_ENCRYPTION_KEY_SECRET` | `masterdriver-data-encryption-key` |
| `GCP_SUPPORT_MEDIA_BUCKET` | `master-driver-511510-support-media` |
| `GCP_API_SERVICE` | `masterdriver-api` |
| `GCP_MIGRATION_JOB` | `masterdriver-migrate` |
| `GCP_WEB_SERVICE` | `masterdriver-web` |
| `GCP_ADMIN_SERVICE` | `masterdriver-admin` |
| `PRODUCTION_WEB_URL` | 司機與乘客網頁的正式網址，例如 `https://<正式網域>`，結尾不加 `/`。派單連結與乘客確認連結用這個網址產生 |

**倉庫**層級的變數（不是環境變數，因為要在進入環境之前判斷）：

| 變數 | 值 |
|---|---|
| `DEPLOY_ENABLED` | 以上全部完成後設為 `true`。沒有設定時，推送到 `main` 只執行品質閘門 |

### 9. 第一次部署之後

```bash
# 功能目錄、方案與上線全站免費期（可重複執行）
gcloud run jobs deploy masterdriver-seed --region="$REGION" --image="<本次發布的 api 映像檔>" \
  --service-account="$(sa migrate)" --set-cloudsql-instances="${PROJECT_ID}:${REGION}:masterdriver-db" \
  --set-secrets=DATABASE_URL=masterdriver-database-url:latest \
  --command=npx --args=tsx,/app/prisma/seed.ts --max-retries=0
gcloud run jobs execute masterdriver-seed --region="$REGION" --wait
```

- **第一個超級管理員**：`npm run admin -- --create …` 會把一次性密碼印在畫面上。不要用 Cloud Run Job 執行（密碼會進入日誌）；請在自己的電腦用 Cloud SQL Auth Proxy 連到正式資料庫後執行，登入後立即修改密碼。
- **客服檔案清理**：建立一個每天執行的 Job（同一個映像檔，指令 `npx tsx src/cli/support-media.ts --purge`，使用 `masterdriver-api` 帳戶並帶 `SUPPORT_MEDIA_BUCKET`），用 Cloud Scheduler 觸發。
- **簡訊與付款通道**：在後台設定；上線前確認「登入配置 → 開發模式登入」是關閉的。

## 正式網域

這一步等正式網域確定後才能做，需要您提供：

1. 司機與乘客網頁用的網域（例如 `shifu.example.com`）。
2. 平台後台用的網域（建議另一個子網域，例如 `admin.shifu.example.com`）。
3. 這個網域的 DNS 由誰管理（之後要加紀錄）。

要留意的事：

- **Cloud Run 的自訂網域對應功能只在部分區域提供，據我所知不包含 `asia-east2`（建立前請以 Google Cloud 文件確認）。**若不支援，要在前面加一個全球外部 HTTPS 負載平衡器（serverless NEG 指向 `web` 與 `admin`），憑證用 Google 代管憑證。Master Travel 目前沒有負載平衡器，也沒有網域對應，這一段沒有現成做法可以沿用。
- **`*.run.app` 網址在內地很可能打不開**（Google 的網域在內地多數被封鎖）。計劃第 0 階段的「新網域在微信內打開實測」必須用正式網域、在內地的手機上做；負載平衡器的 IP 在內地能否穩定連線也要實測，不行的話要改用其他入口（例如在香港的反向代理或 CDN）。
- 微信內分享連結時，未在微信登記的網域可能出現提示頁；是否需要做微信的網域驗證，在實測時一併確認。
- 網域確定後要更新 `PRODUCTION_WEB_URL`，並在後台「SEO」填入正式網域。

## 已在正式環境驗證（2026-10-13）

- 完整的發布流程：品質閘門、三個映像檔、資料庫備份、migration Job、API 部署與健康檢查、兩個前端。
- 資料種子 Job 執行成功。
- 經 `web` 網址的 `/api` 轉發、SPA 路徑、`robots.txt`、`admin` 網址。
- 客服檔案：以訪客身分上傳一張圖片，寫入私有 bucket 後讀回內容完全相同；不帶憑證讀取回 401。（留下一則測試對話和一個 39 位元組的測試檔。）

## 尚未驗證

- **第二次之後的部署路徑**（新版本先不接流量、檢查後才切換）還沒有實際跑過；第一次部署走的是「服務不存在，直接建立」的路徑。下一次推送到 `main` 就會驗證到。
- 回滾腳本沒有實際執行過。
- 正式網域、內地連線、微信與 WhatsApp 內的操作。
- 影片上傳（只驗證了圖片）與客服檔案清理 Job。
- 從本機推送 API 映像檔會因上傳逾時失敗（映像檔約 780 MB），部署一律由 GitHub Actions 執行。

## 相關檔案

- `.github/workflows/deploy-production.yml`、`.github/workflows/quality-gates.yml`
- `backend/Dockerfile`、`.dockerignore`
- `deploy/frontend/`：`Dockerfile`、`web.conf`、`admin.conf`、`build-image.sh`、`deploy.sh`
- `deploy/cloud-run/`：`deploy.sh`、`smoke-test.sh`、`rollback.sh`、`revision-ready.py`
