# AGENTS.md

台股資料 MCP server。給任何 AI 代理讀的專案慣例；
使用說明看 [README.md](README.md)，詞彙定義看 [CONTEXT.md](CONTEXT.md)，
決策與實測紀錄看 [docs/spec-workers-migration.md](docs/spec-workers-migration.md)，
架構決策看 [docs/adr/](docs/adr/)——那裡有活的操作約束（例如導入認證前必須重新評估
`cacheScope`），不是純歷史。

## 更新紀錄

使用者看得到的改動，合併時寫進 `CHANGELOG.md` 與 `CHANGELOG.en.md` 的「尚未編號」一節；
升版時把那一節改成版本號與日期。只寫對使用者的影響，不寫內部重構。
`npm run check-readmes` 會擋下 `package.json` 版本在兩份 CHANGELOG 裡沒有對應一節的情況。

## Agent skills

### Issue tracker

Issues 存放在 GitHub（`taux-io/twse-mcp`），以 `gh` CLI 操作。見 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五個標準標籤，字串與角色同名。見 `docs/agents/triage-labels.md`。

### Domain docs

Single-context：根目錄一份 `CONTEXT.md`，ADR 放 `docs/adr/`。見 `docs/agents/domain.md`。

### Ponytail checkpoints

commit 前、接手或重構前、每週或階段結束，各跑一個 ponytail 過度工程檢查。
時機、標記慣例，以及這個 repo 的防禦性守衛為什麼不算冗餘，見 `docs/agents/ponytail.md`。

### Tool-selection eval

改工具描述、`instructions` 或新增工具之前與之後，各跑一次 `npm run eval:tools`，比較通過題數。
預設用本機的 Claude Code（`claude -p`，走訂閱額度，不產生 API 帳單）；至少再用 `EVAL_MODEL=sonnet` 跑一次——
2026-09-26 的基準是 opus 24/24、sonnet 修正描述前 21/24，較小的模型才抓得到描述寫得不夠清楚的地方。
題目在 `evals/tool-selection.json`，只看第一個工具呼叫；測本機未部署的描述用 `EVAL_ENDPOINT=http://localhost:8787/mcp`。
用法見 `scripts/eval-tools.mjs` 開頭；PR 範本（`.github/pull_request_template.md`）有對應的欄位要填。

**單跑一次不能判定退步。** 模型本身有隨機性：2026-09-26 實測 sonnet 對「殖利率前 10 檔」在**正式環境**
重跑 8 次只過 6 次。改動後出現失敗題，用 `EVAL_ONLY=<題目>` 在正式環境與本機各重跑數次再比較。
同一天也抓到一次真的退步：市場概況的描述寫了「請用 twse_get_dataset 查…」，sonnet 就開始跳過
`twse_search_datasets` 直接猜 dataset_id；改成指向 `twse_search_datasets` 後恢復。
**描述裡點名工具時，指向「先搜尋」那一支**，不要把模型引去直接取資料。

**要比就在同一段時間、同一種環境比。** 2026-09-26 加股利時，「殖利率前 10 檔」先是正式環境 10/11、本機 6/11，
像是退步；但本機換回與正式環境逐字相同的工具清單也只有 5/8。最後用 `git worktree` 在 8788 起一個改動前的
`wrangler dev`，與改動後的 8787 **交錯**各跑 10 次，得到 9/10 對 8/10——落差來自時段，不是改動。
