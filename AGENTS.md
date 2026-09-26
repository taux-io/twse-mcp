# AGENTS.md

台股資料 MCP server。給任何 AI 代理讀的專案慣例；
使用說明看 [README.md](README.md)，詞彙定義看 [CONTEXT.md](CONTEXT.md)，
決策與實測紀錄看 [docs/spec-workers-migration.md](docs/spec-workers-migration.md)，
架構決策看 [docs/adr/](docs/adr/)——那裡有活的操作約束（例如導入認證前必須重新評估
`cacheScope`），不是純歷史。

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
用法見 `scripts/eval-tools.mjs` 開頭。
