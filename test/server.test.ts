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
      if (u.includes("getStockInfo")) return jsonResponse({ msgArray: [{ c: "0056", z: "38.45", t: "13:30:00" }] });
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

/** 呼叫工具並把 content[0].text（本身是 JSON 字串）解回物件。 */
async function callTool(name: string, args: Record<string, unknown>) {
  const payload = await rpc("tools/call", { name, arguments: args });
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return JSON.parse(payload.result.content[0].text);
}

describe("MCP handler seam", () => {
  it("tools/list 只暴露 4 個 OpenAPI 工具（v1 不含 realtime_quote）", async () => {
    const payload = await rpc("tools/list", {});
    const names = payload.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      ["etf_snapshot", "twse_describe_dataset", "twse_get_dataset", "twse_search_datasets"].sort(),
    );
    expect(names).not.toContain("twse_realtime_quote");
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

  it("etf_snapshot：三表合併，realtime 預設不查", async () => {
    const out = await callTool("etf_snapshot", { code: "0056" });
    expect(out.is_etf).toBe(true);
    expect(out.profile.追蹤指數).toBe("臺灣高股息指數");
    expect(out.quote.收盤).toBe(38.2);
    expect(out.regular_savings.交易戶數).toBe(380000);
    expect(out.realtime).toBe("未查詢");
    // 未帶 include_realtime 時不應打即時報價站
    const calledMis = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) =>
      String(c[0]).includes("getStockInfo"),
    );
    expect(calledMis).toBe(false);
  });

  it("etf_snapshot：include_realtime 時才附上即時報價", async () => {
    const out = await callTool("etf_snapshot", { code: "0056", include_realtime: true });
    expect(Array.isArray(out.realtime)).toBe(true);
    expect(out.realtime[0].last).toBe("38.45");
  });
});
