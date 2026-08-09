/**
 * server.ts — MCP handler 薄殼。
 * ==============================
 * 把 core 的純邏輯 + twse 的出站層接成 5 個 MCP 工具，用 createMcpHandler 以
 * stateless streamable-http 對外服務（端點 /mcp）。不需 Durable Objects。
 *
 * 工具一律以 `twse_` 為前綴，標示資料來自證交所（即時報價站也是證交所營運，
 * 且同時涵蓋上市與上櫃）。詞彙定義見 CONTEXT.md。
 */
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import catalogJson from "./catalog.generated.json";
import {
  buildEtfSnapshot,
  describeDataset,
  getDataset,
  resolveDataset,
  searchDatasets,
  type Catalog,
  type Row,
} from "./core";
import { DS_DAY, DS_FUND, DS_RANK, fetchDataset, fetchQuotes } from "./twse";

const catalog = catalogJson as unknown as Catalog;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] };
}

/**
 * 工具清單的快取效期。
 *
 * 五個工具寫死在這支檔案裡，執行期永不改變——只有重新部署才會變，所以理論上可以設得
 * 更長。壓在 1 小時是因為工具描述是本專案最常微調的東西，「線上說法與 repo 不一致」
 * 的窗口比多拿一點快取效益更值得在意。
 *
 * SDK 的預設是 `ttlMs: 0` + `cacheScope: "private"`（合規但最壞值：等於告訴每個 client
 * 這份清單完全不可快取、且只有你能存）。只影響 modern era——legacy 的編碼路徑沒有
 * 快取欄位。
 */
const CACHE_TTL_MS = 3_600_000;

