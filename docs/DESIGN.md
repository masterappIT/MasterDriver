# 視覺設計規範

用戶端（`web/`）2026-10-14 起用 MasterDriver 自己的風格「通關玻璃」，排版按本專案的需求（見下方基準來源）；和 Master Travel 的關係靠頁尾「by MasterApp」與升級入口銜接，不靠長得一樣。平台後台另參照 Master Travel 管理後台。

- **設計參考來源（2026-10-13 決定）：以 Master Travel 現有前端程式碼為準**，即已實作的乘客端（`src/`）與司機端（`driver/`）。參考其視覺數值、版式與元件做法，可直接沿用的部分依 `docs/REUSE.md` 複製，其餘在本專案以 Vue 3 重寫；不 import、不連結 Master Travel 的程式。
- **背景資料：**Master Travel 用戶端與司機端的 Figma 原型「EC Travel（跨境打車）」（https://www.figma.com/design/yqswcQZ9Q3E6BLTm6bFkmo/ ，兩個頁面、約 341 個畫面，含登入、叫車預約、訂單、付款、司機接單、司機收入等）。以程式碼為準；程式碼沒有的畫面，才回到 Figma 查看。
- **基準來源（2026-10-14 改）：用戶端（`web/`）用 MasterDriver 自己的「通關玻璃」風格，排版依使用者確認的線框圖（https://claude.ai/artifact/BK4abv3QGLgVBQFRFxdMes），按本專案的實際需求，不照搬 Master Travel 或 Trip.com**；資訊排法參考過 Trip.com（價錢放大、底部列左邊價錢右邊按鈕）。平台後台（`admin/`）不在此列，另依同日後台決定（參照 Master Travel 管理後台，見本文件後台一段）。
- **只取數值與元件做法，不照搬定位：** 乘客端頁面多以固定 430×932 畫布逐像素定位，本專案改用一般流式版面，以免在不同大小的手機上跑版。
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

Master Travel 沒有對應的頁面（發單成功分享頁、空車廣播、名片頁、推廣素材、團隊管理、方案）由開發方以同一套 token 與元件設計，風格與上表一致（2026-10-14 決定）。

## 顏色

用戶端（`web/src/styles/base.css`），2026-10-14 起採 MasterDriver 自己的「通關玻璃」風格（取代同日先試的乘客端配色）：淺色底配海港藍與青綠的淡漸層，卡片是半透明白，導航與底部列是毛玻璃，港牌金黃標出司機最先要注意的事。

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | `#edf2f7` | 頁面底色 |
| `--wash-blue`、`--wash-teal` | `rgba(31,95,214,.14)`、`rgba(14,159,154,.12)` | 頁面背後左上海港藍、右側青綠的淡漸層 |
| `--color-card`、`--color-card-border` | `rgba(255,255,255,.84)`、`rgba(255,255,255,.95)` | 卡片（半透明白加細白邊） |
| `--color-surface` | `#ffffff` | 輸入框等需要實底的地方 |
| `--color-text` | `#142033` | 主要文字 |
| `--color-text-secondary` | `#556579` | 次要文字 |
| `--color-text-muted` | `#8f9db0` | 提示、途經點 |
| `--color-label` | `#34445a` | 表單標籤、人數行李那一行 |
| `--color-border`、`--color-divider` | `#d3dce7`、`#e2e8ef` | 邊框、分隔線 |
| `--color-primary` | `#1f5fd6` | 海港藍：主按鈕、連結、選中 |
| `--color-primary-dark` | `#1749a8` | 按下狀態 |
| `--color-tint` | `#e5edfb` | 淺藍底（提示、次要按鈕） |
| `--color-teal` | `#0e9f9a` | 青綠：上車點、相對時間（「2 小時後」） |
| `--color-gold` | `#e6a206` | 港牌金黃：待搶狀態、目的地點 |
| `--color-gold-ink` | `#8a5a00` | 金黃當文字時用：價錢、車牌要求、備註 |
| `--color-gold-tint` | `#fff3d6` | 金黃淺底：車牌要求標籤、備註、完成單數 |
| `--color-glass` 等 | `rgba(255,255,255,.66)`，模糊 20px | 膠囊導航與底部固定列；不支援模糊時改用 `--color-glass-fallback` 實色 |
| `--color-error`、`--color-error-tint` | `#c03a3a`、`#fdecec` | 錯誤 |

