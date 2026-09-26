/**
 * smoke-prod.mjs — 對正式環境（或 SMOKE_ENDPOINT）的每一支工具發一個真實查詢。
 *
 * 單元測試跑在手寫的 fixture 上，每日上游健檢只看上游、不呼叫我們的工具。兩者之間的
 * 缺口正是這支要補的：
 *   - 實際資料不符 outputSchema 時，SDK 會讓**整個呼叫失敗**。上游某天多給一個 null，
 *     fixture 永遠抓不到，使用者卻會整支工具查不到。
 *   - 部署後的程式與測試環境不同（Workers 執行期、邊緣快取、兩代協定的實際路由）。
 *
 * 判定分兩級：
 *   - fail：傳輸或 JSON-RPC 錯誤、isError、缺 structuredContent、關鍵欄位缺失 → exit 1
 *   - warn：回應正常但某段因上游取得失敗而降級（caveats 裡的「取得失敗」）→ 只記錄。
 *     上游故障由 check-upstream 開 issue，這裡不重複告警。
 *
 * 新舊兩代協定（legacy 2025、modern 2026-07-28）各跑一遍：主要用戶端是 modern，
 * Codex 走 legacy，兩條路都有真實使用者。
 *
 * 用法：
 *   node scripts/smoke-prod.mjs
 *   SMOKE_ENDPOINT=http://localhost:8787/mcp node scripts/smoke-prod.mjs   # 合併前測本機
 *
 * 只用 Node 內建模組：CI 的這個 job 拿的是 issues write token。
 */
import { writeFile } from "node:fs/promises";

const ENDPOINT = process.env.SMOKE_ENDPOINT ?? "https://twse-mcp.taux.io/mcp";
const SITE = new URL(ENDPOINT).origin;
const MODERN = "2026-07-28";
const TIMEOUT_MS = 90_000;

let nextId = 1;

