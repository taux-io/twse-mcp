# TWSE OpenAPI MCP Server

把臺灣證券交易所 OpenAPI (`https://openapi.twse.com.tw/v1`) 包成 MCP server。

## 安裝

```bash
git clone https://github.com/<ORG>/twse-mcp.git && cd twse-mcp
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python tests/test_offline.py    # 29 項離線測試，不需連網
```

先確認能單獨啟動（停住等 stdin 就是正常的，Ctrl-C 離開）：

```bash
.venv/bin/twse-mcp
```

## 註冊到 Claude Code

本機 stdio server，`--` 後面是啟動指令：

```bash
claude mcp add twse -- /absolute/path/to/twse-mcp/.venv/bin/twse-mcp
claude mcp list          # 應顯示 ✔ Connected
```

一定要用絕對路徑。Claude Code 啟動子行程時的 shell 環境跟你的終端機不同，
用相對路徑常常會找不到。

想在所有專案都能用就加 `--scope user`；要跟團隊共用就 `--scope project`
（寫進 repo 根目錄的 `.mcp.json`）。

## 註冊到 Claude Desktop

編輯 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "twse": {
      "command": "/absolute/path/to/twse-mcp/.venv/bin/twse-mcp"
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
| `twse_realtime_quote` | 盤中即時報價（mis.twse.com.tw，約 5 秒更新） |
| `etf_snapshot` | **單一 ETF 完整概況**：基本資料＋當日價量＋定期定額熱度，一次回傳 |

一般探索用三段式：`search` 找 dataset_id → `describe` 確認欄位 → `get` 帶條件取值。
已知是 ETF 就直接 `etf_snapshot("0056")`。

### etf_snapshot

並行查三張表（`t187ap47_L`／`STOCK_DAY_ALL`／`ETFRank`）再合併：

```json
{
  "code": "0056", "name": "元大高股息", "is_etf": true,
  "profile":  { "追蹤指數": "臺灣高股息指數", "上市日期": "0961226",
                "發行單位數": "30,000,000,000", ... },
  "quote":    { "日期": "20260727", "收盤": 38.2, "漲跌幅%": 0.79,
                "成交股數": 44120000, ... },
  "realtime": [ { "last": "38.45", "time": "13:30:00" } ],
  "regular_savings": { "排名": "2", "交易戶數": 380000 },
  "derived":  { "市值粗估_億元": 11460.0 },
  "caveats":  [ "市值粗估 = 發行單位數 × 收盤價，不是基金規模..." ]
}
```

任何一段查不到都是 `null` + 一則 caveat，不會整個失敗。常見情況：上櫃 ETF 不在
`STOCK_DAY_ALL`、小型 ETF 不在定期定額排行榜、代號其實不是 ETF。
`include_realtime=False` 可略過盤中報價。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `TWSE_MCP_CACHE` | `~/.cache/twse-mcp` | swagger 快取位置 |
| `TWSE_MCP_TTL` | `3600` | 資料快取秒數 |

## 設計筆記

**為什麼不一個 endpoint 一個 tool。** 證交所有 100+ 個 endpoint，全部展開成 tool
會塞爆 context window，而且工具名稱長得都一樣（`t187ap46_L_1` 到 `_21`），模型
反而選不出正確的。這裡把 swagger 當資料，只暴露 4 個泛用工具。

**為什麼過濾一定要在 server 端做完。** 證交所所有 endpoint 都不吃參數，一次回整份
資料集。`STOCK_DAY_ALL` 是 1000+ 檔股票、11 個欄位，直接丟回模型大概是幾萬個
token。所以 `twse_get_dataset` 一定要先過濾投影分頁，並且回報 `rows_in_source` /
`rows_matched`，讓模型知道自己只拿到一部分。

**代號欄位命名不一致。** 同樣是證券代號，各表分別叫 `Code`、`公司代號`、`基金代號`、
`ETFsSecurityCode`、`SecurCode`。`CODE_FIELDS` 做自動偵測。

**別名表。** 證交所表名不直覺，ETF 主檔叫「基金基本資料彙總表」，搜 "ETF" 搜不到。
`ALIASES` 補這一層，可以自己加。

**聚合型工具要並行 + 降級。** `etf_snapshot` 用 `asyncio.gather` 同時抓三張表，
並用 `return_exceptions=True`：其中一張掛掉時仍回傳其他兩張，把失敗記進 `caveats`。
單一資料源出問題不該讓整個工具無法使用。`_get_rows` 有 per-dataset 鎖，
並行呼叫時同一張表只會下載一次。

**不要幫模型算它算不出的東西。** 折溢價需要淨值，證交所 OpenAPI 沒有淨值，
所以 `etf_snapshot` 不提供折溢價。`市值粗估` 是用收盤價而非淨值算的，
因此明確標成粗估並附 caveat —— 讓模型知道哪些數字不能當真比默默給出錯誤數字重要。

**Swagger 延遲載入。** 不要在 import 時抓網路，Claude Code 預設 30 秒啟動 timeout。
這裡在第一次呼叫 tool 時才載入，並落地快取，證交所掛掉時可退回舊快取。

## 已知限制

- OpenAPI 只有前一交易日到前一個月的資料。要當日盤後用
  `www.twse.com.tw/rwd/...`，要盤中用 `twse_realtime_quote`。
- `mis.twse.com.tw` 是網頁背後的 API，沒有服務條款保證，會擋高頻請求。
- 上櫃資料要另接櫃買中心 TPEx OpenAPI，欄位命名跟證交所不一致，要另寫一組 parser。
- ETF 淨值與成分股（PCF）不在證交所 OpenAPI 裡，得逐家投信爬。
