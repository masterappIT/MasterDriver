# MasterDriver 跨境師傅幫

> 有單就派，有空就接

MasterDriver 跨境師傅幫（簡稱「師傅幫」）是 MasterApp 旗下的獨立免費 Web 工具，讓任何規模的司機直接在微信群和 WhatsApp 群裡派單、接單、請乘客確認，不改變他們在群裡的習慣。

本專案的任務是幫 Master Travel 進入市場：司機用 MasterDriver，做大了就用 MasterTravel 開公司。完整規劃見 [docs/PLAN.md](docs/PLAN.md)。

## 專案狀態

第一版開發中（2026-10-13）：後端、司機與乘客網頁、平台後台已有程式，並在本機驗證；還沒在微信與 WhatsApp 內實測。正式環境在公司的 HostKVM 伺服器（2026-10-19 由 Google Cloud 搬過去，Google Cloud 上的運行資源已刪除；正式網域 `masterdriverapp.masterappinc.com`，尚未在內地微信內實測；內地號碼可以收驗證碼登入，港澳號碼的簡訊還沒開通），推送到 `main` 會自動部署（只改文件的推送不部署），見 [docs/PRODUCTION-DEPLOYMENT.md](docs/PRODUCTION-DEPLOYMENT.md) 和 [docs/HOSTKVM-MIGRATION.md](docs/HOSTKVM-MIGRATION.md)。待拍板事項見 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 設計紅線

任何功能都不能違反以下六條：

1. **不改變習慣**：用戶照樣在群裡發單、聊天、搶單，工具只是多一條連結。
2. **在微信內完整可用**：派單、搶單、乘客確認都能在微信內建瀏覽器走完全程，WhatsApp 也一樣。
3. **任何規模都能用**：一個人就能發單，不用先建立公司或池。
4. **Master Travel 完全不動**：兩邊沒有程式或資料上的連接，只靠人工銷售銜接。
5. **不做 Master Travel 的核心**：自動報價、平台代收款與線上付款、自動結算與平台對帳、司機審核、自有品牌乘客端、會員積分，任何一級都不做。出單者可以把自己的收款方式給乘客看，並自己標記已收款（2026-10-14），錢直接付給出單者；出單者也可以把和接單司機的帳標記為已結清（2026-10-14），只是記號，不記金額，平台不經手、不核對。
6. **幫司機經營自己的客源，不做我們的乘客平台**：不做乘客叫車平台；平台不分配乘客、不定價、不經手車費。「司機名錄」（乘客自行挑選司機）保留空間，第四階段經法律意見後再評估。

## 與 Master Travel 的邊界

| | MasterDriver 跨境師傅幫 | MasterTravel |
|---|---|---|
| 給誰 | 司機（個人、小團隊） | 公司、車隊 |
| 定位 | 免費接單派單工具 | 自己品牌的完整運營系統 |
| 倉庫 | `masterappIT/MasterDriver` | `masterappIT/master-travel-project` |

- 不 import、不連結 Master Travel 的程式；部分通用前端程式可以**複製沿用**，複製後由本專案維護，規則與記錄見 [docs/REUSE.md](docs/REUSE.md)。
- 不共用資料庫、網域、部署或登入帳號。
- 升級入口只連到 Master Travel 品牌網站的「預約演示」與微信、WhatsApp 諮詢。

## 規劃中的目錄結構

目前的目錄結構：

| 目錄 | 用途 | 建議技術 |
|---|---|---|
| `web/` | 司機與乘客使用的輕量網頁：搶單頁、乘客確認頁、登入、首頁、發單、我的單、單詳情、我的 | Vue 3 + Vite（不用 uni-app、Flutter Web） |
| `backend/` | API、驗證碼登入、搶單一致性、收費控制 | NestJS |
| `miniprogram/` | 之後的 MasterDriver 微信小程序 | 原生小程序 |
| `app/` | 之後的 MasterDriver App | Capacitor 包裝 `web/` |
| `admin/` | 平台後台 | Vue 3 + Vite |
| `prisma/` | 資料庫 schema 與 migration | Prisma + PostgreSQL |
| `shared/` | 跨端共用型別與契約 | TypeScript |
| `docs/` | 規劃、決定、架構與維運文件 | Markdown |

## 文件

- [完整規劃](docs/PLAN.md)
- [決定記錄與待拍板事項](docs/DECISIONS.md)
- [視覺設計規範](docs/DESIGN.md)
- [沿用 Master Travel 程式碼的規則](docs/REUSE.md)
- [本機開發指南](docs/DEVELOPMENT.md)
- [正式環境部署](docs/PRODUCTION-DEPLOYMENT.md)
- [文件索引](docs/README.md)
- [代理與開發規範](AGENTS.md)

## Git 工作方式

- 遠端為 `https://github.com/masterappIT/MasterDriver.git`。分支沿用 Master Travel 的方式：
  - `main` 是唯一的正式部署分支。雲端設定完成並啟用後，**每次推送到 `main` 都會自動部署正式環境**（先過品質閘門）。
  - `develop` 用於開發整合，推送後只執行品質閘門，不部署。
- 提交與推送分開進行：先提交，經明確指示後才推送。
- 不提交 `.env`、金鑰、正式密碼或個人資料。
