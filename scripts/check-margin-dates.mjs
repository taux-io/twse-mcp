import { fileURLToPath } from "node:url";

/**
 * check-margin-dates.mjs — 對帳 margin_daily 的日期有沒有標對（唯讀，本機執行）。
 * 為什麼要對：docs/adr/0003-d1-daily-archive.md 的「加存本益比與融資融券」——MI_MARGN 沒有日期欄位，
 * 存檔時借用日成交資訊的交易日。
 */

/** 上游每檔的「前日餘額」對 D1 每個已存日期的「今日餘額」，各算吻合率；不吻合的依差距由大到小列出前 10 檔。 */
export function reconcileMargin(upstreamRows, d1Rows) {
  const prev = new Map();
  for (const r of upstreamRows) {
    const margin = toNum(r["融資前日餘額"]);
    const short = toNum(r["融券前日餘額"]);
    // 兩欄都空白（或 -）的檔沒有資訊可比，不算進分母。只有一欄空白是「沒有餘額」，與 D1 的 null 一樣當 0 比。
    if (margin === null && short === null) continue;
    prev.set(r["股票代號"], { margin: margin ?? 0, short: short ?? 0 });
  }
  const byDate = new Map();
  const bad = {};
  for (const d of d1Rows) {
    const u = prev.get(d.code);
    if (!u) continue;
    const s = byDate.get(d.date) ?? { date: d.date, compared: 0, matched: 0, rate: 0 };
    s.compared++;
    if (u.margin === (d.margin_balance ?? 0) && u.short === (d.short_balance ?? 0)) s.matched++;
    else (bad[d.date] ??= []).push({ code: d.code, upstream: u, d1: { margin: d.margin_balance ?? 0, short: d.short_balance ?? 0 } });
    byDate.set(d.date, s);
  }
  const gap = (m) => Math.abs(m.upstream.margin - m.d1.margin) + Math.abs(m.upstream.short - m.d1.short);
  /** @type {Record<string, { code: string, upstream: { margin: number, short: number }, d1: { margin: number, short: number } }[]>} */
  const mismatches = {};
  for (const [date, list] of Object.entries(bad)) mismatches[date] = list.sort((a, b) => gap(b) - gap(a)).slice(0, 10);
  return {
    byDate: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ ...s, rate: s.matched / s.compared })),
    mismatches,
  };
}

function toNum(v) {
  const t = String(v ?? "").replace(/,/g, "").trim();
  return t === "" || t === "-" ? null : Number(t);
}

export const THRESHOLD = 0.95;

/** 從各日期的吻合率下結論：吻合率最高的那天達門檻才算通過；少於兩個日期無法對帳（ok 為 null）。 */
export function verdict(byDate) {
  if (byDate.length < 2) {
    return { ok: null, bestDate: null, bestRate: null, reason: "D1 只有一個日期，前一個交易日還沒存到，至少要兩個交易日才能對帳" };
  }
  const best = byDate.reduce((a, b) => (b.rate > a.rate ? b : a));
  return { ok: best.rate >= THRESHOLD, bestDate: best.date, bestRate: best.rate };
}

// 唯讀。只取最近 3 個日期（對帳只需要最近兩個交易日，多留一天容錯）；表每天多約 1,300 列。
// 找最近日期要掃一次 date（主鍵是 code、date，date 不在前面），所以讀取列數仍會隨存檔天數成長。
const MARGIN_SQL = `SELECT code, date, margin_balance, short_balance FROM margin_daily
WHERE date IN (SELECT DISTINCT date FROM margin_daily ORDER BY date DESC LIMIT 3)`;

const pct = (r) => `${(r * 100).toFixed(1)}%`;

/** 用 wrangler 唯讀查 D1；exec 由外部注入（簽名同 promisify(execFile)）。 */
export function d1Query(exec) {
  return async (sql) => {
    let stdout;
    try {
      ({ stdout } = await exec("npx", ["wrangler", "d1", "execute", "twse-mcp-archive", "--remote", "--json", "--command", sql], { maxBuffer: 64 * 1024 * 1024 }));
    } catch (e) {
      throw new Error(e.stderr ? `${e.message}\n${e.stderr.trimEnd().split("\n").slice(-20).join("\n")}` : e.message);
    }
    // wrangler 的訊息裡也有 [ 字元，要找單獨成行的 [
    return JSON.parse(stdout.slice(stdout.indexOf("[\n")))[0].results;
  };
}

/** 讀 D1 與上游、印出對帳結果；回傳結束碼（0 通過、1 沒達門檻、2 無法對帳）。 */
export async function run({ fetchUpstream, queryD1, log }) {
  let upstream, d1;
  try {
    upstream = await fetchUpstream();
    d1 = await queryD1(MARGIN_SQL);
  } catch (e) {
    log(`無法對帳：讀取失敗：${e instanceof Error ? e.message : e}`);
    return 2;
  }
  const { byDate, mismatches } = reconcileMargin(upstream, d1);
  const v = verdict(byDate);
  if (v.ok === null) {
    log(`無法對帳：${v.reason}`);
    return 2;
  }
  for (const s of byDate) log(`${s.date}  吻合 ${s.matched}/${s.compared}（${pct(s.rate)}）`);
  log(`上游「前日餘額」最吻合的是 ${v.bestDate}（${pct(v.bestRate)}）；門檻 ${pct(THRESHOLD)}：${v.ok ? "通過" : "不通過"}`);
  if (v.ok) return 0;
  log(`${v.bestDate} 不吻合的前 ${mismatches[v.bestDate]?.length ?? 0} 檔（融資／融券）：`);
  for (const m of mismatches[v.bestDate] ?? []) {
    log(`  ${m.code}  上游 ${m.upstream.margin}／${m.upstream.short}  D1 ${m.d1.margin}／${m.d1.short}`);
  }
  return 1;
}

// ── 指令列：只有直接執行時才跑，被測試匯入時不會碰網路 ────────────────────────────
//   export CLOUDFLARE_ACCOUNT_ID=…   # 見 docs/adr/0003-d1-daily-archive.md 的「維運查詢」
//   node scripts/check-margin-dates.mjs
// 上游直接用 fetch 抓同一個網址：src/twse.ts 的 fetchDataset 用了 TypeScript 參數屬性，Node 只拔型別讀不了它。
// 結束碼：0 通過、1 沒達門檻、2 無法對帳。
async function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error("要先設 CLOUDFLARE_ACCOUNT_ID（wrangler 登入了多個帳號時不會替你選）。見 docs/adr/0003-d1-daily-archive.md 的「維運查詢」。");
    return 2;
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  return run({
    fetchUpstream: async () => {
      const res = await fetch("https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`證交所 MI_MARGN 回 ${res.status}`);
      return res.json();
    },
    queryD1: d1Query(exec),
    log: (l) => console.log(l),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
