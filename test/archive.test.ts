import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveDailyQuotes, quoteTuples } from "../src/archive";

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
