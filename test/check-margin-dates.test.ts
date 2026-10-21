import { describe, expect, it } from "vitest";
import { reconcileMargin, run, verdict } from "../scripts/check-margin-dates.mjs";

// 上游 MI_MARGN 沒有日期欄位；「前日餘額」是上游那一天的前一個交易日的今日餘額。
// 所以拿它去對 D1 每一個已存的日期：日期標對了，吻合的會是上游「前一天」對應的那一天。
const upstream = [
  { 股票代號: "2330", 融資前日餘額: "34,000", 融券前日餘額: "10" },
  { 股票代號: "2317", 融資前日餘額: "20,500", 融券前日餘額: "0" },
  { 股票代號: "2454", 融資前日餘額: "8,100", 融券前日餘額: "55" },
];
const d1 = [
  { code: "2330", date: "2026-10-20", margin_balance: 34000, short_balance: 10 },
  { code: "2317", date: "2026-10-20", margin_balance: 20500, short_balance: 0 },
  { code: "2454", date: "2026-10-20", margin_balance: 8100, short_balance: 55 },
  { code: "2330", date: "2026-10-21", margin_balance: 34401, short_balance: 14 },
  { code: "2317", date: "2026-10-21", margin_balance: 20111, short_balance: 3 },
  { code: "2454", date: "2026-10-21", margin_balance: 8200, short_balance: 60 },
];

describe("reconcileMargin", () => {
  it("每個 D1 日期各算吻合數與吻合率：上游前日餘額對得上的那天是 100%，其他天是 0%", () => {
    const r = reconcileMargin(upstream, d1);
    expect(r.byDate).toEqual([
      { date: "2026-10-20", compared: 3, matched: 3, rate: 1 },
      { date: "2026-10-21", compared: 3, matched: 0, rate: 0 },
    ]);
  });

  it("上游是 - 或空白（沒資料）的檔不算入分母；不吻合的列依差距由大到小，最多 10 檔，帶上游與 D1 的值", () => {
    const rows = [
      { 股票代號: "1101", 融資前日餘額: "-", 融券前日餘額: "-" }, // 沒資料：不比
      { 股票代號: "1102", 融資前日餘額: "", 融券前日餘額: "" }, // 沒資料：不比
      ...Array.from({ length: 12 }, (_, i) => ({ 股票代號: String(2000 + i), 融資前日餘額: "1,000", 融券前日餘額: "0" })),
    ];
    const stored = [
      { code: "1101", date: "2026-10-20", margin_balance: 5, short_balance: 0 },
      { code: "1102", date: "2026-10-20", margin_balance: 5, short_balance: 0 },
      // 2000–2011：融資差 (i+1)*10，2011 差最多；2000 以外的融券也不同
      ...Array.from({ length: 12 }, (_, i) => ({ code: String(2000 + i), date: "2026-10-20", margin_balance: 1000 + (i + 1) * 10, short_balance: 0 })),
    ];
    const r = reconcileMargin(rows, stored);
    expect(r.byDate).toEqual([{ date: "2026-10-20", compared: 12, matched: 0, rate: 0 }]);
    expect(r.mismatches["2026-10-20"]).toHaveLength(10);
    expect(r.mismatches["2026-10-20"][0]).toEqual({ code: "2011", upstream: { margin: 1000, short: 0 }, d1: { margin: 1120, short: 0 } });
    expect(r.mismatches["2026-10-20"][9].code).toBe("2002");
  });
});

describe("reconcileMargin：空白是沒有餘額", () => {
  // 實測 2026-10-21 的 MI_MARGN：融券前日餘額有 567/1302 列是空字串（沒有任何一列寫 0），
  // 意思是沒有融券。D1 把空字串存成 null。只有一邊空時要照常比，而且空與 null 視為 0。
  it("只有融券前日餘額是空白：與 D1 的 null 視為吻合，不能整檔略過", () => {
    const r = reconcileMargin(
      [{ 股票代號: "2330", 融資前日餘額: "34,000", 融券前日餘額: "" }],
      [{ code: "2330", date: "2026-10-20", margin_balance: 34000, short_balance: null }],
    );
    expect(r.byDate).toEqual([{ date: "2026-10-20", compared: 1, matched: 1, rate: 1 }]);
  });

  it("空白與 D1 的非零值不吻合", () => {
    const r = reconcileMargin(
      [{ 股票代號: "2330", 融資前日餘額: "34,000", 融券前日餘額: "" }],
      [{ code: "2330", date: "2026-10-20", margin_balance: 34000, short_balance: 14 }],
    );
    expect(r.byDate[0]).toMatchObject({ compared: 1, matched: 0 });
  });
});

