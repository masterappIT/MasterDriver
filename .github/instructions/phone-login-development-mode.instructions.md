---
description: Protect development-mode phone sign-in (登入配置 → 開發模式登入) when changing sign-in, verification codes, SMS or admin login settings
applyTo: 'backend/src/auth/**,prisma/schema.prisma,shared/src/schemas.ts,admin/**'
---

# 開發模式登入的維護規範

規則沿用 Master Travel 的「手機號碼開發模式」，簡化為 MasterDriver 只有司機登入的單一開關。

## 功能

- 「登入配置 → 開發模式登入」開啟時，新的驗證碼申請**不發簡訊**，改為接受後台指定的 6 位驗證碼。
- 用途：本機與測試環境開發、上架審核帳號、無法收簡訊時的內部測試。

## 不可破壞的規則

1. **獨立資料：** 設定只存在 `PhoneLoginDevelopmentSetting`，不併入簡訊通道設定或其他登入設定。
2. **只存雜湊：** 只保存指定碼的雜湊；任何 API、日誌、指令工具都不得回傳或印出指定碼或雜湊。
3. **申請時決定：** 申請驗證碼的當下讀取開關；開啟時把當時指定碼的雜湊存進該次 `VerificationCode`（`mode = DEVELOPMENT`），關閉時發隨機簡訊碼（`mode = SMS`）。
4. **驗證只看該次申請：** 驗證時依該次申請保存的 `mode` 與雜湊比對，不改讀最新設定；切換開關或更新指定碼不影響已發出的申請，也不自動撤銷。
5. **與簡訊隔離：** 開發分支不讀取、不修改簡訊設定，也不呼叫簡訊服務；簡訊失敗時不得自動退回開發模式。
6. **不繞過其他規則：** 手機格式、申請頻率限制、有效期、最多 5 次錯誤、一次性使用、帳號建立與 session 發放，在開發模式下一律照常。
7. **預設碼：** 設定首次建立時預設碼為 `000000`；開啟前應先更換。未提交新碼時保留原雜湊。
8. **權限：** 後台完成後，讀取開關限超級管理員與營運，修改限超級管理員，後端必須重新驗證權限；每次修改記錄修改者。

## 目前狀態

- 後端已實作：`backend/src/auth/development-login.service.ts`、`backend/src/auth/auth.service.ts`。
- 平台後台尚未完成，暫以指令工具設定：`npm run dev-login -- --status`、`--on`、`--off`、`--code=123456`。
- 後台設定頁與管理 API 完成後，更新本節。

## 回歸測試

修改相關程式後執行 `npm run test:api:db`，`backend/src/auth/auth.db-test.ts` 須全部通過，涵蓋：開發模式不發簡訊、指定碼可登入、更新指定碼只影響新申請、關閉後回到簡訊、頻率限制照常、狀態不含雜湊。
