# TWSE OpenAPI MCP Server

把臺灣證券交易所 OpenAPI (`https://openapi.twse.com.tw/v1`) 包成 **遠端 MCP server**，
跑在 Cloudflare Workers 上。使用者不必安裝任何東西，指向一個 URL 即可。

> **v0.2 起改為 TypeScript + Cloudflare Workers（遠端 HTTP）。**
> 舊的 Python 本機 stdio 版保存在 tag [`python-stdio-v0.1`](../../releases/tag/python-stdio-v0.1)，
> 需要時 `git checkout python-stdio-v0.1` 即可取回。

## 使用（連到已部署的 server）

遠端 streamable-http MCP，端點是 `/mcp`：

```bash
claude mcp add twse --transport http https://twse-mcp.<your-subdomain>.workers.dev/mcp
claude mcp list          # 應顯示 ✔ Connected
```

想在所有專案都能用加 `--scope user`；要跟團隊共用用 `--scope project`（寫進 `.mcp.json`）。

Claude Desktop 則在 `claude_desktop_config.json` 加：

```json
{
  "mcpServers": {
    "twse": {
      "type": "http",
      "url": "https://twse-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

## 工具

| Tool | 用途 |
|---|---|
| `twse_search_datasets` | 依關鍵字／分類搜尋有哪些資料集 |
| `twse_describe_dataset` | 看某資料集的完整欄位定義 |
| `twse_get_dataset` | 取資料，支援 code／match 過濾、欄位投影、分頁 |
| `etf_snapshot` | **單一 ETF 完整概況**：基本資料＋當日價量＋定期定額熱度，一次回傳 |
| `twse_realtime_quote` | 盤中即時報價（`mis.twse.com.tw`，約 5 秒更新；`market` tse／otc） |

一般探索用三段式：`search` 找 dataset_id → `describe` 確認欄位 → `get` 帶條件取值。
已知是 ETF 就直接 `etf_snapshot("0056")`。

### etf_snapshot

並行查三張表（`t187ap47_L`／`STOCK_DAY_ALL`／`ETFRank`）再合併：

```json
{
  "code": "0056", "name": "元大高股息", "is_etf": true,
  "profile":  { "追蹤指數": "臺灣高股息指數", "上市日期": "0961226",
                "發行單位數": "30,000,000,000" },
  "quote":    { "日期": "20260727", "收盤": 38.2, "漲跌幅%": 0.79,
                "成交股數": 44120000 },
  "realtime": null,
  "regular_savings": { "排名": "2", "交易戶數": 380000 },
  "derived":  { "市值粗估_億元": 11460.0 },
  "caveats":  [ "市值粗估 = 發行單位數 × 收盤價，不是基金規模..." ]
}
```

任何一段查不到都是 `null` + 一則 caveat，不會整個失敗。常見情況：上櫃 ETF 不在
`STOCK_DAY_ALL`、小型 ETF 不在定期定額排行榜、代號其實不是 ETF。
`include_realtime`（預設 `false`）可附上盤中報價 —— 見下節。

## 即時報價

`twse_realtime_quote` 與 `etf_snapshot` 的即時段打的是 `mis.twse.com.tw`（基本市況報導站），
和 OpenAPI 不同 host、約 5 秒更新。這條路曾因「可能封 Cloudflare 出口 IP」在早期延後，
**部署後從真實邊緣實測已確認可通**（見「開發」一節的「即時報價探測」），故已全面開放。

`etf_snapshot` 的 `include_realtime` 仍預設 `false`（多一次外呼），需要當下價格時帶 `true`；
出站若失敗會安全降級成 `realtime: null`，不影響其餘欄位。

## 開發

```bash
npm install
npm test              # 45 項離線測試（stub 掉出站 fetch，不需連證交所）
npm run refresh-catalog   # 重新從證交所 swagger 產生 src/catalog.generated.json
npm run dry-run       # wrangler bundle + 設定檢查（不部署）
npm run dev           # 本機 wrangler dev
```

部署：

```bash
npm run deploy        # wrangler deploy
```

**即時報價探測（開放 realtime 前必做）：** `mis` 是否封 Cloudflare 出口 IP，
只有從真正的 Cloudflare 邊緣才驗得出來 —— 本機 `wrangler dev` 用的是你自己的 IP，
測不準。因此請先 `npm run deploy`，再從線上 Worker 打一發 `mis.twse.com.tw`，
確認通了再把 realtime 工具接上。

## 架構

- **語言／平台**：TypeScript on Cloudflare Workers，stateless streamable-http，
  用 `createMcpHandler`（`agents/mcp/server`），端點 `/mcp`，**不需 Durable Objects**。
- **目錄烘進 bundle**：`npm run refresh-catalog` 在建置期把證交所 swagger 轉成
  `src/catalog.generated.json` 並簽入版控。執行期零 fetch、無「開機抓 swagger 失敗」，
  且證交所改欄位時 git diff 直接看得到。
- **資料快取走 Cache API**：對證交所的出站請求用 `cf: { cacheTtl, cacheEverything }`
  邊緣快取（資料一天才更新一次）。v1 不用 KV。
- **純核心 + 薄殼分層**：`src/core.ts` 是與網路/runtime 無關的純轉換（過濾/投影/分頁/
  代號偵測/數字正規化/etf 合併），`src/twse.ts`（出站）與 `src/server.ts`（MCP 接線）
  是薄殼。測試主要打這兩個 seam（見 `test/`）。

### 設計筆記

**為什麼不一個 endpoint 一個 tool。** 證交所有 100+ 個 endpoint，全部展開成 tool
會塞爆 context window，且工具名長得都一樣（`t187ap46_L_1` 到 `_21`），模型反而選不出。
這裡把 swagger 當資料，只暴露泛用工具。

**為什麼過濾一定要在 server 端做完。** 證交所所有 endpoint 都不吃參數，一次回整份
資料集。`STOCK_DAY_ALL` 是 1000+ 檔股票，直接丟回模型是幾萬個 token。所以
`twse_get_dataset` 先過濾投影分頁，並回報 `rows_in_source` / `rows_matched`，
讓模型知道自己只拿到一部分。

**代號欄位命名不一致。** 同樣是證券代號，各表分別叫 `Code`、`公司代號`、`基金代號`、
`ETFsSecurityCode`、`SecurCode`。`CODE_FIELDS` 做自動偵測。

**別名表。** 證交所表名不直覺，ETF 主檔叫「基金基本資料彙總表」，搜 "ETF" 搜不到。
`ALIASES` 補這一層，可以自己加。

**聚合型工具要並行 + 降級。** `etf_snapshot` 用 `Promise.allSettled` 同時抓三張表：
其中一張掛掉仍回傳其他兩張，把失敗記進 `caveats`。單一資料源出問題不該讓整個工具無法使用。

**不要幫模型算它算不出的東西。** 折溢價需要淨值，證交所 OpenAPI 沒有淨值，
所以不提供折溢價。`市值粗估` 是用收盤價而非淨值算的，因此明確標成粗估並附 caveat ——
讓模型知道哪些數字不能當真，比默默給出錯誤數字重要。

## 已知限制

- OpenAPI 只有前一交易日到前一個月的資料；盤中即時報價走 `twse_realtime_quote`。
- `mis.twse.com.tw` 是網頁背後的 API，沒有服務條款保證、會擋高頻請求，且可能封雲端出口 IP。
- 上櫃資料要另接櫃買中心 TPEx OpenAPI，欄位命名跟證交所不一致，要另寫一組 parser。
- ETF 淨值與成分股（PCF）不在證交所 OpenAPI 裡，得逐家投信爬。
