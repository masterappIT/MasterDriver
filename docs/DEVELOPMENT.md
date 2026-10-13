# 本機開發指南

## 前置需求

- Node.js 24（含 npm 11）
- Docker（本機 PostgreSQL）

## 第一次設定

```bash
npm install
cp .env.example .env
npm run db:up
npm run prisma:migrate
npm run prisma:seed
```

- 本機資料庫在 `localhost:5434`（Master Travel 用 5433，兩者分開）。
- `prisma:seed` 建立功能目錄、方案（個人、團隊、公司）與「上線全站免費期」，可重複執行。
- npm 11 預設不執行套件安裝腳本；本專案只在根目錄 `package.json` 的 `allowScripts` 放行 Prisma 與 esbuild。新增需要安裝腳本的套件時，先確認用途再以 `npm approve-scripts <套件>` 放行。

## 啟動 API

```bash
npm run dev:api
```

API 在 `http://localhost:3020/api`，健康檢查為 `GET /api/health`（部署用的 `/api/health/live` 只看程序、`/api/health/ready` 看資料庫，見 `docs/PRODUCTION-DEPLOYMENT.md`）。

## 本機登入

簡訊服務商尚未選定。本機有兩種方式取得驗證碼：

1. **開發模式登入**（建議）：`npm run dev-login -- --on` 開啟後，所有號碼都用指定碼登入（預設 `000000`，可用 `--code=123456` 更換）。狀態只顯示開關，不顯示驗證碼。規則見 `.github/instructions/phone-login-development-mode.instructions.md`。
2. **簡訊碼印在日誌**：`.env` 的 `DEV_LOG_OTP=true` 時，未開啟開發模式的簡訊碼會印在 API 日誌。正式環境（`NODE_ENV=production`）一律無效。

## 司機與乘客網頁

```bash
npm run dev:api
npm run dev:web
```

- 網頁在 `http://localhost:5180`（與 `.env` 的 `PUBLIC_BASE_URL` 一致，派單連結和乘客確認連結會打開這裡）。
- 頁面：`/` 平台首頁（未登入時顯示；登入後轉到 `/app`）、`/legal/terms` 與 `/legal/privacy`（後台「一般設定」的條款內容）、`/p/:code` 名片頁（公開，可預約）、`/b/:code` 乘客的預約連結、`/app/profile-page` 編輯名片頁、`/app/bookings` 與 `/app/bookings/:id` 司機的預約、`/o/:code` 搶單頁、`/c/:confirmCode` 乘客確認頁（不用登入、不放廣告、不顯示出單價）、`/login`、`/app` 首頁、`/app/pool` 接單池（要先有司機資料）、`/app/new` 發單、`/app/orders` 我的單、`/app/orders/:id` 單詳情與分享文字、`/app/me` 我的。
- 發單頁最上方的「一句話發單」用 `shared/src/quick-order.ts` 解析（時間、起終點、座位、人數、行李、價格、備註；繁簡皆可），只負責填入下方表格，不會直接發出。測試案例取自實際的微信群訊息。
- 平台首頁的標題、描述與分享圖在瀏覽器裡套用後台「SEO → 首頁」的設定。`index.html` 固定帶 `noindex`，所以**首頁目前不會被搜尋引擎收錄**，不執行腳本的分享預覽（例如微信、WhatsApp 的連結預覽）也讀不到這些設定；要收錄和預覽，需要由伺服器輸出每一頁的標題與摘要，這還沒做。
- Logo 在後台「一般設定」上傳，存在資料庫（`SiteLogo`），由 `BrandMark` 元件顯示在首頁、登入頁、搶單頁；網址帶版本，換了 Logo 會立即更新。
- 介面文字只寫繁體；簡體由沿用 Master Travel 的 OpenCC 對照表轉出，只有選用簡體時才下載。+86 帳號預設簡體，可在「我的」切換。
- 只用系統字型、不依賴 Google 服務；在微信內不顯示「分享到 WhatsApp」（微信會攔截跳轉），改用複製。
- 搶單頁在單仍是「待搶」時每 5 秒更新一次狀態，讓各群打開同一條連結都能看到「已被接走」。
- 接駁單：發單頁選「接駁」（`transfer: true`）的單發出時就是行程第 1 段，目的地是接駁位置。單詳情按「加接駁段」打開 `/app/new?after=<上一段 id>`，帶入接駁位置（上一段的目的地）與乘客資料；改了接駁位置會同步改上一段的目的地，上一段已被其他司機接走時回 `TRANSFER_PLACE_LOCKED`。接駁的單可選填 `requiredPlates`（`HK`、`MACAU`、`MAINLAND`），只顯示、不限制誰能搶。各段的 `journeyId` 指向第一段（第一段指向自己），`legIndex` 從 1 起，最多 4 段。新增段與取消段都先鎖住第一段的資料列，所以服務費只在全部段都取消時退回一次。乘客只用第一段的確認連結。

