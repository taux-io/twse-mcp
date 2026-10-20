/**
 * archive.ts — 每日把三份上市資料存進 D1，自己累積歷史：日成交資訊（daily_quotes）、
 * 本益比／殖利率／股價淨值比（pe_daily）、融資融券餘額（margin_daily）。
 *
 * 證交所 OpenAPI 只有最新一個交易日，「這個月漲了多少」答不了；歷史只能從開始存的那天起累積。
 * 只存 OpenAPI（政府資料開放授權）的資料，不存即時報價，也不存任何使用者資訊。
 *
 * 資安：寫入只由 Cron 觸發（server.ts 的 scheduled），沒有任何 HTTP 路由能寫入；
 * SQL 一律參數綁定，不拼接字串。
 *
 * 免費方案的兩個限制決定了寫法：每次執行最多 50 個 D1 查詢、每個查詢最多 100 個綁定參數。
 * 一天約 1,100–1,400 檔 × 6–15 欄，逐列或多列 VALUES 都會超過；所以整天的資料轉成一個 JSON 參數，
 * 用一條 INSERT … SELECT … FROM json_each(?) 寫入。每張表兩個查詢（建表、寫入），整次共六個。
 *
 * 主鍵是（代號、交易日），交易日取自資料本身，不用執行當下的時間：一天跑兩次、上游還沒更新
 * 而拿到前一天的資料，都只是覆寫同一批列。唯一的例外是融資融券——上游那份沒有日期欄位，
 * 借用同一次抓到的日成交資訊的交易日（假設與對帳方法見 docs/adr/0003-d1-daily-archive.md）。
 */
import { num, rocToIso, type Row } from "./core";
import { DS_DAY, DS_MARGIN, DS_PE, fetchDataset } from "./twse";

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

type PeTuple = [string, string, string | null, number | null, number | null, number | null];

/** 本益比、殖利率、股價淨值比的一列 → 存檔的一列。空字串（例如虧損公司沒有本益比）是 null，不是 0。 */
export function peTuples(rows: Row[]): PeTuple[] {
  const out: PeTuple[] = [];
  for (const r of rows) {
    const code = String(r["Code"] ?? "").trim();
    const date = rocToIso(r["Date"]);
    if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push([
      code,
      date,
      String(r["Name"] ?? "").trim() || null,
      num(r["PEratio"]),
      num(r["DividendYield"]),
      num(r["PBratio"]),
    ]);
  }
  return out;
}

type MarginTuple = [string, string, string | null, ...(number | string | null)[]];

/**
 * 融資融券餘額的一列 → 存檔的一列。上游這份沒有日期欄位，所以日期由呼叫端給
 * （用同一次抓到的日成交資訊的交易日，見 archiveDaily）。不存「前日餘額」：它就是前一天存的
 * 「今日餘額」，存了就沒辦法拿它對帳日期有沒有標錯。註記只有空白或符號，空白存成 null。
 */
export function marginTuples(rows: Row[], date: string): MarginTuple[] {
  const out: MarginTuple[] = [];
  for (const r of rows) {
    const code = String(r["股票代號"] ?? "").trim();
    if (!code) continue;
    out.push([
      code,
      date,
      String(r["股票名稱"] ?? "").trim() || null,
      num(r["融資買進"]),
      num(r["融資賣出"]),
      num(r["融資現金償還"]),
      num(r["融資今日餘額"]),
      num(r["融資限額"]),
      num(r["融券買進"]),
      num(r["融券賣出"]),
      num(r["融券現券償還"]),
      num(r["融券今日餘額"]),
      num(r["融券限額"]),
      num(r["資券互抵"]),
      String(r["註記"] ?? "").trim() || null,
    ]);
  }
  return out;
}

const SCHEMA_PE = `CREATE TABLE IF NOT EXISTS pe_daily (
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  pe_ratio REAL,
  dividend_yield REAL,
  pb_ratio REAL,
  PRIMARY KEY (code, date)
) WITHOUT ROWID`;

const INSERT_PE = `INSERT OR REPLACE INTO pe_daily
  (code, date, name, pe_ratio, dividend_yield, pb_ratio)
SELECT
  json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
  json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]')
FROM json_each(?1)`;

const SCHEMA_MARGIN = `CREATE TABLE IF NOT EXISTS margin_daily (
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  margin_buy INTEGER,
  margin_sell INTEGER,
  margin_repay INTEGER,
  margin_balance INTEGER,
  margin_limit INTEGER,
  short_buy INTEGER,
  short_sell INTEGER,
  short_repay INTEGER,
  short_balance INTEGER,
  short_limit INTEGER,
  offset_qty INTEGER,
  note TEXT,
  PRIMARY KEY (code, date)
) WITHOUT ROWID`;

