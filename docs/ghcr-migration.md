# 方案：映像倉庫由 Artifact Registry 改為 GHCR

> 狀態：**草稿，待你批准**（2026-10-19）。只寫了方案，程式、workflow、伺服器、Google Cloud 都還沒有改。
> 做法參考 Master Travel 已完成的做法（`master-travel-project` 的 `deploy-hostkvm.yml`、`ghcr-retention.yml`，和 `MasterApp-infra` 的 `apps/mastertravel/deploy.sh`）。按 MasterDriver 自己的部署流程調整，不照搬。
> 本倉庫公開：本文件不寫任何密碼、金鑰或 token 的值。

## 1. 現況與目標

**現況**（2026-10-19 GCP 清理之後）：

- `deploy-production.yml` 用 Workload Identity Federation 以 `masterdriver-deploy` 服務帳號登入 Google Cloud。現在登入 GCP **只為了推映像**到 `asia-east2-docker.pkg.dev/master-driver-511510/masterdriver`（`api`、`web`、`admin`），以及用 `gcloud artifacts docker images describe` 取得摘要。
- 伺服器拉映像：root 的 Docker 已用 `masterapp-prod-vm@dualplate-511819` 的金鑰登入 `asia-east2-docker.pkg.dev`（`MasterApp-infra` 的 `server/registry-login.sh`），這個帳號有 `masterdriver` 倉庫的只讀權限。
- `deploy/hostkvm/lib.sh` 的 `REGISTRY` 寫死 Artifact Registry，`deploy.sh` 只接受摘要，再拼成 `$REGISTRY/api@<摘要>`，所以只能部署這個倉庫的映像。
- Artifact Registry `masterdriver`：9.2 GB，api 57 版、web 58 版、admin 58 版，**沒有清理規則**（2026-10-19 查詢）。

**目標**：

- 映像推到 GHCR 私人倉庫 `ghcr.io/masterappit/masterdriver-api`、`masterdriver-web`、`masterdriver-admin`。
- 推送和伺服器拉取都只用 workflow 當次的 `GITHUB_TOKEN`。GitHub 和伺服器都不另外保存 GHCR 的 token。
- 發布流程不變：品質閘門、不可變映像（以摘要指定）、部署前備份、migration、新槽先檢查才接流量、每一步前確認 commit 仍是 `main` 最新一筆。
- 改完後 workflow 完全不用 Google Cloud。MasterDriver 只剩每日備份還用 GCS（第 9 節）。

## 2. 和 Master Travel 的分別

| | Master Travel | MasterDriver（本方案） |
|---|---|---|
| 伺服器指令 | 一個指令做完：拉映像、備份、migration、更新、檢查 | 三個指令：`backup`、`api`、`frontends`。workflow 在每一個之前都確認 commit 仍是最新，這點要保留 |
| token 交給伺服器 | 一次，經 SSH 的標準輸入 | `api`、`frontends` 各一次，同一個 `GITHUB_TOKEN`，同樣經標準輸入；`backup` 不需要 |
| 切換方式 | `compose up` 換容器，失敗退回上一版 | a、b 兩槽，新槽檢查通過才接流量（不變） |
| 伺服器檔案放哪裏 | `MasterApp-infra/apps/mastertravel/` | 本倉庫 `deploy/hostkvm/`（不變，見 `DECISIONS.md` 2026-10-19） |
| 舊映像清理 | 部署成功後刪除 `deploy.env`、`deploy.env.prev` 以外的本產品映像 | 現在**完全不清理**，見 6.2 |

## 3. Workflow 改動（`.github/workflows/deploy-production.yml`）

1. **權限**：最上層 `permissions` 去掉 `id-token: write`（不再登入 GCP），只留 `contents: read`。`deploy` job 自己加：

   ```yaml
   permissions:
     contents: read
     packages: write
   ```

   品質閘門不拿 packages 權限。

2. **刪除** `google-github-actions/auth`、`google-github-actions/setup-gcloud`、`Configure Artifact Registry` 三步。

3. **新增**登入 GHCR（在建置之前）：

   ```yaml
   - name: Log in to GHCR
     env:
       GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     run: printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "${{ github.actor }}" --password-stdin
   ```