## 平台後台

```bash
npm run admin -- --create --username=vincent --name="Vincent" --role=SUPER_ADMIN
npm run dev:api
npm run dev:admin
```

- 第一個超級管理員用指令建立，畫面只顯示一次一次性密碼，登入後請到「修改密碼」更換。之後的帳號在「後台帳號」頁建立。
- 後台在 `http://localhost:5181`，開發時把 `/api` 轉到本機 API。
- 角色：超級管理員（全部）、營運（客服、收費控制、充值、贈送、廣告、SEO、一般設定，可看開發模式登入但不能改）、銷售（只能查看，看不到乘客資料；可以更新潛在客戶的跟進狀態）。
- 「防濫用設定」頁（`LimitSetting`）：客服的訊息與檔案上限在這裡改，後端每次檢查時讀取（`backend/src/common/limits.ts`），所以改了立即生效。
- 頁面：總覽、用戶、訂單、潛在客戶、客服、防濫用設定、收費控制、平台服務費、廣告欄位、SEO、一般設定、登入配置、付款通道、簡訊通道、後台帳號、操作紀錄、修改密碼。
- 付款通道（Stripe、AlipayHK）與簡訊通道（253 國內、國際）沿用 Master Travel 的服務商；只有超級管理員可以修改、檢查、發送測試簡訊。
- 簡訊通道的兩個號碼區（國內 +86、國際 +852／+853）各有自己的 253 雲通訊帳號，在後台「簡訊登入」分頁設定；要改由 Spug 推送助手發送的號碼區，在「Spug 推送助手」分頁勾選（存成該號碼區 `SmsChannel.provider`，`backend/src/channels/spug.ts`，2026-10-14）。Spug 走 `/sms/<範本編碼>` 短信驗證碼接口，用它自己的簽名與官方範本，只傳手機號、驗證碼與有效分鐘數；範本編碼加密儲存，`SpugSetting.appName` 已不使用。Spug 的實際發送與港澳號碼尚未用真實帳號實測。
- 密鑰（Stripe 金鑰、AlipayHK RSA 金鑰、253 密碼）以 AES-256-GCM 加密後存入資料庫，API 永遠不回傳；加密金鑰是 `.env` 的 `DATA_ENCRYPTION_KEY`（本機未設定時使用開發用預設值；正式環境必須由 Secret Manager 提供，更換後已儲存的密鑰會無法讀取）。
- 驗證碼簡訊：+86 走國內帳號，+852／+853 走國際帳號；對應的通道未啟用時，本機（`DEV_LOG_OTP=true`）把驗證碼印在日誌，正式環境則回傳 `SMS_NOT_CONFIGURED`。發送紀錄不保存含驗證碼的簡訊內容。
- 安全：後台帳號與司機帳號分開；登入 cookie 只在 `/api/admin` 下有效（httpOnly、SameSite=Strict）；每個後台請求必須帶 `x-md-admin: 1`；同一帳號 15 分鐘內失敗 5 次即暫停登入；所有修改與查看乘客資料都寫入操作紀錄。

## 名片頁與預約

- 一人一個名片頁（`ProfilePage`），第一次打開「我的名片頁」時建立，預設不公開；公開前要先有司機資料。姓名、車型、座位、車色取自司機資料，完成單數是 `claimedById` 為本人且已完成的單數，不能自填。
- 車輛照片最多 3 張，和客服檔案用同一個媒體儲存，鍵值為 `profile/<名片頁>/<照片>.<副檔名>`；公開的名片頁照片由 `GET /api/public/profiles/:code/photos/:id` 提供，未公開時只有本人讀得到。
- 預約（`BookingRequest`）：乘客不用登入，送出後拿到 `/b/<16 位代碼>`，這條連結就是乘客的憑證。狀態為 待回覆 → 已報價 → 乘客同意 → 已成單，或 已婉拒／乘客取消。雙方同時操作時由資料庫的狀態條件決定誰成立。
- 成單：預約詳情按「成單」打開 `/app/new?booking=<預約 id>`，帶入行程、乘客資料與報價（作為乘客價並顯示給乘客）。發單時送出 `bookingId`，後端在同一個交易裡把預約標為已成單並連到該單；預約不是自己的或已結束時，整張單不會建立。成單後乘客的預約連結會帶他到該單的確認頁 `/c/…`。
- 司機端的未讀：新預約，以及乘客同意或取消，都會讓該預約變成未讀；司機打開或回覆後清除。沒有推播或簡訊。
- 上限在後台「防濫用設定」：同一 IP 每天預約數、每個名片頁每天預約數。
- 名片頁網址可帶 `?from=<來源>`（英數字、底線、連字號，30 字以內），預約會記下來源，供司機自己看哪個平台帶來預約。

