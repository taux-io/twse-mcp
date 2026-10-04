# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要讀者：台灣的一般投資人。他們不寫程式，想讓 Claude、ChatGPT 等 AI 助理查得到台股資料。
來首頁是為了照著步驟，把這個 connector（`https://twse-mcp.taux.io/mcp`）加進自己用的 AI。
之後他們用中文向 AI 提問，不會再回到首頁。

次要讀者是開發者，從 README、`llms.txt` 或 MCP 目錄（Smithery、MCP Registry、Claude Directory）找到這裡。首頁不以他們為主。

## Product Purpose

把臺灣證券交易所、臺灣期貨交易所的公開資料包成遠端 MCP 服務，讓 AI 回答台股與期貨問題時，依據交易所自己發布的資料，不再憑印象猜。
首頁的成功標準：一般投資人讀完能自己把 connector 加好，並且知道這個服務能查什麼、不能查什麼。

## Positioning

- **資料來自交易所**：資料取自證交所 OpenAPI、期交所 OAS，依政府資料開放授權條款轉供，並標示出處。
- **免費、免登入、開源**：不需要帳號或金鑰。程式碼以 MIT 授權公開在 <https://github.com/taux-io/twse-mcp>。
- **資料範圍廣**：
  - 個股、ETF、期貨快照與市場總覽；
  - 股利、ESG；
  - 可搜尋的 275 個資料集；
  - 從 2026-09-29 開始累積的每日行情存檔。

## Operating Context

- 安裝方式是把 connector URL 貼進 AI 用戶端（claude.ai、Claude Code、ChatGPT 等）。之後所有互動都發生在 AI 對話裡，首頁不提供查詢介面。
- 首頁是 Worker 用 TypeScript 樣板字串產生的 HTML（`src/site.ts`）：
  - 繁中在 `/`，英文在 `/en`；
  - 另有 `/privacy`、`/llms.txt`、`/og.png`。
- README 有五種語言，`npm run check-readmes` 會檢查各語言版本的結構是否一致。

## Capabilities and Constraints

- **工具**（9 支，全部唯讀）：
  - `dataset.search`、`dataset.describe`、`dataset.get`；
  - `snapshot.stock`、`snapshot.etf`、`snapshot.market`、`snapshot.futures`；
  - `quote.lookup`、`quote.realtime`。
- **資料時效**：
  - 大多是前一交易日收盤後的資料。
  - 只有 `quote.realtime` 是盤中即時報價。它的來源是 mis.twse.com.tw，不在 OGDL 授權範圍內，可以用 `ENABLE_REALTIME_QUOTE` 關閉。
- **查不到的資料**：
  - 上櫃股票只有盤中即時報價，沒有歷史與統計資料。
  - 選擇權快照目前不提供。
- **必須遵守的約束**：
  - **中英雙語**：首頁同時維護繁中與英文兩版。
  - **首頁要輕**：服務跑在 Cloudflare Workers 免費方案，每個請求只有 10ms CPU（見 #104），首頁不能變重。
- **法遵上必須保留的內容**：
  - OGDL v1 的顯名聲明。
  - 「與證交所、期交所無隸屬」的聲明。Directory 的上架名稱就是 "Taiwan Market Open Data (Unofficial)"。
  - 「不構成投資建議」的聲明。
  - 隱私權政策連結與聯絡信箱 dev@taux.io。
- **使用者沒有列為硬性約束的現況**：
  - 首頁唯一會執行的腳本是一鍵複製（`COPY_SCRIPT`，CSP 以 SHA-256 放行，沒有腳本時退回全選），其餘只有 JSON-LD。
  - 深淺色主題靠 `prefers-color-scheme` 切換。

## Brand Commitments

- 名稱：Taiwan Market Open Data (Unofficial)，伺服器識別碼是 `taiwan-market-open-data`。網域 `twse-mcp.taux.io` 與 repo 名稱都不改。
- 由 taux.io 開發維運。
- 中文行文遵守 `CONTEXT.md` 的詞彙表。例如寫「證交所」，不寫「TWSE」；寫「上櫃」，不寫「OTC」。

## Evidence on Hand

- **已上架或送審的目錄**：
  - Smithery（taux/twse，品質分數 100）；
  - MCP Registry（`io.github.taux-io/twse-mcp`）；
  - awesome-remote-mcp-servers（PR #729 已合併）；
  - Claude Directory 審核中。
- **既有素材**：五種語言的 README、`CHANGELOG.md`、`og.png`、`PRIVACY.md`、`docs/adr/`。
- **沒有的素材，不得捏造**：使用者見證、使用量數字、媒體報導、合作夥伴。

## Product Principles

1. 一般投資人看得懂、做得到，優先於技術完整。
2. 只說資料做得到的事：寫明資料日期、來源與限制，不誇大即時性或涵蓋範圍。
3. 免費、免登入是承諾，不是試用期。
4. 輕量優先：任何新增都要放在 10ms CPU 的預算內考量。
