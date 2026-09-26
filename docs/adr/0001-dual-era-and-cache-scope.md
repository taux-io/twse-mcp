# 同時服務兩個協定 era，並把工具清單標成公開可快取

MCP 的 `2026-07-28` 修訂版是破壞性改版（取消 `initialize` 交握與 session，改為每個請求
自帶 `_meta` envelope），但本專案跨過它時**幾乎沒有動到程式碼**。這份 ADR 記錄三件在
原始碼裡看不出來的事：合規責任落在哪一層、`cacheScope: "public"` 的依據與失效條件、
以及 legacy lane 為什麼開過、又為什麼在 2026-09-26 關掉。

> **狀態（2026-09-26）**：已做 era 收斂，只服務 modern（`2026-07-28`）。第三節記錄依據。
> 檔名與標題保留「dual-era」，因為第一、二節描述的機制與失效條件仍然成立。

詞彙（協定 era／協定修訂版／lane／era 收斂）見 [`CONTEXT.md`](../../CONTEXT.md)。

## 一、為什麼零協定程式碼就已經合規

`2026-07-28` 對 server 有一批強制義務——`server/discover`（每個 server 都 MUST 實作）、
每個結果帶 `resultType`、可快取結果帶必填的 `ttlMs`/`cacheScope`、capability 宣告——
**全部由 MCP SDK 自動履行**。工具註冊與回應建構的程式碼在兩個 era 完全相同，
不需要任何 era 分支。

兩個關鍵事實，讀本專案的原始碼完全看不出來：

- **era 判定是純 claim-based**：請求的 `params._meta` 裡有沒有協定版本這個保留鍵，
  就這一個訊號。標頭只做交叉驗證，本身不決定 era；`initialize`、批次、通知等只影響
  分類理由，不影響那個單一訊號的地位。
- **lane 策略完全由 `agents` 這層相依決定**：它強制底層 SDK 進入 modern-only 模式
  （`legacy: "reject"`），再自行實作一條 legacy lane。本專案的程式碼對此沒有發言權。

因此 `agents` 被**釘成確切版本**而非 range——它的次版本足以改變對外協定行為。
同理，合規性由主 seam 的測試守住，不由「讀過相依的原始碼」守住（收斂前兩個 era 各跑一遍；
收斂後工具測試走 modern，另有測試斷言 legacy 被拒）。

> 這個結論來得不直觀，過程中兩個方向相反的假設都被推翻過：先是「相依升級了所以沒事」
> （讀規範原文後推翻——確實有一批 MUST），再是「所以我們大概不合規」（讀 SDK 實作後
> 推翻——義務都被履行了）。**規範原文與相依實作要兩邊都讀**，只讀一邊會得到方向相反
> 但同樣錯誤的結論。

## 二、`cacheScope: "public"` 的依據，與它何時會變成錯的

SDK 的預設是 `ttlMs: 0` + `cacheScope: "private"`——合規，但等於告訴每個 client
「這份工具清單完全不可快取、且只有你能存」。本服務的工具寫死在程式碼裡，
執行期永不改變，這個預設是最壞值。

改為 `tools/list`、`prompts/list` 與 `server/discover` 皆 `ttlMs: 3_600_000`（1 小時）、
`cacheScope: "public"`。

`prompts/list` 是後來才加的（三個零安裝入口），套用同一組值而非重新推導：它與 `tools/list`
是同一種東西——寫死在原始碼裡、執行期永不改變、所有請求者拿到同一份。少了它就會吃 SDK
預設，而那個不一致本身會變成下一個讀這段程式的人的疑問。下面的失效觸發條件對它一體適用，
`test/server.test.ts` 也給了它一條與 `tools/list` 對等的 `Authorization` 絆線。

- **`public` 的依據**：服務公開、不認證、所有請求者拿到同一份清單。這是對真實可見度的
  誠實描述。規範明訂這個欄位**不得**當作存取控制使用，此處也不作此用。
- **1 小時而非更長**：清單執行期永不改變，理論上可以設得更長；但工具描述是本專案最常
  微調的東西，把「線上說法與 repo 不一致」的窗口壓在 1 小時內，比多拿一點快取效益值得。