4. **建置與推送**：兩個 build 步驟的 `env` 改為
   - `REGISTRY: ghcr.io/masterappit`（GHCR 的名稱只能用小寫）
   - `SOURCE_LABEL: org.opencontainers.image.source=https://github.com/${{ github.repository }}`

   映像名稱改為 `${REGISTRY}/masterdriver-<api|web|admin>:<tag>`，tag 不變（API 是 `<sha>-<run id>-<attempt>`，前端是 `<sha>`）。
   - 每個映像加 `--label "$SOURCE_LABEL"`：第一次推送時 package 會連到本倉庫，`GITHUB_TOKEN` 之後才有權推送、拉取和清理。
   - `deploy/frontend/build-image.sh` 現在只接受 3 個參數。改為把第 4 個以後的參數原樣交給 `docker buildx build`，就能傳 `--label`。品質閘門沒有用到這個腳本，不受影響。
   - 取摘要：`gcloud artifacts docker images describe` 改為 `docker buildx imagetools inspect "$image" --format '{{json .Manifest}}' | jq -r .digest`，並檢查格式是 `sha256:<64 hex>`，不符就停止（和 Master Travel 一樣）。
   - 輸出仍是 `名稱@sha256:…`。後面幾步只傳 `#*@` 之後的摘要，不用改。

5. **把 token 交給伺服器**：`api`、`frontends` 兩步加 `GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}`，改為

   ```bash
   printf '%s\n' "$GHCR_TOKEN" | ssh production api "$GITHUB_SHA" "${IMAGE#*@}"
   printf '%s\n' "$GHCR_TOKEN" | ssh production frontends "$GITHUB_SHA" "${WEB_IMAGE#*@}" "${ADMIN_IMAGE#*@}"
   ```

   - token 不在命令列，所以不會出現在伺服器的程序列表和日誌。
   - GitHub Actions 的日誌會自動遮蔽 `GITHUB_TOKEN`。
   - `GITHUB_TOKEN` 在 job 結束時失效。
   - `status`、`backup` 兩步不變。

6. **檔頭註解**改寫成 GHCR，並寫明伺服器不保存 token。

7. **新增 `.github/workflows/ghcr-retention.yml`**（見 6.1）。

8. GitHub `production` 環境：不再需要的變數見第 9 節。`MASTERDRIVER_DEPLOY_SSH_KEY`、`PRODUCTION_WEB_URL` 和倉庫變數 `DEPLOY_ENABLED` 保留。

## 4. 伺服器拉 GHCR 的登入方式

照 Master Travel 的做法：

- `deploy.sh` 的 `api`、`frontends` 從標準輸入讀一行 token（等最多 10 秒）。只在標準輸入不是終端機時讀，所以 root 手動執行時不會卡住。
- 只檢查長度（20 到 4096）和字元（`A-Za-z0-9_.-`），不符就拒絕。不檢查 `ghs_` 前綴：2026-10-19 Master Travel 第一次經 GHCR 部署就是因為 GitHub 改了 token 格式而失敗。
- 拉映像時用一個臨時的 Docker 設定目錄：

  ```bash
  cfg="$(mktemp -d)"
  printf '%s' "$token" | DOCKER_CONFIG="$cfg" docker login ghcr.io --username x-access-token --password-stdin
  DOCKER_CONFIG="$cfg" docker pull --quiet "$image"
  rm -rf "$cfg"
  ```

  拉完立即刪除這個目錄，並清空變數裏的 token。root 原有的 `~/.docker/config.json`（Artifact Registry 的登入，其他產品還在用）不受影響。
- 之後 `compose up` 用的是本機已有的映像（`--quiet-pull` 在映像已存在時不會再拉），所以不需要登入。
- **手動執行**（沒有 token）時不拉取，只確認映像已在伺服器上（`docker image inspect`）；不在就停止，並提示改為重新執行 workflow。手動回滾到上一版仍然可以，因為上一版的映像在本機（見 6.2）。
- forced command（`forced-command.sh`）不用改：`sudo` 會把 SSH 的標準輸入交給 `masterdriver-deploy`，參數仍由 `deploy.sh` 逐個檢查。

## 5. Deploy 腳本的映像來源檢查

- `deploy/hostkvm/lib.sh`：

  ```bash
  REGISTRY=ghcr.io/masterappit
  ```

  去掉 `MASTERDRIVER_REGISTRY` 的覆寫，來源只能是這一個。部署帳號經 `sudo` 本來就改不了環境變數，去掉後連 root 手動執行也不能換來源。
- `deploy/hostkvm/deploy.sh`：
  - `cmd_api`：`image="$REGISTRY/masterdriver-api@$2"`
  - `cmd_frontends`：`$REGISTRY/masterdriver-web@$2`、`$REGISTRY/masterdriver-admin@$3`
  - 參數仍然只接受 40 位 commit SHA 和 `sha256:<64 hex>` 摘要，不接受映像名稱。所以部署帳號只能指定「哪一版」，不能指定「從哪裏來」。
  - 新增第 4 節的 token 讀取和臨時登入，取代現在直接 `docker pull`。
  - 更新檔頭註解（現在寫着 `Images come from Artifact Registry by digest`）。
