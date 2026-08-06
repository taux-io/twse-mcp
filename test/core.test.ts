/**
 * core.test.ts — 次 seam：純轉換函式單元測試。
 * 這是 Python 版離線測試那 29 個 case 的落點：證交所資料怪癖。
 * （Python 版已移除，保存於 tag python-stdio-v0.1）
 * 不碰網路、不碰 Worker runtime。
 */
import { describe, expect, it } from "vitest";
import {
  buildEtfSnapshot,
  describeDataset,
  detectCodeField,
  firstRow,
  getDataset,
  num,
  resolveDataset,
  searchDatasets,
  type Catalog,
  type Row,
} from "../src/core";

// --- 迷你目錄 fixture（對應 Python 版的 FAKE_SWAGGER） ---
const CATALOG: Catalog = {
  "exchangeReport/STOCK_DAY_ALL": {
    id: "exchangeReport/STOCK_DAY_ALL",
    summary: "上市個股日成交資訊",
    description: "上市個股日成交資訊",
    tags: ["證券交易"],
    fields: { Code: "證券代號", Name: "證券名稱", ClosingPrice: "收盤價", TradeVolume: "成交股數" },
  },
  "opendata/t187ap47_L": {
    id: "opendata/t187ap47_L",
    summary: "基金基本資料彙總表",
    description: "基金基本資料彙總表",
    tags: ["其他"],
    fields: { 基金代號: "基金代號", 基金簡稱: "基金簡稱", 基金類型: "基金類型" },
  },
  "ETFReport/ETFRank": {
    id: "ETFReport/ETFRank",
    summary: "定期定額交易戶數統計排行月報表",
    description: "",
    tags: ["券商資料"],
    fields: { ETFsSecurityCode: "ETF代號", ETFsName: "ETF名稱" },
  },
};

describe("num — 證交所字串數字正規化", () => {
  it("去逗號", () => expect(num("1,234.5")).toBe(1234.5));
  it("'--' -> null", () => expect(num("--")).toBeNull());
  it("'-' -> null", () => expect(num("-")).toBeNull());
  it("'N/A' -> null", () => expect(num("N/A")).toBeNull());
  it("空字串 -> null", () => expect(num("")).toBeNull());
  it("純空白 -> null", () => expect(num("   ")).toBeNull());
  it("null/undefined -> null", () => {
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });
  it("純小數字串", () => expect(num("3.14")).toBe(3.14));
  it("已是數字", () => expect(num(42)).toBe(42));
  it("帶前後空白", () => expect(num("  38.2 ")).toBe(38.2));
});

describe("detectCodeField — 跨表不一致代號欄位偵測", () => {
  it("Code", () => expect(detectCodeField({ Code: "0050", Name: "x" })).toBe("Code"));
  it("基金代號", () => expect(detectCodeField({ 基金代號: "0050" })).toBe("基金代號"));
  it("ETFsSecurityCode", () => expect(detectCodeField({ ETFsSecurityCode: "0056" })).toBe("ETFsSecurityCode"));
  it("無可辨識欄位 -> null", () => expect(detectCodeField({ Foo: "bar" })).toBeNull());
  it("依 CODE_FIELDS 順序，Code 優先於 基金代號", () =>
    expect(detectCodeField({ 基金代號: "a", Code: "b" })).toBe("Code"));
});

describe("firstRow", () => {
  const rows: Row[] = [{ Code: "0050" }, { Code: " 0056 " }, { Code: "2330" }];
  it("命中（含去空白）", () => expect(firstRow(rows, "Code", "0056")).toEqual({ Code: " 0056 " }));
  it("查詢值去空白", () => expect(firstRow(rows, "Code", " 0050 ")).toEqual({ Code: "0050" }));
  it("找不到 -> null", () => expect(firstRow(rows, "Code", "9999")).toBeNull());
});

describe("searchDatasets", () => {
  it("關鍵字比對 summary/欄位", () => {
    const r = searchDatasets(CATALOG, { query: "日成交" });
    expect(r.results.map((x) => x.dataset_id)).toContain("exchangeReport/STOCK_DAY_ALL");
  });
  it("別名：ETF 命中命名對不上的基金表，並標 note", () => {
    const r = searchDatasets(CATALOG, { query: "ETF" });
    const ids = r.results.map((x) => x.dataset_id);
    expect(ids).toContain("opendata/t187ap47_L");
    expect(ids).toContain("ETFReport/ETFRank");
    expect(r.results.find((x) => x.dataset_id === "opendata/t187ap47_L")?.note).toBe("別名命中");
  });
  it("tag 過濾", () => {
    const r = searchDatasets(CATALOG, { tag: "券商資料" });
    expect(r.results.map((x) => x.dataset_id)).toEqual(["ETFReport/ETFRank"]);
  });
  it("空查詢列出全部", () => {
    const r = searchDatasets(CATALOG, {});
    expect(r.total_matched).toBe(3);
  });
  it("limit 生效但 total_matched 是全量", () => {
    const r = searchDatasets(CATALOG, { limit: 1 });
    expect(r.results).toHaveLength(1);
    expect(r.total_matched).toBe(3);
  });
  it("prototype 上的鍵不會被當成別名", () => {
    // ALIASES["constructor"] 會撈到 Object.prototype.constructor，
    // new Set(Function) 會丟 TypeError，或更糟——靜默命中錯誤的資料集。
    const r = searchDatasets(CATALOG, { query: "constructor" });
    expect(r.total_matched).toBe(0);
  });
});

