# Ponytail：三個防止過度工程的檢查點

用 [ponytail](https://github.com/DietrichGebert/ponytail) 外掛的三個 skill，在固定時機檢查
「有沒有東西可以刪」。三者都**只列清單、不自動修改**，而且只管複雜度——正確性、
安全與效能不在範圍內，那些照舊走 `/code-review`。

| 時機 | 指令 | 範圍 |
|---|---|---|
| **commit 前** | `/ponytail:ponytail-review` | 這次的 diff |
| **接手或重構前** | `/ponytail:ponytail-audit` | 整個 repo |
| **每週，或每個階段結束**（例如打版本 tag 前後） | `/ponytail:ponytail-debt` | 所有 `ponytail:` 註解 |

## 1. commit 前：review

改動 staged 之後、`git commit` 之前跑。發現可以直接照做的（`delete:`、`shrink:`）
就在同一個 commit 裡改掉；需要討論的（`yagni:` 動到公開介面）另開 issue。

結果是 `Lean already. Ship.` 就直接提交，不必在 commit 訊息裡記錄。

## 2. 接手或重構前：audit

開始一段重構、或接手一個不熟的區塊之前跑一次整個 repo，先知道哪裡本來就該刪，
重構時順手處理，而不是把冗餘搬到新結構裡。清單裡要處理的項目開成 issue
（標 `ready-for-agent` 或 `needs-triage`，見 `triage-labels.md`）。

## 3. 每週或階段結束：debt

收集所有 `ponytail:` 註解成清冊，確認刻意延後的事沒有被忘掉。有觸發條件已經成立的
（例如「超過 N 筆時改用索引」而現在已超過），就開 issue 處理；
標 `no-trigger` 的，補上升級條件或直接處理。

**已自動化**：每週一 09:00（台北時間）由 Claude Code 雲端 routine「twse-mcp weekly ponytail-debt」
執行（`trig_01UXVNqEewXndUNLvDLYnGch`，管理頁 https://claude.ai/code/routines ）。
它只讀不改：沒有標記就什麼都不做；有 `no-trigger` 或條件已成立的項目才開 issue
（標 `needs-triage`，標題以 `ponytail debt:` 開頭，不重複開）。手動跑 `/ponytail:ponytail-debt` 仍然可以，
例如在打版本 tag 前。

### 標記慣例

刻意選了簡單但有上限的做法時，在程式碼旁寫一行：

```ts
// ponytail: <上限是什麼>, <什麼時候該升級>
```

例：`// ponytail: 線性掃描整份目錄，目錄超過 2000 筆時改建索引`。
沒有這一行，debt 就收不到——延後的決定只存在於當時的對話裡，也就等於沒有。

`// ponytail:` 只用在「刻意的捷徑」。說明**為什麼這樣寫才對**的註解（這個 repo 大多數
註解都是這種）照舊用一般註解，不要加這個前綴。

## 這個 repo 的判讀原則

ponytail 的預設立場是「越短越好」。這個 repo 有很多**看起來像多餘、其實是修過 bug 的
守衛**，砍之前先讀旁邊的註解：

- **防禦性檢查不是冗餘。** `Object.hasOwn` 取代 `in`、夾住負數的 `limit`、
  上游非 JSON 的診斷、空陣列當成上游故障、三態的 `is_etf`／`處置股`——每一個都對應一個
  真的發生過的「安靜地給錯答案」。它們屬於正確性，不在 ponytail 的範圍內。
- **「重複」的常數多半有測試綁著。** 例如 `scripts/check-catalog.mjs` 的 `REQUIRED` 與
  `src/twse.ts` 的 `SNAPSHOT_DATASETS`、`TAIFEX_CSV_DATASETS` 的表頭：刻意各寫一份，
  由 `test/catalog.test.ts` 斷言一致，因為從一邊推導另一邊的路曾被證明會失效。
- **ADR 與註解裡寫明的取捨優先。** 與 `docs/adr/` 或程式碼註解明文記錄的決定衝突的建議，
  要先推翻那份理由，而不是直接刪。

判準：一項建議若會讓某個既有測試失敗、或會刪掉一段寫著「曾經發生過」的註解所保護的程式碼，
它就不是單純的過度工程，要當成設計變更討論。
