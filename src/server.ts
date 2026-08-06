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

export function createServer() {
  const server = new McpServer({ name: "twse-opendata", version: "0.2.0" });

  server.registerTool(
    "twse_search_datasets",
    {
      description:
        "搜尋證交所 OpenAPI 有哪些資料集可用。取資料前先用這個找 dataset_id。" +
        "會比對資料集代號、中文說明與欄位名稱。",
      inputSchema: {
        query: z.string().default("").describe('關鍵字，例如 "ETF"、"融資"、"本益比"。留空列出全部。'),
        tag: z.string().default("").describe('依分類過濾，例如 "證券交易"、"公司治理"、"財務報表"。'),
        limit: z.number().int().default(25).describe("最多回傳幾筆（預設 25）。"),
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
        match: z
          .record(z.string(), z.string())
          .optional()
          .describe('其他欄位的子字串過濾，例如 {"基金類型": "ETF"}。'),
        fields: z.array(z.string()).optional().describe("只回傳這些欄位。"),
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
        codes: z.array(z.string()).describe('代號清單，例如 ["0050", "0056", "2330"]。'),
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

export default {
  fetch(request, env, ctx) {
    return createMcpHandler(createServer)(request, env, ctx);
  },
} satisfies ExportedHandler;