describe("resolveDataset — 目錄查找/錯誤只此一處", () => {
  it("命中回 { ds }", () => {
    const r = resolveDataset(CATALOG, "ETFReport/ETFRank");
    expect(r).toHaveProperty("ds");
    expect((r as { ds: { id: string } }).ds.id).toBe("ETFReport/ETFRank");
  });
  it("開頭斜線正規化後仍命中", () => {
    expect(resolveDataset(CATALOG, "/ETFReport/ETFRank")).toHaveProperty("ds");
  });
  it("找不到回 { error }，訊息用正規化後的 id", () => {
    const r = resolveDataset(CATALOG, "/no/such") as { error: string };
    expect(r.error).toContain("no/such");
    expect(r.error).not.toContain("/no/such");
  });
});

describe("describeDataset", () => {
  it("回欄位定義", () => {
    const ds = describeDataset(CATALOG, "opendata/t187ap47_L");
    expect(ds).toMatchObject({ id: "opendata/t187ap47_L", summary: "基金基本資料彙總表" });
  });
  it("開頭斜線容忍", () => {
    expect(describeDataset(CATALOG, "/ETFReport/ETFRank")).toMatchObject({ id: "ETFReport/ETFRank" });
  });
  it("找不到 -> error", () => {
    expect(describeDataset(CATALOG, "no/such")).toHaveProperty("error");
  });
  it("__proto__ 不會被當成存在的資料集", () => {
    // 修補前 catalog["__proto__"] 回 Object.prototype（truthy），
    // 於是一個不存在的資料集被報成存在、回一份空的有效結果。
    expect(resolveDataset(CATALOG, "__proto__")).toHaveProperty("error");
    expect(resolveDataset(CATALOG, "constructor")).toHaveProperty("error");
    expect(describeDataset(CATALOG, "__proto__")).toHaveProperty("error");
  });
});

describe("getDataset — 過濾/投影/分頁", () => {
  const day = CATALOG["exchangeReport/STOCK_DAY_ALL"];
  const rows: Row[] = [
    { Code: "0050", Name: "元大台灣50", ClosingPrice: "180.5", TradeVolume: "1,000" },
    { Code: "0056", Name: "元大高股息", ClosingPrice: "38.2", TradeVolume: "44,120,000" },
    { Code: "2330", Name: "台積電", ClosingPrice: "1,000", TradeVolume: "20,000" },
  ];

  it("code 過濾（自動偵測 Code 欄位）", () => {
    const r = getDataset(day, rows, { code: "0056" }) as any;
    expect(r.rows_matched).toBe(1);
    expect(r.data[0].Name).toBe("元大高股息");
    expect(r.rows_in_source).toBe(3);
  });
  it("查無代號欄位 + 給 code -> error 附 available_fields", () => {
    const r = getDataset(day, [{ Foo: "bar", Baz: "qux" }], { code: "0050" }) as any;
    expect(r.error).toContain("沒有可辨識的代號欄位");
    expect(r.available_fields).toEqual(["Foo", "Baz"]);
  });
  it("match 子字串過濾", () => {
    const r = getDataset(day, rows, { match: { Name: "元大" } }) as any;
    expect(r.rows_matched).toBe(2);
  });
  it("fields 投影", () => {
    const r = getDataset(day, rows, { code: "0050", fields: ["Code", "ClosingPrice"] }) as any;
    expect(Object.keys(r.data[0])).toEqual(["Code", "ClosingPrice"]);
  });
  it("分頁 offset/limit", () => {
    const r = getDataset(day, rows, { limit: 1, offset: 1 }) as any;
    expect(r.returned).toBe(1);
    expect(r.offset).toBe(1);
    expect(r.data[0].Code).toBe("0056");
  });
  it("limit 超過硬上限被夾到 200", () => {
    const many: Row[] = Array.from({ length: 500 }, (_, i) => ({ Code: String(i) }));
    const r = getDataset(day, many, { limit: 500 }) as any;
    expect(r.returned).toBe(200);
    expect(r.rows_matched).toBe(500);
  });
  it("負數 limit 不會反向繞過硬上限", () => {
    const many: Row[] = Array.from({ length: 500 }, (_, i) => ({ Code: String(i) }));
    const r = getDataset(day, many, { limit: -1 }) as any;
    expect(r.returned).toBe(0);
    expect(r.rows_matched).toBe(500);
  });
  it("fields 投影不會撈到 prototype 上的成員", () => {
    const r = getDataset(day, rows, { code: "0050", fields: ["Code", "toString"] }) as any;
    expect(Object.keys(r.data[0])).toEqual(["Code"]);
  });
  it("負數 offset 當作 0", () => {
    const r = getDataset(day, rows, { limit: 1, offset: -5 }) as any;
    expect(r.returned).toBe(1);
    expect(r.offset).toBe(0);
    expect(r.data[0].Code).toBe("0050");
  });
});