export function createServer() {
  const server = new McpServer(
    { name: "twse-opendata", version: "0.2.0" },
    {
      cacheHints: {
        // "public"：服務公開、不認證，所有請求者拿到同一份清單，這是對真實可見度的
        // 誠實描述。規範明訂這個欄位不得當作存取控制使用，此處也不作此用。
        // 一旦導入認證，這個值就從誠實變成錯誤，而且是安靜地錯（共享快取會跨授權
        // 情境重用回應）——見 docs/adr/0001。
        "tools/list": { ttlMs: CACHE_TTL_MS, cacheScope: "public" },
        "server/discover": { ttlMs: CACHE_TTL_MS, cacheScope: "public" },
      },
    },
  );

  server.registerTool(
    "twse_search_datasets",
    {
      description:
        "搜尋證交所 OpenAPI 有哪些資料集可用。取資料前先用這個找 dataset_id。" +
        "會比對資料集代號、中文說明與欄位名稱。",
      inputSchema: {
        query: z.string().default("").describe('關鍵字，例如 "ETF"、"融資"、"本益比"。留空列出全部。'),
        tag: z.string().default("").describe('依分類過濾，例如 "證券交易"、"公司治理"、"財務報表"。'),
        // .min(0) 與 core 端的夾值是兩層獨立防守，跟 twse_get_dataset 對等：
        // schema 擋掉合法 client 的手誤，core 擋掉繞過 schema 的呼叫路徑。
        limit: z.number().int().min(0).default(25).describe("最多回傳幾筆（預設 25）。"),
      },
    },
    async ({ query, tag, limit }) => json(searchDatasets(catalog, { query, tag, limit })),
  );

  server.registerTool(
    "twse_describe_dataset",
    {
      description: "查看某個資料集的完整欄位定義，取資料前用來確認要過濾／投影哪些欄位。",
      inputSchema: {
        dataset_id: z
          .string()
          .describe('來自 twse_search_datasets 的資料集代號，例如 "exchangeReport/STOCK_DAY_ALL"。'),
      },
    },
    async ({ dataset_id }) => json(describeDataset(catalog, dataset_id)),
  );

  server.registerTool(
    "twse_get_dataset",
    {
      description:
        "取得證交所資料集內容，支援伺服器端過濾、欄位投影與分頁。" +
        "證交所每個資料集都是一次回整份（可能上千筆），務必用 code/match/fields 縮小範圍。",
      inputSchema: {
        dataset_id: z.string().describe('資料集代號，例如 "exchangeReport/STOCK_DAY_ALL"。'),
        code: z.string().default("").describe('證券／基金代號，例如 "0050"。會自動偵測代號欄位。'),
        // match/fields 的每個元素都會在整份資料集上再跑一輪 filter/map，
        // 元素數乘上筆數就是這支工具的最壞情況 CPU。不是攻擊面（見稽核報告對
        // denial-of-wallet 的否決），但上限是免費的，讓最壞情況可預期。
        // 目錄裡最寬的資料集有 68 個欄位，所以 fields 給 100 —— 要投影全部欄位
        // 永遠不會被擋；沒有人會同時對 20 個欄位下子字串過濾。
        match: z
          .record(z.string(), z.string())
          .refine((m) => Object.keys(m).length <= 20, "match 最多 20 個欄位")
          .optional()
          // refine 在 JSON Schema 裡表達不出來（沒有 maxProperties），tools/list
          // 不會帶上這個上限，所以寫進 description，免得又是一個「說了卻沒守」
          // 或「守了卻沒說」的落差。fields 的 .max() 則會轉成 maxItems。
          .describe('其他欄位的子字串過濾，例如 {"基金類型": "ETF"}。最多 20 個欄位。'),
        fields: z.array(z.string()).max(100).optional().describe("只回傳這些欄位。"),
        limit: z.number().int().min(0).default(30).describe("回傳筆數上限（硬上限 200）。"),
        offset: z.number().int().min(0).default(0).describe("分頁位移。"),
      },
    },
    async ({ dataset_id, code, match, fields, limit, offset }) => {
      const resolved = resolveDataset(catalog, dataset_id);
      if ("error" in resolved) return json(resolved);
      const { ds } = resolved;
      const rows = await fetchDataset(ds.id);
      return json(getDataset(ds, rows, { code, match, fields, limit, offset }));
    },
  );

  server.registerTool(
    "twse_etf_snapshot",
    {
      description:
        "一次取得單一上市 ETF 的完整概況：基本資料 + 前一交易日價量 + 定期定額熱度。" +
        "價量為前一交易日，不是盤中即時；要當下價格請用 twse_realtime_quote。" +
        "合併三個證交所資料集並行查詢。任何一段查不到都會標成 null 並記在 caveats，不會整個失敗。",
      inputSchema: {
        code: z.string().describe('ETF 代號，例如 "0056"、"0050"、"00878"。'),
        include_realtime: z
          .boolean()
          .default(false)
          .describe("是否附上盤中即時報價。預設 false，需要當下價格時才帶 true（多一次外呼）。"),
      },
    },
    async ({ code, include_realtime }) => {
      const tasks: Promise<Row[]>[] = [
        fetchDataset(DS_FUND),
        fetchDataset(DS_DAY),
        fetchDataset(DS_RANK),
      ];
      const rtTask = include_realtime ? fetchQuotes([code]) : null;
      const settled = await Promise.allSettled(tasks);
      const [funds, days, ranks] = settled.map((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      const labels = ["基金基本資料", "日成交資訊", "定期定額排行"];
      const errors = settled
        .map((r, i) => {
          if (r.status !== "rejected") return null;
          const e = r.reason as Error | undefined;
          // 保留 message：只記 name 的話，線上問題會退化成一句沒有資訊的 "TypeError"，
          // 查不出是逾時、被重導、還是被對方擋掉。
          const error = [e?.name ?? "Error", e?.message].filter(Boolean).join(": ");
          return { source: labels[i], error };
        })
        .filter((x): x is { source: string; error: string } => x !== null);

      let realtime: Row[] | null = null;
      if (rtTask) {
        realtime = await rtTask.then(
          (q) => q as unknown as Row[],
          () => [],
        );
      }

      return json(
        buildEtfSnapshot(code, {
          funds,
          days,
          ranks,
          realtime,
          includeRealtime: include_realtime,
          errors,
        }),
      );
    },
  );

  server.registerTool(
    "twse_realtime_quote",
    {
      description:
        "取得盤中即時報價（約 5 秒更新一次）。OpenAPI 只有前一交易日資料，" +
        '要當下的價格得走基本市況報導站。ETF 與上市股票用 market="tse"，上櫃用 "otc"。',
      inputSchema: {
        codes: z
          // trim 在前，維持既有對前後空白的容忍（fetchQuotes 本來就會 trim）。
          .array(z.string().trim().regex(/^[0-9A-Za-z]{1,10}$/, "代號只能是英數字，最多 10 碼"))
          .max(50)
          .describe('代號清單，例如 ["0050", "0056", "2330"]。'),
        market: z.enum(["tse", "otc"]).default("tse").describe('"tse"（上市）或 "otc"（上櫃）。'),
      },
    },
    async ({ codes, market }) => {
      const quotes = await fetchQuotes(codes, market);
      return json({ count: quotes.length, quotes });
    },
  );

  return server;
}

/**
 * 探針只記真正可能是 MCP 請求的流量。
 *
 * 這個常數必須跟 createMcpHandler 的預設 route 一致（我們沒有覆寫它）。不一致的話
 * 探針會靜靜地記錯東西——它沒有回應可以驗證，所以只能靠測試守（見 test 裡的
 * 「不寫探針記錄」那組）。
 */
const MCP_ROUTE = "/mcp";

/**
 * 臨時探針：量測 client 分佈，為「要不要做 era 收斂」累積證據。issue #36。
 * **數週後連同它的測試一起移除。**
 *
 * **判讀規則——先前寫錯過一次，別再錯第二次。**
 * 不要數 `protocolVersion` 是不是 null。2025-era 的 streamable-HTTP client 依規範
 * **必須**在每個請求送 `MCP-Protocol-Version`，值是 `2025-06-18` 之類；它們是
 * legacy，但這個欄位不是 null。按 null 數會把一整批合規的 2025 client 讀成「零
 * legacy 流量」，然後盲切。要按**值**分類：等於 `2026-07-28` 的才算跟上，
 * 其餘（含 null）都還沒。
 *
 * 刻意不記 era。分類為 legacy 的理由有六種（http-method / initialize / no-claim /
 * notification / batch / response），而這裡只拿得到最終的 era 值、拿不到理由——
 * 一個完全支援 modern 的 client 只要送的是通知或批次就會被算進 legacy，於是 legacy
 * 用量被系統性高估。
 *
 * 只記 POST /mcp。先前無條件記錄，於是 404 路徑掃描、CORS preflight 與 GET 全都會
 * 寫下一筆四欄皆 null 的記錄，和真正的裸 legacy 請求位元組相同——公開端點的背景
 * 掃描會把 null 桶灌滿，收斂條件永遠達不成，而且每一筆都在計費。
 *
 * 記 origin 是為了讓瀏覽器來的流量（會被 origin 檢查擋掉的那些）事後濾得掉；它們
 * 打得到 POST /mcp，但不可能是 MCP client。
 */
function logClientProbe(request: Request) {
  if (request.method !== "POST") return;
  if (new URL(request.url).pathname !== MCP_ROUTE) return;
  // SDK 對非 JSON 的 POST 回 415。少了這道，那些請求仍會寫下一筆四欄皆 null 的記錄，
  // 和真正的裸 legacy 請求位元組相同——正是上面那個 gate 想消除的污染。
  // 判定要跟 SDK 一致：可帶 charset 等參數、大小寫不敏感，否則會把合法 client 漏掉，
  // 那是反方向的失真。（403「Origin 不合」的請求不在此列：它們的 origin 欄位有值，
  // 事後濾得掉。）
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return;
  console.log(
    JSON.stringify({
      tag: "mcp-client-probe",
      protocolVersion: request.headers.get("mcp-protocol-version"),
      mcpMethod: request.headers.get("mcp-method"),
      userAgent: request.headers.get("user-agent"),
      origin: request.headers.get("origin"),
    }),
  );
}

export default {
  fetch(request, env, ctx) {
    logClientProbe(request);
    // 每個請求建一次，**不要**提到模組層級。曾經提上去過，理由寫的是「handler 沒有
    // 跨請求狀態」——那是錯的。SDK 的 handler 閉包持有一個 inflight Set，以及
    // subscriptions/listen 的 router（帶固定訂閱上限，滿了回 -32603）。提到模組層級
    // 後這兩個結構的生命週期就變成整個 isolate：任何未認證的 client 都能開 listen
    // stream 把上限塞滿，之後落在同一個 isolate 的其他人一律被拒。每請求重建多一點
    // 成本，但它讓這些結構跟著請求一起消滅。
    return createMcpHandler(createServer)(request, env, ctx);
  },
} satisfies ExportedHandler;
