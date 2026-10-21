# 用 D1 自己累積每日價量

證交所 OpenAPI 只提供最新一個交易日，「這個月漲了多少」「近 20 日均價」都答不了。
這份 ADR 記錄為什麼改成自己存檔、存了什麼，以及免費方案下的幾條硬限制——
這是本專案第一次保存資料，之前一律是即時轉接。

決定日期：2026-09-30。

## 存什麼、為什麼授權上沒問題

- 只存 `exchangeReport/STOCK_DAY_ALL`（上市個股日成交資訊）的價量欄位，一天約 1,400 列，
  主鍵（代號、交易日）。實作在 `src/archive.ts`。
- 這份資料依政府資料開放授權條款第 1 版釋出，可以儲存與再提供，條件是標示出處——
  讀取路徑（之後的 `snapshot.stock` 歷史查詢）沿用既有的顯名聲明。
- **不存**：即時報價（mis.twse.com.tw 不在開放授權範圍內）、任何使用者資訊。
  資料庫裡只有公開的市場資料，所以隱私權政策不必改。

## 沒有回補

證交所網站有按月的個股歷史查詢，但那是網站而不是 OpenAPI，受網站使用條款
「禁止…自動程式…擷取程式等方式下載本網站之軟體或資料」約束。所以歷史只從開始存的那天
（2026-09-30 部署）往後累積，不回補。

## 資安

- 寫入只由 Cron 觸發（`server.ts` 的 `scheduled`）。D1 只以 binding 綁在 Worker 內，
  沒有任何 HTTP 路由能寫入，也不需要任何 API token。
- SQL 一律參數綁定，不拼接字串。
- 讀取路徑（之後做）：只 SELECT、參數綁定、代號先過既有的 `^[0-9A-Za-z]{1,10}$` 驗證、
  筆數設上限。免費方案每天 500 萬列讀取額度是可被耗盡的資源：每次最多讀幾百列，
  要數萬次請求才會用完，擋這種濫用靠的是 Cloudflare WAF 的限速規則。

## 免費方案的限制，以及它們決定的寫法

查證日期 2026-09-30（[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)、
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)）：

| 限制 | 免費方案 | 這裡的用量 |
|---|---|---|
| 每次 Worker 執行的 D1 查詢數 | 50 | 2（建表、寫入） |
| 每個查詢的綁定參數 | 100 | 1 |
| 每天寫入列數 | 10 萬 | 每次排程約 1,400，一天兩次 |
| 單一資料庫大小 | 500 MB | 一年約 34 萬列 |
| Cron 每次 CPU | 10 ms | 2026-10-21 第一次排程（三張表）：`cpuTime` 44 ms，`outcome` 為 `ok`，見最後一節 |

1,400 列 × 11 欄，逐列或多列 `VALUES` 都會超過前兩條。所以整天的資料轉成一個 JSON 參數，
用一條 `INSERT OR REPLACE … SELECT … FROM json_each(?1)` 寫入。

交易日取自資料本身，不用執行當下的時間：排程一天跑兩次（台灣 06:30、09:30，
上游約在清晨更新前一交易日），拿到的若還是前一天的資料，只是覆寫同一批列。

**若 Cron 的 CPU 經常超過 10 ms**，備案是 GitHub Actions 每天抓好、經 D1 REST API 寫入——
代價是要在 GitHub 存一把長期有效、只能寫這個資料庫的 Cloudflare token，
而且無人值守的排程不能放在需要人工核准的 environment 後面。能用 Worker Cron 就不走這條。

## 讀取路徑（2026-09-30 上線）

`snapshot.stock` 的 `history_days`（2–250，預設不帶）→ `stockHistory`：一條
`SELECT … WHERE code = ?1 ORDER BY date DESC LIMIT ?2`，主鍵讓它只讀 N 列。

- 資料不足、查無資料、D1 出錯或沒有綁定，都回 `history: null`（或較短的歷史）加一句固定說明；
  D1 的錯誤內容不回給用戶端，讀取路徑也不寫 log。D1 出事只影響這一段，其他段落與工具照常。
- 只回原始價量與整段期間漲跌幅，不算技術指標——llms.txt 公開說本服務不做技術指標。
- 比較模式（codes）不接受 `history_days`。
- **讀取額度是可被耗盡的資源**：每次最多 250 列（2026-10-21 起 JOIN 本益比與融資融券，變成最多 750 列，見最後一節），約 2 萬次請求（現在約 6,700 次）就能用完每天 500 萬列的免費額度，
  之後歷史查詢一律回「暫時無法取得」（其他功能不受影響）。擋這件事要靠 Cloudflare WAF 限速規則
  （SUBMISSION_CHECKLIST 的用戶端限速一項）。2026-09-30 已建立：`/mcp` 同一 IP 10 秒內超過 100 次封鎖 10 秒；
  單一 IP 一天最多約 86 萬次請求，仍可能用完額度，但需要持續大量請求，屆時再視情況收緊。
