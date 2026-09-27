/**
 * eval-answers.mjs — 端到端答案檢查：讓 Claude Code 真的查完、作答，再核對答案。
 *
 * eval-tools 只看第一個工具呼叫，看不到兩件事：多步驟的後續（先查代號，第二步有沒有帶對
 * 參數），以及模型有沒有照著回應裡的說明讀數字（單位、累計數、N/A 不是 0）。這支補這兩件。
 *
 * 判分不用另一個模型，用程式規則；標準答案取自**同一次對話裡工具回傳的結果**，不另外查，
 * 所以資料每天變也不影響。每題三種結果：
 *   - pass：前提成立，答案符合
 *   - fail：前提成立，答案不符；或根本沒呼叫工具（憑記憶回答）
 *   - 沒驗到：模型走了別條路，這題要檢查的東西沒出現在工具結果裡（例如沒帶 esg_topics）。
 *     不算通過——少了工具結果的檢查不能憑空成立。
 *
 * 只打本機（預設 http://localhost:8787/mcp；沒開就自己起 wrangler dev，結束時關掉）：
 * 正式環境跑在 Workers 免費方案（#104）。需要登入的 Claude Code，不進 CI。
 *
 *   npm run eval:answers
 *   EVAL_MODEL=sonnet EVAL_REPEAT=3 EVAL_ONLY=esg-board-ratio npm run eval:answers
 *
 * 完整的答案與工具結果存在暫存目錄（結束時印出路徑），失敗時讀得到原文。
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portInUse, startServer } from "./eval-ab.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8787;
const TIMEOUT_MS = 300_000;
const CONCURRENCY = 3;

/** 用 claude -p 問到底：只准用 twse 的 MCP 工具，其他一律拒絕。回傳工具呼叫（含結果）與最後的答案。 */
function ask(question, { endpoint, model, cwd }) {
  const args = [
    "-p", question,
    "--output-format", "stream-json", "--verbose",
    "--mcp-config", JSON.stringify({ mcpServers: { twse: { type: "http", url: endpoint } } }),
    "--strict-mcp-config",
    "--tools", "",
    "--allowedTools", "mcp__twse__*",
    "--permission-mode", "dontAsk",
    "--setting-sources", "project",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const calls = new Map();
    let buf = "";
    let answer = null;
    let usedModel = null;
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "system" && ev.subtype === "init") usedModel = ev.model;
        if (ev.type === "assistant") {
          for (const b of ev.message.content) {
            if (b.type === "tool_use") calls.set(b.id, { name: b.name.replace(/^mcp__[^_]+__/, ""), input: b.input });
          }
        }
        if (ev.type === "user") {
          for (const b of ev.message.content ?? []) {
            if (b.type !== "tool_result" || !calls.has(b.tool_use_id)) continue;
            const text = Array.isArray(b.content) ? b.content.map((x) => x.text ?? "").join("") : String(b.content ?? "");
            let result = text;
            try { result = JSON.parse(text); } catch {}
            Object.assign(calls.get(b.tool_use_id), { result, isError: Boolean(b.is_error), text });
          }
        }
        if (ev.type === "result") answer = String(ev.result ?? "");
      }
    });
    child.on("error", (e) => resolve({ fatal: `無法啟動 claude：${e.message}` }));
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ calls: [...calls.values()], answer, model: usedModel });
    });
  });
}

// ---------------------------------------------------------------------------
// 答案比對工具
// ---------------------------------------------------------------------------

/** 從答案抓出「數字＋單位」，數字去逗號、萬／億換算。 */
export function numbersWithUnits(text) {
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(萬|億)?\s*(張|股|元|%|％)/g;
  for (const m of String(text).matchAll(re)) {
    let v = Number(m[1].replace(/,/g, ""));
    if (m[2] === "萬") v *= 1e4;
    if (m[2] === "億") v *= 1e8;
    out.push({ value: v, unit: m[3] === "％" ? "%" : m[3] });
  }
  return out;
}

