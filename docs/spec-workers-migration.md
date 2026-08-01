# Spec: twse-mcp 重構為 Cloudflare Workers 遠端 MCP server

> 狀態：ready-for-agent（草案，尚未發為 issue）
> 由 `/grill-me` + `/to-spec` 綜合對話共識產出。

## Problem Statement

現在的 `twse-mcp` 是本機 stdio server，使用者要用它得先 `git clone`、建 venv、`pip install -e .`，再用**絕對路徑**註冊進 Claude Code/Desktop。散佈摩擦高、每台機器都要重來一遍、絕對路徑一錯就連不上。對想「開箱即用查證交所開放資料」的人來說，安裝這關就先勸退一半。維護者也想驗證這個服務能否用最低維運成本長駐上線給多人共用。

## Solution

把 server 改寫成 **TypeScript + Cloudflare Workers 的遠端 MCP server**，以 `createMcpHandler()`（stateless）對外提供 `/mcp` 端點。使用者不再安裝任何東西，只需 `claude mcp add --transport http <url>/mcp` 指向一個 URL 即可使用。資料經由 Cloudflare 邊緣快取，維運者用 `wrangler deploy` 一行上線、幾乎零維運成本。原本的工具行為（目錄搜尋、欄位描述、伺服器端過濾/投影/分頁、ETF 概況）維持對等。

## User Stories

1. 作為一個查詢者，我想只靠一個 URL 就把 server 加進我的 MCP client，這樣我不必安裝 Python、建 venv 或處理絕對路徑。
2. 作為一個查詢者，我想用關鍵字（例如「ETF」「融資」「本益比」）搜尋證交所有哪些資料集，這樣我在取資料前先知道 dataset_id。
3. 作為一個查詢者，我想在搜尋時用分類（tag）過濾，這樣我能在「證券交易」「公司治理」等大類裡快速收斂。
4. 作為一個查詢者，我想讓「ETF」這種直覺關鍵字也能命中「基金基本資料彙總表」這類名稱對不上的表，這樣我不必先懂證交所的命名習慣。
5. 作為一個查詢者，我想查看某個資料集的完整欄位定義，這樣我在取值前知道能過濾/投影哪些欄位。
6. 作為一個查詢者，我想用證券/基金代號取某資料集中某一檔的資料，且系統會自動辨識該表的代號欄位，這樣我不必知道每張表把代號叫什麼。
7. 作為一個查詢者，我想對非代號欄位做子字串過濾（例如 `{"基金類型": "ETF"}`），這樣我能撈出一整類資料。
8. 作為一個查詢者，我想只回傳我指定的欄位，這樣回應精簡、不塞爆上下文。
9. 作為一個查詢者，我想用 limit/offset 分頁，且有硬上限保護，這樣一次呼叫不會把上千筆原始資料全倒回來。
10. 作為一個查詢者，我想在回應裡看到「來源總筆數／符合筆數／本次回傳筆數」的統計，這樣我知道有沒有被截斷、要不要翻頁。
11. 作為一個查詢者，我想一次取得單一上市 ETF 的完整概況（基本資料＋前一交易日價量＋定期定額熱度），這樣我不必自己串三張表。
12. 作為一個查詢者，我想在 ETF 概況裡看到「市值粗估」這類衍生指標，並附上它「不是基金規模」的但書，這樣我不會誤解數字。
13. 作為一個查詢者，我想在任何一段子查詢失敗時，該段標成 null 並附一則 caveat，而不是整個呼叫失敗，這樣我仍能拿到其他有用的部分。
14. 作為一個查詢者，我想在查一檔不在上市基金彙總表的代號時，收到清楚的說明（可能是上櫃 ETF、非基金、或代號有誤），這樣我知道下一步往哪找。
15. 作為一個查詢者，我想拿到的價量數字已正規化（去逗號、`--`/空白轉 null），這樣我能直接拿來計算。
16. 作為一個查詢者，我想每次收到的資料都清楚標示「為前一交易日」，這樣我不會誤把它當即時報價。
17. 作為一個查詢者，我想即使我常查同一張表，回應也很快，這樣我的互動不會被反覆下載大表拖慢。
18. 作為一個維運者，我想用 `wrangler deploy` 一行把服務上線，這樣我不必管伺服器、容器或作業系統。
19. 作為一個維運者，我想服務對證交所的請求走邊緣快取、不會每個使用者請求都打證交所，這樣我對來源有禮貌、也省成本。
20. 作為一個維運者，我想 swagger 目錄在建置期就烘進 bundle，這樣執行期沒有「開機抓 swagger 失敗」這個故障點。
21. 作為一個維運者，我想 `catalog.json` 簽入版本控制，這樣證交所新增/變更資料集時，git diff 直接看得到，且部署不依賴證交所當下活著。
22. 作為一個維運者，我想服務在 v1 先公開、不強制認證，這樣最快讓人試用；認證留待日後需要時再加。
23. 作為一個維運者，我想用 `wrangler deploy --dry-run` 在 CI 當型別/設定檢查，這樣壞掉的部署設定在合併前就被擋下。
24. 作為一個維運者，我想 CI 完全離線跑測試（fixture 取代網路），這樣 CI 不依賴證交所、也不對它發流量。
25. 作為一個既有 Python stdio 使用者，我想舊版本被打上 tag 保存，這樣我需要時仍能 clone 舊 commit 回去用。
26. 作為一個實作者，我想核心資料轉換邏輯與 MCP handler/網路層分離，這樣我能用純函式測試怪癖邏輯、也讓程式好導航。
27. 作為一個維運者，我想在上線第一天就能單獨驗證 Workers 出口能否打到證交所的即時報價站，這樣我提早知道 realtime 這條脆弱鏈可不可行。

