/**
 * eval-tools.mjs — 工具選擇測試：常見問法丟給 Claude，看它的第一個工具呼叫對不對。
 *
 * 工具定義與 instructions 從**實際的 MCP 端點**抓，所以測的是 client 真正看到的描述，
 * 不是另一份副本。改了工具描述之後跑一次，就知道是改好還是改壞。
 *
 * 兩種跑法（EVAL_RUNNER）：
 *
 *   claude-code（預設）：用本機的 Claude Code 非互動模式（`claude -p`）連上 MCP 端點，
 *     每題開一個 session。走的是登入的 Claude 訂閱額度，**不產生 API 帳單**；測的就是
 *     Claude Code 這個真實 client 的行為（它是本服務最大的流量來源）。每題在空的暫存目錄
 *     執行、只載入 project 層設定，使用者自己的外掛與 hook 不會影響結果；看到第一個工具
 *     呼叫就結束行程，不讓它繼續用額度。
 *   api：直接呼叫 Anthropic API（需要 ANTHROPIC_API_KEY，會計費，24 題約一兩美元）。
 *     刻意**不**開 refusal fallback：評的是指定模型自己的選擇。
 *
 *   npm run eval:tools
 *   EVAL_ENDPOINT=http://localhost:8787/mcp   # 測本機 wrangler dev 上尚未部署的描述
 *   EVAL_MODEL=sonnet                         # 換模型（claude-code 吃別名；api 預設 claude-opus-5）
 *   EVAL_ONLY=stock-financials,market-today   # 只跑指定題目
 *   EVAL_RUNNER=api                           # 改用 API
 *
 * 只看第一個工具呼叫：選錯第一步是最常見、也最便宜抓的錯。
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
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

/** Claude Code 的 MCP 工具名帶 `mcp__<server>__` 前綴，比對前拿掉。 */
export function stripMcpPrefix(name) {
  return name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
}

/**
 * 用 `claude -p` 問一題，回傳第一個工具呼叫。工具權限一律不給（dontAsk），
 * 所以它不會真的去查資料；看到第一個 tool_use 就結束行程。
 */
export async function askClaudeCode(question, { endpoint, model, cwd }) {
  const args = [
    "-p", question,
    "--output-format", "stream-json", "--verbose",
    "--mcp-config", JSON.stringify({ mcpServers: { twse: { type: "http", url: endpoint } } }),
    "--strict-mcp-config",
    "--tools", "",
    "--permission-mode", "dontAsk",
    "--setting-sources", "project",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let done = false;
    let usedModel = null;
    let lastText = "";
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve({ model: usedModel, ...r });
    };
    const timer = setTimeout(() => finish({ call: null, note: "逾時（180 秒）" }), 180_000);
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "system" && ev.subtype === "init") usedModel = ev.model;
        if (ev.type === "assistant") {
          const use = ev.message.content.find((b) => b.type === "tool_use");
          if (use) return finish({ call: { name: stripMcpPrefix(use.name), input: use.input } });
          const text = ev.message.content.find((b) => b.type === "text");
          if (text) lastText = text.text;
        }
        // 沒呼叫工具時把它說了什麼帶出來：是反問使用者、直接憑記憶回答，還是別的，
        // 判讀方式完全不同。
        if (ev.type === "result") {
          return finish({ call: null, note: `沒有呼叫工具：「${lastText.replace(/\s+/g, " ").slice(0, 120)}」` });
        }
      }
    });
    child.on("error", (e) => finish({ call: null, note: `無法啟動 claude：${e.message}`, fatal: true }));
    child.on("close", () => finish({ call: null, note: "沒有呼叫工具" }));
  });
}

async function runClaudeCode(cases, { endpoint, model }) {
  // 空的暫存目錄：不讓 repo 的 CLAUDE.md／AGENTS.md 或任何 project 設定進到 session。
  const cwd = await mkdtemp(path.join(os.tmpdir(), "twse-eval-"));
  try {
    const results = [];
    let next = 0;
    let fatal = null;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < cases.length && !fatal) {
          const c = cases[next++];
          const r = await askClaudeCode(c.question, { endpoint, model, cwd });
          if (r.fatal) fatal = r.note;
          results.push({ c, call: r.call, pass: matchCall(r.call, c.expect), note: r.note ?? "", model: r.model });
        }
      }),
    );
    if (fatal) throw new Error(fatal);
    return results;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function runApi(cases, { endpoint, model }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const [{ tools }, discover] = await Promise.all([mcp(endpoint, "tools/list"), mcp(endpoint, "server/discover")]);
  const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
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
            model,
          });
        } catch (e) {
          // 只有 API 回應的錯誤（逾時以外的 4xx/5xx）算這一題失敗。沒設憑證、網路斷了、
          // 認證失敗這類問題跟模型選不選得對無關，記成失敗只會讓分數失真——直接中止。
          if (!(e instanceof Anthropic.APIError) || e instanceof Anthropic.AuthenticationError) throw e;
          results.push({ c, call: null, pass: false, note: `${e.constructor.name}: ${e.message}`, model });
        }
      }
    }),
  );
  return results;
}

async function main() {
  const endpoint = process.env.EVAL_ENDPOINT ?? "https://twse-mcp.taux.io/mcp";
  const runner = process.env.EVAL_RUNNER ?? "claude-code";
  const model = process.env.EVAL_MODEL ?? (runner === "api" ? "claude-opus-5" : undefined);
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());

  const { cases: all } = JSON.parse(await readFile(path.join(ROOT, "evals/tool-selection.json"), "utf-8"));
  const cases = only ? all.filter((c) => only.includes(c.id)) : all;
  const { tools } = await mcp(endpoint, "tools/list");
  console.log(`${endpoint}：${tools.length} 支工具；跑法 ${runner}；${cases.length} 題\n`);

  const results =
    runner === "api" ? await runApi(cases, { endpoint, model }) : await runClaudeCode(cases, { endpoint, model });

  results.sort((a, b) => cases.indexOf(a.c) - cases.indexOf(b.c));
  for (const r of results) {
    const got = r.call ? `${r.call.name} ${JSON.stringify(r.call.input)}` : r.note;
    console.log(`${r.pass ? "✅" : "❌"} ${r.c.id}：${got}`);
    if (!r.pass) console.log(`   期望任一：${r.c.expect.map((e) => `${e.tool} ${JSON.stringify(e.args ?? {})}`).join(" ｜ ")}`);
  }
  const passed = results.filter((r) => r.pass).length;
  const models = [...new Set(results.map((r) => r.model).filter(Boolean))].join(", ");
  console.log(`\n${passed}/${results.length} 通過（模型：${models || "未知"}）`);
  if (passed < results.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
