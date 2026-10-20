/**
 * tpex-movers.mjs — 上櫃股票的漲幅與跌幅排行、漲停與跌停檔數（本機個人使用）。
 *
 * 算法與 snapshot.movers 同一份（src/core.ts 的 buildMovers），只多一層把櫃買中心的欄位轉成
 * 證交所的欄位名。這不是 MCP 工具，也不進 CI、不發佈。為什麼不做成工具、不進線上版：
 * docs/adr/0004-snapshot-movers.md 的「不做上櫃」——線上版被櫃買中心擋、授權沒講清楚。
 *
 * 授權：櫃買中心 OpenAPI 頁面沒有授權條款；網站使用條款第五條禁止未經同意的自動下載。
 * 這支只給你自己偶爾查一次用（每次一個請求，約 5 MB）；不要排程、不要轉成對外服務。
 *
 *   node scripts/tpex-movers.mjs            # 各前 10 名
 *   node scripts/tpex-movers.mjs 20         # 各前 20 名（1–30）
 *   node scripts/tpex-movers.mjs 10 --json  # 輸出 JSON
 *
 * 需要 Node 23.6 以上（直接讀 src/core.ts 的 TypeScript）。
 * 資料量：約 5 MB、一萬兩千多列（大多是權證），沒有伺服器端過濾，所以在本機過濾。
 */
const ENDPOINT = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";
const SCOPE = "上櫃股票（四碼代號，不含 ETF）";

const limit = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 10);
const asJson = process.argv.includes("--json");
if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
  console.error("N 要是 1–30 的整數");
  process.exit(2);
}

let core;
try {
  core = await import("../src/core.ts");
} catch (e) {
  console.error(`讀不到 src/core.ts（需要 Node 23.6 以上，目前 ${process.version}）：${e.message}`);
  process.exit(2);
}

/** 下載並確認 JSON 完整。這個檔案偶爾傳到一半就中斷（2026-10-18 前兩次都是），所以重試。 */
async function download() {
  let last;
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(ENDPOINT, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = JSON.parse(await res.text());
      if (!Array.isArray(rows) || !rows.length) throw new Error("不是非空的陣列");
      return rows;
    } catch (e) {
      last = e;
      console.error(`第 ${i} 次下載失敗：${e.message}`);
    }
  }
  throw new Error(`下載失敗：${last?.message}`);
}

const raw = await download();
// 櫃買的欄位 → 證交所的欄位名。Change 沒有成交的列是 "---"，num() 會變 null、被 buildMovers 略過。
const days = raw.map((r) => ({
  Date: r.Date,
  Code: r.SecuritiesCompanyCode,
  Name: r.CompanyName,
  ClosingPrice: r.Close,
  Change: r.Change,
  TradeVolume: r.TradingShares,
}));
const out = core.buildMovers(days, limit);

// 新上市初期不設漲跌幅限制：櫃買把次日漲跌停價公布成 9995／0.01，推算的漲跌停不可信。
// 這是「明天」的限制、不是今天的，但新上市股通常連續數日都不設限，足以拿來標記。
const unlimited = new Set(
  raw
    .filter((r) => /^[1-9]\d{3}$/.test(r.SecuritiesCompanyCode) && Number(r.NextLimitDown) === 0.01)
    .map((r) => r.SecuritiesCompanyCode),
);
const flag = (x) => (unlimited.has(String(x["代號"])) ? "⚠不設漲跌幅限制" : x["漲跌停"] ?? "");
const result = { ...out, 範圍: SCOPE, 不設漲跌幅限制: [...unlimited] };

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const table = (title, rows) => {
    console.log(`\n${title}`);
    for (const x of rows) {
      console.log(
        `${String(x["排名"]).padStart(2)}. ${String(x["代號"]).padEnd(5)}${String(x["名稱"]).padEnd(10, "　")}` +
          `收 ${String(x["收盤"]).padStart(8)}  漲跌 ${String(x["漲跌"]).padStart(7)}  ${String(x["漲跌幅%"]).padStart(6)}%  ${flag(x)}`,
      );
    }
  };
  console.log(`${SCOPE} ｜ 資料日期 ${out["日期"]}（櫃買中心收盤後資料，非盤中即時）`);
  table("漲幅排行", out["漲幅排行"]);
  table("跌幅排行", out["跌幅排行"]);
  console.log(`\n漲停 ${out["漲停家數"]} 檔 ｜ 跌停 ${out["跌停家數"]} 檔（依前收盤與升降單位推算，資料沒有標記）`);
  if (unlimited.size) console.log(`不設漲跌幅限制（新上市初期）：${[...unlimited].join("、")}，其漲跌停推算不可信`);
}
