/**
 * server.test.ts — 主 seam：MCP 請求邊界。
 * 對真正的 createMcpHandler fetch handler 灌 JSON-RPC，stub 掉對證交所的出站 fetch，
 * 斷言 MCP client 會看到的回應。這一層測工具註冊 + 參數傳遞 + core/twse 接線，
 * 內部模組怎麼重構都不影響。
 *
 * 這個 seam 跑兩遍，一遍一個協定 era（詞彙見 CONTEXT.md）。同一組工具斷言在
 * legacy 與 modern 下各跑一次，兩條 lane 才不會偷偷分岔——這是本檔存在的第二個理由，
 * 也是唯一擋得住「相依升級後協定行為無聲改變」的東西。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "../src/server";
import { fetchQuotes } from "../src/twse";

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

/**
 * MIS 即時報價站的真實回應形狀：content-type 是 `text/html`，body 卻是前面墊了
 * 一堆換行的合法 JSON。先前這裡也用 jsonResponse()，於是 fetchJson 一度改成拿
 * content-type 當閘門時，測試全綠、線上卻整支工具壞掉。mock 要貼著上游，
 * 不是貼著我們希望上游長的樣子。
 */
function misResponse(v: unknown) {
  return new Response("\n".repeat(20) + JSON.stringify(v), {
    status: 200,
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
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
          return misResponse({
            msgArray: [{ c: "00679B", n: "元大美債20年", z: "26.68", y: "26.51", o: "26.57", h: "26.69", l: "26.56", v: "15501", t: "13:30:00" }],
          });
        }
        // 依 ex_ch 裡實際帶了幾檔就回幾筆，多檔查詢才驗得到東西
        const codes = [...u.matchAll(/tse_([^.]+)\.tw/g)].map((m) => m[1]);
        return misResponse({
          msgArray: codes.map((c) => ({ c, z: "38.45", t: "13:30:00" })),
        });
      }
      return jsonResponse([]);
    }),
  );
});

// --- 協定 era ---
// era 判定是純 claim-based：params._meta 裡有沒有協定版本這個保留鍵。header 只做
// 交叉驗證，本身不決定 era。這兩個常數是規範定義的保留鍵，寫死在測試裡（CI 離線，
// 不從相依 re-export，否則相依改了值測試會跟著改、就守不住任何東西）。
const MODERN_REVISION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";

const ERAS = ["legacy", "modern"] as const;
type Era = (typeof ERAS)[number];

/** 與 src/server.ts 的快取提示對齊。寫死而非 import，這樣值被改動時測試會紅。 */
const TOOL_LIST_TTL_MS = 3_600_000;

function mcpRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: "localhost",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * 依 era 建構請求。
 * - legacy：裸 JSON-RPC，什麼都不加。
 * - modern：params._meta 帶兩個必填保留鍵，並補上必填的 MCP-Protocol-Version 與
 *   Mcp-Method 標頭；tools/call 另需 Mcp-Name。標頭與 body 不一致會被判 -32020，
 *   所以這裡刻意從 body 推導標頭，而不是各寫一份。
 */
function eraRequest(era: Era, method: string, params: Record<string, unknown>) {
  if (era === "legacy") {
    return mcpRequest({ jsonrpc: "2.0", id: 1, method, params });
  }
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MODERN_REVISION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  };
  const headers: Record<string, string> = {
    "MCP-Protocol-Version": MODERN_REVISION,
    "Mcp-Method": method,
  };
  if (method === "tools/call" && typeof params.name === "string") {
    headers["Mcp-Name"] = params.name;
  }
  return mcpRequest(body, headers);
}

/** 解析回應：modern 的單次交換回純 JSON，legacy 走 SSE，兩種都要接得住。 */
async function readPayload(res: Response) {
  const text = await res.text();
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) throw new Error(`no SSE data line in: ${text}`);
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(text);
}

async function send(request: Request) {
  const handler = createMcpHandler(createServer);
  return handler(request, {}, ctx);
}

function rpcFor(era: Era) {
  return async function rpc(method: string, params: Record<string, unknown>) {
    const res = await send(eraRequest(era, method, params));
    expect(res.status).toBe(200);
    return readPayload(res);
  };
}