## 客服

- 司機端 `/support`（登入與否都能用）；後台 `/support`。兩邊都每 5 秒讀取新訊息，頁面在背景時暫停。
- 登入的用戶一人一個對話。訪客第一次送出訊息時才建立對話，後端發一個隨機憑證（只存雜湊），瀏覽器放在 `localStorage` 的 `md-support-guest`，之後每個請求帶 `x-md-support-guest`。
- 每則訊息帶 `clientMessageId`，同一個 id 重送不會重複發出，所以傳送失敗可以直接重試。
- 圖片與影片：請求內容就是檔案本身（不是表單、不是 base64）。類型由檔案開頭的位元組判斷，不相信 `Content-Type`；圖片上限 5 MB、影片上限 25 MB（Cloud Run 單一請求上限 32 MiB）。司機端送出前會先把大圖縮到 1920 px 並轉成 JPEG。
- 儲存：資料庫只存紀錄（`SupportMedia`），檔案放私有儲存空間，鍵值為 `support/<對話>/<檔案>.<副檔名>`。本機放 `.data/support-media/`（已列入 `.gitignore`，可用 `SUPPORT_MEDIA_DIR` 更改）；正式環境放 `SUPPORT_MEDIA_BUCKET` 指定的私有 Cloud Storage bucket，以 Cloud Run 服務帳戶的身分存取（需要 `roles/storage.objectAdmin`），不需要金鑰檔。正式環境沒有設定 bucket 時只收文字，上傳回 `SUPPORT_MEDIA_UNAVAILABLE`。
- 讀取：`<img>`、`<video>` 不直接指向檔案；頁面帶登入資訊向 API 取回後才顯示，所以沒有可以外流的網址。影片按了才下載。
- 清理：檔案保留 180 天。`npm run support-media -- --purge` 刪除過期檔案並把紀錄標為已過期，正式環境請排程每天執行一次；bucket 另外設定 200 天的生命週期規則作為保險。
- 上線前要做：建立 bucket（不公開、統一 bucket 層級存取）、授權服務帳戶、設定 `SUPPORT_MEDIA_BUCKET`、排程清理。Cloud Storage 的讀寫只有以假的回應做過單元測試，尚未對真正的 bucket 驗證。

## 平台服務費與點數（後台完成前用指令）

```bash
npm run billing -- --status
npm run billing -- --fee-on --fee=5
npm run billing -- --fee-off
npm run billing -- --top-up --phone=+852:91234567 --amount=100 --note="轉數快 #123"
```

服務費預設關閉。開啟後只向派單者收，發單時扣、取消退回；團隊、公司方案與上線全站免費期免收（本機 seed 已建立上線免費期，所以本機開啟後仍會顯示免收）。

## API 一覽

