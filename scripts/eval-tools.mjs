/**
 * eval-tools.mjs — 工具選擇測試：常見問法丟給 Claude，看它的第一個工具呼叫對不對。
 *
 * 工具定義與 instructions 從**實際的 MCP 端點**抓（tools/list、server/discover），
 * 所以測的是 client 真正看到的描述，不是另一份副本。改了工具描述之後跑一次，
 * 就知道是改好還是改壞。
 *
 *   ANTHROPIC_API_KEY=... npm run eval:tools
 *   EVAL_ENDPOINT=http://localhost:8787/mcp   # 測本機 wrangler dev 上尚未部署的描述
 *   EVAL_MODEL=claude-sonnet-5                # 換模型（預設 claude-opus-5）
 *   EVAL_ONLY=stock-financials,market-today   # 只跑指定題目
 *
 * 只看第一個工具呼叫，不實際執行工具：選錯第一步是最常見、也最便宜抓的錯。
 * 一題約 5k 輸入 token（工具定義與 instructions 走 prompt cache），24 題一次約一兩美元。
 *
 * 刻意**不**開 refusal fallback：評的是指定模型自己的選擇，被換成另一個模型回答
 * 會讓分數失真。被拒絕的題目直接記為失敗並標出來。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 部分比對：expected 裡寫到的才檢查。陣列是「每個期望元素都能在實際陣列中找到」。 */
export function subsetMatch(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((e) => actual.some((a) => subsetMatch(a, e)));
  }
  if (expected && typeof expected === "object") {
    return (
      actual !== null &&
      typeof actual === "object" &&
      Object.entries(expected).every(([k, v]) => subsetMatch(actual[k], v))
    );
  }
  return actual === expected;
}

/** 第一個工具呼叫是否符合任一可接受選項。沒有呼叫工具一律不通過。 */
export function matchCall(call, expect) {
  if (!call) return false;
  return expect.some((e) => e.tool === call.name && subsetMatch(call.input ?? {}, e.args ?? {}));
}

/** 對 MCP 端點送一個 modern（2026-07-28）請求。 */
async function mcp(endpoint, method, params = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  // modern lane 的單次交換回純 JSON（SSE 是 legacy 的編碼，已收斂掉）
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function main() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const endpoint = process.env.EVAL_ENDPOINT ?? "https://twse-mcp.taux.io/mcp";
  const model = process.env.EVAL_MODEL ?? "claude-opus-5";
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());

  const { cases: all } = JSON.parse(await readFile(path.join(ROOT, "evals/tool-selection.json"), "utf-8"));
  const cases = only ? all.filter((c) => only.includes(c.id)) : all;
  const [{ tools }, discover] = await Promise.all([mcp(endpoint, "tools/list"), mcp(endpoint, "server/discover")]);
  const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  console.log(`${endpoint}：${tools.length} 支工具；模型 ${model}；${cases.length} 題\n`);

  const client = new Anthropic();
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < cases.length) {
        const c = cases[next++];
        try {
          const response = await client.messages.create({
            model,
            max_tokens: 16000,
            // 工具定義與 instructions 每題相同，放進 prompt cache
            cache_control: { type: "ephemeral" },
            system: discover.instructions,
            tools: apiTools,
            tool_choice: { type: "auto" },
            messages: [{ role: "user", content: c.question }],
          });
          const use = response.content.find((b) => b.type === "tool_use");
          const call = use ? { name: use.name, input: use.input } : null;
          results.push({
            c,
            call,
            pass: matchCall(call, c.expect),
            note: response.stop_reason === "refusal" ? "refusal" : call ? "" : "沒有呼叫工具",
          });
        } catch (e) {
          // 只有 API 回應的錯誤（逾時以外的 4xx/5xx）算這一題失敗。沒設憑證、網路斷了、
          // 認證失敗這類問題跟模型選不選得對無關，記成失敗只會讓分數失真——直接中止。
          if (!(e instanceof Anthropic.APIError) || e instanceof Anthropic.AuthenticationError) throw e;
          results.push({ c, call: null, pass: false, note: `${e.constructor.name}: ${e.message}` });
        }
      }
    }),
  );

  results.sort((a, b) => cases.indexOf(a.c) - cases.indexOf(b.c));
  for (const r of results) {
    const got = r.call ? `${r.call.name} ${JSON.stringify(r.call.input)}` : r.note;
    console.log(`${r.pass ? "✅" : "❌"} ${r.c.id}：${got}`);
    if (!r.pass) console.log(`   期望任一：${r.c.expect.map((e) => `${e.tool} ${JSON.stringify(e.args ?? {})}`).join(" ｜ ")}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} 通過`);
  if (passed < results.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