圓角：卡片 20、按鈕與輸入框 12、膠囊 100。卡片陰影 `0 6px 20px rgba(20,32,51,.06)`。價錢一律用 `--color-gold-ink` 加粗。圖示用 Material Icons 的路徑內嵌（`web/src/components/AppIcon.vue`），不下載圖示字型。效能：只有導航和底部列用 `backdrop-filter`，卡片只用半透明，避免低階 Android 在微信裡捲動卡頓。

**不要像表格**（2026-10-14 使用者要求「整體風格不要好像表格一樣」）：
1. 少用「標籤：內容」一行行排列，改寫成一句話或一行重點，例如「4人｜3件行李｜7座」「陳師傅出的單 · 已完成 128 張」。
2. 少用框，靠字級、粗細和留白分層；每個畫面只有一個主角。
3. 輸入像對話：不放步驟計數和欄位標題框；電話欄只有一條底線，區號是小膠囊；驗證碼是 6 個數字格。
4. 主要按鈕用膠囊形；狀態和重點用顏色、小標籤和圖示表達。
5. 公開頁（首頁、登入）共用同一塊漸層弧形面板（`web/src/components/BrandPanel.vue`），兩頁切換看起來是同一個畫面。

共用的做法（`web/src/styles/base.css`）：按鈕一律膠囊形；區塊標題用小灰字 `.section-label`，不用框起來的大標題；「我的」這類清單一行一項，用 `web/src/components/MenuRow.vue`（標題、一行說明、紅色未讀數字、箭頭）；開關用 `.switch`（外觀是開關，仍是 checkbox）；句子後面的選項用 `.select--inline`；表單輸入用底線的 `.line-input`，上面只放一行小字 `.line-field`。

未登入首頁再進一步（2026-10-14）：只有一個按鈕；示範是一段會動、可以點的故事；特色寫成一句句大字，不用格子。

套用進度：登入、未登入首頁（2026-10-14）；我的、我的名片頁、預約列表與預約詳情（2026-10-14 第一批）；出單表單、單詳情、訂單卡片、分享到群、接單池（2026-10-14 第二批，出單表單的路線用上車、目的地圓點串成一條線，價錢用 `.amount-line`，直達／接駁用 `.segment`）；搶單頁、乘客確認頁、公開名片頁與預約表單、乘客的預約連結、客服（2026-10-14 第三批，路線輸入的圓點線改為共用的 `.route-inputs`）。用戶端頁面全部完成；平台後台另依 Master Travel 管理後台。接單池沒有搜尋欄，沒有單時中間是轉動的雷達（`web/src/components/PoolRadar.vue`，只用 CSS 轉一層，系統設定減少動態時停住）。

**不用 emoji 和圖案符號**（2026-10-14 使用者要求）：畫面上不放 ✅ 🔒 ▶ ▲ ▼ ← › ● ⇄ 之類的字元；返回寫「返回某某」，狀態和展開收合用文字表示，需要圖示時用 `AppIcon` 的線條圖示。貼進群的文字（`backend/src/orders/share-text.ts`）的「→」是產品輸出格式，改動前先確認；解析司機輸入時接受「→」「➡」要保留。

卡片照乘客端做法：白色卡片放在灰底上，沒有陰影也沒有邊框。金額用 `--color-primary` 加粗；搶單頁底部固定列左邊放出單價、右邊放按鈕（Trip.com 的排法）。圖示用 Material Icons 的路徑內嵌（`web/src/components/AppIcon.vue`），不下載圖示字型。

### 平台後台專用