| 方法與路徑 | 登入 | 用途 |
|---|---|---|
| `POST /api/auth/otp/request` | — | 申請驗證碼 |
| `POST /api/auth/otp/verify` | — | 驗證並登入；回傳 token，同時設定 cookie |
| `POST /api/auth/logout` | 要 | 登出 |
| `GET /api/me` | 要 | 目前用戶與司機資料 |
| `GET/PUT /api/me/profile` | 要 | 司機資料（第一次搶單前要填）。`vehicleOwnership`（`HK`、`MACAU`、`MAINLAND`）與 `plateType`（`SINGLE`、`DUAL`、`TRIPLE`）決定要填哪些車牌和格式，規則在 `shared/src/vehicle-plate.ts`；車牌存成固定格式（澳門 `AA-00-00`，內地 `粵Z·…港`、`粵Z·…澳` 或 `粵A·…`），該類型沒有的車牌不保存；`vehicleType` 是自由文字，必填 |
| `POST /api/orders` | 要 | 發單；回傳連結與可直接貼上的分享文字。`transfer: true`：接駁單的第 1 段；`afterOrderId`：加接駁段（接在行程最後一段後面，出發地即接駁位置，不再扣額度和服務費）；`requiredPlates`：需要的車牌（只標明）；`selfDrive: true`：這單我自己做（直接算自己接，要先有司機資料）；`inPool`：同時放到接單池（不傳時用「我的」的預設值；`selfDrive` 的單一律不進池） |
| `GET /api/orders?role=dispatched\|claimed` | 要 | 我的派單／我的接單 |
| `GET /api/orders/pool?date=YYYY-MM-DD&q=地點` | 要 | 接單池：發單者勾選放進來、待搶且未到出發時間的單，不含自己發的；與搶單頁相同的資訊，不含乘客資料；最多 50 張。沒有司機資料時回 `PROFILE_REQUIRED` |
| `GET /api/orders/:id` | 要 | 單的詳情（發單者或接單司機） |
| `PATCH /api/orders/:id/pool` | 要 | 把單放進或取出接單池（發單者；只限待搶的單） |
| `GET /api/orders/passengers` | 要 | 客人通訊錄：自己出過的單的乘客，一個電話一列（稱呼、搭過幾次、最近一次的時間與路線）；只讀自己出的單 |
| `PATCH /api/orders/:id/trip-group`、`GET /api/orders/:id/trip-group/qr` | 要 | 行程群（出單者設定）：`platform` 為 `WHATSAPP`（加 `inviteUrl`）、`WECHAT`（加 `qrImage`）或 `null`（移除）；二維碼圖片給出單者與可看乘客電話的接單司機 |
| `PATCH /api/orders/:id/settlement` | 要 | 已結清（出單者）：`settled` 把和接單司機的帳標記為已結清或改回未結清；只限已完成、由別的司機接的單；接駁各段各自標記；接單司機在單的資料看到 `settledAt` |
| `PATCH /api/orders/:id/payment` | 要 | 收款（出單者）：`showPaymentMethods` 乘客確認頁是否顯示收款方式，`paid` 標記已收款或改回未收款；接駁行程整個一起改；已取消的單不行 |
| `GET/POST /api/me/payment-methods`、`PATCH/DELETE /api/me/payment-methods/:id`、`GET /api/me/payment-methods/:id/qr` | 要 | 自己的收款方式（最多 5 個；文字帳號或收款碼圖片，至少一樣）與自己的收款碼圖片 |
| `PATCH /api/orders/:id/prices` | 要 | 改出單價、乘客價、是否讓乘客看到乘客價（發單者；出單價在有人接單後鎖定） |
| `POST /api/orders/:id/cancel` | 要 | 取消（發單者） |
| `POST /api/orders/:id/reopen` | 要 | 改派：收回並重新開放搶單（發單者） |
| `POST /api/orders/:id/complete` | 要 | 完成（發單者或接單司機） |
| `GET /api/o/:code` | 可選 | 搶單頁；只有發單者和接單司機看得到乘客資料 |
| `POST /api/o/:code/claim` | 要 | 搶單，先到先得；回傳 `WON` 或 `LOST` |
| `GET/PUT /api/me/preferences` | 要 | 發單預設：接單司機何時看到乘客電話（`contactRevealMinutes`，null 為搶到即顯示）、新發的單是否預設放到接單池（`poolByDefault`）；`PUT` 可以只傳其中一項 |
| `PATCH /api/orders/:id/contact-reveal` | 要 | 逐張調整乘客電話顯示時間（發單者） |
| `GET/POST /api/me/group-invites`、`PATCH/DELETE /api/me/group-invites/:id` | 要 | 我的派單群（微信群二維碼、個人微信二維碼、WhatsApp 連結；最多 5 個） |
| `GET /api/public/group-invites/:id/qr` | — | 二維碼圖片（微信群二維碼過期後不再提供） |
| `GET /api/me/credits` | 要 | 點數餘額、最近紀錄、目前每單服務費（是否免收） |
| `GET /api/me/upgrade` | 要 | 「我的」頁的 Master Travel 升級入口：後台填了升級連結，且近 30 天出單超過 30 張（接駁行程算一張，取消的不算）才回傳 `upgradeUrl`，否則為 null |
| `POST /api/support/guest` | — | 訪客開始對話，回傳只顯示一次的憑證（同一 IP 每天最多 5 個） |
| `GET /api/support/thread?after=\|before=` | 可選 | 客服對話的訊息（登入用戶，或帶 `x-md-support-guest` 的訪客）；`after` 只取新訊息 |
| `GET /api/support/unread` | 可選 | 客服未讀回覆數 |
| `POST /api/support/messages` | 可選 | 傳文字（`text`、`clientMessageId`） |
| `POST /api/support/media?clientMessageId=` | 可選 | 傳圖片或影片，請求內容是檔案本身；訪客不能傳影片 |
| `GET /api/support/media/:id` | 可選 | 讀取自己對話裡的圖片或影片 |
| `GET/PUT /api/me/profile-page` | 要 | 我的名片頁（內容、是否公開） |
| `POST /api/me/profile-page/photos`、`DELETE /api/me/profile-page/photos/:id` | 要 | 車輛照片；上傳時請求內容是圖片本身 |
| `GET /api/me/bookings`、`/unread`、`/:id` | 要 | 名片頁收到的預約、未讀數、單筆（打開即已讀） |
| `POST /api/me/bookings/:id/quote`、`/decline` | 要 | 回覆報價（可重複修改）、婉拒 |
| `GET /api/public/profiles/:code` | 可選 | 名片頁；未公開時只有本人看得到 |
| `POST /api/public/profiles/:code/bookings` | — | 乘客送出預約，回傳預約連結 |
| `GET /api/public/bookings/:code`、`POST …/accept`、`…/cancel` | — | 乘客的預約連結：狀態與報價、同意報價、取消 |
| `GET /api/c/:confirmCode` | — | 乘客確認頁（不含出單價；乘客價只在發單者選擇顯示時出現）；接駁行程另有 `legs` 列出未取消的各段與司機；出單者選擇顯示收款方式時另有 `payment`（收款人、金額、是否已收款、收款方式） |
| `GET /api/c/:confirmCode/trip-group/qr`、`GET /api/c/:confirmCode/driver-photos/:id` | — | 乘客看的行程群二維碼（未取消、未過期）與接送司機的車輛照片（只限現在接這張單或其接駁段的司機） |
| `GET /api/c/:confirmCode/payment-methods/:id/qr` | — | 乘客看的收款碼圖片：只限該單顯示收款方式、未取消，且收款方式屬於出單者 |
| `POST /api/c/:confirmCode/confirm` | — | 乘客按確認；接駁行程一次確認全部未取消的段 |

