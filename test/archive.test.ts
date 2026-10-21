import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/server";
import { ARCHIVE_PE_MARGIN_SINCE, ARCHIVE_SINCE, archiveDaily, marginTuples, peTuples, quoteTuples, stockHistory } from "../src/archive";

const DAY = [
  { Date: "1150924", Code: "2330", Name: "台積電", TradeVolume: "14,557,662", TradeValue: "36,1", OpeningPrice: "2,480", HighestPrice: "2,490", LowestPrice: "2,470", ClosingPrice: "2,475", Change: "-25.0000", Transaction: "31,000" },
  { Date: "1150924", Code: "", Name: "壞列", ClosingPrice: "1" },
  { Date: "", Code: "9999", Name: "沒日期" },
];

afterEach(() => vi.unstubAllGlobals());

describe("每日存檔", () => {
  it("日成交資訊轉成存檔列：日期轉 ISO、數字去逗號；缺代號或日期的列丟掉", () => {
    const t = quoteTuples(DAY);
    expect(t).toHaveLength(1);
    expect(t[0].slice(0, 3)).toEqual(["2330", "2026-09-24", "台積電"]);
    expect(t[0][6]).toBe(2475); // close
    expect(t[0][7]).toBe(-25); // change
  });
});

// BWIBBU_ALL（個股日本益比、殖利率、股價淨值比）。虧損公司的本益比是空字串，不是 0。
const PE = [
  { Date: "1151020", Code: "1101", Name: "台泥", PEratio: "", DividendYield: "2.99", PBratio: "0.87" },
  { Date: "1151020", Code: "2330", Name: "台積電", PEratio: "24.31", DividendYield: "1.52", PBratio: "7.10" },
  { Date: "1151020", Code: "", Name: "壞列", PEratio: "1" },
  { Date: "", Code: "9999", Name: "沒日期", PEratio: "1" },
];

describe("每日存檔：本益比、殖利率、股價淨值比", () => {
  it("轉成存檔列：日期轉 ISO；空字串存成 null 不是 0；缺代號或日期的列丟掉", () => {
    expect(peTuples(PE)).toEqual([
      ["1101", "2026-10-20", "台泥", null, 2.99, 0.87],
      ["2330", "2026-10-20", "台積電", 24.31, 1.52, 7.1],
    ]);
  });
});

// MI_MARGN（融資融券餘額）。上游這份每一列都沒有日期欄位，日期由呼叫端給。
const MARGIN = [
  { "股票代號": "00400A", "股票名稱": "主動國泰動能高息", "融資買進": "424", "融資賣出": "220", "融資現金償還": "6", "融資前日餘額": "11189", "融資今日餘額": "11,387", "融資限額": "512535", "融券買進": "", "融券賣出": "", "融券現券償還": "", "融券前日餘額": "", "融券今日餘額": "", "融券限額": "512535", "資券互抵": "5", "註記": " " },
  { "股票代號": "2330", "股票名稱": "台積電", "融資買進": "1", "融資賣出": "2", "融資現金償還": "3", "融資前日餘額": "10", "融資今日餘額": "8", "融資限額": "100", "融券買進": "4", "融券賣出": "5", "融券現券償還": "6", "融券前日餘額": "20", "融券今日餘額": "19", "融券限額": "200", "資券互抵": "0", "註記": "Ｘ" },
  { "股票代號": "", "股票名稱": "壞列", "融資買進": "1" },
];

describe("每日存檔：融資融券餘額", () => {
  it("轉成存檔列：日期由參數給；不存前日餘額；空字串與空白註記是 null，0 仍是 0；缺代號的列丟掉", () => {
    expect(marginTuples(MARGIN, "2026-10-20")).toEqual([
      ["00400A", "2026-10-20", "主動國泰動能高息", 424, 220, 6, 11387, 512535, null, null, null, null, 512535, 5, null],
      ["2330", "2026-10-20", "台積電", 1, 2, 3, 8, 100, 4, 5, 6, 19, 200, 0, "Ｘ"],
    ]);
  });
});

/** 依網址回不同資料集的假 fetch；值是 Error 的資料集回 500。 */
function stubUpstream(by: { day?: unknown[] | Error; pe?: unknown[] | Error; margin?: unknown[] | Error }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = url.includes("STOCK_DAY_ALL") ? by.day : url.includes("BWIBBU_ALL") ? by.pe : url.includes("MI_MARGN") ? by.margin : undefined;
      if (body === undefined || body instanceof Error) return new Response("upstream down", { status: 500 });
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  );
}

