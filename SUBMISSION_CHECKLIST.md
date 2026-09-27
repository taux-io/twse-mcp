# Claude Directory 送件檢查表

路線：Single MCP connector。上架名稱：**Taiwan Market Open Data (Unofficial)**。
最後更新：2026-09-28（v0.13.0，#128–#132）。

狀態分成三種：完成、未完成、待查證（官方沒有公告或還沒實測，不推估）。

## 檢查項目

| 項目 | 狀態 | 證據 |
|---|---|---|
| Transport：Streamable HTTP、無狀態、HTTPS | 完成 | `src/server.ts` 的 `createMcpHandler(..., {legacy:"stateless"})`；`http://` 會 301 導向 `https://`，並回 HSTS `max-age=31536000`（2026-09-28 用 curl 實測） |
| MCP 規格：支援 2026-07-28，也支援 2025 系列 | 完成 | `@modelcontextprotocol/server` 2.0.0；`docs/adr/0001-dual-era-and-cache-scope.md`；冒煙測試的 modern 與 legacy 兩代都通過 |
| 驗證：不需登入（公開資料） | 完成 | Directory 的 authentication 文件：「`none` — No authentication (authless server) — Supported by default」 |
| 每支工具都有 `title`，以及 `readOnlyHint`／`destructiveHint` | 完成 | #132；測試「每支工具都有 title、annotations.title，以及 readOnlyHint 與 destructiveHint」；正式環境 tools/list 有 18 個 title |
| 工具名稱不超過 64 字 | 完成 | 同上一項的測試（最長 16 字，例如 `snapshot.futures`） |
| 工具描述：英文為主，寫明來源、更新頻率與限制 | 完成 | #132。eval:ab：opus 35/36 → 36/36、sonnet 36/36 → 36/36。eval:answers ×3：sonnet 33/33；opus 31/33，另 2 題「需人工看」，讀過原文都是答對的 |
| 參數 schema 都有說明、enum、pattern | 完成 | 所有參數都有 `.describe()`（#132 補上 `where[]` 的三個欄位）；`codes` 有 pattern；`scope`、`op`、`order`、`market`、`esg_topics` 都是 enum |
| 單次回傳量在 Claude 上限（約 15 萬字元）內 | 完成 | #130：`dataset.get` 的資料超過 10 萬字元就減少筆數，並附 `size_note`；實測最寬的表 `t187ap03_L` 取 200 筆約 14 萬字元 |
| 錯誤訊息不含 stack trace 或敏感資訊 | 完成 | `errorText` 只保留 `name: message`；訊息裡的網址都是公開 API 網址 |
| 上游保護：timeout、一次重試、User-Agent、並行上限 | 完成 | #130：資料集 25 秒、即時報價 8 秒；網路錯誤、429、5xx 重試一次；UA 是 `TaiwanMarketOpenData/<ver> (+https://twse-mcp.taux.io; dev@taux.io)`；`UPSTREAM_MAX_CONCURRENCY`（預設 3） |
| 上游快取 | 完成 | 資料集用邊緣快取 1 小時（`DATA_TTL_SECONDS`）；即時報價不快取 |
| 上游公告的限流數字 | 待查證 | TWSE OpenAPI 的 swagger 和使用條款、TAIFEX OAS 的 swagger 和使用條款都沒有公告限流數字 |
| 用戶端限速 | 未完成 | 需要你在 Cloudflare 後台設定 WAF 限速規則，步驟見下方。程式裡刻意不做逐 IP 限速：Claude 的請求都來自 Anthropic 的 `160.79.104.0/21` |
| 非官方、無隸屬聲明 | 完成 | #128：五份 README 標題下方、首頁的授權區塊、llms.txt |
| 資料來源與授權的顯名聲明 | 完成 | MCP `instructions`、README、首頁都有 OGDL v1 的顯名聲明，文字照[條款附件](https://data.gov.tw/license)原文 |
| OGDL 是否禁止「暗示機關背書」 | 完成（查證結果：沒有這條） | 條款六(一)「依本條款提供之開放資料，不構成任何資料提供機關申述、保證或暗示其推薦、同意、許可或核准之意思表示」，這是提供機關的免責聲明。條款中沒有禁止使用者暗示背書的規定。我們仍然主動聲明無隸屬 |
| 隱私權政策（可公開存取） | 完成 | #131：<https://twse-mcp.taux.io/privacy>（中英文）、`PRIVACY.md`；正式環境回 200；每天的存活檢查也會打這一頁 |
| 隱私政策與實際行為一致 | 完成 | 用 Observability API 取出一筆真實 log，比對欄位：IP、地理位置、ASN、UA、請求標頭（含 `Mcp-Name`）、URL、狀態碼，不含 body；保存 3 天（[Cloudflare 文件](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)）。向證交所的請求會帶 `CF-Connecting-IP`（[Cloudflare 文件](https://developers.cloudflare.com/fundamentals/reference/http-headers/)；證交所主機是 nginx，期交所在 Cloudflare 上） |
| 不蒐集多餘的對話資料 | 完成 | 程式沒有任何 `console.*`；不記錄請求 body |
| 聯絡方式 | 完成 | dev@taux.io（隱私權政策、首頁頁尾、README）；另有 GitHub Issues |
| 公開文件 | 完成 | README（五種語言）、首頁 <https://twse-mcp.taux.io/>、llms.txt、CHANGELOG |
| LICENSE 與資料授權相容 | 完成 | 程式碼是 MIT；資料依 OGDL v1 另外授權並完整標示，兩者互不衝突 |
| Secrets 沒有外洩 | 完成 | working tree 與 122 個 commit 的歷史都沒有 token 或金鑰；GitHub Actions 只引用 `secrets.*` |
| CORS | 完成 | `Access-Control-Allow-Origin: *`，是 `agents` 的預設值，對不需登入的公開服務合理 |
| `ENABLE_REALTIME_QUOTE` 開關 | 完成 | #129：設成 `false` 時 tools/list 不含 `quote.realtime`（兩代協定都有測試；本機 `wrangler dev --var` 也實測過）。目前設定是 `true` |
| quote.realtime 的授權依據 | 待查證 | mis.twse.com.tw 沒有自己的條款，而[證交所網站使用條款](https://www.twse.com.tw/zh/page/terms/use.html)禁止「透過…自動程式…擷取程式等方式下載本網站之軟體或資料」。詢問信草稿：`docs/upstream-reports/2026-09-28-twse-mis-inquiry.md` |
| 部署後實測 | 完成 | 對正式網址跑一次完整冒煙測試：9 支工具 × 兩代協定、並發、首頁、/privacy，全部通過。MCP Inspector CLI 的 tools/list 列出 9 支工具與 title；`quote.lookup 台積電` → 2330 |
| 單元測試 | 完成 | 443 個通過（`npm test`） |

## 需要你人工處理

1. **寄出給證交所的詢問信**（`docs/upstream-reports/2026-09-28-twse-mis-inquiry.md`，收件窗口【待查證】）。收到回覆前，即時報價是送件時的已知風險。證交所如果不同意：把 `wrangler.jsonc` 改成 `"ENABLE_REALTIME_QUOTE": "false"` 後重新部署。
2. **Cloudflare WAF 限速規則**。免費方案只能有 1 條，以 IP 計數，時間窗與封鎖時間都是 10 秒（[文件](https://developers.cloudflare.com/waf/rate-limiting-rules/)）：
   - Dashboard → taux.io → Security → WAF → Rate limiting rules → Create rule
   - 條件：Hostname equals `twse-mcp.taux.io`，且 URI Path equals `/mcp`
   - 門檻：同一 IP 每 10 秒 100 次，動作 Block，時間 10 秒
   - 門檻刻意放寬：所有 Claude 使用者共用 Anthropic 的出口 IP。近 3 天正式環境只有約 144 次工具呼叫
   - 超限時回應的內容能不能自訂【待查證】
   - 設好後請截圖給我，再把 README 的限速政策補上
3. **git 歷史中的真實姓名與本機名稱**：16 個 commit 的作者欄是 `…@xieyoumindeMacBook-Air-2.local`。改寫歷史會讓 tag 和 fork 失效，建議保留，由你決定。
4. **送件表單**：七項政策聲明要由你本人勾選；資料處理題請照下方的草稿誠實回答。

## 送件資訊草稿

- **Name**（100 字以內）：Taiwan Market Open Data (Unofficial)
- **One-liner**（200 字以內）：Unofficial access to Taiwan Stock Exchange and Taiwan Futures Exchange open data: stock, ETF and futures snapshots, market overview, dividends, ESG and 275 searchable datasets.
- **Description**（2000 字以內）：
  > Taiwan Market Open Data lets Claude answer questions about the Taiwan stock and futures markets from the exchanges' own published data instead of guessing. It covers TWSE-listed stocks and ETFs (profile, previous-day price and volume, valuation, monthly revenue, dividends and ex-dividend dates, attention and disposition status, financial statements, corporate governance, margin trading, ESG disclosures), TAIFEX futures (per-contract prices, open interest, institutional and large-trader positions), a daily market overview with an events calendar, intraday quotes, and a searchable catalog of 275 TWSE and TAIFEX datasets with server-side filtering and sorting.
  >
  > Answers state their data date. After holidays the tools say which days the market was closed, and a failed upstream fetch is reported as "cannot tell", never as "none". Most data is after-close data from the TWSE OpenAPI and TAIFEX OAS, republished under Taiwan's Open Government Data License with the required attribution.
  >
  > This is an unofficial, free, open-source service (https://github.com/taux-io/twse-mcp), not affiliated with or endorsed by TWSE or TAIFEX. It is read-only, needs no account, and is not investment advice.
- **Connector URL**：https://twse-mcp.taux.io/mcp
- **Authentication**：None（authless，公開資料）
- **Privacy policy URL**：https://twse-mcp.taux.io/privacy
- **Documentation**：https://github.com/taux-io/twse-mcp#readme 、https://twse-mcp.taux.io/en
- **Support contact**：dev@taux.io
- **分類建議**：Finance（其次 Data & Analytics）
- **Tools**（全部唯讀、非破壞性）：

  | name | title |
  |---|---|
  | dataset.search | Search datasets |
  | dataset.describe | Describe dataset |
  | dataset.get | Get dataset rows |
  | snapshot.stock | Stock snapshot |
  | snapshot.etf | ETF snapshot |
  | snapshot.market | Market overview |
  | snapshot.futures | Futures contract snapshot |
  | quote.lookup | Look up stock code |
  | quote.realtime | Real-time quote |

- **資料處理題（API 屬誰）**：誠實答「第三方、你無法控制的公開 API」，並說明：
  - TWSE OpenAPI 與 TAIFEX OAS 依政府資料開放授權條款第 1 版公開釋出，本服務依條款轉供並標示出處。
  - `quote.realtime` 取自證交所基本市況報導站的公開查詢介面，不在上述授權範圍內；已去信詢問，而且可以隨時關閉（`ENABLE_REALTIME_QUOTE`）。
- **金融交易**：不涉及。服務只讀取公開資料，不下單、不轉帳、不提供投資建議。