const INSERT_MARGIN = `INSERT OR REPLACE INTO margin_daily
  (code, date, name, margin_buy, margin_sell, margin_repay, margin_balance, margin_limit,
   short_buy, short_sell, short_repay, short_balance, short_limit, offset_qty, note)
SELECT
  json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
  json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
  json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
  json_extract(value, '$[9]'), json_extract(value, '$[10]'), json_extract(value, '$[11]'),
  json_extract(value, '$[12]'), json_extract(value, '$[13]'), json_extract(value, '$[14]')
FROM json_each(?1)`;

type TableResult = { rows: number; dates: string[]; error?: string };

async function writeTable(db: D1Database, schema: string, insert: string, tuples: unknown[][]): Promise<TableResult> {
  await db.prepare(schema).run();
  if (tuples.length) await db.prepare(insert).bind(JSON.stringify(tuples)).run();
  return { rows: tuples.length, dates: [...new Set(tuples.map((t) => String(t[1])))].sort() };
}

/** 一張表的抓取＋寫入；任何一步出錯都只記在這張表的結果裡，不影響其他張。 */
async function archiveOne(run: () => Promise<TableResult>): Promise<TableResult> {
  try {
    return await run();
  } catch (e) {
    return { rows: 0, dates: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 每日存檔：日成交資訊、本益比殖利率股價淨值比、融資融券餘額，三張表。
 * 融資融券那份上游沒有日期欄位，日期用同一次抓到的日成交資訊的交易日。
 * 三張表各自成敗：一份上游壞了，其他兩份照存。
 */
export async function archiveDaily(
  db: D1Database,
): Promise<{ daily_quotes: TableResult; pe_daily: TableResult; margin_daily: TableResult }> {
  let day = "";
  const daily_quotes = await archiveOne(async () => {
    const quotes = quoteTuples(await fetchDataset(DS_DAY));
    day = quotes.map((t) => t[1]).sort().at(-1) ?? "";
    return writeTable(db, SCHEMA, INSERT, quotes);
  });
  const pe_daily = await archiveOne(async () =>
    writeTable(db, SCHEMA_PE, INSERT_PE, peTuples(await fetchDataset(DS_PE))),
  );
  const margin_daily = await archiveOne(async () => {
    // 沒有交易日可借就不寫：標成空日期或亂猜的日期，比沒有資料更糟。
    if (!day) throw new Error("融資融券沒有日期欄位，要借日成交資訊的交易日，但這次日成交資訊沒有取得，所以不存");
    return writeTable(db, SCHEMA_MARGIN, INSERT_MARGIN, marginTuples(await fetchDataset(DS_MARGIN), day));
  });
  return { daily_quotes, pe_daily, margin_daily };
}

/** 存檔開始的日期（第一筆正式存檔）。歷史不足時照實說從哪天開始，不必為此多查一次 MIN(date)。 */
export const ARCHIVE_SINCE = "2026-09-29";

const HISTORY = `SELECT date, open, high, low, close, change, volume
FROM daily_quotes WHERE code = ?1 ORDER BY date DESC LIMIT ?2`;

/**
 * 某一檔最近 N 個交易日的價量（snapshot.stock 的 history_days）。
 *
 * 資安：只有這一條 SELECT，代號與筆數都是綁定參數；主鍵（code, date）讓它只讀 N 列，
 * 這是保護免費方案每天 500 萬列讀取額度的方式。D1 出錯時回 null，錯誤訊息不外洩給回應，
 * 也不寫 log（隱私權政策承諾程式不記錄個別請求）。
 * 只回原始價量與整段期間的漲跌幅，不算技術指標（llms.txt 公開說明本服務不做技術指標）。
 */
export async function stockHistory(
  db: D1Database | undefined,
  code: string,
  days: number,
): Promise<{ history: Record<string, unknown> | null; caveat?: string }> {
  if (!db) return { history: null, caveat: "歷史資料暫時無法取得" };
  let rows: Record<string, unknown>[];
  try {
    rows = (await db.prepare(HISTORY).bind(code, days).all()).results ?? [];
  } catch {
    return { history: null, caveat: "歷史資料暫時無法取得" };
  }
  if (!rows.length) {
    return { history: null, caveat: `${code} 沒有存檔的歷史價量（存檔自 ${ARCHIVE_SINCE} 開始，只收上市股票與 ETF）` };
  }
  rows.reverse(); // 由舊到新
  const first = rows[0].close as number | null;
  const last = rows[rows.length - 1].close as number | null;
  const history = {
    "期間": `${rows[0].date} ～ ${rows[rows.length - 1].date}`,
    "交易日數": rows.length,
    "期間漲跌幅%": first && last && rows.length > 1 ? Math.round((last / first - 1) * 10000) / 100 : null,
    rows,
  };
  return rows.length < days
    ? { history, caveat: `存檔自 ${ARCHIVE_SINCE} 開始，目前只有 ${rows.length} 個交易日，少於要求的 ${days} 日` }
    : { history };
}