- 品質閘門已有 `bash -n deploy/hostkvm/*.sh`，不用改。

## 6. 映像保留

### 6.1 GHCR（新增 `ghcr-retention.yml`）

- 照 Master Travel 的做法：`Deploy production` 成功後（`workflow_run`），用 `actions/delete-package-versions@v5`，每個 package 只留最近 10 版。也可以手動執行。
- 和部署同一個 `concurrency: production`，不會在部署拉映像時刪除。
- package 連到本倉庫（第 3 節的 label），所以 `GITHUB_TOKEN` 有權刪除，不用另存 token。

### 6.2 伺服器上的舊映像（建議一併做，要你決定）

- 現在 `deploy.sh` 從不刪除映像。每次發布多三個（API 約 780 MB，但大部分層和上一版共用）；伺服器磁碟已用 51%。
- 建議照 Master Travel：部署成功後，刪除 `release.env`、`release.env.prev` 都沒用到的映像。範圍只限 `ghcr.io/masterappit/masterdriver-*` 和舊的 `asia-east2-docker.pkg.dev/master-driver-511510/masterdriver/*`，其他產品的映像不動。
- `release.env` 裏 a、b 兩槽的映像就是現在和上一版，所以手動回滾仍可用本機映像。
- 這不是換倉庫必需的改動，可以分開做。但換到 GHCR 後手動執行不能再拉映像，本機保留上一版這件事就更重要。

## 7. 上線步驟

每一步確認後才做下一步。只有第 4 步會改動正式環境。

1. **在本倉庫改好並提交**（不推送）：
   - workflow、`ghcr-retention.yml`、`build-image.sh`、`lib.sh`、`deploy.sh`（加 6.2 的話也在這裏）
   - 文件：本文件、`PRODUCTION-DEPLOYMENT.md`、`HOSTKVM-MIGRATION.md` 5.1（「映像必須來自 Artifact Registry」）、`DECISIONS.md`
   - 本機檢查：actionlint、shellcheck、`bash -n`。
2. **你在 GitHub 確認**：`masterappIT` 是個人帳號（不是組織），個人帳號第一次發布的 package 預設是私人的。
   - 第一次推送後，到 `https://github.com/users/masterappIT/packages/container/package/masterdriver-api/settings` 確認三個 package 都是 Private，並連到 `masterappIT/MasterDriver`。
   - **package 一旦改成公開就不能改回私人**，所以不要在設定頁改可見度。
   - 本倉庫本身是公開的，映像裏只有公開的程式碼和 DB-IP Lite 資料；`.dockerignore` 排除了 `.env`。萬一變成公開，不會洩露密碼，但不符合這次「私人倉庫」的要求。
3. **把新的部署腳本裝到伺服器**（需要 root）：把本倉庫的 `deploy/hostkvm/` 複製到伺服器，不帶參數執行 `sudo bash setup.sh`。不帶參數時只更新腳本、compose 檔和 cron，不動 `app.env`、金鑰和運行中的容器。
   - 裝好之後到第 4 步之前，如果有人用舊 workflow 部署，會在拉映像時失敗（新腳本找 GHCR 的摘要），還沒備份和 migration，舊版照常運行。所以第 3、4 步要接着做。
4. **推送** → workflow 推到 GHCR，伺服器用 token 拉取並部署。觀察：
   - workflow 每一步成功；`ssh production status` 顯示新槽的映像是 `ghcr.io/masterappit/masterdriver-*@sha256:…`
   - 公開網址 `/api/health/ready` 回 200
   - 伺服器上沒有留下 GHCR 的登入：root 的 `~/.docker/config.json` 沒有 `ghcr.io`，`/tmp` 沒有殘留的設定目錄
   - 三個 package 是 Private（第 2 步）
5. **再部署一次**（下一次程式推送，或手動執行 workflow），讓 a、b 兩槽都是 GHCR 映像。`ghcr-retention.yml` 應在部署後自動執行並成功。
6. （可選，要你同意，會切換一次正式環境）以 root 手動執行 `masterdriver-deploy api <上一版 commit> <上一版摘要>`，確認沒有 token 時可以用本機映像回滾。
7. **清理 Google Cloud**（第 9 節，要你同意），並在本倉庫和 `MasterApp-infra` 的 `docs/step-3-master-driver.md` 都記錄。`MasterApp-infra` 由那邊的 session 記錄，本倉庫不改它。

