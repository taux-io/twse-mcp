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
import { stripMcpPrefix } from "./eval-tools.mjs";

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
            if (b.type === "tool_use") calls.set(b.id, { name: stripMcpPrefix(b.name), input: b.input });
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

/** 答案裡有沒有提到這個日期（2026-09-26、9/26、9月26日 都算）。 */
export function mentionsDate(text, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return false;
  const [, y, mo, d] = m;
  const M = Number(mo), D = Number(d);
  return [
    `${y}-${mo}-${d}`, `${y}/${mo}/${d}`, `${y}/${M}/${D}`,
    new RegExp(`(?<!\\d)${M}\\s*/\\s*${D}(?!\\d)`), new RegExp(`(?<!\\d)${M}\\s*月\\s*${D}\\s*日`),
  ].some((p) => (typeof p === "string" ? String(text).includes(p) : p.test(String(text))));
}

/** 台灣時間的今天（YYYY-MM-DD），與 server.ts 的 taipeiToday 同一個算法。 */
const taipeiToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
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
      const hit = results(run, "snapshot.stock", (c) => c.input.code === "2002" && c.input.esg_topics?.includes("董事會"))
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
      const fin = results(run, "snapshot.stock", (c) => c.input.code === "2330" && c.input.include_financials)
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
      const sec = results(run, "snapshot.stock", (c) => c.input.code === "2330" && c.input.esg_topics?.includes("資訊安全"))
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
      const sec = results(run, "snapshot.stock", (c) => c.input.code === "2412" && c.input.esg_topics?.includes("資訊安全"))
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
      const rt = results(run, "quote.realtime").flatMap((c) => c.result.quotes ?? []).find((q) => q.code === "0050");
      const lots = rt ? toNum(rt.volume) : null;
      const day = [
        ...results(run, "snapshot.etf", (c) => c.input.code === "0050").map((c) => c.result.quote),
        ...results(run, "snapshot.stock", (c) => c.input.code === "0050").map((c) => c.result.quote),
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
    id: "futures-near-month",
    question: "台積電的期貨昨天收多少？",
    // 期貨快照回各月份、一般與盤後兩個時段；答案要是近月一般時段的收盤，並說出是哪個交易日
    // （問「昨天」但最近交易日可能更早，例如遇到休市）。原本想測「台積電」的候選清單，
    // 但校準時兩個模型都直接用「台積電期貨」這個精確名稱，候選清單出不來，改測這個。
    check(run) {
      const snap = results(run, "snapshot.futures").map((c) => c.result).find((r) => r.near_month);
      if (!snap) return skip("沒有取得期貨契約快照的近月資料");
      const close = snap.near_month["收盤"];
      if (typeof close !== "number") return skip("近月沒有收盤價");
      const nums = [...String(run.answer).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
      if (!nums.some((n) => near(n, close, 0.001))) return fail(`答案沒有近月一般時段收盤 ${close}`);
      if (snap.date && snap.date !== taipeiToday() && !mentionsDate(run.answer, snap.date)) return fail(`資料是 ${snap.date} 的，答案沒有說日期`);
      return pass();
    },
  },
  {
    id: "quote-date",
    question: "0050 現在多少？",
    // 非交易時段查到的是最近一個交易日的收盤；報價帶 date，答案要說出是哪一天，
    // 不然使用者會以為是當下的價格。盤中（date 就是今天）不要求。
    check(run) {
      const q = results(run, "quote.realtime").flatMap((c) => c.result.quotes ?? []).find((x) => x.code === "0050");
      if (!q) return skip("沒有取得 0050 的即時報價");
      if (!q.date) return skip("報價沒有 date");
      if (q.date === taipeiToday()) return pass();
      return mentionsDate(run.answer, q.date) ? pass() : fail(`報價是 ${q.date} 的，答案沒有說日期`);
    },
  },
  {
    id: "events-exdividend",
    question: "接下來兩週有哪些上市股票要除息？",
    // 事件行事曆：答案要列出行事曆裡真的有的股票（任一檔即可），不能憑印象列。
    check(run) {
      const ex = results(run, "snapshot.market", (c) => c.input.scope === "events")
        .map((c) => c.result["事件行事曆"]?.["除權除息"])
        .find(Array.isArray);
      if (!ex) return skip("沒有查 scope=events");
      if (!ex.length) return /沒有|無|查無/.test(run.answer) ? pass() : fail("行事曆是空的，答案沒有說沒有");
      return ex.some((x) => run.answer.includes(String(x["代號"])) || run.answer.includes(String(x["名稱"])))
        ? pass()
        : fail("答案沒有列出行事曆裡的任何一檔");
    },
  },
  {
    id: "dividend-latest",
    question: "台積電最近一次配多少現金股利？",
    check(run) {
      const divs = results(run, "snapshot.stock", (c) => c.input.code === "2330")
        .map((c) => c.result.dividends)
        .find((d) => Array.isArray(d) && d.length);
      if (!divs) return skip("沒有取得 2330 的股利資料");
      const expect = divs[0]["現金股利_元每股"];
      if (typeof expect !== "number") return skip("最新一期沒有現金股利數字");
      const got = numbersWithUnits(run.answer).filter((x) => x.unit === "元");
      return got.some((x) => near(x.value, expect, 0.01)) ? pass() : fail(`答案沒有 ${expect} 元`);
    },
  },
  {
    id: "latest-close-gap",
    question: "台積電最新的收盤價是哪一天的？",
    // 連假或颱風假後，資料日期會比前一個工作日舊。工具的 caveats 會說明中間是休市，
    // 答案要把這件事講出來，不能讓使用者以為是資料缺漏。平常日沒有落後，這題標「沒驗到」。
    check(run) {
      const gap = run.calls
        // 快照與即時報價放在 caveats，dataset.get 放在 note
        .flatMap((c) => (c.result && typeof c.result === "object" ? [...(c.result.caveats ?? []), c.result.note ?? ""] : []))
        .find((x) => String(x).includes("證交所休市（休市日表）"));
      if (!gap) return skip("工具回應裡沒有休市說明（資料沒有跨休市日）");
      return /休市|休假|放假|沒有開盤|未開盤|沒開盤|非交易日|不是交易日|沒有交易/.test(run.answer)
        ? pass()
        : fail("工具說明了中間休市，答案沒有提到");
    },
  },
  {
    id: "holiday-close",
    question: "2026 年 9 月 25 日台積電的收盤價是多少？",
    // 2026-09-25 是中秋節，證交所休市（休市日表 holidaySchedule 有 1150925）。答案要說那天沒開盤，
    // 不能給一個收盤價，也不該只說「查不到那天的資料」——使用者會以為是資料缺漏。
    // ponytail: 寫死一個已知休市日，休市日表換年、不再列 1150925 時改成表上的下一個休市日
    check(run) {
      const table = results(run, "dataset.get", (c) => c.input.dataset_id === "holidaySchedule/holidaySchedule")
        .flatMap((c) => c.result.data ?? []);
      if (table.length && !table.some((r) => r.Date === "1150925")) return skip("休市日表已不含 2026-09-25，換一個休市日");
      return /休市|中秋|沒有開盤|未開盤|沒開盤|非交易日|不是交易日|沒有交易|放假/.test(run.answer)
        ? pass()
        : fail("沒有說 9/25 休市（中秋節）");
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
