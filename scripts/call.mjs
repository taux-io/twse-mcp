/**
 * 呼叫一支 MCP 工具，印出解開後的結果 JSON。
 *
 *   npm run call -- snapshot.stock '{"code":"2330","history_days":5}'
 *   npm run call -- snapshot.stock '{"code":"2330"}' --prod
 *
 * 預設打本機 wrangler dev（http://localhost:8787/mcp，要先自己開著）。--prod 打正式環境：
 * 它跑在 Workers 免費方案，每個請求都在消耗 CPU 的寬容額度（#104），只用來驗證剛部署的改動，不要迴圈呼叫。
 * 工具回傳 isError 時印出錯誤並以 1 結束。
 */
const LOCAL = "http://localhost:8787/mcp";
const PROD = "https://twse-mcp.taux.io/mcp";

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const [name, rawArgs = "{}"] = argv.filter((a) => a !== "--prod");
if (!name) {
  console.error("用法：npm run call -- <工具名稱> ['{\"參數\":值}'] [--prod]");
  process.exit(2);
}
let args;
try {
  args = JSON.parse(rawArgs);
} catch (e) {
  console.error(`參數不是合法的 JSON：${e.message}`);
  process.exit(2);
}

const res = await fetch(prod ? PROD : LOCAL, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
}).catch((e) => {
  console.error(`連不上 ${prod ? PROD : LOCAL}：${e.message}${prod ? "" : "（本機要先開 wrangler dev）"}`);
  process.exit(1);
});
const text = await res.text();
const data = text.split("\n").find((l) => l.startsWith("data:"));
const payload = JSON.parse(data ? data.slice(5) : text);
if (payload.error) {
  console.error(JSON.stringify(payload.error, null, 2));
  process.exit(1);
}
const out = payload.result.content[0].text;
let body = out;
try {
  body = JSON.stringify(JSON.parse(out), null, 2);
} catch {}
(payload.result.isError ? console.error : console.log)(body);
process.exit(payload.result.isError ? 1 : 0);