- 隱私不變：資料庫只有公開市場資料，查詢不存任何使用者資訊。

## 2026-10-21：加存本益比與融資融券（只存，不讀）

除了 `STOCK_DAY_ALL`，再把兩份有登錄在 data.gov.tw 的資料集每天存進 D1：

| 資料集 | 表 | 列數／天 | 欄位 |
|---|---|---|---|
| `BWIBBU_ALL`（個股日本益比、殖利率、股價淨值比） | `pe_daily` | 約 1,100 | 本益比、殖利率、股價淨值比；虧損公司沒有本益比，存 NULL 不是 0 |
| `MI_MARGN`（融資融券餘額） | `margin_daily` | 約 1,300（含 ETF） | 融資、融券各：買進、賣出、償還、今日餘額、限額；資券互抵；註記 |

**這次只存、不讀。** `snapshot.stock` 的 `history_days` 沒有改：融資融券的日期還沒用資料驗證過（見下），
現在就讓模型引用可能標錯日期的數字不好；讀取會改變工具回應形狀，要另外跑 smoke 與 `eval:answers`。

### 融資融券沒有日期欄位——這是一個假設

`MI_MARGN` 每一列只有股票代號與各欄餘額，沒有日期。主鍵要有交易日，所以**借用同一次排程抓到的
日成交資訊的交易日**。三份上游的 `last-modified` 實測都在 UTC 21:20–21:23（台灣 05:20 左右），
但沒有任何文件保證它們永遠同步；某天融資融券比價量晚一天更新，就會被標成錯的日期，而且不會有任何錯誤。

- **不存「前日餘額」**，因為它等於前一天的「今日餘額」。真正的用處是拿來對帳：
  上游**今天**的 `融資前日餘額`，應該等於我們存的**前一個交易日**的 `margin_balance`。
  存了前日餘額，這個對帳就只剩自己跟自己比。
- **累積兩個交易日後要對一次帳**：抓當下的 `MI_MARGN`，拿每檔的 `融資前日餘額` 與 `融券前日餘額`
  對 D1 裡前一個 `date` 的 `margin_balance`、`short_balance`。大部分對不上，代表日期標錯一天，
  要改成別的日期來源（例如抓回應標頭的 `last-modified`）。這個對帳**還沒做**，因為資料還不夠兩天。
- 日成交資訊那份抓不到時，融資融券**不存**（沒有交易日可借），結果與 log 會說明原因。

### 寫法

- 三張表各自成敗：一份上游壞了，其他兩份照存。`scheduled` 每張表印一行 log（表名、列數、交易日、
  有錯才有 `error`），最後若有任何一張失敗就丟出例外，讓 Cron 的失敗出現在 Workers Logs。
- 查詢數：每張表兩個（建表、寫入），共 6 個，遠低於每次 50 個；每天寫入約 7,600 列，遠低於 10 萬列。
  500 MB 的容量：三張表加起來一年約 100 萬列，仍遠低於。
- **Cron 的 CPU 仍沒有量測。** 本來就是「待部署後量測」，現在多兩次約 1,000 列的 JSON 序列化，更接近 10 ms。
  部署後第一次排程要看 Workers Logs 有沒有 CPU 超限；若有，走上面寫的備案。
- 測試（`test/archive.test.ts`）：欄位轉換、整次 6 個查詢與單一 JSON 參數、單表失敗隔離、日期借用，
  外加一組用真的 SQLite（`node:sqlite`，CI 的 Node 22.13 以上可用、會印 ExperimentalWarning）跑 SCHEMA 與
  INSERT，驗證 `json_extract(value, '$[n]')` 的位置——假 D1 看不出欄位順序寫錯。
  這組測試刻意改錯一個索引驗證過會失敗。

## 2026-10-21：`history_days` 帶出本益比與融資融券

對帳通過後（見上一節，由維運者確認），`snapshot.stock` 的 `history_days` 每列多五個欄位：
`pe_ratio`、`dividend_yield`、`pb_ratio`（來自 `pe_daily`）、`margin_balance`、`short_balance`（來自 `margin_daily`）。
其餘已存的欄位（融資融券的買賣、限額、資券互抵、註記）不放進回應：`history_days` 最多 250 列，帶全部 12 個欄位
回應會變成約三倍大，而問「本益比變化」「融資水位」用不到那些。

- **一條 SELECT，價量是主表。** `daily_quotes` LEFT JOIN `pe_daily`、`margin_daily`（以代號與交易日），
  列數永遠等於價量的筆數。某天沒有本益比或融資融券（存檔開始得比較晚、或當天上游沒抓到）就是 null，
  不會少一列。虧損公司沒有本益比，也是 null，不是 0。