### 收斂前的實際效益是零（2026-09-26 起生效）

> era 收斂後所有流量都在 modern lane，這組值從此對每個 client 生效。以下保留收斂前的
> 紀錄，說明它為什麼曾經「設了卻沒作用」。

**這組值只在 modern lane 生效，而當時已知的主要 client 在 legacy lane。**

2026-08-09 對線上服務的端對端實測（見 issue #51）：Claude Code `2.1.226` 送出的是
`mcp-protocol-version: 2025-11-25`、沒有 `_meta` envelope claim，被判為 legacy。
而 2025 的編碼路徑**沒有快取欄位**——`ttlMs`/`cacheScope` 根本不會出現在它收到的回應裡。

所以這個改動現在**一個 client 都沒有受益**。它不是錯的：modern client 一出現就會生效，
而 SDK 的保守預設對一個公開唯讀服務本來就是最壞值。但別把它讀成「已經在發揮作用」——
它是為了將來，不是為了現在。

這也是為什麼上面那條「1 小時而非更長」的取捨目前不會咬到任何人：沒有 client 在快取這份
清單。同一次實測裡觀察到的過期 `tools/list` schema 與快取無關，那是 client 從連線建立
起就持有初次清單，跟 `ttlMs` 是兩回事。

era 收斂之後（見第三節）這一節要重讀：屆時所有流量都在 modern lane，這組值才會真的作用，
而「1 小時」這個選擇也才會第一次被實際檢驗。

### ⚠️ 失效觸發條件

有**三**件事會讓這組值從誠實變成錯的。前兩件影響 `server/discover`，第三件最嚴重。

**1. era 收斂。** `server/discover` 的回應帶著 `supportedVersions`；收斂若改變它，共享快取
會繼續發送舊的探索文件最久一小時。**2026-09-26 實際收斂時沒有觸發**：收斂前後
`supportedVersions` 都是 `["2026-07-28"]`（legacy 從來不經過 discover），所以不需要先調低
`ttlMs`。這條留著給日後新增修訂版時參考。

**2. 相依升版。** 本 ADR 第一節說明了 `agents` 被釘死的理由是「它的次版本足以改變對外
協定行為」。同一句話的推論是：任何一次升版都可能改變 `supportedVersions` 或 `capabilities`，
而快取的失效窗口一樣是一小時。

**這兩件的處理方式相同**：部署前先把 `server/discover` 的 `ttlMs` 調低（或暫時歸零），
部署後過了舊 TTL 再調回來。

新增或改名 prompt 時同理：舊的 `prompts/list` 最久會被共享快取多發送一小時，
於是 client 的斜線選單裡短暫留著一個已經不存在的指令。

**3. ⚠️ 導入認證——這件最嚴重，而且是安靜地錯。** 屆時不同的請求者可能看到不同的工具清單，
而 `public` 會讓共享快取跨授權情境重用回應。**不會有任何錯誤訊息。**

`docs/spec-workers-migration.md` 的 Implementation Decisions 一節明載「v1 **公開、不認證**
（代理的是公開唯讀資料）。認證（Cloudflare Access / OAuth）為日後選項」，同一份文件的
User Story 22 也記了同一件事。（該節是無編號的條列，不要照「決策 #N」去找。）
這份 ADR 存在的主要理由就是這一條：讓那個「日後」發生時，有人記得回頭看這個值。

程式碼裡也埋了一道絆線：`test/server.test.ts` 有一條測試斷言「帶不帶 `Authorization`
標頭拿到的回應位元組相同」。導入認證會讓它變紅，而紅的地方就指回這裡。

## 三、era 收斂：legacy lane 在 2026-09-26 關閉

收斂前本服務是 dual-era：帶 envelope 的流量走 modern lane，其餘走 legacy lane。
當時沒有收斂，是因為服務公開、不認證，不知道誰在用；關掉 legacy lane 等於盲切。
於是先量測：臨時探針（issue #36）記錄每個請求的協定版本**標頭**而非 era（分類為
legacy 的理由有六種，只拿得到最終值會系統性高估 legacy），判讀時**按值分類**，
不按「是否為 null」（2025 client 依規範必送版本標頭，按 null 數會把它們算成 modern）。

