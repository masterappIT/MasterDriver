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

登入後的 token 可放在 `Authorization: Bearer <token>`，或使用驗證時設定的 `md_session` cookie。

錯誤回應的 `code` 是固定的英文代碼（例如 `QUOTA_EXCEEDED`、`PROFILE_REQUIRED`），前端依代碼顯示文字。

## 驗證

| 指令 | 內容 |
|---|---|
| `npm run verify:api` | 共用規則測試、建置、後端單元測試、Prisma schema 檢查 |
| `npm run test:api:db` | 資料庫整合測試：搶單並發、額度、狀態變化、登入與開發模式。使用獨立的 `master_driver_test` 資料庫，會自動建立並清空，不影響開發資料 |

修改後端時兩者都要通過。
