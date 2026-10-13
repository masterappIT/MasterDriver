# 視覺設計規範

MasterDriver 的 UI 沿用 Master Travel 的風格，讓用戶從 MasterDriver 升級到 Master Travel 時感覺是同一個品牌家族。

- **設計參考來源（2026-10-13 決定）：以 Master Travel 現有前端程式碼為準**，即已實作的乘客端（`src/`）與司機端（`driver/`）。參考其視覺數值、版式與元件做法，可直接沿用的部分依 `docs/REUSE.md` 複製，其餘在本專案以 Vue 3 重寫；不 import、不連結 Master Travel 的程式。
- **背景資料：**Master Travel 用戶端與司機端的 Figma 原型「EC Travel（跨境打車）」（https://www.figma.com/design/yqswcQZ9Q3E6BLTm6bFkmo/ ，兩個頁面、約 341 個畫面，含登入、叫車預約、訂單、付款、司機接單、司機收入等）。以程式碼為準；程式碼沒有的畫面，才回到 Figma 查看。
- **基準來源：** Master Travel 司機端的設計 token（`driver/lib/core/tokens/driver_tokens.dart`），輔以乘客端的車牌樣式與品牌網站的配色。
- **沿用方式：** 本專案在 `web/` 以 CSS 變數定義同樣的數值；圖示、圖片與部分通用程式可依 `docs/REUSE.md` 複製沿用，不 import、不連結 Master Travel 的程式（紅線 4）。
- **Token 是唯一來源：** 程式中的顏色、間距、字號、圓角、陰影一律從 token 取值，不寫死數值。
- 以下數值為 2026-10-13 從 Master Travel 讀取；若 Master Travel 日後調整，由我們決定是否跟進，不自動同步。

## 頁面參考對照

MasterDriver 的頁面與 Master Travel 現有前端最接近的實作（路徑相對於 Master Travel 倉庫）：

| MasterDriver 頁面 | 參考 Master Travel |
|---|---|
| 搶單頁（從群裡點進來） | `driver/lib/order_invite/order_invite_page.dart`（連結接單、外部司機免註冊）、`driver/lib/order_detail_page.dart` 與 `order_detail_sections.dart` |
| 搶到單後的畫面 | `driver/lib/order_accepted_page.dart` |
| 首頁 | `driver/lib/home_page.dart` |
| 我的單 | `driver/lib/order_history_page.dart`、`driver/lib/order_hall_page.dart`（列表卡片） |
| 底部導航 | `driver/lib/floating_nav_bar.dart` |
| 登入、驗證碼 | `src/pages/login/login.vue`、`src/pages/login/verify.vue`、`driver/lib/driver_phone_verification_dialog.dart` |
| 發單表單（時間、地點） | `src/components/home/BookingTimePicker.vue`、`src/components/home/AddressPicker.vue`、`src/components/home/TripEditSheet.vue` |
| 乘客確認頁、車牌顯示 | `src/pages/vehicles/trip-waiting.vue`、`src/pages/vehicles/trip-progress.vue`（港牌金色、內地牌黑底） |
| 頁首、返回 | `src/components/common/PageNavBar.vue` |
| 我的資料、車輛 | `driver/lib/profile_page.dart`、`driver/lib/vehicle_page.dart`、`driver/lib/add_vehicle_page.dart` |
| 提示、彈窗 | `driver/lib/core/widgets/driver_overlays.dart` |
| 地址顯示 | `driver/lib/core/widgets/driver_address_text.dart` |

Master Travel 沒有對應的頁面（發單成功分享頁、空車廣播、名片頁、推廣素材、團隊管理、方案）由設計者另行設計，風格與上表一致。

## 顏色

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | `#f4f7fb` | 頁面底色 |
| `--color-surface` | `#ffffff` | 卡片、輸入框 |
| `--color-text` | `#17233d` | 主要文字 |
| `--color-text-secondary` | `#65738b` | 次要文字 |
| `--color-text-muted` | `#98a3b5` | 提示、停用 |
| `--color-label` | `#41506a` | 表單標籤 |
| `--color-border` | `#dbe3ef` | 邊框 |
| `--color-divider` | `#e8edf4` | 分隔線 |
| `--color-primary` | `#3568e8` | 主按鈕、連結、選中 |
| `--color-primary-dark` | `#1e4fc7` | 按下狀態 |
| `--color-on-primary` | `#ffffff` | 主按鈕文字 |
| `--color-tint` | `#e8f0ff` | 淺藍底（資訊、選中背景） |
| `--color-nav-inactive` | `#8793a8` | 底部導航未選中 |
| `--color-nav-active` | `#245bd6` | 底部導航選中 |

### 平台後台專用

2026-10-14 起，平台後台（`admin/`）參照 **Master Travel 最新的管理後台**（`admin/src/styles/`，commit `c902bb5a`），與用戶端的乘客端風格分開；數值定義在 `admin/src/styles/base.css`，沿用記錄見 `docs/REUSE.md`。

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | `#f3f6fb` | 頁面底色（右上加淡藍光暈） |
| `--color-text` | `#12243b` | 主要文字、標題 |
| `--color-text-secondary` | `#647892` | 次要文字 |
| `--color-label` | `#526985` | 表單標籤 |
| `--color-primary` | `#1769e0` | 主按鈕（漸層至 `#3f8df0`）、連結 |
| `--gradient-side` | `#12243b → #1b3557 → #56657e` | 左側選單底色 |
| `--color-nav-active-bg` | `#3c76c5` | 選單選中 |
| `--color-danger` | `#d74b4b` | 停用、刪除等危險按鈕 |
| `--color-danger-tint`／`--color-warning-tint` | `#ffe4e4`／`#fff3cc` | 錯誤、警告提示底色（例如開發模式登入開啟中） |

