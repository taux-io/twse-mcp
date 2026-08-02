/**
 * server.test.ts — 主 seam：MCP 請求邊界。
 * 對真正的 createMcpHandler fetch handler 灌 JSON-RPC，stub 掉對證交所的出站 fetch，
 * 斷言 MCP client 會看到的回應。這一層測工具註冊 + 參數傳遞 + core/twse 接線，
 * 內部模組怎麼重構都不影響。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "../src/server";

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

// --- 證交所回應 fixtures，依 URL 路由 ---
const FUNDS = [
  {
    基金代號: "0056",
    基金簡稱: "元大高股息",
    基金類型: "ETF",
    "標的指數/追蹤指數名稱": "臺灣高股息指數",
    "發行單位數/轉換數": "30,000,000,000",
  },
];
const DAY = [
  { Code: "0056", Name: "元大高股息", Date: "20260727", ClosingPrice: "38.2", Change: "0.3", TradeVolume: "44,120,000" },
  { Code: "2330", Name: "台積電", Date: "20260727", ClosingPrice: "1,000", Change: "-5", TradeVolume: "20,000" },
];
const RANKS = [{ ETFsSecurityCode: "0056", No: "2", ETFsNumberofTradingAccounts: "380,000" }];

function jsonResponse(v: unknown) {
  return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("STOCK_DAY_ALL")) return jsonResponse(DAY);
      if (u.includes("t187ap47_L")) return jsonResponse(FUNDS);
      if (u.includes("ETFRank")) return jsonResponse(RANKS);
      if (u.includes("getStockInfo")) {
        // 依 ex_ch 帶的市場別回不同標的，才能驗證 market 有真的傳到出站請求
        const otc = u.includes("otc_");
        if (otc) {
          return jsonResponse({
            msgArray: [{ c: "00679B", n: "元大美債20年", z: "26.68", y: "26.51", o: "26.57", h: "26.69", l: "26.56", v: "15501", t: "13:30:00" }],
          });
        }
        // 依 ex_ch 裡實際帶了幾檔就回幾筆，多檔查詢才驗得到東西
        const codes = [...u.matchAll(/tse_([^.]+)\.tw/g)].map((m) => m[1]);
        return jsonResponse({
          msgArray: codes.map((c) => ({ c, z: "38.45", t: "13:30:00" })),
        });
      }
      return jsonResponse([]);
    }),
  );
});

function mcpRequest(body: unknown) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: "localhost",
    },
    body: JSON.stringify(body),
  });
}

/** 解析 streamable-http 的 SSE 回應，回傳 JSON-RPC payload。 */
async function rpc(method: string, params: unknown) {
  const handler = createMcpHandler(createServer);
  const res = await handler(mcpRequest({ jsonrpc: "2.0", id: 1, method, params }), {}, ctx);
  expect(res.status).toBe(200);
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) throw new Error(`no SSE data line in: ${text}`);
  return JSON.parse(dataLine.slice("data:".length).trim());
}

