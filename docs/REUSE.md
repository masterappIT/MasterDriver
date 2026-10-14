# 沿用 Master Travel 程式碼的規則

2026-10-13 決定：Master Travel 的部分前端程式碼可以直接沿用。本文件規定哪些可以沿用、怎麼沿用，以及如何記錄來源。

## 原則

1. **複製，不連結。** 沿用方式是把檔案複製進本專案，複製後由 MasterDriver 自己維護。不建立跨倉庫的 import、共用套件、git submodule 或自動同步。Master Travel 完全不動（紅線 4）。
2. **只沿用通用部分。** 報價、收款、結算、司機審核、會員積分等 Master Travel 核心業務程式一律不沿用（紅線 5）。
3. **複製前先檢查。** 移除 Master Travel 專屬的名稱、網址、AppID、環境變數名稱和業務假設；不得帶入任何金鑰或正式設定（本倉庫公開）。
4. **記錄來源。** 每次沿用都在下方「沿用記錄」新增一列，寫明來源路徑與 Master Travel 的 commit。
5. **連同測試一起帶過來。** 來源有測試的，測試一併複製並在本專案通過。

## 分類

### A. 可以直接沿用（複製後小幅調整）

| 類別 | Master Travel 來源 | 用在 MasterDriver |
|---|---|---|
| 圖示、圖片 | `src/static/`（SVG 圖示、車輛圖、分享預覽圖）、`driver/assets/` | 所有頁面；Logo 另依 `docs/DESIGN.md` |
| 設計數值 | `driver/lib/core/tokens/driver_tokens.dart`、`src/styles/tokens.css` 的數值 | `web/` 的 CSS 變數（已整理在 `docs/DESIGN.md`） |
| 繁簡轉換 | `src/i18n/zh-hans-map.ts`、`src/i18n/index.ts` 的轉換做法 | 繁簡自動切換（+852 繁、+86 簡） |
| 車牌格式 | `src/utils/vehiclePlate.ts` | 司機資料、車牌顯示 |
| 地址顯示 | `src/utils/orderAddress.ts`、`src/utils/routePoints.ts` | 單的地點與途經點顯示 |
| 香港、內地地區 | `src/utils/localRegions.ts` | 常用地點、名片頁服務地區 |
| 連結網址 | `backend/src/order-url.ts` | 派單連結（須改用本專案的網域與路徑） |
| 連結預覽頁 | `backend/src/order-invite-share.ts` | WhatsApp 預覽、伺服器輸出的標題和摘要（須改標題「MasterApp｜司機端」等文字） |
| 頭像圖片處理 | `backend/src/avatar-image.ts` | 司機頭像、車輛照片 |

| 部署腳本 | `deploy/cloud-run/`（`deploy.sh`、`smoke-test.sh`、`rollback.sh`、`revision-ready.py`）、`deploy/frontend/`（`build-image.sh`、`deploy.sh`、`Dockerfile`、`default.conf`）、`.github/workflows/deploy-production.yml` | 正式環境部署（須移除分享圖片服務、Flutter、小程序與 Master Travel 的 Secret；**不得沿用 `.github/workflows/security-audit.yml`**） |

### B. 改寫後沿用（邏輯可參考，程式要轉換）

| 來源 | 原因 | 做法 |
|---|---|---|
| 乘客端 uni-app 元件，例如 `src/components/common/PageNavBar.vue`、`src/components/home/BookingTimePicker.vue`、`AddressPicker.vue` | 使用 uni-app 標籤（`view`、`text`）與 `uni.*` API | 版式與樣式沿用，標籤與 API 改成標準 Vue 3 與瀏覽器 API |
| 司機端 Flutter 頁面與規則，例如 `driver/lib/core/vehicle_plate_rules.dart`、`order_invite/order_invite_page.dart` | Dart / Flutter，無法在 Vue 使用 | 依其邏輯與版式用 TypeScript、Vue 3 重寫 |
| Stripe 與 AlipayHK 收款設定，例如 `backend/src/stripe-channel-config.ts`、`backend/src/finance-channel.ts`、`admin/src/pages/payments/` | 綁定 Master Travel 的收款通道與財務中心 | 參考設定驗證與通道設定的做法；MasterDriver 只用 Stripe、AlipayHK 收訂閱，不做乘客收款 |
| 手機驗證碼登入流程 | 綁定 Master Travel 的帳號、session 與資料表 | 參考流程，依本專案資料結構重寫 |
| 後台外觀與版面：`admin/src/styles/`（`tokens.css`、`layout.css`、`components.css`、`tables.css`、`overlays.css`、`auth.css`、`dashboard.css`）、`admin/src/main.js` 的外框與選單、`admin/src/pages/dashboard/` | 原生 JS 與全域樣式，並綁定 Master Travel 的頁面、權限與多語 | 沿用顏色、圓角、陰影、側欄、卡片、表格、按鈕、輸入框、分頁、登入頁與總覽卡片的樣式數值，用 Vue 3 元件與本專案的 token 名稱重寫；選單順序與分組參照它，但項目與用詞按本專案的頁面；不帶入它的頁面、權限、多語與 Logo 上傳 |
| 內置客服，`docs/INTERNAL-SUPPORT-REQUIREMENTS.md`、`backend/src/main.ts` 的客服 API、`src/pages/support/chat.vue`、`admin/src/pages/support/` | Express、uni-app、Flutter 與原生 JS 後台，並綁定 Master Travel 的乘客、司機帳號 | 沿用設計（共用收件匣、訪客憑證只存雜湊、訊息去重、定時讀取、私有媒體），用 NestJS 與 Vue 3 重寫；兩邊各有各的資料庫與收件匣 |

