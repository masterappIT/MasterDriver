# MasterDriver 跨境師傅幫

> 有單就派，有空就接

MasterDriver 跨境師傅幫（簡稱「師傅幫」）是 MasterApp 旗下的獨立免費 Web 工具，讓任何規模的司機直接在微信群和 WhatsApp 群裡派單、接單、請乘客確認，不改變他們在群裡的習慣。

本專案的任務是幫 Master Travel 進入市場：司機用 MasterDriver，做大了就用 MasterTravel 開公司。完整規劃見 [docs/PLAN.md](docs/PLAN.md)。

## 專案狀態

規劃階段。尚未開始寫程式；開工前的待拍板事項見 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 設計紅線

任何功能都不能違反以下六條：

1. **不改變習慣**：用戶照樣在群裡發單、聊天、搶單，工具只是多一條連結。
2. **在微信內完整可用**：派單、搶單、乘客確認都能在微信內建瀏覽器走完全程，WhatsApp 也一樣。
3. **任何規模都能用**：一個人就能發單，不用先建立公司或池。
4. **Master Travel 完全不動**：兩邊沒有程式或資料上的連接，只靠人工銷售銜接。
5. **不做 Master Travel 的核心**：自動報價、收款、結算、司機審核、自有品牌乘客端、會員積分，任何一級都不做。
6. **幫司機經營自己的客源，不做我們的乘客平台**：不做乘客註冊和找車平台，不由平台分配乘客。

## 與 Master Travel 的邊界

| | MasterDriver 跨境師傅幫 | MasterTravel |
|---|---|---|
| 給誰 | 司機（個人、小團隊） | 公司、車隊 |
| 定位 | 免費接單派單工具 | 自己品牌的完整運營系統 |
| 倉庫 | `masterappIT/MasterDriver` | `masterappIT/master-travel-project` |

- 不 import、不複製 Master Travel 的實作；只可參考其邏輯後在本專案重寫。
- 不共用資料庫、網域、部署或登入帳號。
- 升級入口只連到 Master Travel 品牌網站的「預約演示」與微信、WhatsApp 諮詢。

## 規劃中的目錄結構

技術選擇待拍板；以下為建議結構，建立時同步更新本表。

| 目錄 | 用途 | 建議技術 |
|---|---|---|
| `web/` | 司機與乘客使用的輕量網頁（發單、搶單、乘客確認、名片頁）；日後延伸到微信小程序和 App | uni-app（Vue 3）或 Vue 3 + Vite，待拍板（不用 Flutter Web） |
| `backend/` | API、驗證碼登入、搶單一致性、收費控制 | NestJS |
| `admin/` | 平台後台（收費控制、廣告、潛在客戶） | Vue 3 + Vite |
| `prisma/` | 資料庫 schema 與 migration | Prisma + PostgreSQL |
| `shared/` | 跨端共用型別與契約 | TypeScript |
| `docs/` | 規劃、決定、架構與維運文件 | Markdown |

## 文件

- [完整規劃](docs/PLAN.md)
- [決定記錄與待拍板事項](docs/DECISIONS.md)
- [文件索引](docs/README.md)
- [代理與開發規範](AGENTS.md)

## Git 工作方式

- `main` 為主分支；遠端為 `https://github.com/masterappIT/MasterDriver.git`。
- 提交與推送分開進行：先提交，經明確指示後才推送。
- 不提交 `.env`、金鑰、正式密碼或個人資料。
