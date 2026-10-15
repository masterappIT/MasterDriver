# 代理與開發規範 / Project guidance for agents

本文件要求 Claude Code、Codex、Copilot 及其他代理，從接到任務、辨識規範、分析、依授權修改、驗證到交付，全程遵循本專案的要求。要求以現行 `.github/instructions/` 為準；本文件不取代它們。每次任務都須讀取當前適用來源，包括日後新增或修訂的規範。若無法在授權範圍內遵守，停止受影響工作並說明衝突。

This file directs every agent to follow the current rules in `.github/instructions/` throughout intake, analysis, authorized changes, verification, and delivery. Read the applicable sources for each task; stop and report if a rule cannot be followed within the authorized scope.

## 專案定位

MasterDriver 跨境師傅幫是獨立專案，任務是幫 Master Travel 進入市場。修改前先讀 [README.md](README.md) 的設計紅線與邊界，以及 [docs/PLAN.md](docs/PLAN.md)、[docs/DECISIONS.md](docs/DECISIONS.md)。

- 任何變更不得違反 README 的六條設計紅線。
- 不得修改或 import Master Travel（`masterappIT/master-travel-project`）的程式。沿用其程式碼只能依 `docs/REUSE.md` 複製通用部分，並在該文件記錄來源與 commit；核心業務程式不沿用。
- 待拍板事項未確認前，不得以猜測方式實作相關功能。

## 工作流程

1. 接到任務時，先辨識任務類型、端別（`web/`、`backend/`、`admin/`、`prisma/`、`shared/`、`docs/` 或跨區）及授權範圍。唯讀要求只授權分析；功能相關不代表取得其他區域的修改授權。
2. 分析或修改前，讀取 `.github/instructions/development-reliability.instructions.md`，並檢視其他 `.github/instructions/*.instructions.md`，依 `applyTo` 與描述辨識適用規則。
3. 修改前理解既有行為、依賴、資料／API 契約、生命週期、錯誤處理及受影響的畫面；確定最小完整修改與驗證方式。必要修改超出授權範圍或重大選擇不明時，停止並取得授權。
4. 實作時就遵守端別規範：前端必須在微信內建瀏覽器可用、保持輕量，不依賴內地被封鎖的服務；後端負責驗證、權限、收費判斷與搶單一致性，前端不得決定可信任的商業結果。
5. 依規範檢查實際差異並執行對應驗證；建置或靜態檢查不能取代功能、微信內及 WhatsApp 內的實際驗證。交付時列出實際命令、結果及未驗證項目。純文件變更只檢查內容、連結及差異。

## 多代理工作模式

- 多個代理可能同時在同一個工作樹工作。修改前先查看工作樹狀態，不把未提交變更假定為自己的，保留其他代理的變更。
- 開始修改前，先查看 `.agents/active-work/`，再為自己的工作建立一個以代理及任務識別命名的 Markdown 標記，以繁體中文寫明代理／對話識別、任務、預計修改的檔案、狀態及更新時間；範圍或狀態改變時更新。
- 其他代理的標記表示該範圍可能正在修改；範圍重疊時先協調，不自行刪除或接管。交付後只移除自己的標記。
- `.agents/active-work/` 只供同一工作樹即時協作，不提交至 Git。

## Git

- 提交與推送分開：先提交，等明確指示後才推送。
- 沒有使用者明確指示，不得把變更提交、合併或推送到 `main`。在其他分支或工作樹工作時，所有變更（包括順手發現、與當前任務無關的修正）都留在該分支；要改 `main`，先取得使用者明確同意。
- 使用者交代「不提交」或「只留在某個分支」時，這個要求適用於整個對話裡之後的所有工作，不會因為接到新任務而失效；要改變做法，先問使用者。
- 不提交 `.env`、金鑰、正式密碼、Secret value 或個人資料。
- 除非使用者明確納入，保留工作樹中既有的使用者變更。
