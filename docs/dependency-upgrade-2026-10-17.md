# 2026-10-17 Dependabot 升級的驗證紀錄

Dependabot 設定（#157）合併後第一批 PR（#158、#159、#160）。這份紀錄寫下當時怎麼驗證、
看到什麼、結論，下次遇到跨大版本的升級可以照做。

結論：**沒有使用者看得到的影響，CHANGELOG 不用寫。**

## 升了什麼

| PR | 內容 |
|---|---|
| #158 | minor/patch 群組：`@modelcontextprotocol/server` 2.0.0 → 2.3.1、`agents` 0.20.1 → 0.28.1、`zod` ^4.4.3 → ^4.6.7、`@anthropic-ai/sdk`、`@cloudflare/workers-types`、`@types/node`、`wrangler`（共 7 個） |
| #159 | `vitest` 3.2.7 → 5.0.4 |
| #160 | `typescript` 5.9.3 → 7.0.2 |

## 怎麼驗證

1. 每個 PR 在本機 worktree 各跑 `npm ci`、`npm test`（463 個測試）、`npm run typecheck`、
   `npm run check-readmes`，全過。確認 `tsc -v`、`vitest --version` 真的是新版。
2. #158 動到執行期依賴（MCP server、agents），另外跑本機 `npm run smoke`：兩代協定、
   全部工具都通過。
3. 合併後在 `main` 上確認 `test`、`Workers Builds` 通過，`npm run dry-run`（`wrangler deploy --dry-run`）
   成功，並手動觸發 `smoke.yml`（`smoke` 不在 push 到 `main` 時跑），成功。
4. **新舊行為對照**：同一份程式碼，升級前（`3e8d948`）與升級後（`ca8df76`）各起一個
   `wrangler dev`（8788、8787），兩代協定各對兩邊送同樣的請求，比對回應。

## 對照的結果

相同：`initialize`、`server/discover`、`prompts/list`，以及 `dataset.search`、`dataset.describe`、
`quote.lookup` 的回應，還有參數錯誤、未知工具的錯誤訊息。

**唯一的差異在 `tools/list` 裡 3 支工具的 `outputSchema`（7 個欄位）：可為空的欄位，
JSON Schema 寫法從 `anyOf: [{type: "string"}, {type: "null"}]` 變成 `type: ["string", "null"]`。**
兩種寫法語意相同，欄位名稱、型別、必填都沒變；逐欄位檢查過，7 處全是這種改寫。

- 只出現在 `outputSchema`，`inputSchema` 沒變，所以使用者的參數、允許清單、寫死的呼叫都不受影響。
- 介面契約快照（`test/__snapshots__/server.test.ts.snap`）只涵蓋輸入面，沒有失敗、沒有用 `-u` 更新。
- 寫法改變的來源沒有查證；最可能是 `zod` 4.4 → 4.6 或 MCP SDK 轉換 JSON Schema 的方式有變。
  只有在某個 MCP 客戶端對 `type` 陣列這種寫法處理得不好時，才需要追。

## 流程上的注意

- 三個 PR 都改 `package-lock.json`，合併第一個後其他的會衝突（`CONFLICTING`）。
  留言 `@dependabot rebase` 重建，**一次一個**，等 CI 跑完再合併，再重建下一個。
- `smoke.yml` 只在 PR 與排程時跑；`main` 上要驗證要手動觸發（`gh workflow run smoke.yml`）。
- 當時 `upstream health` 已連續幾天失敗，與這次升級無關，是上游資料集逾時（issue #153）；
  升級前後都有，只回報、不為了讓它通過而放寬測試。