**回退**：在第 7 步之前，Artifact Registry 和 `masterapp-prod-vm` 的權限都還在。revert 這個 commit，重新裝舊腳本（第 3 步的做法），再推送即可。

## 8. 要驗證的事

- 推送、拉取都只用 `GITHUB_TOKEN`。workflow 裏沒有 `id-token`、沒有 Google 的 action。
- 用錯的摘要、多餘的參數、格式不對的 token，`deploy-masterdriver` 一律拒絕（和 2026-10-19 測過的限制一樣，再測一次）。
- 拉取失敗時停在 migration 之前，舊版照常運行。
- 一次發布的時間和現在相近（約 10 分鐘）。

## 9. 改完後 Google Cloud 可以刪甚麼

前提：第 7 節第 5 步完成（兩槽都是 GHCR 映像）。刪除前照之前的做法，把相關 IAM 和設定匯出到 `gs://master-driver-511510-archive/`。

**換到 GHCR 後可以刪除**（`master-driver-511510`）：

| 資源 | 說明 |
|---|---|
| Artifact Registry `masterdriver` | 9.2 GB，每月約 US$1。`masterapp-prod-vm@dualplate-511819` 在這個倉庫的只讀權限會隨倉庫一起刪除，該帳號本身和它在其他產品倉庫的權限不受影響（Dualplate、MasterBox 仍用 Artifact Registry） |
| 服務帳號 `masterdriver-deploy` | 先移除它的專案角色 `run.admin`、`artifactregistry.writer`、`cloudsql.admin`、`logging.viewer`，在 `masterdriver-api`、`-migrate`、`-frontend` 上的 `iam.serviceAccountUser`，以及 Workload Identity 的 `iam.workloadIdentityUser`（`attribute.repository/masterappIT/MasterDriver`），再刪除帳號 |
| Workload Identity pool `github` 和 provider `github` | 只有本倉庫用。刪除後 30 天內可以恢復 |
| GitHub `production` 環境的變數 | `GCP_*` 全部 19 個（2026-10-19 查詢，包括早已沒用的 Cloud Run、Cloud SQL 相關變數），只留 `PRODUCTION_WEB_URL`。刪除前把值存一份到封存 bucket |

**和 GHCR 無關、現在已經可以刪除**（Cloud Run 和 Cloud SQL 已刪除，這些已經沒有用途）：

- 服務帳號 `masterdriver-api`、`masterdriver-migrate`、`masterdriver-frontend`、`masterdriver-scheduler`，以及它們的權限：`cloudsql.client`、3 個 Secret 的 `secretAccessor`、`support-media` 的 `objectAdmin`。
- 停用不再使用的 API：Cloud Run、Cloud SQL Admin、Artifact Registry、IAM Credentials、STS。可選，不影響費用。

**要保留**：

| 資源 | 原因 |
|---|---|
| bucket `master-driver-511510-backups`，服務帳號 `masterdriver-backup` | 伺服器每天上傳的備份（`backup.sh`），金鑰在伺服器上。所以這個專案不能關閉 |
| bucket `master-driver-511510-archive` | 最後的資料庫匯出和刪除前的設定 |
| Secret Manager 3 個 secret | 是否保留作密碼備份，要你決定 |
| bucket `master-driver-511510-support-media` | 要先確認舊的客服附件都已搬到伺服器才刪（切換時複製了 14 個檔案並核對過） |

## 10. 風險

| 風險 | 處理 |
|---|---|
| GHCR 私人 package 的費用 | GitHub 對私人 package 的儲存和下載流量有免費額度，超出要收費；容器映像目前是否計費，要你在 `https://github.com/settings/billing` 看 Master Travel 已產生的用量確認。每個 package 只留 10 版（6.1）；伺服器拉取時只下載有變的層 |
| package 意外變成公開 | 第 7 節第 2 步檢查；不在設定頁改可見度 |
| GitHub 改 `GITHUB_TOKEN` 的格式 | 只檢查長度和字元（第 4 節） |
| 手動執行不能從遠端拉映像 | 回滾用本機的上一版（6.2）；更舊的版本就重新執行 workflow |
| 刪除 Artifact Registry 後就不能用它回退 | 第 9 節要等兩槽都是 GHCR 映像才做 |

## 11. 要你決定或操作的事

1. 批准這份方案。
2. 6.2 伺服器舊映像清理要不要一起做。
3. 第 7 節第 2 步：在 GitHub 確認 package 是私人的，並看 Packages 的用量和費用。
4. 第 7 節第 3 步要有人在伺服器以 root 執行（或授權 session 經 `ssh masterapp-prod` 執行）。
5. 第 9 節各項刪除，以及 Secret Manager 和 `support-media` 是否保留。