/** 出站請求過的所有網址。 */
function fetchedUrls(): string[] {
  return (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
}

/** 這次打到即時報價站的網址（沒打到就是 undefined）。 */
function quoteUrl(): string | undefined {
  return fetchedUrls().find((u) => u.includes("getStockInfo"));
}

/** 呼叫工具並把 content[0].text（本身是 JSON 字串）解回物件。 */
async function callTool(name: string, args: Record<string, unknown>) {
  const payload = await rpc("tools/call", { name, arguments: args });
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return JSON.parse(payload.result.content[0].text);
}

describe("MCP handler seam", () => {
  it("tools/list 暴露 5 個工具（含 egress 驗通後開放的 realtime_quote）", async () => {
    const payload = await rpc("tools/list", {});
    const names = payload.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      [
        "twse_etf_snapshot",
        "twse_describe_dataset",
        "twse_get_dataset",
        "twse_realtime_quote",
        "twse_search_datasets",
      ].sort(),
    );
  });

  it("twse_search_datasets：ETF 別名命中真實目錄裡的基金表", async () => {
    const out = await callTool("twse_search_datasets", { query: "ETF" });
    const ids = out.results.map((r: { dataset_id: string }) => r.dataset_id);
    expect(ids).toContain("opendata/t187ap47_L");
  });

  it("twse_describe_dataset：回真實目錄的欄位定義", async () => {
    const out = await callTool("twse_describe_dataset", { dataset_id: "exchangeReport/STOCK_DAY_ALL" });
    expect(out.id).toBe("exchangeReport/STOCK_DAY_ALL");
    expect(out.fields).toHaveProperty("ClosingPrice");
  });

  it("twse_get_dataset：code 過濾 + 伺服器端投影", async () => {
    const out = await callTool("twse_get_dataset", {
      dataset_id: "exchangeReport/STOCK_DAY_ALL",
      code: "0056",
      fields: ["Code", "ClosingPrice"],
    });
    expect(out.rows_matched).toBe(1);
    expect(out.data).toEqual([{ Code: "0056", ClosingPrice: "38.2" }]);
  });

  it("twse_get_dataset：未知 dataset 不觸發 fetch，直接回 error", async () => {
    const out = await callTool("twse_get_dataset", { dataset_id: "no/such/dataset" });
    expect(out.error).toContain("找不到");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("twse_etf_snapshot：三表合併，realtime 預設不查", async () => {
    const out = await callTool("twse_etf_snapshot", { code: "0056" });
    expect(out.is_etf).toBe(true);
    expect(out.profile.追蹤指數).toBe("臺灣高股息指數");
    expect(out.quote.收盤).toBe(38.2);
    expect(out.regular_savings.交易戶數).toBe(380000);
    expect(out.realtime).toBe("未查詢");
    // 未帶 include_realtime 時不應打即時報價站
    const calledMis = quoteUrl() !== undefined;
    expect(calledMis).toBe(false);
  });

  it("twse_etf_snapshot：include_realtime 時才附上即時報價", async () => {
    const out = await callTool("twse_etf_snapshot", { code: "0056", include_realtime: true });
    expect(Array.isArray(out.realtime)).toBe(true);
    expect(out.realtime[0].last).toBe("38.45");
  });

  it("twse_realtime_quote：回映射後的報價，且 market 帶進出站請求", async () => {
    const out = await callTool("twse_realtime_quote", { codes: ["0056"], market: "tse" });
    expect(out.count).toBe(1);
    expect(out.quotes[0]).toMatchObject({ code: "0056", last: "38.45", time: "13:30:00" });
    const calledUrl = quoteUrl();
    expect(calledUrl).toContain("tse_0056.tw");
  });

  // 上櫃即時報價是已上線、且工具描述明文承諾的能力，必須有測試守住。
  // （上櫃的 OpenAPI 資料集取不到，但即時報價站沒有封鎖，這條路是通的。）
  it('twse_realtime_quote：market="otc" 查得到上櫃標的，且出站帶 otc_ 前綴', async () => {
    const out = await callTool("twse_realtime_quote", { codes: ["00679B"], market: "otc" });
    expect(out.count).toBe(1);
    // README 承諾上櫃「查得到現在的價格、今天的開高低、昨天的收盤、成交量」。
    // 這些欄位跟著即時報價一起來，不是走取不到的上櫃資料集。
    // 逐項斷言，包含 high/low——先前漏掉它們，等於文件承諾了卻沒人守。
    expect(out.quotes[0]).toMatchObject({
      code: "00679B",
      name: "元大美債20年",
      last: "26.68",
      open: "26.57",
      high: "26.69",
      low: "26.56",
      prev_close: "26.51",
      volume: "15501",
    });
    const calledUrl = quoteUrl();
    expect(calledUrl).toContain("otc_00679B.tw");
    expect(calledUrl).not.toContain("tse_");
  });

  it("twse_realtime_quote：多檔一次查，全部帶進同一個請求", async () => {
    const out = await callTool("twse_realtime_quote", { codes: ["0050", "0056", "2330"] });
    const calledUrl = quoteUrl();
    for (const c of ["tse_0050.tw", "tse_0056.tw", "tse_2330.tw"]) {
      expect(calledUrl).toContain(c);
    }
    // 三個代號要真的變成三筆回應，而不是「有回東西就算過」
    expect(out.count).toBe(3);
    expect(out.quotes.map((q: { code: string }) => q.code)).toEqual(["0050", "0056", "2330"]);
  });

  it("twse_etf_snapshot：查無上市資料時，caveat 要指向做得到的替代路徑（otc 即時報價）", async () => {
    const out = await callTool("twse_etf_snapshot", { code: "00679B" });
    const joined = out.caveats.join("\n");
    expect(joined).toContain("twse_realtime_quote");
    expect(joined).toContain('market="otc"');
    // 不該再叫使用者自己去查櫃買中心——那是本服務取不到、而使用者也不見得能取到的路
    expect(joined).not.toContain("需查櫃買中心");
  });
});