## Implementation Decisions

**平台與語言**
- 目標平台：**Cloudflare Workers**（`wrangler deploy`）。放棄原題的 Rust 與 Docker——理由是「最快上線 + 最簡散佈」壓過「練手 Rust」，而 Rust-on-Workers 是最差象限（難、且非正統 Rust）。「練手 Rust」改列日後獨立的 native 專案。
- 語言：**TypeScript**。Python 邏輯近乎 1:1 直譯（`async/await`、`fetch` ≈ `httpx`）。

**MCP 傳輸與 handler**
- 用 **`createMcpHandler()`（stateless）**，端點 `/mcp`，**不使用 Durable Objects**。理由：5 個工具全為唯讀、無跨呼叫 session 狀態。
- v1 **公開、不認證**（代理的是公開唯讀資料）。認證（Cloudflare Access / OAuth）為日後選項。
- 對外契約不變：工具集合維持 `twse_search_datasets` / `twse_describe_dataset` / `twse_get_dataset` / `etf_snapshot`（後更名為 `twse_etf_snapshot`，見 PR #17），回應為 JSON 字串，語意與現行 Python 版對齊。

**目錄（swagger catalog）**
- **建置期**抓 `swagger.json`、轉成精簡 catalog、以靜態 `catalog.json` 打包進 bundle；**執行期零 fetch**。
- `catalog.json` **簽入 repo**，由 `refresh-catalog` 腳本產生。部署不依賴證交所即時可用。
- catalog 條目維持「dataset_id / summary / description / tags / fields(欄位→說明)」結構，供搜尋比對與描述輸出。
- 別名層（alias）保留：讓「ETF/淨值/成分股/股價/配息」等關鍵字命中命名對不上的表。

**資料快取**
- dataset 資料透過 **Cache API 快取出站請求**（`cf: { cacheTtl: 3600, cacheEverything: true }`），過濾/投影/分頁仍於 Worker 內每請求計算。
- **v1 不使用 Workers KV**。跨 colo 一致性需求出現時再引入。
- 原 Python 的 `Semaphore(2)` 併發禮貌，在 stateless 下由「邊緣快取讓來源命中稀少」取代其目的。

