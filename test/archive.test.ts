import { afterEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_SINCE, archiveDailyQuotes, quoteTuples, stockHistory } from "../src/archive";

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

  it("整次只發兩個查詢（建表、寫入），資料以單一 JSON 參數綁定，不拼進 SQL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(DAY), { headers: { "content-type": "application/json" } })));
    const sql: string[] = [];
    const binds: unknown[][] = [];
    const db = {
      prepare(q: string) {
        sql.push(q);
        const stmt = { bind: (...a: unknown[]) => (binds.push(a), stmt), run: async () => ({}) };
        return stmt;
      },
    } as unknown as D1Database;

    const r = await archiveDailyQuotes(db);
    expect(r).toEqual({ rows: 1, dates: ["2026-09-24"] });
    expect(sql).toHaveLength(2);
    expect(sql[1]).toContain("json_each(?1)");
    expect(sql.join()).not.toContain("台積電");
    expect(binds).toHaveLength(1);
    expect(JSON.parse(binds[0][0] as string)[0][0]).toBe("2330");
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

describe("歷史價量（讀取端）", () => {
  const desc = [
    { date: "2026-10-02", close: 110 },
    { date: "2026-10-01", close: 105 },
    { date: "2026-09-30", close: 100 },
  ];

  it("由舊到新；期間漲跌幅；只綁代號與筆數，SQL 裡沒有使用者輸入", async () => {
    const { db, seen } = fakeDb(desc);
    const { history, caveat } = await stockHistory(db, "2330", 3);
    expect((history!.rows as { date: string }[]).map((r) => r.date)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
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
