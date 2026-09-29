/**
 * archive.ts — 每日把上市個股日成交資訊存進 D1，自己累積歷史價量。
 *
 * 證交所 OpenAPI 只有最新一個交易日，「這個月漲了多少」答不了；歷史只能從開始存的那天起累積。
 * 只存 OpenAPI（政府資料開放授權）的資料，不存即時報價，也不存任何使用者資訊。
 *
 * 資安：寫入只由 Cron 觸發（server.ts 的 scheduled），沒有任何 HTTP 路由能寫入；
 * SQL 一律參數綁定，不拼接字串。
 *
 * 免費方案的兩個限制決定了寫法：每次執行最多 50 個 D1 查詢、每個查詢最多 100 個綁定參數。
 * 一天約 1,400 檔 × 11 欄，逐列或多列 VALUES 都會超過；所以整天的資料轉成一個 JSON 參數，
 * 用一條 INSERT … SELECT … FROM json_each(?) 寫入。整次只有兩個查詢（建表、寫入）。
 *
 * 主鍵是（代號、交易日），交易日取自資料本身，不用執行當下的時間：一天跑兩次、上游還沒更新
 * 而拿到前一天的資料，都只是覆寫同一批列。
 */
import { num, rocToIso, type Row } from "./core";
import { DS_DAY, fetchDataset } from "./twse";

const SCHEMA = `CREATE TABLE IF NOT EXISTS daily_quotes (
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  change REAL,
  volume INTEGER,
  value INTEGER,
  trades INTEGER,
  PRIMARY KEY (code, date)
) WITHOUT ROWID`;

const INSERT = `INSERT OR REPLACE INTO daily_quotes
  (code, date, name, open, high, low, close, change, volume, value, trades)
SELECT
  json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
  json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
  json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
  json_extract(value, '$[9]'), json_extract(value, '$[10]')
FROM json_each(?1)`;

type QuoteTuple = [string, string, string | null, ...(number | null)[]];

/** 日成交資訊的一列 → 存檔的一列。代號或日期缺漏的列丟掉：主鍵不能是空的。 */
export function quoteTuples(rows: Row[]): QuoteTuple[] {
  const out: QuoteTuple[] = [];
  for (const r of rows) {
    const code = String(r["Code"] ?? "").trim();
    const date = rocToIso(r["Date"]);
    if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push([
      code,
      date,
      String(r["Name"] ?? "").trim() || null,
      num(r["OpeningPrice"]),
      num(r["HighestPrice"]),
      num(r["LowestPrice"]),
      num(r["ClosingPrice"]),
      num(r["Change"]),
      num(r["TradeVolume"]),
      num(r["TradeValue"]),
      num(r["Transaction"]),
    ]);
  }
  return out;
}

/** 抓當天的日成交資訊並寫入。回傳寫了幾列、資料屬於哪些交易日（排程 log 用）。 */
export async function archiveDailyQuotes(db: D1Database): Promise<{ rows: number; dates: string[] }> {
  const tuples = quoteTuples(await fetchDataset(DS_DAY));
  await db.prepare(SCHEMA).run();
  if (tuples.length) await db.prepare(INSERT).bind(JSON.stringify(tuples)).run();
  return { rows: tuples.length, dates: [...new Set(tuples.map((t) => t[1]))].sort() };
}