**範圍切割**
- v1 出貨 **4 個 OpenAPI 工具**。
- **`etf_snapshot` 的即時報價段：程式已接好，靠 `include_realtime` 預設 `false` 收斂。** 它打的是較脆的 host（`mis.twse.com.tw`；「可能封 Cloudflare 出口 IP」的疑慮**已由上線後的 egress 探測排除**，見 Further Notes），且失敗會**安全降級成 `realtime: null`**、不影響其餘欄位；想用的人自行帶 `include_realtime=true`。（原本列為延後，實作後確認可安全降級，故收進 v1。）
- **獨立的 `twse_realtime_quote` 工具**：上線首日從 Cloudflare 邊緣實測 `mis` egress **已通過**，故已註冊開放（後續工作見 issue #3）。

**Repo 策略**
- **同 repo，TS 取代 Python**。取代前先 `git tag python-stdio-v0.1` 保存現況。移植期暫留 Python 版當 parity 對照組，收尾 commit 移除。
- README 整段改寫：從「pip + venv + 絕對路徑」改為「一個 URL + `--transport http`」。
- CI 由 Python 矩陣改為 Node + Vitest + `wrangler deploy --dry-run`。

**架構分層**
- **純轉換核心**（過濾、投影、分頁邊界、代號欄位自動偵測、數字正規化、`etf_snapshot` 三表合併）抽成獨立、與網路/runtime 無關的模組。
- **MCP handler 與 `fetch` 出站**為薄殼，包在核心外層。

## Testing Decisions

- **好測試的定義**：只測外部可觀察行為，不綁實作細節。對這個 server，外部行為＝「給定一個 MCP `tools/call` 請求 + 一組被 stub 的證交所回應 → 得到預期的工具 JSON 回應」，以及純轉換函式「給定髒輸入 → 得到正規化輸出」。
- **主 seam（最高）：MCP 請求邊界。** 對 Worker 的 `fetch` handler 灌 JSON-RPC `tools/call`，stub 出站 `fetch`（證交所那層），斷言回傳 JSON。內部模組重構不影響此層測試。
- **次 seam（刻意最小的一條）：純轉換函式單元測試。** 專供證交所資料怪癖：數字帶逗號/`--`/空白的正規化、跨不一致命名的代號欄位偵測、過濾/投影/分頁邊界。這些邊界不經由完整 JSON-RPC 封包，直接對純函式測。
- **受測模組**：純轉換核心（於次 seam）、MCP handler 對 4 個工具的接線（於主 seam）。
- **Prior art**：現行 `tests/test_offline.py` 的 29 項離線 fixture 測試——把網路層換成 fixture、測解析/過濾/分頁。這批 case 直接港到 Vitest（純函式者落次 seam、端到端者落主 seam），並沿用其「CI 完全離線」哲學。
- **工具**：plain Vitest + mock `fetch`（不需 `workerd` runtime）。`@cloudflare/vitest-pool-workers` 的 workerd 整合測試列為日後選加，非 v1 阻擋項。

## Out of Scope

- **Rust 實作、Docker（含 dev container）** — 本次完全不做。
- ~~獨立的 `twse_realtime_quote` 工具~~ — 原列延後；上線首日 egress 探測通過後已開放（issue #3），**不再** out of scope。
- **Workers KV、Durable Objects、stateful session** — v1 不引入。
- **認證/授權、速率限制、濫用防護** — v1 公開，日後再加。
- **上櫃/櫃買中心資料** — **已嘗試並回退**，原因不是不想做，而是做不到：櫃買中心會封鎖 Cloudflare 邊緣的出口（詳見 Further Notes 的實測紀錄）。
- **基金淨值/實際基金規模** — 兩家交易所的 OpenAPI 都不提供，維持「市值粗估 + caveats」現狀。
- **每週自動刷新 catalog 的 GitHub Action** — 可選增強，非 v1 必需。

## Further Notes

