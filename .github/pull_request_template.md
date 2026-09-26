## 為什麼

## 改了什麼

## 驗證

- [ ] `npm test`、`npm run typecheck`、`npm run dry-run` 通過
- [ ] commit 前跑過 `/ponytail:ponytail-review`（見 `docs/agents/ponytail.md`）

<!-- 動到工具描述、inputSchema／outputSchema、server instructions，或新增／移除工具時，下面這段必填 -->
### 工具選擇測試（`npm run eval:tools`）

測本機未部署的版本：先 `npm run dev`，再加 `EVAL_ENDPOINT=http://localhost:8787/mcp`。

| | 改動前（正式環境） | 改動後（本機） |
|---|---|---|
| 預設模型（opus） | /24 | /24 |
| `EVAL_MODEL=sonnet` | /24 | /24 |

- [ ] 改動後有失敗的題目，已用 `EVAL_ONLY=<題目>` 在**正式環境與本機各重跑數次**比較，
      確認是改動造成的退步，還是模型本身的隨機性（見 `AGENTS.md`）