describe("buildEtfSnapshot — 三表合併", () => {
  const funds: Row[] = [
    {
      基金代號: "0056",
      基金簡稱: "元大高股息",
      基金中文名稱: "元大台灣高股息證券投資信託基金",
      基金類型: "ETF",
      "標的指數/追蹤指數名稱": "臺灣高股息指數",
      "發行單位數/轉換數": "30,000,000,000",
      出表日期: "1150727",
    },
  ];
  const days: Row[] = [
    {
      Code: "0056",
      Name: "元大高股息",
      Date: "20260727",
      ClosingPrice: "38.2",
      Change: "0.3",
      OpeningPrice: "38.0",
      TradeVolume: "44,120,000",
    },
  ];
  const ranks: Row[] = [{ ETFsSecurityCode: "0056", No: "2", ETFsNumberofTradingAccounts: "380,000" }];

  it("完整合併：profile/quote/savings/derived + is_etf", () => {
    const r = buildEtfSnapshot("0056", { funds, days, ranks, includeRealtime: false }) as any;
    expect(r.is_etf).toBe(true);
    expect(r.name).toBe("元大高股息");
    expect(r.profile.追蹤指數).toBe("臺灣高股息指數");
    expect(r.quote.收盤).toBe(38.2);
    expect(r.regular_savings.交易戶數).toBe(380000);
    expect(r.derived.市值粗估_億元).toBeCloseTo((30_000_000_000 * 38.2) / 1e8, 1);
    expect(r.realtime).toBe("未查詢");
  });
  it("漲跌幅% 由收盤與漲跌推回前收算出", () => {
    const r = buildEtfSnapshot("0056", { funds, days, ranks, includeRealtime: false }) as any;
    // prev = 38.2 - 0.3 = 37.9; pct = 0.3/37.9*100 ≈ 0.79
    expect(r.quote["漲跌幅%"]).toBeCloseTo(0.79, 2);
  });
  it("市值粗估附上『不是基金規模』的 caveat", () => {
    const r = buildEtfSnapshot("0056", { funds, days, ranks, includeRealtime: false }) as any;
    expect(r.caveats.some((c: string) => c.includes("不是基金規模"))).toBe(true);
  });
  it("代號不在基金表 -> profile null + caveat", () => {
    const r = buildEtfSnapshot("9999", { funds, days, ranks, includeRealtime: false }) as any;
    expect(r.profile).toBeNull();
    expect(r.caveats.some((c: string) => c.includes("不在證交所基金基本資料彙總表"))).toBe(true);
  });
  it("非 ETF 類型 -> is_etf false + caveat", () => {
    const bond: Row[] = [{ 基金代號: "0056", 基金簡稱: "x", 基金類型: "債券型" }];
    const r = buildEtfSnapshot("0056", { funds: bond, days: [], ranks: [], includeRealtime: false }) as any;
    expect(r.is_etf).toBe(false);
    expect(r.caveats.some((c: string) => c.includes("不是 ETF"))).toBe(true);
  });
  it("真實 ETF 類型字串（指數股票型，不含字面 ETF）-> is_etf true 且無誤導 caveat", () => {
    // 這是 0056 在證交所的實際 基金類型，離線 fixture 之前測不到
    const real: Row[] = [
      { 基金代號: "0056", 基金簡稱: "元大高股息", 基金類型: "國內成分證券指數股票型基金" },
    ];
    const r = buildEtfSnapshot("0056", { funds: real, days: [], ranks: [], includeRealtime: false }) as any;
    expect(r.is_etf).toBe(true);
    expect(r.caveats.some((c: string) => c.includes("不是 ETF"))).toBe(false);
  });
  it("國外成分/期貨型等其他 ETF 種類也認得（都帶「指數股票型」）", () => {
    for (const t of ["國外成分證券指數股票型基金", "指數股票型期貨信託基金"]) {
      const funds2: Row[] = [{ 基金代號: "00X", 基金簡稱: "x", 基金類型: t }];
      const r = buildEtfSnapshot("00X", { funds: funds2, days: [], ranks: [], includeRealtime: false }) as any;
      expect(r.is_etf, t).toBe(true);
    }
  });
  it("來源抓取失敗 -> caveat 標記", () => {
    const r = buildEtfSnapshot("0056", {
      funds,
      days,
      ranks,
      includeRealtime: false,
      errors: [{ source: "日成交資訊", error: "TypeError" }],
    }) as any;
    expect(r.caveats.some((c: string) => c.includes("日成交資訊取得失敗"))).toBe(true);
  });
});