**2026-10-14 稍後改：後台的尺寸不再跟 Master Travel。** 使用者選定緊湊、資料優先的版面（見 `docs/DECISIONS.md`）：標題 22px、卡片圓角 12px 與淡陰影、按鈕與輸入框高 36px、表格行高收緊且數字靠右、側欄 208px 並分四組、內容區最寬 1440px。下表的**顏色仍然適用**；表後一段關於圓角 20px、陰影、輸入框高度與表格標題的數值已被取代，以 `admin/src/styles/base.css` 為準。

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
| 已派 | `#1f5fd6` | 海港藍 |
| 乘客已確認 | `#25c987` | 品牌網站薄荷綠 |
| 已完成 | `#98a3b5` | 司機端提示灰 |
| 已取消、已被接走 | `#65738b` | 司機端次要文字 |

## 間距、圓角、陰影

| 類別 | Token | 值 |
|---|---|---|
| 間距 | `xs` `sm` `md` `lg` `xl` | 4、8、12、16、24 px |
| 圓角 | 卡片／輸入框與按鈕／膠囊 | 20、12、100 px |
| 陰影 | 卡片 | `0 6px 20px rgba(20,32,51,.06)` |
| 陰影 | 浮動元素 | `0 10px 24px rgba(0,0,0,.12)` |
| 版面 | 最大內容寬度 | 430 px，置中 |
| 版面 | 頁面左右留白 | 24 px（窄螢幕可縮為 16 px） |

## 字型

| 字級 | 值 |
|---|---|
| 說明文字 | 14 px |
| 標籤 | 15 px |
| 內文 | 16 px |
| 大內文 | 18 px |
| 卡片標題 | 20 px、字重 500 |

2026-10-14 起用戶端（`web/`）全部字級加大 2 px（使用者表示「整體字體有點太小」）；26 px 以上的大標題與大數字不變，未讀數字小圓點維持 10 px。平台後台不受影響。

**字體：** Master Travel 使用 Noto Sans TC（並分層載入簡體與罕用字）。MasterDriver 為了在微信內 3 秒打開，**搶單頁、乘客頁使用系統字體**（蘋方、微軟正黑體、思源黑體等），不在首次載入時下載中文網路字型；司機端其他頁面如需 Noto Sans TC，必須自行託管並分層載入，不可使用 Google Fonts（內地無法存取）。

## 車牌顯示

跨境車同時顯示香港車牌與內地車牌，樣式參考 Master Travel 乘客端（金色港牌、黑底內地牌）。澳門車牌與真車牌一樣用黑底白字（使用者 2026-10-14 指示）。具體尺寸在設計稿確定。

## 品牌區隔

- 色系、字型、圓角與 Master Travel 一致，屬同一品牌家族。
- **2026-10-14 起品牌標誌用使用者提供的白色雲形 M**（`web/src/assets/brand/masterapp-mark.svg`），淺色底放在漸層圓角方塊裡，深色底直接用白色，旁邊配「MasterDriver」字樣，見 `web/src/components/BrandMark.vue`。以下 2026-10-13 的專屬 Logo 建議保留作背景資料。
- **MasterDriver 有自己的專屬 Logo**，同時**保留 MasterApp Logo** 作為母品牌（2026-10-13 決定，標誌部分已被上一條取代）。採「子品牌 + 母品牌背書」：
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

做法（2026-10-14 起）：

1. **不先出 Figma 稿，由開發方直接做**（2026-10-14 決定，取代原本「先有設計稿再切版」）。Master Travel 有對應的頁面，照上方「頁面參考對照」的程式還原版式與元件；沒有對應的頁面，由開發方以本文件的 token 與相同元件設計，風格與對應頁面一致。
2. 不自行發明新的視覺數值；需要新 token 時先寫進本文件再使用。每批頁面完成後，給使用者看手機寬度的截圖確認，使用者提出的修改照做。
3. 專屬 Logo 由使用者或設計師製作；出來之前頁首用文字標題（或後台上傳的 Logo）。
4. 圖片、圖示只用專案 `assets/` 內的檔案；沿用 Master Travel 的圖示或插畫前，確認可在 MasterDriver 使用。
5. 驗收至少涵蓋手機窄寬（320 px）、基準寬度（430 px）、微信內建瀏覽器及 WhatsApp 開啟。
