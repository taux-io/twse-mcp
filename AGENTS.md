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