- **`mis` egress 探測：已完成，結果為通過。** 這原本是整份 spec 唯一可能逼架構改變（需台灣落地 proxy）的風險點，現已解除：
  - **方法修正**：原訂用 `wrangler dev` 探測是**錯的**——它走的是開發者本機 IP，驗不到 Cloudflare 邊緣的出口。實際必須**先部署**，再從線上 Worker 發出請求。
  - **結果**：部署到 `https://twse-mcp.taux.io/mcp` 後，`etf_snapshot("0056", include_realtime=true)` 與 `twse_realtime_quote(["0050","0056","2330"])` 皆回傳真實報價（例：0056 last 48.19 @ 13:30:00），`wrangler tail` 全程 `Ok`、無任何 fetch 例外。`openapi.twse.com.tw` 出站亦正常。
  - **結論**：Cloudflare 邊緣未被 `mis.twse.com.tw` 封鎖，獨立的 `twse_realtime_quote` 工具因此解禁並註冊（issue #3）。此結論屬**觀測值而非保證**——對方是非官方網頁介面、無服務條款背書，日後仍可能改變；屆時的降級路徑是 `realtime: null` + caveat，不會使工具整體失效。
- **櫃買中心（TPEx OpenAPI）egress 探測：已完成，結果為失敗，功能因此回退（PR #13 → 回退）。**
  - **動機**：櫃買中心也有 swagger（225 個資料集），照理能沿用「catalog 當資料」的架構，不必新增工具就涵蓋上櫃。實作完成、62 項測試通過、且從開發機實測 `00679B`（元大美債20年）可正確解析為「上櫃」。
  - **失敗**：部署後從 Cloudflare 邊緣呼叫，`www.tpex.org.tw` 把請求整串導向 `/errors`，fetch 拋 `TypeError: Too many redirects`。試過補正常 `User-Agent`（改善為 HTTP 502）、再加 `Referer` 與 `Accept-Language`（退回重導迴圈）——**任何標頭組合都無效，是 IP 層阻擋**。
  - **對照證據**：同一個 endpoint 從台灣 HiNet 出口（AS3462）回 HTTP 200 正常資料；Cloudflare 邊緣則被擋。結論是**櫃買中心封鎖非台灣／機房 IP**。
  - **與 `mis` 的對比**：兩者都是「雲端出口能不能取用」的同一類風險。`mis` 過關、櫃買中心沒過——所以這個風險**必須逐一實測，不能從任何一次的成功外推**。
  - **教訓（重蹈覆轍的紀錄）**：合併前只做了開發機驗證，而本 spec 早已寫明開發機驗不到邊緣出口。**任何新增外部資料源，都應在合併前先用 `wrangler dev --remote`（在真實邊緣執行、但不動到正式服務）驗證出站**。
  - **唯一可行的解法**：架設台灣落地 proxy。Workers 無法指定出口地區，而 proxy 會引入機器與維運成本，與本專案「零維運」的前提相衝，故暫不採用。
  - **但上櫃不是全滅**：被擋的只有櫃買中心的 OpenAPI（`www.tpex.org.tw`）。`mis.twse.com.tw` 沒被擋，而它支援 `market="otc"`，所以**上櫃標的的盤中即時報價仍可正常取得**——已於線上驗證：`twse_realtime_quote(["00679B","6488"], market="otc")` 正確回傳元大美債20年與環球晶的報價。缺的是上櫃的**歷史／彙總類資料集**，不是上櫃本身。
- **成本**：Workers 與 Cache API 免費額度對此用量綽綽有餘，預期 $0。
- **散佈轉變**：價值主張從「安裝一個本機二進位」變成「指向一個 URL」，README 需據此重寫，並提供 client 端 `claude mcp add --transport http` 範例。
- **catalog 漂移監控**：因 `catalog.json` 簽入，證交所端資料集增刪/欄位變更會以 git diff 形式浮現，構成被動監控；可選掛每週 Action 自動開 PR。
- 對應 triage：日後若發為 issue，貼 `ready-for-agent` 標籤（該 label 目前不存在，需先建立）。