/** 上游字串（"36.36%"、"7.0000"、"12,345"）轉數字。 */
export function toNum(v) {
  const n = Number(String(v ?? "").replace(/[,%％\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const pass = () => ({ status: "pass" });
const fail = (reason) => ({ status: "fail", reason });
const skip = (reason) => ({ status: "沒驗到", reason });
const review = (reason) => ({ status: "需人工看", reason });

/** 正向條件成立才算通過；同時命中「說它沒有」就標成需人工看，附上前後文。 */
function disclosed(answer, positive, what) {
  if (!positive.test(answer)) return fail(`沒有說明${what}`);
  const m = answer.match(CLAIMS_NONE);
  if (m) return review(`說明了${what}，但有像「說它沒有」的句子：…${answer.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\n/g, " ")}…`);
  return pass();
}

/** 找出符合條件的工具結果；拿不到就是「沒驗到」。 */
function results(run, name, pred = () => true) {
  return run.calls.filter((c) => c.name === name && c.result && typeof c.result === "object" && pred(c));
}

/**
 * 「說它沒有」的錯誤講法。只抓錯誤的主張本身，不抓單字：「沒有揭露」是對的，裡面也有「沒有」。
 *
 * 這條**只用來標記要人看的答案，不直接判失敗**。2026-09-27 校準時，opus 五個被它抓到的答案
 * 全都是對的：「不能說沒有資訊外洩」「看不出有沒有發生」、引用同業「台灣大 0 件」。否定、
 * 疑問與引用別家的寫法太多，規則寫不完；判分只看正向條件（有沒有說明 N/A／不在表中）。
 */
export const CLAIMS_NONE = /(?<![無未沒]法[^，。]{0,6})(?<!(?:不是|並非|而非|不代表|不等於|非|不能[^，。]{0,10}(?:說|解讀|推論))[^，。]{0,8})(?<!有)(沒有發生|未發生|沒發生|無(?:任何)?(?:資訊)?外洩|沒有(?:任何)?(?:資訊)?外洩|(?<![\d.])0\s*(?:件|起|次)|零\s*(?:件|起|次))/;

// ---------------------------------------------------------------------------
// 題目
// ---------------------------------------------------------------------------

export const CASES = [
  {
    id: "esg-board-ratio",
    question: "中鋼的女性董事比例是多少？",
    // 多步驟：先查代號、再帶 esg_topics。第一步 eval-tools 看得到，第二步只有這裡看得到。
    check(run) {
      const hit = results(run, "twse_stock_snapshot", (c) => c.input.code === "2002" && c.input.esg_topics?.includes("董事會"))
        .map((c) => c.result.esg?.主題?.董事會)
        .find((b) => b && typeof b === "object");
      if (!hit) return skip("沒有對 2002 查 esg_topics=董事會");
      const expect = toNum(hit["女性董事席次及比率-比率"]);
      if (expect === null) return skip("董事會資料沒有女性董事比率");
      const got = numbersWithUnits(run.answer).filter((x) => x.unit === "%");
      return got.some((x) => near(x.value, expect, 0.5)) ? pass() : fail(`答案沒有 ${expect}%`);
    },
  },
  {
    id: "financials-cumulative",
    question: "台積電今年第二季賺多少錢？",
    // 損益表是年初至該季的累計數。把累計數當成單季說出去，是回應裡特別警告的錯。
    check(run) {
      const fin = results(run, "twse_stock_snapshot", (c) => c.input.code === "2330" && c.input.include_financials)
        .map((c) => c.result.financials)
        .find((f) => f && typeof f === "object" && f.損益);
      if (!fin) return skip("沒有查 2330 的 include_financials");
      return /累計|上半年|前兩季|前二季|年初(?:至|到)|1\s*[-~～至到]\s*6\s*月|一至六月|單季.{0,12}(?:無法|需|要|沒有)/.test(run.answer)
        ? pass()
        : fail("沒有說明財報是年初至今的累計數");
    },
  },
  {
    id: "infosec-na",
    question: "台積電去年有沒有發生資訊外洩事件？",
    // 台積電的資訊安全列存在，但數值是 "N/A"：不適用或未揭露，不是 0。
    check(run) {
      const sec = results(run, "twse_stock_snapshot", (c) => c.input.code === "2330" && c.input.esg_topics?.includes("資訊安全"))
        .map((c) => c.result.esg?.主題?.資訊安全)
        .find((b) => b && typeof b === "object");
      if (!sec) return skip("沒有對 2330 查 esg_topics=資訊安全");
      if (!Object.values(sec).some((v) => /N\/A|不適用/.test(String(v)))) return skip("資訊安全的數值不是 N/A，前提已變");
      return disclosed(run.answer, /N\/A|不適用|未揭露|沒有揭露|未提供|無法(?:判斷|確認|得知)/, "數值是 N/A／未揭露");
    },
  },
  {
    id: "infosec-not-in-table",
    question: "中華電去年有沒有發生資訊外洩事件？",
    // 2412 不在資訊安全的申報表中：不代表沒有外洩。
    check(run) {
      const sec = results(run, "twse_stock_snapshot", (c) => c.input.code === "2412" && c.input.esg_topics?.includes("資訊安全"))
        .map((c) => c.result.esg?.主題?.資訊安全)
        .find((b) => b !== undefined);
      if (sec === undefined) return skip("沒有對 2412 查 esg_topics=資訊安全");
      if (typeof sec !== "string" || !sec.includes("不在此主題的申報表中")) return skip("中華電已在資訊安全表中，前提已變");
      return disclosed(run.answer, /不在|沒有(?:相關|這項|此項)?(?:申報|揭露|資料)|未(?:申報|揭露)|查不到|無法(?:判斷|確認|得知)/, "中華電不在申報表中");
    },
  },
  {
    id: "volume-units",
    question: "0050 今天的成交量多大？",
    // 單位跟著工具走：即時報價的 volume 是「張」，日成交資訊的成交股數是「股」。
    // 兩者都可以換算（1 張 = 1,000 股），錯的是把張的數字配上股，或反過來。
    check(run) {
      const got = numbersWithUnits(run.answer).filter((x) => x.unit === "張" || x.unit === "股");
      const rt = results(run, "twse_realtime_quote").flatMap((c) => c.result.quotes ?? []).find((q) => q.code === "0050");
      const lots = rt ? toNum(rt.volume) : null;
      const day = [
        ...results(run, "twse_etf_snapshot", (c) => c.input.code === "0050").map((c) => c.result.quote),
        ...results(run, "twse_stock_snapshot", (c) => c.input.code === "0050").map((c) => c.result.quote),
      ].find(Boolean);
      const shares = day ? toNum(day["成交股數"]) : null;
      if (lots === null && shares === null) return skip("沒有取得 0050 的成交量");
      const ok = (value, unit) => {
        const asShares = unit === "張" ? value * 1000 : value;
        return [lots !== null ? lots * 1000 : null, shares].some((s) => s !== null && near(asShares, s, s * 0.01 + 1));
      };
      if (!got.length) return fail("答案裡沒有帶單位的成交量");
      return got.some((x) => ok(x.value, x.unit)) ? pass() : fail(`數字與單位對不上：${got.map((x) => x.value + x.unit).join("、")}`);
    },
  },
  {
    id: "dividend-latest",
    question: "台積電最近一次配多少現金股利？",
    check(run) {
      const divs = results(run, "twse_stock_snapshot", (c) => c.input.code === "2330")
        .map((c) => c.result.dividends)
        .find((d) => Array.isArray(d) && d.length);
      if (!divs) return skip("沒有取得 2330 的股利資料");
      const expect = divs[0]["現金股利_元每股"];
      if (typeof expect !== "number") return skip("最新一期沒有現金股利數字");
      const got = numbersWithUnits(run.answer).filter((x) => x.unit === "元");
      return got.some((x) => near(x.value, expect, 0.01)) ? pass() : fail(`答案沒有 ${expect} 元`);
    },
  },
];

// ---------------------------------------------------------------------------

async function main() {
  const model = process.env.EVAL_MODEL;
  const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  if (!cases.length) throw new Error(`EVAL_ONLY 沒有對到任何題目：${only}`);
  const endpoint = `http://localhost:${PORT}/mcp`;

  const tmp = await mkdtemp(path.join(os.tmpdir(), "twse-answers-"));
  const cwd = path.join(tmp, "cwd");
  await mkdir(cwd);
  let server = null;
  if (!(await portInUse(PORT))) server = await startServer(ROOT, PORT);
  try {
    console.log(`${endpoint} ｜ ${cases.length} 題 × ${repeat} 輪${model ? ` ｜ ${model}` : ""}\n`);
    const jobs = [];
    for (let r = 0; r < repeat; r++) for (const c of cases) jobs.push({ c, r });
    const tally = new Map(cases.map((c) => [c.id, { pass: 0, fail: 0, skip: 0, review: 0, notes: [] }]));
    let next = 0;
    let fatal = null;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < jobs.length && !fatal) {
          const { c, r } = jobs[next++];
          const run = await ask(c.question, { endpoint, model, cwd });
          if (run.fatal) { fatal = run.fatal; break; }
          await writeFile(path.join(tmp, `${c.id}-${r + 1}.json`), JSON.stringify(run, null, 2));
          // 權限被拒代表跑法壞了，不是模型答錯——整批中止，不計分。
          const denied = run.calls.find((x) => x.isError && /permission|not allowed|denied/i.test(x.text ?? ""));
          if (denied) { fatal = `工具被拒絕執行（${denied.name}）：${denied.text?.slice(0, 120)}`; break; }
          const v = run.answer === null ? fail("沒有得到最後的答案（逾時或中斷）")
            : !run.calls.length ? fail("沒有呼叫任何工具，憑記憶回答")
            : c.check(run);
          const t = tally.get(c.id);
          if (v.status === "pass") t.pass++;
          else if (v.status === "fail") t.fail++;
          else if (v.status === "需人工看") t.review++;
          else t.skip++;
          if (v.reason) t.notes.push(`${v.status} #${r + 1}：${v.reason}`);
        }
      }),
    );
    if (fatal) throw new Error(fatal);
    for (const c of cases) {
      const t = tally.get(c.id);
      const mark = t.fail ? "❌" : t.review ? "👀" : t.skip ? "・" : "✅";
      console.log(`${mark} ${c.id}：通過 ${t.pass} ｜ 失敗 ${t.fail} ｜ 需人工看 ${t.review} ｜ 沒驗到 ${t.skip}（共 ${repeat}）`);
      for (const n of t.notes) console.log(`     ${n.slice(0, 160)}`);
    }
    console.log(`\n答案與工具結果原文：${tmp}`);
  } finally {
    if (server) try { process.kill(-server.pid); } catch {}
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
