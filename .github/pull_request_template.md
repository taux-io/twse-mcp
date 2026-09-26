## 為什麼

## 改了什麼

## 驗證

- [ ] `npm test`、`npm run typecheck`、`npm run dry-run` 通過
- [ ] commit 前跑過 `/ponytail:ponytail-review`（見 `docs/agents/ponytail.md`）

<!-- 動到工具描述、inputSchema／outputSchema、server instructions，或新增／移除工具時，下面這段必填 -->
### 工具選擇測試（`npm run eval:tools`）

兩邊都跑本機，不打正式環境：改動前用 `git worktree` 從 main 起一個 `wrangler dev --port 8788`，
改動後是 `npm run dev`（8787），分別帶 `EVAL_ENDPOINT=http://localhost:8788/mcp`／`8787`（做法見 `AGENTS.md`）。

| | 改動前（本機 8788，main） | 改動後（本機 8787） |
|---|---|---|
| 預設模型（opus） | / | / |
| `EVAL_MODEL=sonnet` | / | / |

- [ ] 改動後有失敗的題目，已用 `EVAL_ONLY=<題目>` 在 8788 與 8787 **交錯**各重跑數次比較，
      確認是改動造成的退步，還是模型本身的隨機性（見 `AGENTS.md`）