- **存檔起點不同，說清楚。** 價量自 2026-09-29，本益比與融資融券自 `ARCHIVE_PE_MARGIN_SINCE`（2026-10-20）。
  回傳的列裡有更早的日子，`caveats` 就多一句說明；答案核對（`eval:answers` 的 `history-pe-margin`）會檢查模型有沒有講出來，
  而不是把 null 當成 0。
- **新表還不存在時不拖垮價量歷史。** 讀取端可能先於第一次排程部署，或那兩份上游一直壞著、表沒建起來。
  JOIN 的查詢出錯時，退回只讀價量的查詢，新欄位補 null；兩個查詢都失敗才回「暫時無法取得」（錯誤內容照舊不外洩、不寫 log）。
- **讀取額度變成 3 倍。** 一次查詢最多讀 250（價量）＋250（本益比）＋250（融資融券）＝750 列，
  免費方案每天 500 萬列大約是 **6,700 次請求**（原本約 2 萬次）。限速規則（`/mcp` 同一 IP 10 秒內超過 100 次封鎖 10 秒）
  不變：單一 IP 一天最多約 86 萬次請求，仍可能耗盡額度，但需要持續大量請求，屆時再視情況收緊。
  額度耗盡時歷史查詢一律回「暫時無法取得」，其他功能不受影響。
- **對帳的限度。** 日期借用的假設是用上游「前日餘額」對我們存的前一日「今日餘額」驗證的；
  它驗證過的只是那幾個交易日，不保證三份上游永遠同步更新。若之後某天融資融券晚一天出來，
  那天的融資融券會被標成錯的日期——這是這個設計的已知風險，回應裡沒有逐日的提示。

## 維運查詢

這台機器的 `wrangler` 登入了兩個帳號，非互動模式不會替你選，直接報錯。查正式環境要先指定帳號：

```sh
export CLOUDFLARE_ACCOUNT_ID=5164de0801b523f919f7a9eac9bbf9bf   # 拓思科技股份有限公司，twse-mcp 在這個帳號
```

不要把它寫進 `wrangler.jsonc`：別的環境（CI、其他人的帳號）部署會跟著指到這個帳號。

資料庫是 `twse-mcp-archive`。**只下唯讀的 SELECT**（讀取也計入免費額度的每日列數，見上面「讀取額度」；
`--remote` 的寫入會動到正式資料）：

```sh
# 各表的筆數與日期範圍
npx wrangler d1 execute twse-mcp-archive --remote --json --command \
  "SELECT 'daily_quotes' t, COUNT(*) n, MIN(date) a, MAX(date) b FROM daily_quotes
   UNION ALL SELECT 'pe_daily', COUNT(*), MIN(date), MAX(date) FROM pe_daily
   UNION ALL SELECT 'margin_daily', COUNT(*), MIN(date), MAX(date) FROM margin_daily"
```

- 表還沒建（第一次排程之前）會報 `no such table`，這是正常的；`sqlite_master` 可以列出現有的表。
- `--json` 的輸出前面有 wrangler 的訊息，解析時從第一個單獨成行的 `[` 開始（訊息裡也有 `[` 字元）。
- 筆數查詢要掃整張表（`daily_quotes` 約 2 萬列），別放進迴圈或排程。
- 看排程 log：`npx wrangler tail twse-mcp --format json`，只看得到開著期間發生的事件；排程是 UTC 22:30 與 01:30（台北 06:30、09:30），
  要提前開。每個事件有 `outcome`（`exceededCpu` 表示超限）、`cpuTime` 與 `wallTime`（毫秒）；排程事件的 `event` 有 `cron` 欄位，`logs` 是三行存檔 log。
  tail 是即時串流，用 `--format json` 輸出的是多行縮排的 JSON，解析時逐個物件讀（例如 Python 的 `raw_decode`），不是一行一筆。macOS 沒有 `timeout` 指令。
- 驗證剛部署的工具回應：`npm run call -- snapshot.stock '{"code":"2330","history_days":5}' --prod`。

### 2026-10-21 第一次三張表排程的實測

台北 09:30（UTC 01:30）的排程，用 `wrangler tail` 取得：`outcome` 為 `ok`，`cpuTime` 44 ms，`wallTime` 5,833 ms，
沒有例外；三行 log 都在：`daily_quotes` 1,383 列、`pe_daily` 1,084 列、`margin_daily` 1,302 列，日期都是 2026-10-20。

- **44 ms 超過上面表格寫的 10 ms，卻沒有被判超限。** 所以那個 10 ms 不是這個觸發類型的硬上限，表格和「若 Cron 的 CPU 經常超過 10 ms」那句備案條件
  是依 HTTP 請求的額度寫的。實際的上限沒有在官方文件核對過；備案的觸發條件改以 `outcome` 出現 `exceededCpu` 為準。
- 這只是一次量測。資料量隨上市家數與當天交易日略有變化，之後排程若出現 `exceededCpu` 再回頭看。

