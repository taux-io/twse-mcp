## 為什麼

## 改了什麼

## 驗證

- [ ] `npm test`、`npm run typecheck`、`npm run dry-run` 通過
- [ ] commit 前跑過 `/ponytail:ponytail-review`（見 `docs/agents/ponytail.md`）

<!-- 動到工具描述、inputSchema／outputSchema、server instructions，或新增／移除工具時，下面這段必填 -->
### 工具選擇測試（`npm run eval:tools`）

用 `npm run eval:ab`（main 對工作目錄，兩邊都在本機、交錯執行，不打正式環境），opus 與 `EVAL_MODEL=sonnet` 各一次。

| | 改動前（本機 8788，main） | 改動後（本機 8787） |
|---|---|---|
| 預設模型（opus） | / | / |
| `EVAL_MODEL=sonnet` | / | / |

- [ ] 改動後有失敗的題目，已用 `EVAL_ONLY=<題目> EVAL_REPEAT=10 npm run eval:ab` 重跑比較，
      確認是改動造成的退步，還是模型本身的隨機性（見 `AGENTS.md`）