/** 記下 SQL 與綁定值的假 D1（寫入路徑）。 */
function recordingDb() {
  const writes: { sql: string; bind: unknown[] }[] = [];
  const prepared: string[] = [];
  const db = {
    prepare(sql: string) {
      prepared.push(sql);
      const stmt = {
        bind: (...a: unknown[]) => (writes.push({ sql, bind: a }), stmt),
        run: async () => ({}),
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, writes, prepared };
}

describe("每日存檔：三張表一起存", () => {
  it("每張表各兩個查詢（建表、寫入）、每個寫入只綁一個 JSON 參數；融資融券的日期用日成交資訊的交易日", async () => {
    stubUpstream({ day: DAY, pe: PE, margin: MARGIN });
    const { db, writes, prepared } = recordingDb();
    const r = await archiveDaily(db);
    // 查詢總數遠低於免費方案每次執行 50 個的上限：3 張表 × （建表 + 寫入）
    expect(prepared).toHaveLength(6);
    expect(writes).toHaveLength(3);
    for (const w of writes) {
      expect(w.sql).toContain("json_each(?1)");
      expect(w.bind).toHaveLength(1);
    }
    const margin = writes.find((w) => w.sql.includes("margin_daily"))!;
    // 日成交資訊那天是 2026-09-24（DAY），融資融券沒有日期欄位，就該標成這一天
    expect(JSON.parse(margin.bind[0] as string)[0].slice(0, 2)).toEqual(["00400A", "2026-09-24"]);
    // 資料只以綁定參數進去，不拼進 SQL
    expect(writes.map((w) => w.sql).join()).not.toContain("台積電");
    expect(r).toEqual({
      daily_quotes: { rows: 1, dates: ["2026-09-24"] },
      pe_daily: { rows: 2, dates: ["2026-10-20"] },
      margin_daily: { rows: 2, dates: ["2026-09-24"] },
    });
  });
});

describe("每日存檔：一張表失敗不拖垮其他張", () => {
  it("本益比那份抓不到：價量與融資融券照存，結果標出失敗的那張", async () => {
    stubUpstream({ day: DAY, pe: new Error("down"), margin: MARGIN });
    const { db, writes } = recordingDb();
    const r = await archiveDaily(db);
    expect(writes.map((w) => /INTO (\w+)/.exec(w.sql)![1]).sort()).toEqual(["daily_quotes", "margin_daily"]);
    expect(r.daily_quotes.rows).toBe(1);
    expect(r.margin_daily.rows).toBe(2);
    expect(r.pe_daily).toEqual({ rows: 0, dates: [], error: expect.any(String) });
  });
});

describe("每日存檔：價量抓不到時融資融券不能存", () => {
  it("沒有交易日可借，融資融券不寫（不存日期是空的列），本益比照存，並說明原因", async () => {
    stubUpstream({ day: new Error("down"), pe: PE, margin: MARGIN });
    const { db, writes } = recordingDb();
    const r = await archiveDaily(db);
    expect(writes.map((w) => /INTO (\w+)/.exec(w.sql)![1])).toEqual(["pe_daily"]);
    expect(r.daily_quotes.error).toEqual(expect.any(String));
    expect(r.pe_daily.rows).toBe(2);
    expect(r.margin_daily).toEqual({ rows: 0, dates: [], error: expect.stringContaining("交易日") });
  });
});

/**
 * 用真的 SQLite（node:sqlite，D1 底層同一個引擎）跑 SCHEMA 與 INSERT。假 D1 看不到
 * `json_extract(value, '$[n]')` 的位置寫錯——欄位順序錯了，資料會悄悄存進別的欄位。
 */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: (...a: unknown[]) => ({
          run: async () => (sqlite.prepare(sql).run(...(a as never[])), {}),
          all: async () => ({ results: sqlite.prepare(sql).all(...(a as never[])) }),
        }),
        run: async () => (sqlite.exec(sql), {}),
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

describe("每日存檔：真的 SQLite 跑一遍", () => {
  it("每個值落在對的欄位；空值是 NULL；重跑只覆寫同一批列（主鍵是代號與交易日）", async () => {
    stubUpstream({ day: DAY, pe: PE, margin: MARGIN });
    const { db, sqlite } = sqliteD1();
    await archiveDaily(db);
    await archiveDaily(db); // 一天跑兩次

    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM pe_daily").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("SELECT * FROM pe_daily WHERE code = '1101'").get()).toEqual({
      code: "1101", date: "2026-10-20", name: "台泥", pe_ratio: null, dividend_yield: 2.99, pb_ratio: 0.87,
    });
    expect(sqlite.prepare("SELECT * FROM margin_daily WHERE code = '2330'").get()).toEqual({
      code: "2330", date: "2026-09-24", name: "台積電",
      margin_buy: 1, margin_sell: 2, margin_repay: 3, margin_balance: 8, margin_limit: 100,
      short_buy: 4, short_sell: 5, short_repay: 6, short_balance: 19, short_limit: 200,
      offset_qty: 0, note: "Ｘ",
    });
    expect(sqlite.prepare("SELECT short_balance, note FROM margin_daily WHERE code = '00400A'").get()).toEqual({ short_balance: null, note: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM margin_daily").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM daily_quotes").get()).toEqual({ n: 1 });
  });
});

