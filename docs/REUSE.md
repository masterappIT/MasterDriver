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

### B. 改寫後沿用（邏輯可參考，程式要轉換）

| 來源 | 原因 | 做法 |
|---|---|---|
| 乘客端 uni-app 元件，例如 `src/components/common/PageNavBar.vue`、`src/components/home/BookingTimePicker.vue`、`AddressPicker.vue` | 使用 uni-app 標籤（`view`、`text`）與 `uni.*` API | 版式與樣式沿用，標籤與 API 改成標準 Vue 3 與瀏覽器 API |
| 司機端 Flutter 頁面與規則，例如 `driver/lib/core/vehicle_plate_rules.dart`、`order_invite/order_invite_page.dart` | Dart / Flutter，無法在 Vue 使用 | 依其邏輯與版式用 TypeScript、Vue 3 重寫 |
| Stripe 與 AlipayHK 收款設定，例如 `backend/src/stripe-channel-config.ts`、`backend/src/finance-channel.ts`、`admin/src/pages/payments/` | 綁定 Master Travel 的收款通道與財務中心 | 參考設定驗證與通道設定的做法；MasterDriver 只用 Stripe、AlipayHK 收訂閱，不做乘客收款 |
| 手機驗證碼登入流程 | 綁定 Master Travel 的帳號、session 與資料表 | 參考流程，依本專案資料結構重寫 |

### C. 不沿用

- 報價、計價、路線定價、收款、退款、結算、錢包、會員、積分、優惠券。
- 地圖與定位（本專案不用地圖）。
- Master Travel 的後台、權限、登入設定。
- 任何含 Master Travel 金鑰、正式網址或 AppID 的設定。

## 沿用記錄

| 日期 | 本專案檔案 | Master Travel 來源 | 來源 commit | 調整內容 |
|---|---|---|---|---|
| — | — | — | — | 尚未沿用任何檔案 |
