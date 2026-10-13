# 視覺設計規範

MasterDriver 的 UI 沿用 Master Travel 的風格，讓用戶從 MasterDriver 升級到 Master Travel 時感覺是同一個品牌家族。

- **基準來源：** Master Travel 司機端的設計 token（`driver/lib/core/tokens/driver_tokens.dart`），輔以乘客端的車牌樣式與品牌網站的配色。
- **只沿用視覺數值，不複製程式：** 本專案在 `web/` 以 CSS 變數重新定義同樣的數值，不 import、不複製 Master Travel 的實作（紅線 4）。
- **Token 是唯一來源：** 程式中的顏色、間距、字號、圓角、陰影一律從 token 取值，不寫死數值。
- 以下數值為 2026-10-13 從 Master Travel 讀取；若 Master Travel 日後調整，由我們決定是否跟進，不自動同步。

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
- MasterDriver 必須有**自己的 Logo 與名稱標示**，放在頁首與官網，避免與 Master Travel 現有司機端「Master App Driver」混淆。

## 設計流程

沿用 Master Travel 的做法：

1. 先有設計稿（Figma），再切版；設計稿以本文件的 token 為準。設計稿由使用者（同時是 Master Travel 設計稿的設計者）製作；開發方提供頁面清單、內容與狀態需求作為設計依據。
2. 實作目標是還原設計稿，不自行調整視覺數值；若認為規格有問題，先提出再修改。
3. 圖片、圖示只用專案 `assets/` 內的檔案；沿用 Master Travel 的圖示或插畫前，確認可在 MasterDriver 使用。
4. 驗收至少涵蓋手機窄寬（320 px）、基準寬度（430 px）、微信內建瀏覽器及 WhatsApp 開啟。