describe("排程（scheduled）", () => {
  const run = (env: Record<string, unknown>) =>
    (worker.scheduled as (c: unknown, e: unknown) => Promise<void>)({}, env);

  it("沒有 ARCHIVE 綁定就什麼都不做：不抓上游、不丟例外", async () => {
    stubUpstream({ day: DAY, pe: PE, margin: MARGIN });
    await expect(run({})).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("三張表各印一行 log（表名、列數、交易日），沒有別的內容", async () => {
    stubUpstream({ day: DAY, pe: PE, margin: MARGIN });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ ARCHIVE: recordingDb().db });
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
      { archive: "daily_quotes", rows: 1, dates: ["2026-09-24"] },
      { archive: "pe_daily", rows: 2, dates: ["2026-10-20"] },
      { archive: "margin_daily", rows: 2, dates: ["2026-09-24"] },
    ]);
    log.mockRestore();
  });

  // 一張失敗不拖垮其他張（見上），但整次排程要標成失敗：Cron 的失敗才會出現在 Workers Logs，
  // 否則上游壞了好幾天都沒人知道。
  it("有任何一張失敗：其他張照存照印，最後丟出例外並說是哪一張", async () => {
    stubUpstream({ day: DAY, pe: new Error("down"), margin: MARGIN });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(run({ ARCHIVE: recordingDb().db })).rejects.toThrow(/pe_daily/);
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines.map((l) => l.archive)).toEqual(["daily_quotes", "pe_daily", "margin_daily"]);
    expect(lines[1].error).toEqual(expect.any(String));
    log.mockRestore();
  });
});

describe("歷史價量帶本益比與融資融券：存檔起點不同", () => {
  it("較早只有價量的日子照樣回來、新欄位是 null，並說明本益比與融資融券從哪天才有", async () => {
    const { db } = sqliteD1();
    // 10-19 只有價量（本益比與融資融券的上游當天抓不到）；10-20 三份都有
    stubUpstream({
      day: [{ Date: "1151019", Code: "2330", Name: "台積電", ClosingPrice: "100" }],
      pe: new Error("down"),
      margin: new Error("down"),
    });
    await archiveDaily(db).catch(() => {});
    await seedDay(db, "1151020", { close: "101", pe: "21", marginBalance: "480", shortBalance: "12" });

    const { history, caveat } = await stockHistory(db, "2330", 2);
    const rows = history!.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.date)).toEqual(["2026-10-19", "2026-10-20"]); // 列數 = 價量的筆數
    expect(rows[0]).toMatchObject({ close: 100, pe_ratio: null, dividend_yield: null, pb_ratio: null, margin_balance: null, short_balance: null });
    expect(rows[1]).toMatchObject({ close: 101, pe_ratio: 21, margin_balance: 480 });
    expect(ARCHIVE_PE_MARGIN_SINCE).toBe("2026-10-20");
    expect(caveat).toContain(ARCHIVE_PE_MARGIN_SINCE);
    expect(caveat).toMatch(/本益比.*融資融券|融資融券.*本益比/);
  });
});

describe("歷史價量帶本益比與融資融券：新表還不存在", () => {
  // 讀取端部署在第一次排程之前，或某天 pe／margin 的上游一直壞到連表都沒建：
  // 不能因此讓原本好好的價量歷史整段變成「暫時無法取得」。
  it("pe_daily、margin_daily 都還沒建：價量歷史照回，新欄位是 null", async () => {
    const { db } = sqliteD1();
    stubUpstream({ day: [{ Date: "1151019", Code: "2330", Name: "台積電", ClosingPrice: "100" }], pe: new Error("down"), margin: new Error("down") });
    await archiveDaily(db).catch(() => {});

    const { history, caveat } = await stockHistory(db, "2330", 5);
    expect(history).not.toBeNull();
    expect(history!.rows).toEqual([
      { date: "2026-10-19", open: null, high: null, low: null, close: 100, change: null, volume: null, pe_ratio: null, dividend_yield: null, pb_ratio: null, margin_balance: null, short_balance: null },
    ]);
    expect(caveat).toContain(ARCHIVE_PE_MARGIN_SINCE);
  });
});