### 公開資料（司機端與公開頁面用，不用登入）

| 方法與路徑 | 用途 |
|---|---|
| `GET /api/public/settings` | Logo 網址（有上傳時）、升級連結、客服聯絡、公告（只在開啟時） |
| `GET /api/public/logo` | 後台上傳的 Logo 圖片 |
| `GET /api/public/terms`、`/api/public/privacy` | 服務條款、私隱政策 |
| `GET /api/public/seo/HOME`、`/PROFILE` | 頁面標題、描述、分享圖、robots、網站驗證碼、百度統計 ID |
| `GET /api/public/robots.txt` | 未開放收錄時封鎖全站；開放後仍封鎖搶單頁、乘客頁、司機端、後台與 API |
| `GET /api/public/ads?position=CLAIM_PAGE\|HOME\|MY_ORDERS` | 正在顯示的廣告（每位置最多 3 則） |
| `POST /api/public/ads/impressions` | 記錄曝光（每次最多 10 則） |
| `GET /api/public/ads/:id/click` | 記錄點擊並轉到後台設定的連結 |

登入後的 token 可放在 `Authorization: Bearer <token>`，或使用驗證時設定的 `md_session` cookie。

錯誤回應的 `code` 是固定的英文代碼（例如 `QUOTA_EXCEEDED`、`PROFILE_REQUIRED`），前端依代碼顯示文字。

## 驗證

| 指令 | 內容 |
|---|---|
| `npm run verify:api` | 共用規則測試、建置、後端單元測試、Prisma schema 檢查 |
| `npm run verify:admin` | 後台型別檢查與建置 |
| `npm run verify:web` | 網頁測試（繁簡轉換）、型別檢查與建置 |
| `npm run test:api:db` | 資料庫整合測試：搶單並發、額度、狀態變化、接駁段（服務費與額度只算一次、同時取消只退一次、乘客一次確認全部、各段司機互看、接駁位置兩段共用）、客服（對話權限、訊息去重、檔案類型與大小、訪客限制、過期清理）、名片頁與預約（公開與否、照片、報價到成單、歸屬、上限）、登入與開發模式。使用獨立的 `master_driver_test` 資料庫，會自動建立並清空，不影響開發資料 |

修改後端時兩者都要通過。
