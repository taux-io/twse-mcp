#!/usr/bin/env node
/**
 * archive-report.mjs
 * ------------------
 * smoke workflow 的「每日存檔（本機 D1）」步驟用：判斷這次存檔成功了沒有，失敗就寫一份報告。
 *   node scripts/archive-report.mjs <排程回的狀態碼> <daily_quotes 的列數> <wrangler 的 log>
 *
 * 為什麼需要：這個步驟失敗時 smoke-report.md 仍然寫「全部通過」（那份報告只管工具實測），
 * 排程開出來的 issue 因此看不出是什麼壞了。2026-11-05 就是這樣，原因只在 run 的 log 裡。
 *
 * 每張表的結果由 Worker 的 scheduled() 用一行 JSON 印出來，這裡從 wrangler 的 log 撈回來。
 * 只用 Node 內建功能與 report-text.mjs。
 */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { quoted } from "./report-text.mjs";

/** 一整天的上市股票遠多於這個數字；少於它代表沒有寫進去。 */
export const MIN_ROWS = 1000;

/** 純函式：回傳報告（Markdown），成功時回 null。status 0 代表連不上（curl 印 000）。 */
export function archiveReport({ status, rows, log }) {
  const lines = [];
  if (status === 0) lines.push("- 連不上本機 Worker 的排程端點");
  else if (status !== 200) lines.push(`- 觸發排程回 HTTP ${status}`);
  for (const text of log.split("\n")) {
    const json = /\{"archive":.*\}/.exec(text)?.[0];
    if (!json) continue;
    let table;
    try {
      table = JSON.parse(json);
    } catch {
      continue;
    }
    if (table.error) lines.push(`- ${quoted(table.archive, 60)}：${quoted(table.error)}`);
  }
  if (Number.isNaN(rows)) lines.push("- 讀不到 `daily_quotes` 的列數");
  else if (!(rows > MIN_ROWS)) lines.push(`- \`daily_quotes\` 只有 ${rows} 列，應該超過 ${MIN_ROWS}`);
  return lines.length ? ["每日存檔（本機 D1）失敗：", "", ...lines].join("\n") : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [status, rows, logPath] = process.argv.slice(2);
  if (!logPath) {
    process.stderr.write("用法：node scripts/archive-report.mjs <狀態碼> <列數> <wrangler 的 log>\n");
    process.exit(2);
  }
  const log = await readFile(logPath, "utf-8").catch(() => "");
  const report = archiveReport({ status: Number(status), rows: rows === "" ? Number.NaN : Number(rows), log });
  if (report) {
    await writeFile(process.env.ARCHIVE_REPORT ?? "archive-report.md", report + "\n");
    console.log(report);
    process.exit(1);
  }
  console.log(`每日存檔通過：daily_quotes ${rows} 列`);
}