/** 假的 D1：記下 SQL 與綁定值，回傳給定的列（由新到舊，如同 ORDER BY date DESC）。 */
function fakeDb(rows: Record<string, unknown>[] | Error) {
  const seen = { sql: [] as string[], binds: [] as unknown[][] };
  const db = {
    prepare(q: string) {
      seen.sql.push(q);
      return {
        bind: (...a: unknown[]) => {
          seen.binds.push(a);
          return { all: async () => { if (rows instanceof Error) throw rows; return { results: rows.slice(0, a[1] as number) }; } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, seen };
}

/** 用真的存檔流程灌一天：三份上游各回一列 2330，經 archiveDaily 寫進（真的）SQLite。 */
async function seedDay(db: D1Database, roc: string, v: { close: string; pe: string; marginBalance: string; shortBalance: string }) {
  stubUpstream({
    day: [{ Date: roc, Code: "2330", Name: "台積電", OpeningPrice: "1", HighestPrice: "3", LowestPrice: "1", ClosingPrice: v.close, Change: "1", TradeVolume: "1,000", TradeValue: "1", Transaction: "1" }],
    pe: [{ Date: roc, Code: "2330", Name: "台積電", PEratio: v.pe, DividendYield: "1.5", PBratio: "7.1" }],
    margin: [{ "股票代號": "2330", "股票名稱": "台積電", "融資今日餘額": v.marginBalance, "融券今日餘額": v.shortBalance }],
  });
  await archiveDaily(db);
}

describe("歷史價量帶本益比與融資融券（讀取端，真的 SQLite）", () => {
  it("每列帶 pe_ratio、dividend_yield、pb_ratio、margin_balance、short_balance，由舊到新", async () => {
    const { db } = sqliteD1();
    await seedDay(db, "1151019", { close: "100", pe: "20.5", marginBalance: "500", shortBalance: "10" });
    await seedDay(db, "1151020", { close: "101", pe: "", marginBalance: "480", shortBalance: "12" });

    const { history } = await stockHistory(db, "2330", 2);
    expect((history!.rows as Record<string, unknown>[])).toEqual([
      { date: "2026-10-19", open: 1, high: 3, low: 1, close: 100, change: 1, volume: 1000, pe_ratio: 20.5, dividend_yield: 1.5, pb_ratio: 7.1, margin_balance: 500, short_balance: 10 },
      { date: "2026-10-20", open: 1, high: 3, low: 1, close: 101, change: 1, volume: 1000, pe_ratio: null, dividend_yield: 1.5, pb_ratio: 7.1, margin_balance: 480, short_balance: 12 },
    ]);
  });
});

describe("歷史價量（讀取端）", () => {
  const desc = [
    { date: "2026-10-22", close: 110 },
    { date: "2026-10-21", close: 105 },
    { date: "2026-10-20", close: 100 },
  ];

  it("由舊到新；期間漲跌幅；只綁代號與筆數，SQL 裡沒有使用者輸入", async () => {
    const { db, seen } = fakeDb(desc);
    const { history, caveat } = await stockHistory(db, "2330", 3);
    expect((history!.rows as { date: string }[]).map((r) => r.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(history!["期間漲跌幅%"]).toBe(10);
    expect(caveat).toBeUndefined();
    expect(seen.binds).toEqual([["2330", 3]]);
    expect(seen.sql.join()).not.toContain("2330");
    expect(seen.sql[0]).toMatch(/^SELECT/);
  });

  it("不足要求的天數：說明存檔從哪天開始、目前有幾天", async () => {
    const { caveat } = await stockHistory(fakeDb(desc).db, "2330", 20);
    expect(caveat).toContain(ARCHIVE_SINCE);
    expect(caveat).toContain("3 個交易日");
  });

  it("沒有資料：history 為 null 並說明，不是錯誤", async () => {
    const r = await stockHistory(fakeDb([]).db, "9999", 5);
    expect(r.history).toBeNull();
    expect(r.caveat).toContain("沒有存檔的歷史價量");
  });

  it("D1 出錯或沒有綁定：固定的說明，不外洩錯誤內容", async () => {
    const thrown = await stockHistory(fakeDb(new Error("D1_ERROR: secret detail")).db, "2330", 5);
    expect(thrown).toEqual({ history: null, caveat: "歷史資料暫時無法取得" });
    expect(await stockHistory(undefined, "2330", 5)).toEqual({ history: null, caveat: "歷史資料暫時無法取得" });
  });
});