### C. 不沿用

- 報價、計價、路線定價、收款、退款、結算、錢包、會員、積分、優惠券。
- 地圖與定位（本專案不用地圖）。
- Master Travel 後台的程式、權限與登入設定。後台的**外觀與版面**可以參照（2026-10-14 決定，見 B 類「後台外觀與版面」），但頁面內容與功能按本專案需求，不照搬它的頁面。
- 任何含 Master Travel 金鑰、正式網址或 AppID 的設定。

## 沿用記錄

| 日期 | 本專案檔案 | Master Travel 來源 | 來源 commit | 調整內容 |
|---|---|---|---|---|
| 2026-10-13 | `web/src/i18n/zh-hans-map.ts` | `src/i18n/zh-hans-map.ts`（由 OpenCC 資料產生） | `c1691339` | 原樣複製 |
| 2026-10-13 | `web/src/i18n/convert.ts` | `src/i18n/index.ts` 的繁轉簡邏輯 | `c902bb5a` | 同樣的詞組優先、逐字轉換與快取；改為瀏覽器版本，並在需要簡體時才載入 |
| 2026-10-13 | `backend/src/channels/stripe-config.ts` | `backend/src/stripe-channel-config.ts` | `e4a82aa2` | 原樣複製；設定的儲存、加密與 API 改由本專案的 `payment-channels.service.ts` 處理 |
| 2026-10-13 | `backend/src/channels/stripe-config.test.ts` | `backend/src/stripe-channel-config.test.ts` | `e4a82aa2` | 只改 import 路徑 |
| 2026-10-13 | `backend/src/channels/alipayhk-config.ts` | `backend/src/main.ts` 的 AlipayHK 設定驗證與金鑰檢查 | `c902bb5a` | 依同樣規則重寫成獨立函式（HTTPS 網關、2160 開頭 16 位商戶、PKCS8／SPKI 金鑰） |
| 2026-10-13 | `backend/src/channels/sms253.ts`、`sms-channels.service.ts` | `backend/src/main.ts` 的 253 雲通訊呼叫（`requestSms253WithConfig`、`sendSms253`） | `c902bb5a` | 依同樣的請求格式重寫；改為 +86 走國內帳號、+852／+853 走國際帳號；紀錄不保存含驗證碼的簡訊內容 |
| 2026-10-13 | `backend/src/common/secret-box.ts` | `backend/src/main.ts` 的 `encryptWechatSecret`／`decryptWechatSecret` | `c902bb5a` | 同樣使用 AES-256-GCM；金鑰改用獨立的 `DATA_ENCRYPTION_KEY`，密文加版本前綴 `v1` |
| 2026-10-13 | `backend/src/support/`、`web/src/pages/SupportPage.vue`、`web/src/support.ts`、`admin/src/pages/SupportPage.vue` | 內置客服：`docs/INTERNAL-SUPPORT-REQUIREMENTS.md`、`prisma/schema.prisma` 的 `Support*` 模型、`backend/src/main.ts` 的客服 API、`backend/src/support-media.ts`、`src/pages/support/chat.vue`、`admin/src/pages/support/` | `c902bb5a` | 依同樣的設計重寫，沒有複製程式：對話參與者改為本專案的用戶與訪客（沒有乘客、司機之分）；客服操作寫入本專案的後台操作紀錄，不另建客服稽核表與客服帳戶；圖片不在伺服器轉檔（由瀏覽器先縮小），另加影片；媒體改為經 API 讀取的私有 Cloud Storage，並在沒有儲存空間時拒收 |
| 2026-10-14 | `admin/src/pages/AccountsPage.vue`、`admin/src/components/FeedbackLayer.vue` 的樣式 | `admin/src/pages/administrators/AdministratorsPage.js`、`admin/src/styles/administrators.css`、`tables.css`、`overlays.css`（確認視窗與提示） | `c902bb5a` | 照搬介面：頁首、三格統計、角色與狀態標籤、行內按鈕、新增視窗、確認視窗與提示的樣式；功能照本專案：一次性密碼改在視窗顯示並可複製，角色為超級管理員、營運、銷售，沒有編輯、解鎖、強制登出與安全狀態；樣式暫時限於這一頁，之後抽成共用 |
| 2026-10-14 | `admin/src/support-alert.ts`、`admin/src/pages/SupportPage.vue` 的新對話視窗、對象分類、詳細資料 | `admin/src/utils/support-alert.js`（提示音、新訊息計數）、`admin/src/pages/support/SupportPage.js`（新對話彈出視窗、乘客／司機／訪客分類與各類待回覆數、對話的詳細資料、空狀態與重試） | `c902bb5a` | 提示音照同樣的雙音合成與「首次載入只建立基準」重寫；分類改為用戶與訪客（本專案不分乘客、司機）；新對話用現有的用戶搜尋（電話、姓名或名片頁連結），不另設按 ID 查找；沒有沿用客服功能開關與獨立客服工作台。另加 Master Travel 沒有的「不用回覆」 |
| 2026-10-13 | `deploy/cloud-run/revision-ready.py`、`test_revision_ready.py`、`rollback.sh` | 同名檔案 | `c902bb5a` | 原樣複製 |
| 2026-10-13 | `deploy/cloud-run/deploy.sh`、`smoke-test.sh` | 同名檔案 | `c902bb5a` | 移除分享圖片服務；環境變數與 Secret 改為本專案的（`OTP_PEPPER`、`DATA_ENCRYPTION_KEY`、`PUBLIC_BASE_URL`、`SUPPORT_MEDIA_BUCKET`）；探測路徑改為 `/api/health/live`；記憶體 1Gi |
| 2026-10-13 | `deploy/frontend/build-image.sh`、`deploy.sh`、`Dockerfile` | 同名檔案 | `c902bb5a` | 多一個參數選擇 `web` 或 `admin` 的 nginx 設定；第一次部署不帶 `--no-traffic`；移除 Flutter 字型與 wasm 的壓縮處理；部署後多檢查一次 `/api` 轉發 |
| 2026-10-13 | `deploy/frontend/web.conf`、`admin.conf` | `deploy/frontend/default.conf` | `c902bb5a` | 依同樣結構重寫：`/api` 保留前綴轉給 API、上傳上限 26 MB 且不暫存到磁碟、帶雜湊的 `/assets/` 長期快取、`robots.txt`；後台另加不收錄與禁止嵌入的標頭 |
| 2026-10-13 | `.github/workflows/deploy-production.yml`、`quality-gates.yml` | 同名檔案 | `c902bb5a` | 相同的步驟順序與「commit 仍是 main 最新」檢查；移除 Flutter、小程序、分享圖片服務與每月重建；加上 `DEPLOY_ENABLED` 開關 |
| 2026-10-13 | `backend/Dockerfile` | `backend/Dockerfile` | `c902bb5a` | 依同樣的兩階段做法重寫：Node 24、npm workspaces（`shared` 與 `backend`）、不含 GeoIP 資料 |
| 2026-10-14 | `shared/src/vehicle-plate.ts`、`web/src/components/ProfileForm.vue` | 車牌規則與加車頁：`driver/lib/core/vehicle_plate_rules.dart`、`driver/lib/add_vehicle_page.dart`、`admin/src/pages/drivers/vehicle-plates.js`、`backend/src/main.ts` 的 `normalizeVehiclePlateData`／`validVehiclePlateData` | `c902bb5a` | 依同樣的規則用 TypeScript 與 Vue 3 重寫（來源沒有測試，測試為本專案自寫）：歸屬地與車牌類型改用代碼（`HK`／`MACAU`／`MAINLAND`、`SINGLE`／`DUAL`／`TRIPLE`）；內地車牌多接受簡體「粤」與沒有間隔號的寫法並統一格式；車輛類別不沿用（它綁定 Master Travel 的後台車輛目錄與計價），車型由司機自己打字；不收車輛相片 |
| 2026-10-14 | `admin/src/styles/base.css`、`admin/src/App.vue`、`admin/src/pages/LoginPage.vue`、`admin/src/pages/DashboardPage.vue`、`admin/src/components/PagerBar.vue`、`StatusBadge.vue` | 後台外觀與版面：`admin/src/styles/{tokens,layout,components,tables,overlays,auth,dashboard,users}.css`、`admin/src/pages/dashboard/DashboardActionCard.css`、`admin/src/main.js` 的外框 | `c902bb5a` | 依同樣的數值用 Vue 3 重寫，沒有複製程式：沿用深色漸層側欄、卡片、表格、按鈕、輸入框、置中分頁、淺底狀態標籤、深藍登入頁與總覽卡片；手機版改為頂列加可橫向滑動的選單。按本專案需求調整：選單用本專案的頁面與用詞，「開發模式登入」與「簡訊通道」歸在「登入配置」下；總覽的「待處理事項」只放客服待回覆（後台不派單）；登入頁不放語言切換與 Master Travel 的版權列；登入錯誤字改淺紅色以便在深色底上看清楚 |
| 2026-10-14 | `web/src/alert-sound.ts` | 司機端提示音：`driver/lib/core/platform/driver_alert_tone.dart`、`new_order_alert_web.dart`；通知設定頁 `driver/lib/notification_settings_page.dart` 的款式名稱 | `fc4f7a558` | 依同樣的做法用 TypeScript 重寫，沒有複製程式：只取「清脆雙音」（1397、1760 Hz，0.64 秒，預設）和「柔和三音」（659、831、988 Hz，2.4 秒）兩款，音量包絡相同（峰值 0.65、起音 0.02 秒、收尾 0.18 秒）；用 Web Audio 播放，沒有帶入它在 Web Audio 不能用時改播 WAV 的後備；首次點擊畫面即解鎖，不另設「啟用」按鈕；款式存在手機本機 |
| 2026-10-14 | `backend/src/observability/region.ts`、`region.test.ts` | `backend/src/observability-region.ts`、`observability-region.test.ts` | `06446b32` | 同樣的 IP 正規化、內網判斷、DB-IP 查詢與快取規則；另外回傳內地／香港／澳門的分類；不沿用它由代理鏈選 IP 的做法（我們的請求經網頁前端代理，照它的做法會取到代理的 IP），改用與頻率限制相同的 `req.ip` |
| 2026-10-14 | `admin/src/pages/ObservabilityPage.vue`、`admin/src/styles/observability.css` | 後台「數據流監控」：`admin/src/pages/project-observability/ProjectObservabilityPage.js`、`admin/src/styles/project-observability.css` | `36d8e62e` | 版面、心智圖動畫、即時事件、地區訪問、即時在線、警告與異常照它的做法用 Vue 單檔元件重寫；節點的符號圖示改為線條圖示，警告的符號改為文字；節點改為本專案的管理後台、乘客頁、司機端；串流改用 fetch 讀（後台每個請求都要帶後台標頭）；另加今日業務、地區速度與錯誤、用甚麼打開、通知即時連線、簡訊與外部服務五塊 |
| 2026-10-14 | `backend/Dockerfile` 的 DB-IP 下載步驟 | `backend/Dockerfile`、`.github/workflows/deploy-production.yml` 的 `DBIP_RELEASE` | `36d8e62e` | 同樣下載當月 City Lite 並檢查檔案；當月未出時改用上個月，兩個都下載不到時不中斷建置 |
| 2026-10-14 | `admin/src/pages/LoginSettingsPage.vue`、`admin/src/styles/login-settings.css` | 後台「登入配置」：`admin/src/pages/login-settings/LoginSettingsPage.js`、`PhoneLoginDevelopmentSettings.js`、`PhoneLoginDevelopmentSettings.css`、`admin/src/styles/login-settings.css` | `22134f1a9` | 版面與樣式數值照它，用 Vue 單檔元件重寫，顏色改用本專案的 token；只做開發模式登入、簡訊登入、Spug 推送助手三個分頁；開發模式只有一個司機開關、6 位指定碼；簡訊卡片加上各號碼區的發送服務商選擇；去掉符號圖示 |
