/**
 * check-upstream.mjs — 每天實際抓一次每個資料集，抓出「上游悄悄改了」的情況。
 *
 * 目錄刷新（refresh-catalog）只比對 swagger 的欄位定義，從不抓資料本身。2026-09-26
 * 逐一實測才發現期交所有兩個端點已經改回 CSV，查它們一律失敗，而且壞了多久沒人知道；
 * 同一天也發現漲跌家數表停在三個多月前。這支腳本把那次手動實測變成排程：
 *
 *   - format：回的不是 JSON，而且不是程式讀得了的期交所 CSV（表頭對應規則見
 *     src/csv-header.mjs，與執行期共用同一份）→ 上游改了格式，工具正在失敗
 *   - http：狀態碼不是 2xx，或連線失敗（重試後仍然）
 *   - empty：必定有資料的主檔回 0 筆
 *   - stale：每日更新的表，最新日期落後超過容許天數
 *
 * 期交所端點在 JSON 與 CSV 之間切換不算問題：程式 JSON 優先、CSV 照規則讀，兩種都讀得了。
 *
 * ALWAYS_POPULATED 與 src/twse.ts 各有一份，由 test/catalog.test.ts 斷言一致——腳本是
 * .mjs、程式是 .ts，這是 repo 既有的作法（見 check-catalog.mjs 的 REQUIRED）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { headerMatches } from "../src/csv-header.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 與 src/twse.ts 的 ALWAYS_POPULATED 一致。 */
export const ALWAYS_POPULATED = [
  "opendata/t187ap47_L",
  "exchangeReport/STOCK_DAY_ALL",
  "ETFReport/ETFRank",
  "opendata/t187ap03_L",
  "exchangeReport/BWIBBU_ALL",
  "opendata/t187ap05_L",
  "opendata/t187ap06_L_ci",
  "opendata/t187ap07_L_ci",
  "opendata/t187ap33_L",
  "exchangeReport/MI_INDEX",
];

/**
 * 每日更新、而且工具直接依賴的表：最新日期落後超過 maxAgeDays 就算停擺。
 * 12 天涵蓋最長的連假（農曆年約 9 天）加上週末。
 */
export const FRESHNESS = [
  { id: "exchangeReport/STOCK_DAY_ALL", field: "Date" },
  { id: "exchangeReport/BWIBBU_ALL", field: "Date" },
  { id: "exchangeReport/MI_INDEX", field: "日期" },
  { id: "exchangeReport/MI_INDEX20", field: "Date" },
  { id: "taifex/PutCallRatio", field: "Date" },
  { id: "taifex/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate", field: "Date" },
];
export const MAX_AGE_DAYS = 12;

export function datasetUrl(id) {
  return id.startsWith("taifex/")
    ? `https://openapi.taifex.com.tw/v1/${id.slice("taifex/".length)}`
    : `https://openapi.twse.com.tw/v1/${id}`;
}

/** 民國七碼或西元八碼 → Date（UTC 午夜）。認不出回 null。 */
export function parseDate(v) {
  const s = String(v ?? "").trim();
  let m = /^(19|20)(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return new Date(Date.UTC(Number(m[1] + m[2]), Number(m[3]) - 1, Number(m[4])));
  m = /^(\d{2,3})(\d{2})(\d{2})$/.exec(s);
  if (m) return new Date(Date.UTC(Number(m[1]) + 1911, Number(m[2]) - 1, Number(m[3])));
  return null;
}

/** 期交所的 CSV 程式讀不讀得了：與執行期（src/twse.ts 的 csvSpecFor）同一個判準。 */
function readableCsv(id, body, catalog) {
  const fields = catalog[id]?.fields;
  if (!id.startsWith("taifex/") || !fields) return false;
  const header = body.replace(/^\uFEFF/, "").split(/\r?\n/)[0].split(",");
  return headerMatches(header, Object.values(fields));
}

/**
 * 純函式：依回應判定問題。回傳 null 代表健康，否則 { kind, detail }。
 * `now` 與 `catalog` 由呼叫端給，測試才不會隨執行日期或目錄內容改變。
 */
export function classify(id, { status, body }, now, catalog) {
  if (status < 200 || status >= 300) return { kind: "http", detail: `HTTP ${status}` };
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    if (readableCsv(id, body, catalog)) return null;
    const head = body.trim().slice(0, 80).replace(/\s+/g, " ");
    return { kind: "format", detail: `回的不是 JSON，也不是讀得了的 CSV（表頭對不上目錄）：「${head}」` };
  }
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0 && ALWAYS_POPULATED.includes(id)) {
    return { kind: "empty", detail: "必定有資料的主檔回 0 筆" };
  }
  const fresh = FRESHNESS.find((f) => f.id === id);
  if (fresh && rows.length) {
    const dates = rows.map((r) => parseDate(r?.[fresh.field])).filter(Boolean);
    if (!dates.length) return { kind: "stale", detail: `找不到可解析的 ${fresh.field}` };
    const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
    const age = Math.floor((now.getTime() - latest.getTime()) / 86_400_000);
    if (age > MAX_AGE_DAYS) {
      return { kind: "stale", detail: `最新日期 ${latest.toISOString().slice(0, 10)}，落後 ${age} 天` };
    }
  }
  return null;
}

async function fetchBody(id) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(datasetUrl(id), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      return { status: res.status, body: await res.text() };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return { status: 0, body: String(last?.message ?? last) };
}

async function main() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "src/catalog.generated.json"), "utf-8"));
  const ids = Object.keys(catalog);
  const problems = [];
  let next = 0;
  // 同時 4 條：對上游客氣一點，這是每日一次的健檢，不趕時間。
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const r = await fetchBody(id);
        const p =
          r.status === 0 ? { kind: "http", detail: `連線失敗：${r.body}` } : classify(id, r, new Date(), catalog);
        if (p) problems.push({ id, ...p });
      }
    }),
  );
  problems.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const lines = [
    `實測 ${ids.length} 個資料集，${problems.length} 個有問題。`,
    "",
    ...problems.map((p) => `- \`${p.kind}\` \`${p.id}\`：${p.detail}`),
  ];
  const report = lines.join("\n");
  await writeFile(path.join(ROOT, "upstream-report.md"), report + "\n");
  console.log(report);
  if (problems.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