卡片圓角 20 px、邊框 `#e1e8f2`、陰影 `0 12px 32px rgba(39,72,111,.08)`；輸入框與按鈕圓角 10 px、高 40–44 px；表格標題 11 px、字距加寬。單的狀態在後台用淺底彩字的膠囊：待搶黃、已派藍、乘客已確認與已完成綠、已取消紅，並一定顯示文字。手機寬度下側欄變成頂列，選單由右上按鈕展開並可橫向滑動。

## 單的狀態顏色

以 Master Travel 既有色系組成。顏色不能是唯一的狀態資訊，必須同時顯示文字。

| 狀態 | 值 | 來源 |
|---|---|---|
| 待搶 | `#e6a206` | 乘客端車牌金色 |
| 已派 | `#3568e8` | 司機端主色 |
| 乘客已確認 | `#25c987` | 品牌網站薄荷綠 |
| 已完成 | `#98a3b5` | 司機端提示灰 |
| 已取消、已被接走 | `#65738b` | 司機端次要文字 |

## 間距、圓角、陰影

| 類別 | Token | 值 |
|---|---|---|
| 間距 | `xs` `sm` `md` `lg` `xl` | 4、8、12、16、24 px |
| 圓角 | 卡片／輸入框／膠囊 | 16、12、100 px |
| 陰影 | 卡片 | `0 8px 18px rgba(0,0,0,.08)` |
| 陰影 | 浮動元素 | `0 10px 24px rgba(0,0,0,.12)` |
| 版面 | 最大內容寬度 | 430 px，置中 |
| 版面 | 頁面左右留白 | 24 px（窄螢幕可縮為 16 px） |

## 字型

| 字級 | 值 |
|---|---|
| 說明文字 | 12 px |
| 標籤 | 13 px |
| 內文 | 14 px |
| 大內文 | 16 px |

**字體：** Master Travel 使用 Noto Sans TC（並分層載入簡體與罕用字）。MasterDriver 為了在微信內 3 秒打開，**搶單頁、乘客頁使用系統字體**（蘋方、微軟正黑體、思源黑體等），不在首次載入時下載中文網路字型；司機端其他頁面如需 Noto Sans TC，必須自行託管並分層載入，不可使用 Google Fonts（內地無法存取）。

## 車牌顯示

跨境車同時顯示香港車牌與內地車牌，樣式參考 Master Travel 乘客端（金色港牌、黑底內地牌）。具體尺寸在設計稿確定。

## 品牌區隔

- 色系、字型、圓角與 Master Travel 一致，屬同一品牌家族。
- **MasterDriver 有自己的專屬 Logo**，同時**保留 MasterApp Logo** 作為母品牌（2026-10-13 決定）。採「子品牌 + 母品牌背書」：
  - 主要位置（App 圖示、頁首、分享圖、官網首屏）用 **MasterDriver 專屬 Logo**；
  - 頁尾、官網、關於頁標示「**by MasterApp**」並放 MasterApp Logo。
- 現有 MasterApp Logo 的特徵（`brand/favicon.svg`）：主藍 `#285cfc` 方底、白色雲形「M」圖形、灰藍 `#56657e` 圓形裝飾、底部一輛商務車剪影。
- **專屬 Logo 設計建議：**
  1. 延續 MasterApp 的家族元素（主藍底、白色主圖形、灰藍點綴），一看就知道是同一家公司；
  2. 主圖形表達 MasterDriver 自己的意思，可考慮：方向盤或司機帽（師傅）、兩個方向的箭頭（跨境、派與接）、兩手相扣或連結（幫）；
  3. **避免和 Master Travel 司機端「Master App Driver」相似**，主圖形不要直接沿用 MasterApp 的「M」雲形；
  4. 小尺寸也要清楚：瀏覽器分頁圖示 16 px、微信頭像、推廣圖浮水印；
  5. 準備三個版本：彩色、單色白（放深色底與推廣圖）、單色深色；
  6. 圖形與文字可以分開使用：「MasterDriver」英文字標、「跨境師傅幫」中文字標。
- Logo 旁的產品名稱固定為「MasterDriver 跨境師傅幫」，其中「跨境師傅幫」要醒目，進一步與「Master App Driver」區隔。

## 設計流程

沿用 Master Travel 的做法：

1. 先有設計稿（Figma），再切版；設計稿以本文件的 token 為準。設計稿由使用者（同時是 Master Travel 設計稿的設計者）製作；開發方提供頁面清單、內容與狀態需求作為設計依據。
2. 實作目標是還原設計稿，不自行調整視覺數值；若認為規格有問題，先提出再修改。
3. 圖片、圖示只用專案 `assets/` 內的檔案；沿用 Master Travel 的圖示或插畫前，確認可在 MasterDriver 使用。
4. 驗收至少涵蓋手機窄寬（320 px）、基準寬度（430 px）、微信內建瀏覽器及 WhatsApp 開啟。