/** 一次 JSON-RPC 呼叫。modern 要帶 _meta 與對應標頭（與 test/server.test.ts 的 eraRequest 同一套規則）。 */
async function rpc(era, method, params = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  let body = { jsonrpc: "2.0", id: nextId++, method, params };
  if (era === "modern") {
    body.params = {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    };
    headers["MCP-Protocol-Version"] = MODERN;
    headers["Mcp-Method"] = method;
    if (typeof params.name === "string") headers["Mcp-Name"] = params.name;
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const line = res.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5)
    : text;
  if (!line) throw new Error(`回應沒有資料：${text.slice(0, 200)}`);
  const payload = JSON.parse(line);
  if (payload.error) throw new Error(`JSON-RPC ${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

/**
 * 每一支工具一個查詢，加上「一定要有」的欄位檢查。只檢查長期穩定的事實
 * （2330 是上市公司、0056 是 ETF、台指期是 TX），不檢查會變的數字。
 * structured: 宣告了 outputSchema 的工具必須回 structuredContent。
 */
const CASES = [
  {
    tool: "twse_search_datasets",
    args: { query: "殖利率" },
    check: (r) => r.total_matched > 0 || "total_matched 為 0",
  },
  {
    tool: "twse_describe_dataset",
    args: { dataset_id: "exchangeReport/BWIBBU_ALL" },
    check: (r) => Object.keys(r.fields ?? {}).length > 0 || "沒有 fields",
  },
  {
    tool: "twse_get_dataset",
    args: { dataset_id: "exchangeReport/BWIBBU_ALL", code: "2330" },
    check: (r) => (r.rows_matched === 1 && r.data?.[0]?.Code === "2330") || `預期 2330 一列，得到 ${r.rows_matched} 列`,
  },
  {
    tool: "twse_lookup",
    structured: true,
    args: { query: "台積電" },
    check: (r) => r.results?.some((x) => x.code === "2330") || "結果裡沒有 2330",
  },
  {
    tool: "twse_stock_snapshot",
    structured: true,
    // 選配段落全開：outputSchema 對每一段都要驗過真實資料。
    args: { code: "2330", include_financials: true, include_governance: true, include_margin: true },
    check: (r) => {
      if (r.is_listed_company !== true) return `is_listed_company = ${r.is_listed_company}`;
      if (!Array.isArray(r.dividends) && r.dividends !== null) return "dividends 不是陣列也不是 null";
      if (["financials", "governance", "margin"].some((k) => r[k] === "未查詢")) return "選配段落沒有被查詢";
      return true;
    },
  },
  {
    tool: "twse_etf_snapshot",
    structured: true,
    args: { code: "0056" },
    check: (r) => r.is_etf === true || `is_etf = ${r.is_etf}`,
  },
  {
    tool: "twse_market_overview",
    structured: true,
    args: {},
    check: (r) => (r["證券市場"] && r["期貨籌碼"] ? true : "缺證券市場或期貨籌碼"),
  },
  {
    tool: "twse_futures_snapshot",
    structured: true,
    args: { contract: "台指期" },
    check: (r) => r.contract === "TX" || `contract = ${r.contract}`,
  },
  {
    tool: "twse_realtime_quote",
    structured: true,
    args: { codes: ["2330"] },
    check: (r) => r.quotes?.[0]?.code === "2330" || "quotes 裡沒有 2330",
  },
];

/** 工具結果轉成物件：有 structuredContent 用它，否則解析第一段文字。 */
function body(result) {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  return JSON.parse(text);
}

async function runCase(era, c) {
  const result = await rpc(era, "tools/call", { name: c.tool, arguments: c.args });
  if (result.isError) {
    const msg = result.content?.map((x) => x.text).join(" ") ?? "";
    return { fail: `isError：${msg.slice(0, 300)}` };
  }
  if (c.structured && !result.structuredContent) return { fail: "宣告了 outputSchema 卻沒有 structuredContent" };
  const r = body(result);
  const ok = c.check(r);
  if (ok !== true) return { fail: typeof ok === "string" ? ok : "檢查未通過" };
  const degraded = (r.caveats ?? []).filter((x) => String(x).includes("取得失敗"));
  return { warn: degraded };
}

async function main() {
  const fails = [];
  const warns = [];
  const log = (line) => console.log(line);

  for (const era of ["modern", "legacy"]) {
    try {
      const tools = await rpc(era, "tools/list");
      const names = tools.tools.map((t) => t.name);
      const missing = CASES.map((c) => c.tool).filter((t) => !names.includes(t));
      const extra = names.filter((t) => !CASES.some((c) => c.tool === t));
      if (missing.length || extra.length) {
        fails.push(`[${era}] tools/list 與冒煙清單不一致：缺 ${missing.join(",") || "無"}；多 ${extra.join(",") || "無"}（新工具要補一個查詢）`);
      }
      const prompts = await rpc(era, "prompts/list");
      if ((prompts.prompts ?? []).length !== 3) fails.push(`[${era}] prompts/list 有 ${prompts.prompts?.length} 個，預期 3`);
    } catch (e) {
      fails.push(`[${era}] tools/list 或 prompts/list 失敗：${e.message}`);
    }

    for (const c of CASES) {
      const t0 = Date.now();
      let out;
      try {
        out = await runCase(era, c);
      } catch (e) {
        out = { fail: e.message };
      }
      const ms = Date.now() - t0;
      if (out.fail) {
        fails.push(`[${era}] ${c.tool}：${out.fail}`);
        log(`❌ [${era}] ${c.tool} ${ms}ms — ${out.fail}`);
      } else {
        for (const w of out.warn) warns.push(`[${era}] ${c.tool}：${w}`);
        log(`${out.warn.length ? "⚠️ " : "✅"} [${era}] ${c.tool} ${ms}ms`);
      }
    }
  }

  // 首頁：兩個語系都要回 200，而且頁面上的端點網址要是這個服務本身。
  for (const p of ["/", "/en"]) {
    try {
      const res = await fetch(SITE + p, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const html = await res.text();
      if (!res.ok) fails.push(`首頁 ${p}：HTTP ${res.status}`);
      else if (!html.includes("https://twse-mcp.taux.io/mcp")) fails.push(`首頁 ${p}：找不到端點網址`);
      else log(`✅ 首頁 ${p}`);
    } catch (e) {
      fails.push(`首頁 ${p}：${e.message}`);
    }
  }

  const report = [
    `端點：${ENDPOINT}`,
    "",
    fails.length ? `**失敗 ${fails.length} 項**` : "全部通過",
    ...fails.map((f) => `- ${f}`),
    ...(warns.length ? ["", `上游降級 ${warns.length} 項（不算失敗；上游故障由每日上游健檢追蹤）：`, ...warns.map((w) => `- ${w}`)] : []),
  ].join("\n");
  await writeFile("smoke-report.md", report + "\n");
  console.log("\n" + report);
  if (fails.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
