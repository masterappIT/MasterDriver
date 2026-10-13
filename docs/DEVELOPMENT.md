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

API 在 `http://localhost:3020/api`，健康檢查為 `GET /api/health`。

## 本機登入

簡訊服務商尚未選定。本機有兩種方式取得驗證碼：

1. **開發模式登入**（建議）：`npm run dev-login -- --on` 開啟後，所有號碼都用指定碼登入（預設 `000000`，可用 `--code=123456` 更換）。狀態只顯示開關，不顯示驗證碼。規則見 `.github/instructions/phone-login-development-mode.instructions.md`。
2. **簡訊碼印在日誌**：`.env` 的 `DEV_LOG_OTP=true` 時，未開啟開發模式的簡訊碼會印在 API 日誌。正式環境（`NODE_ENV=production`）一律無效。

## 平台後台

```bash
npm run admin -- --create --username=vincent --name="Vincent" --role=SUPER_ADMIN
npm run dev:api
npm run dev:admin
```

- 第一個超級管理員用指令建立，畫面只顯示一次一次性密碼，登入後請到「修改密碼」更換。之後的帳號在「後台帳號」頁建立。
- 後台在 `http://localhost:5181`，開發時把 `/api` 轉到本機 API。
- 角色：超級管理員（全部）、營運（收費控制、充值、贈送、廣告、SEO、一般設定，可看開發模式登入但不能改）、銷售（只能查看，看不到乘客資料；可以更新潛在客戶的跟進狀態）。
- 頁面：總覽、用戶、訂單、潛在客戶、收費控制、平台服務費、廣告欄位、SEO、一般設定、登入配置、付款通道、簡訊通道、後台帳號、操作紀錄、修改密碼。
- 付款通道（Stripe、AlipayHK）與簡訊通道（253 國內、國際）沿用 Master Travel 的服務商；只有超級管理員可以修改、檢查、發送測試簡訊。
- 密鑰（Stripe 金鑰、AlipayHK RSA 金鑰、253 密碼）以 AES-256-GCM 加密後存入資料庫，API 永遠不回傳；加密金鑰是 `.env` 的 `DATA_ENCRYPTION_KEY`（本機未設定時使用開發用預設值；正式環境必須由 Secret Manager 提供，更換後已儲存的密鑰會無法讀取）。
- 驗證碼簡訊：+86 走國內帳號，+852／+853 走國際帳號；對應的通道未啟用時，本機（`DEV_LOG_OTP=true`）把驗證碼印在日誌，正式環境則回傳 `SMS_NOT_CONFIGURED`。發送紀錄不保存含驗證碼的簡訊內容。
- 安全：後台帳號與司機帳號分開；登入 cookie 只在 `/api/admin` 下有效（httpOnly、SameSite=Strict）；每個後台請求必須帶 `x-md-admin: 1`；同一帳號 15 分鐘內失敗 5 次即暫停登入；所有修改與查看乘客資料都寫入操作紀錄。

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
| `GET/PUT /api/me/profile` | 要 | 司機資料（第一次搶單前要填） |
| `POST /api/orders` | 要 | 發單；回傳連結與可直接貼上的分享文字 |
| `GET /api/orders?role=dispatched\|claimed` | 要 | 我的派單／我的接單 |
| `GET /api/orders/:id` | 要 | 單的詳情（發單者或接單司機） |
| `PATCH /api/orders/:id/prices` | 要 | 改司機價、乘客價、是否讓乘客看到乘客價（發單者；司機價在有人接單後鎖定） |
| `POST /api/orders/:id/cancel` | 要 | 取消（發單者） |
| `POST /api/orders/:id/reopen` | 要 | 改派：收回並重新開放搶單（發單者） |
| `POST /api/orders/:id/complete` | 要 | 完成（發單者或接單司機） |
| `GET /api/o/:code` | 可選 | 搶單頁；只有發單者和接單司機看得到乘客資料 |
| `POST /api/o/:code/claim` | 要 | 搶單，先到先得；回傳 `WON` 或 `LOST` |
| `GET /api/me/credits` | 要 | 點數餘額、最近紀錄、目前每單服務費（是否免收） |
| `GET /api/c/:confirmCode` | — | 乘客確認頁（不含司機價；乘客價只在發單者選擇顯示時出現） |
| `POST /api/c/:confirmCode/confirm` | — | 乘客按確認 |

### 公開資料（司機端與公開頁面用，不用登入）

| 方法與路徑 | 用途 |
|---|---|
| `GET /api/public/settings` | 升級連結、客服聯絡、公告（只在開啟時） |
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
| `npm run test:api:db` | 資料庫整合測試：搶單並發、額度、狀態變化、登入與開發模式。使用獨立的 `master_driver_test` 資料庫，會自動建立並清空，不影響開發資料 |

修改後端時兩者都要通過。
