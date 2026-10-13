# 文件索引

根目錄 [README.md](../README.md) 是專案入口；本頁是詳細文件索引。

| 文件 | 用途 |
|---|---|
| [PLAN.md](./PLAN.md) | 完整規劃：定位、紅線、流程、功能範圍、訂閱、升級路徑、技術方向、開發階段、指標與風險 |
| [DECISIONS.md](./DECISIONS.md) | 已確認的決定與待拍板事項 |
| [REUSE.md](./REUSE.md) | 沿用 Master Travel 程式碼的規則、分類與來源記錄 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 本機開發、指令、API 一覽與驗證 |
| [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md) | 正式環境的架構、分支、發布流程、一次性設定與正式網域 |
| [ACCEPTANCE.md](./ACCEPTANCE.md) | 第一版的微信內驗收操作清單：照著做的步驟、預期結果與回報方式 |
| [DESIGN.md](./DESIGN.md) | 視覺設計規範：沿用 Master Travel 風格的顏色、間距、字型與設計流程 |

## 文件責任分工

- `README.md`：專案入口、設計紅線、與 Master Travel 的邊界。
- `docs/`：規劃、決定、架構、API、部署與維運文件。開始開發後依需要新增 `ARCHITECTURE.md`、`API.md`、`DEVELOPMENT.md`、`OPERATIONS.md`。
- `.github/instructions/`：修改特定路徑時必須遵守的工程規範。
- `AGENTS.md`：代理與開發流程入口。

## 變更文件時

1. 決定有變：先更新 `DECISIONS.md`，再同步 `PLAN.md` 相關章節。
2. 紅線或邊界有變：同步更新根目錄 `README.md` 與 `AGENTS.md`。

文件不得包含正式密碼、API 金鑰、Secret value 或個人資料。
