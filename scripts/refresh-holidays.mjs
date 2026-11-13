#!/usr/bin/env node
/**
 * refresh-holidays.mjs
 * --------------------
 * 把證交所的休市日表存一份到 src/holidays.generated.json，一個年度一份。
 *   用法： npm run refresh-holidays
 *
 * 為什麼要自己存：休市日表（holidaySchedule/holidaySchedule）只列一個年度，而且證交所會在年底前
 * 把它換成下一年度的內容（2026-11-13 觀察到已是民國 116 年）。換了之後，今年剩下的日子有沒有休市
 * 就查不到了。執行期以上游為準，上游不涵蓋的年度才用這份副本（src/core.ts 的 withStoredHolidays）。
 *
 * 只存日期與名稱：執行期只用這兩欄判斷哪一天休市。說明欄的排版在不同端點不一樣，不存。
 * 從不刪掉年度：上游換年之後，舊的那一年正是這份副本存在的理由。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fetchBody } from "./check-upstream.mjs";
import { quoted } from "./report-text.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "holidays.generated.json");
const DATASET = "holidaySchedule/holidaySchedule";
export const OPENAPI_SOURCE = "證交所 OpenAPI holidaySchedule/holidaySchedule";

/** 一整年的表至少有這麼多列（2026 年 27 列、2027 年 29 列）。少於它多半是上游出事。 */
const MIN_ROWS = 10;

/**
 * 純函式：把上游這次列的那一年併進副本。那一年整年換新，其他年度原樣保留。
 * 內容沒變就原樣回傳（連取得日期都不動），檔案才不會每次刷新都有差異。
 * 上游的表不像一整年的休市日表時丟錯，不覆寫副本。
 */
export function mergeHolidayYear(stored, rows, fetched, source = OPENAPI_SOURCE) {
  if (!Array.isArray(rows) || rows.length < MIN_ROWS) {
    throw new Error(`休市日表的列數太少（${Array.isArray(rows) ? rows.length : "不是陣列"}，至少要 ${MIN_ROWS}），不覆寫副本`);
  }
  const kept = rows.map((r) => ({ Date: String(r?.Date ?? "").trim(), Name: String(r?.Name ?? "").trim() }));
  const bad = kept.find((r) => !/^\d{7}$/.test(r.Date) || !r.Name);
  if (bad) throw new Error(`休市日表有一列的日期或名稱認不出來（${JSON.stringify(bad).slice(0, 120)}），不覆寫副本`);
  const years = [...new Set(kept.map((r) => String(Number(r.Date.slice(0, 3)) + 1911)))];
  if (years.length !== 1) throw new Error(`休市日表跨了 ${years.length} 個年度（${years.join("、")}），不覆寫副本`);
  const [year] = years;
  if (JSON.stringify(stored[year]?.rows) === JSON.stringify(kept)) return stored;
  const merged = { ...stored, [year]: { source, fetched, rows: kept } };
  return Object.fromEntries(Object.keys(merged).sort().map((y) => [y, merged[y]]));
}

/**
 * 純函式：兩份副本的差異，給每週刷新的 issue 內文用。沒有變動回空字串。
 * 一個年度一行。名稱是上游的文字，經過 quoted() 才進報告。
 */
export function holidaysDiff(before, after) {
  const lines = [];
  for (const year of Object.keys(after).sort()) {
    const was = before[year]?.rows;
    const now = after[year].rows;
    if (!was) {
      lines.push(`- 休市日副本新增 ${quoted(year, 8)} 年（${now.length} 列）`);
      continue;
    }
    const old = new Map(was.map((r) => [r.Date, r.Name]));
    const cur = new Map(now.map((r) => [r.Date, r.Name]));
    const added = now.filter((r) => !old.has(r.Date)).map((r) => quoted(`${r.Date} ${r.Name}`, 80));
    const removed = was.filter((r) => !cur.has(r.Date)).map((r) => quoted(`${r.Date} ${r.Name}`, 80));
    const renamed = now
      .filter((r) => old.has(r.Date) && old.get(r.Date) !== r.Name)
      .map((r) => quoted(`${r.Date} ${old.get(r.Date)} → ${r.Name}`, 120));
    const parts = [];
    if (added.length) parts.push(`新增 ${added.join("、")}`);
    if (removed.length) parts.push(`移除 ${removed.join("、")}`);
    if (renamed.length) parts.push(`改名 ${renamed.join("、")}`);
    if (parts.length) lines.push(`- 休市日副本 ${quoted(year, 8)} 年：${parts.join("；")}`);
  }
  return lines.join("\n");
}

async function main() {
  const stored = JSON.parse(await readFile(OUT, "utf-8").catch((e) => (e?.code === "ENOENT" ? "{}" : Promise.reject(e))));
  const { status, body } = await fetchBody(DATASET);
  if (status < 200 || status >= 300) throw new Error(`${DATASET} 取得失敗（HTTP ${status}）`);
  const merged = mergeHolidayYear(stored, JSON.parse(body), new Date().toISOString().slice(0, 10));
  if (merged === stored) {
    process.stderr.write(`休市日副本沒有變動（${Object.keys(stored).join("、")} 年）\n`);
    return;
  }
  await writeFile(OUT, JSON.stringify(merged, null, 1) + "\n", "utf-8");
  process.stderr.write(`wrote ${Object.keys(merged).join("、")} 年 -> ${OUT}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // `--diff <舊.json> <新.json>`：只印差異摘要，不抓上游、不寫檔。
  const [flag, oldPath, newPath] = process.argv.slice(2);
  const run =
    flag === "--diff"
      ? async () => {
          if (!oldPath || !newPath) throw new Error("用法：node scripts/refresh-holidays.mjs --diff <舊.json> <新.json>");
          const [o, n] = await Promise.all([oldPath, newPath].map(async (f) => JSON.parse(await readFile(f, "utf-8"))));
          process.stdout.write(holidaysDiff(o, n) + "\n");
        }
      : main;
  run().catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exit(1);
  });
}
