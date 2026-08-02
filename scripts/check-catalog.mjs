#!/usr/bin/env node
/**
 * check-catalog.mjs
 * -----------------
 * 對 src/catalog.generated.json 做健檢。每週自動刷新後會跑這支；本機也能直接跑：
 *   npm run check-catalog
 *
 * 為什麼需要它：測試「有」用到真實目錄（server.ts 直接 import，改壞它測試會紅），
 * 但覆蓋面只到少數幾個資料集。這裡補上整體性的檢查——證交所若整批下架或改結構，
 * 要在通知維護者之前就擋下來。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const CATALOG = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog.generated.json");

/**
 * twse_etf_snapshot 直接依賴這三個資料集，少一個該工具就殘廢。
 * 這份清單必須與 src/twse.ts 的 DS_FUND/DS_DAY/DS_RANK 一致——
 * test/catalog.test.ts 會斷言兩邊相同，改了一邊沒改另一邊 CI 就會紅。
 */
export const REQUIRED = [
  "opendata/t187ap47_L",
  "exchangeReport/STOCK_DAY_ALL",
  "ETFReport/ETFRank",
];

/** 目錄少於這個數量，幾乎必然是證交所端出事而非真的縮編。 */
export const MIN_DATASETS = 100;

export function checkCatalog(catalog) {
  const problems = [];
  const ids = Object.keys(catalog);

  if (ids.length < MIN_DATASETS) {
    problems.push(`資料集只剩 ${ids.length} 個（門檻 ${MIN_DATASETS}），證交所端可能異常`);
  }

  const missing = REQUIRED.filter((id) => !catalog[id]);
  if (missing.length) {
    problems.push(`twse_etf_snapshot 依賴的資料集消失：${missing.join(", ")}`);
  }

  const malformed = ids.filter((id) => {
    const d = catalog[id];
    return !d || typeof d.summary !== "string" || !Array.isArray(d.tags) || !d.fields;
  });
  if (malformed.length) {
    problems.push(`${malformed.length} 個資料集結構不對，例如：${malformed.slice(0, 3).join(", ")}`);
  }

  // 只數「結構正常但沒有欄位」的；畸形的已經報過，再讀它的 .fields 會直接爆掉——
  // 一個負責偵測畸形目錄的函式，不該遇到畸形目錄就自己拋例外。
  const noFields = ids.filter(
    (id) => !malformed.includes(id) && !Object.keys(catalog[id].fields).length,
  );
  return { total: ids.length, noFields: noFields.length, problems };
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG, "utf-8"));
  const { total, noFields, problems } = checkCatalog(catalog);
  process.stdout.write(`${total} 個資料集，${noFields} 個沒有欄位定義\n`);
  if (problems.length) {
    for (const p of problems) process.stderr.write(`✗ ${p}\n`);
    process.exit(1);
  }
  process.stdout.write("健檢通過\n");
}

// 只有被直接執行時才跑；被 import（測試）時不執行。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exit(1);
  });
}