describe("verdict", () => {
  const day = (date: string, matched: number, compared = 100) => ({ date, compared, matched, rate: matched / compared });

  it("最高吻合率的日期達 95% 就是通過，並指出是哪一天", () => {
    expect(verdict([day("2026-10-20", 97), day("2026-10-21", 2)])).toMatchObject({ ok: true, bestDate: "2026-10-20", bestRate: 0.97 });
  });

  it("最高吻合率沒達 95%：不通過，不管是低一點還是整個對不上；剛好 95% 算通過", () => {
    expect(verdict([day("2026-10-20", 94), day("2026-10-21", 1)]).ok).toBe(false);
    expect(verdict([day("2026-10-20", 3), day("2026-10-21", 1)]).ok).toBe(false);
    expect(verdict([day("2026-10-20", 95), day("2026-10-21", 1)]).ok).toBe(true);
  });

  it("只有一個 D1 日期：前一個交易日還沒存到，無法對帳，說明原因而不是印 0%", () => {
    const v = verdict([day("2026-10-20", 0)]);
    expect(v).toMatchObject({ ok: null, bestDate: null });
    expect(v.reason).toMatch(/前一個交易日|至少兩/);
  });
});

describe("run（上游與 D1 讀取由外部注入）", () => {
  function harness(opts: { upstream?: unknown[]; d1?: unknown[] } = {}) {
    const lines: string[] = [];
    const sql: string[] = [];
    const deps = {
      fetchUpstream: async () => (opts.upstream ?? upstream) as never,
      queryD1: async (q: string) => (sql.push(q), (opts.d1 ?? d1) as never),
      log: (l: string) => lines.push(l),
    };
    return { deps, out: () => lines.join("\n"), sql };
  }

  it("吻合：印出每個日期的吻合率與結論，結束碼 0", async () => {
    const h = harness();
    expect(await run(h.deps)).toBe(0);
    expect(h.out()).toContain("2026-10-20");
    expect(h.out()).toContain("100.0%");
    expect(h.out()).toContain("2026-10-21");
    expect(h.out()).toMatch(/通過/);
  });

  it("沒達門檻：結束碼 1，結論說不通過，並列出吻合率最高那天不吻合的檔（代號、上游值、D1 值）", async () => {
    // 上游前日餘額只有 2330 對得上 10-20；2317、2454 的 D1 值不同
    const h = harness({
      d1: [
        { code: "2330", date: "2026-10-20", margin_balance: 34000, short_balance: 10 },
        { code: "2317", date: "2026-10-20", margin_balance: 999, short_balance: 0 },
        { code: "2454", date: "2026-10-20", margin_balance: 1, short_balance: 55 },
        { code: "2330", date: "2026-10-21", margin_balance: 34401, short_balance: 14 },
      ],
    });
    expect(await run(h.deps)).toBe(1);
    expect(h.out()).toMatch(/不通過/);
    expect(h.out()).toContain("2317");
    expect(h.out()).toMatch(/上游 20,?500/);
    expect(h.out()).toMatch(/D1 999/);
  });

  it("D1 只有一個日期：結束碼 2，說明前一個交易日還沒存到，不拿 0% 當結論", async () => {
    const h = harness({ d1: d1.filter((r) => r.date === "2026-10-21") });
    expect(await run(h.deps)).toBe(2);
    expect(h.out()).toMatch(/至少要兩個交易日/);
    expect(h.out()).not.toMatch(/不通過|通過/);
  });

  it("只下一條唯讀 SELECT，而且只讀最近幾個日期，不掃整張表", async () => {
    const h = harness();
    await run(h.deps);
    expect(h.sql).toHaveLength(1);
    expect(h.sql[0]).toMatch(/^\s*SELECT\b/i);
    expect(h.sql[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
    expect(h.sql[0]).toMatch(/LIMIT\s+\d+/i); // 表每天多約 1,300 列，限制讀取列數
  });

  it("D1 或上游讀取失敗：結束碼 2，印出原因，不丟例外", async () => {
    const h = harness();
    expect(await run({ ...h.deps, queryD1: async () => { throw new Error("no such table: margin_daily"); } })).toBe(2);
    expect(h.out()).toContain("no such table: margin_daily");
    const h2 = harness();
    expect(await run({ ...h2.deps, fetchUpstream: async () => { throw new Error("上游 503"); } })).toBe(2);
    expect(h2.out()).toContain("上游 503");
  });
});