### 量測結果（issue #51）

Cloudflare Workers Observability，篩 `tag = "mcp-client-probe"`，2026-09-26 約 08:43（GMT+8）查詢：

| `protocolVersion` | 過去 1 小時 | 過去 24 小時 |
|---|---|---|
| `2026-07-28`（modern） | 115（52.3%） | 290（47.0%） |
| `2025-11-25` | 56 | 98 |
| `2025-06-18` | 18 | 31 |
| `1999-01-01`（異常值） | 0 | 1 |
| 沒有這個欄位 | 31 | 197 |
| **legacy 合計** | **105（47.7%）** | **327（53.0%）** |
| 總筆數 | 220 | 617 |

- 7 天的查詢只回 411 筆（少於 24 小時的 617），推測是方案的保留期或抽樣，未採用。
- 有一部分是 liveness 監測 bot（1 小時內 `SentinelOracle` 30 筆、`mcpbeat` 16 筆）。
- **`claude-code/*` 全部已是 modern**——8 月實測時它還送 `2025-11-25`，這是收斂前後最大的變化。

**合併前的定點實測**（2026-09-26 約 09:01，GMT+8）：維護者從 claude.ai 網頁版連接器
與 Claude Desktop 各發一次查詢，同時段 15 筆探針記錄中：

| user agent | `protocolVersion` |
|---|---|
| `Claude-User`（claude.ai 網頁版連接器，README 的主要安裝路徑） | `2026-07-28` |
| `claude-code/2.1.281 (claude-desktop, …)` | `2026-07-28` |
| `claude-code/2.1.282 (cli)` | `2026-07-28` |
| `python-httpx2/2.7.0` | `2025-11-25` |
| `Python/3.11 aiohttp/3.14.3` | （無此欄位） |

Anthropic 自家的三個 client 全部是 modern；同時段的 legacy 請求全部來自 Python 腳本。
這把收斂的影響範圍從「約半數請求」縮小到「自己寫腳本、用舊版 SDK 的呼叫者」——
他們收到 -32022 後升級 SDK 即可。

### 決定

**原本寫下的收斂條件沒有成立**（「不再有非 modern 的請求，持續一段足以涵蓋低頻使用者的期間」）：
legacy 仍約占一半。**維護者仍決定收斂**，理由是本服務最主要的 client 已經跟上，
而維持 legacy lane 的代價是持續的：一條只有它自己需要的批次扇出守衛、一支每請求寫 log 的
探針、以及 `cacheHints` 對半數流量無效。這是有意識地接受「約半數請求會開始被拒」的取捨，
不是條件成立後的例行關閉。

實作：`createMcpHandler(createServer, { legacy: "reject" })`。legacy 請求收到 `400` 與
規範定義的 `-32022 Unsupported protocol version`，附 `supported: ["2026-07-28"]`，
client 看得出是版本問題而不是服務故障。

連帶移除：
- **探針**（`logClientProbe` 與其測試）。`wrangler.jsonc` 的 observability 設定保留。
- **批次扇出守衛**（`batchTooLarge`）。JSON-RPC 批次只存在於 legacy，收斂後在分派前就被
  整批拒絕；`test/server.test.ts` 以「275 元素批次零出站」斷言守著這件事。
  出站層的並行上限（`MAX_CONCURRENT_FETCHES`）保留，它管的是同一 isolate 裡的多個 modern 請求。

### 若要回頭

把 `legacy: "reject"` 拿掉即恢復 dual-era（`agents` 預設是 `"stateless"`）。但要一併評估
批次扇出：屆時必須把 `batchTooLarge` 之類的守衛加回來，否則 #70 修掉的 OOM 會回來。

## Consequences

- `agents` 釘死後不再自動拿到修補更新，需要人工升版；升版時主 seam 的測試是安全網，
  其中「legacy 請求被拒」那組守的是收斂不會被預設值的變動悄悄撤銷。
- 工具描述的修改最久要 1 小時才會反映到有快取的 client 上。
- 探針已在 era 收斂時移除（見第三節）。
- 收斂後，送 2025 修訂版的 client 一律被拒，直到它們更新。