/** 出站請求過的所有網址。 */
function fetchedUrls(): string[] {
  return (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
}

/** 這次打到即時報價站的網址（沒打到就是 undefined）。 */
function quoteUrl(): string | undefined {
  return fetchedUrls().find((u) => u.includes("getStockInfo"));
}

describe.each(ERAS)("MCP handler seam（%s era）", (era) => {
  const rpc = rpcFor(era);

  /** 呼叫工具並把 content[0].text（本身是 JSON 字串）解回物件。 */
  async function callTool(name: string, args: Record<string, unknown>) {
    const payload = await rpc("tools/call", { name, arguments: args });
    if (payload.error) throw new Error(JSON.stringify(payload.error));
    return JSON.parse(payload.result.content[0].text);
  }

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

  // match/fields 的每個元素都會在整份資料集上再跑一輪 filter/map。上限讓最壞
  // 情況可預期，但不能訂得比合法用法低——目錄裡最寬的資料集有 68 個欄位。
  it("twse_get_dataset：fields 給滿 68 個欄位（目錄最寬的資料集）仍可通過", async () => {
    const many = Array.from({ length: 68 }, (_, i) => `F${i}`);
    const out = await callTool("twse_get_dataset", {
      dataset_id: "exchangeReport/STOCK_DAY_ALL",
      fields: many,
    });
    expect(out.dataset_id).toBe("exchangeReport/STOCK_DAY_ALL");
  });

  it("twse_get_dataset：fields 超過 100 個被擋下", async () => {
    const payload = await rpc("tools/call", {
      name: "twse_get_dataset",
      arguments: {
        dataset_id: "exchangeReport/STOCK_DAY_ALL",
        fields: Array.from({ length: 101 }, (_, i) => `F${i}`),
      },
    });
    expect(payload.result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("twse_get_dataset：match 超過 20 個欄位被擋下", async () => {
    const match = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`F${i}`, "x"]));
    const payload = await rpc("tools/call", {
      name: "twse_get_dataset",
      arguments: { dataset_id: "exchangeReport/STOCK_DAY_ALL", match },
    });
    expect(payload.result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  // tools/list 講的話要跟實際擋的一致：fields 的上限轉得成 maxItems，
  // match 的 refine 轉不成，所以那個上限必須出現在 description 裡。
  it("tools/list：兩個上限對呼叫端都是可見的", async () => {
    const payload = await rpc("tools/list", {});
    const tool = payload.result.tools.find(
      (t: { name: string }) => t.name === "twse_get_dataset",
    );
    expect(tool.inputSchema.properties.fields.maxItems).toBe(100);
    expect(tool.inputSchema.properties.match.description).toContain("最多 20 個欄位");
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

  // 出站網址是用字串拼的，代號帶 # 會把後面釘死的 json=1&delay=0 整段吃掉。
  // 兩道防線：schema 先擋掉這種代號，fetchQuotes 再 encodeURIComponent。
  it("twse_realtime_quote：非英數代號被擋下，不會發出出站請求", async () => {
    const payload = await rpc("tools/call", {
      name: "twse_realtime_quote",
      arguments: { codes: ["0050#foo"] },
    });
    expect(payload.result.isError).toBe(true);
    expect(quoteUrl()).toBeUndefined();
  });

  // content-type 不是判準：這個回應宣稱 text/html，body 卻是合法 JSON，必須照收。
  // 曾經拿 content-type 當閘門，結果線上整支 twse_realtime_quote 壞掉。
  it("上游宣稱 text/html 但 body 是合法 JSON 時，照樣正常解析", async () => {
    const out = await callTool("twse_realtime_quote", { codes: ["0050"] });
    expect(out.count).toBe(1);
    expect(out.quotes[0].last).toBe("38.45");
  });

  // 2026-08-03 的 refresh-catalog 排程就是死在這個情境：證交所前面那層 nginx
  // 用 2xx 狀態碼回了一張裸 HTML 錯誤頁，res.ok 通過，res.json() 才丟出
  // 「Unexpected token '<'」。模型看到那句話會以為是自己參數給錯。
  it("上游回 2xx + HTML 時，錯誤訊息要指得出是上游問題", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>\n<head><title>503 Service Unavailable</title></head>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    const payload = await rpc("tools/call", {
      name: "twse_get_dataset",
      arguments: { dataset_id: "exchangeReport/STOCK_DAY_ALL" },
    });
    expect(payload.result.isError).toBe(true);
    const text = payload.result.content[0].text;
    expect(text).toContain("上游回的不是 JSON");
    expect(text).toContain("text/html");
    // body 開頭要帶出來，不然下次還是查不出是被擋還是格式變了
    expect(text).toContain("503 Service Unavailable");
    expect(text).not.toContain("Unexpected token");
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

// 不經過 MCP 邊界的一條，所以不跟著 era 跑兩遍。
describe("twse 出站層", () => {
  it("fetchQuotes 對代號做 URL encode，pinned 參數不會被吃掉", async () => {
    await fetchQuotes(["0050#foo"]);
    const calledUrl = quoteUrl()!;
    expect(calledUrl).not.toContain("#");
    expect(calledUrl).toContain("%23");
    expect(calledUrl).toContain("json=1&delay=0");
  });
});

/**
 * 協定 era 本身的行為。上面的 describe.each 驗的是「兩條 lane 的工具行為一致」，
 * 這裡驗的是「兩條 lane 確實是不同的 era」——否則 describe.each 可能只是把同一條
 * lane 跑了兩遍，什麼都沒守到。
 */
describe("協定 era", () => {
  it("modern 的 tools/list 帶結果型別、快取欄位與 serverInfo", async () => {
    const payload = await rpcFor("modern")("tools/list", {});
    expect(payload.result.resultType).toBe("complete");
    expect(payload.result.ttlMs).toBe(TOOL_LIST_TTL_MS);
    expect(payload.result.cacheScope).toBe("public");
    expect(payload.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({
      name: "twse-opendata",
    });
  });

  it("legacy 的 tools/list 不帶結果型別與快取欄位（2025 編碼路徑沒有蓋章邏輯）", async () => {
    const payload = await rpcFor("legacy")("tools/list", {});
    expect(payload.result.resultType).toBeUndefined();
    expect(payload.result.ttlMs).toBeUndefined();
    expect(payload.result.cacheScope).toBeUndefined();
  });

  it("server/discover 在 modern 可呼叫，支援版本含 2026-07-28", async () => {
    const payload = await rpcFor("modern")("server/discover", {});
    expect(payload.result.supportedVersions).toContain(MODERN_REVISION);
    expect(payload.result.capabilities).toHaveProperty("tools");
    expect(payload.result.ttlMs).toBe(TOOL_LIST_TTL_MS);
    expect(payload.result.cacheScope).toBe("public");
  });

  // 工具清單可快取的前提之一是順序穩定，否則 client 每次拿到的清單都算「變了」，
  // LLM 的 prompt cache 也跟著失效。規範列為 SHOULD，本專案本來就固定順序註冊。
  it("工具以固定順序回傳", async () => {
    const first = await rpcFor("modern")("tools/list", {});
    const second = await rpcFor("modern")("tools/list", {});
    const names = (p: { result: { tools: { name: string }[] } }) =>
      p.result.tools.map((t) => t.name);
    expect(names(first)).toEqual(names(second));
  });

  // 這是唯一與 lane 設定無關的 envelope 驗證錯誤：標頭宣告了 modern，body 卻沒有
  // 對應的 claim，兩邊對不上就不能猜，只能拒絕。
  it("帶 modern 協定版本標頭但缺 envelope 的請求被拒", async () => {
    const res = await send(
      mcpRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { "MCP-Protocol-Version": MODERN_REVISION, "Mcp-Method": "tools/list" },
      ),
    );
    expect(res.status).toBe(400);
    const payload = await readPayload(res);
    expect(payload.error.code).toBe(-32602);
  });

  // 沒有 claim、也沒有 modern 標頭 → 走 legacy lane，正常服務。這條守的是
  // 「舊 client 還能用」，也就是本專案暫不做 era 收斂的前提。
  it("既沒有 claim 也沒有標頭的裸請求，仍被 legacy lane 正常服務", async () => {
    const res = await send(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    expect(res.status).toBe(200);
    const payload = await readPayload(res);
    expect(payload.result.tools).toHaveLength(5);
  });
});
