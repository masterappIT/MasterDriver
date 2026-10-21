# 特價車教學圖

給司機看的特價車教學：上半是功能作用：司機開自己的專屬路線，得到一條專屬連結，乘客打開直接向司機下單，不經任何中介（路線你開、價錢你定、專屬連結），下半是五步流程（發特價車 → 發專屬連結給乘客 → 乘客預約 → 每組各自成單，分「這單我自己做」和「派給其他司機」 → 夠了就關閉）和小提示。1080×1920（9:16），可以發到司機群、朋友圈，或讓司機存到手機看。

| 檔案 | 用途 |
|---|---|
| `deal-guide-zh-Hant.png` / `deal-guide-zh-Hans.png` | 繁體、簡體成品 |
| `deal-guide-zh-Hant.html` | 原稿，改字只改這個檔 |
| `deal-guide-zh-Hans.html` | 由繁體原稿轉出，不要手改 |
| `to-hans.mjs` | 轉簡體：用 App 同一套轉換（`web/src/i18n/convert.ts`），另外把「留著」改成「留着」 |

步驟的字眼照 App 畫面（`web/src/pages/Deal*.vue`）。不用「空車便宜賣」這類說法：特價車是司機的專屬路線訂單，不是賣空車（2026-10-22 使用者指示）。特價車的規則改了（例如出單額度、確認方式、時段長度），這張圖也要跟著改。

## 改完重新出圖

在倉庫根目錄：

```bash
node --import tsx docs/marketing/deal-guide/to-hans.mjs
```

```bash
cd docs/marketing/deal-guide && for l in zh-Hant zh-Hans; do "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1080,1920 --screenshot="$PWD/deal-guide-$l.png" "file://$PWD/deal-guide-$l.html"; done
```

出圖後打開 PNG 看最下面一行「平台不會把你的特價車列給其他人看」有沒有被切掉；內容加長超出 1920 高時要縮字或刪字。
