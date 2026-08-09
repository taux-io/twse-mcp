#!/usr/bin/env node
/**
 * check-catalog.mjs
 * -----------------
 * 對 src/catalog.generated.json 做健檢。每週自動刷新後會跑這支；本機也能直接跑：
 *   npm run check-catalog
 *
 * 為什麼需要它：測試「有」用到真實目錄（server.ts 直接 import，改壞它測試會紅），
 * 但覆蓋面只到少數幾個資料集。這裡補上整體性的檢查——任一交易所若整批下架或改結構，
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

/** 目錄少於這個數量，幾乎必然是上游出事而非真的縮編。 */
export const MIN_DATASETS = 100;

/**
 * **每個來源各自**的下限。只看總數擋不住「一邊整批消失」：期交所那 132 個全部不見時，
 * 總數仍有 143，遠高於 MIN_DATASETS，健檢會回報「通過」——正是最需要它出聲的時候。
 */
export const MIN_DATASETS_PER_SOURCE = 100;

/** 已知的來源。出現沒見過的值代表 refresh-catalog 改了而這裡沒跟上。 */
export const SOURCES = ["twse", "taifex"];

/**
 * id 前綴與來源的對應。前綴不是裝飾——src/twse.ts 的 datasetUrl 只看它決定要打哪個
 * 交易所，對不上等於把請求送到錯的主機（症狀是線上 404，離線測試全綠）。
 */
const PREFIX = { taifex: "taifex/" };

/**
 * 刻意排除在目錄之外的端點（理由見 scripts/refresh-catalog.mjs 的 TAIFEX_EXCLUDE）。
 * 這裡再擋一次，是因為排除清單在另一支檔案裡，某次刷新把它拿掉時不會有人發現。
 *
 * **比對正規化後的路徑，不是字面值。** 稽核實測 `/v1/./TimeAndSalesData`、
 * `/v1//TimeAndSalesData`、`/v1/x/../TimeAndSalesData`、`/v1/%2e/TimeAndSalesData`
 * 全都回 200 與 255,751,505 bytes——字面比對一個都擋不住，而它們保護的是一個
 * 「大小」問題（255 MB 進 128 MB 的 isolate）。
 */
const MUST_NOT_EXIST = [
  "TimeAndSalesData",
  "OptionsTimeAndSalesData",
  "TimeAndSalesDataOnCalendarSpreadOrders",
];

/**
 * 零欄位的資料集比例上限。少數幾個是上游常態（有些端點的 schema 真的沒宣告欄位），
 * 但**整批**歸零代表 refresh-catalog 的 $ref 解析斷了——而那會靜悄悄地解除
 * src/twse.ts 的 CSV 表頭守衛，並讓 describe_dataset 什麼都說不出來。
 */
const MAX_NO_FIELDS_RATIO = 0.2;

/** 把 dataset id 正規化成上游實際會收到的路徑，用來做等價比對。 */
function normalisePath(id) {
  const out = [];
  for (const seg of id.split("/")) {
    let s;
    try {
      s = decodeURIComponent(seg);
    } catch {
      s = seg;
    }
    if (s === "" || s === ".") continue;
    if (s === "..") { out.pop(); continue; }
    out.push(s);
  }
  return out;
}

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

  const bySource = {};
  for (const id of ids) {
    const src = catalog[id]?.source;
    bySource[src] = (bySource[src] ?? 0) + 1;
  }
  for (const src of SOURCES) {
    const n = bySource[src] ?? 0;
    if (n < MIN_DATASETS_PER_SOURCE) {
      problems.push(`${src}：只剩 ${n} 個資料集（門檻 ${MIN_DATASETS_PER_SOURCE}），該來源可能異常`);
    }
  }

  const badSource = ids.filter((id) => !SOURCES.includes(catalog[id]?.source));
  if (badSource.length) {
    problems.push(
      `${badSource.length} 個資料集的 source 缺漏或不是已知來源，例如：${badSource.slice(0, 3).join(", ")}`,
    );
  }

  // 雙向檢查：期交所的 id 一定要有前綴，證交所的一定不能有。
  const mislabelled = ids.filter((id) => {
    const src = catalog[id]?.source;
    const p = PREFIX[src];
    return p ? !id.startsWith(p) : Object.values(PREFIX).some((q) => id.startsWith(q));
  });
  if (mislabelled.length) {
    problems.push(
      `${mislabelled.length} 個資料集的 id 前綴與 source 對不上（會送到錯的上游主機）：` +
        mislabelled.slice(0, 3).join(", "),
    );
  }

  // key 與 entry.id 不一致：健檢看 key，而 src/twse.ts 的 datasetUrl 路由用 id。
  // 兩者分岔的症狀是請求跑到另一個交易所、套上錯誤的授權聲明，而健檢說一切正常。
  const idMismatch = ids.filter((id) => catalog[id]?.id !== id);
  if (idMismatch.length) {
    problems.push(
      `${idMismatch.length} 個資料集的 key 與 entry.id 不一致（執行期路由用的是 id）：` +
        idMismatch.slice(0, 3).join(", "),
    );
  }

  // 正規化後比對，字面值擋不住 ./ 與 // 這類等價拼法。
  const resurrected = ids.filter((id) => {
    const segs = normalisePath(id);
    return MUST_NOT_EXIST.includes(segs[segs.length - 1]);
  });
  if (resurrected.length) {
    problems.push(
      `刻意排除的巨量端點又出現在目錄裡：${resurrected.join(", ")}` +
        `（單日可達 255 MB，會撐爆 Worker 的記憶體上限）`,
    );
  }

  // 路徑穿越：id 帶 .. 或空片段會讓請求跳出 /v1，或產生與其他 id 等價的路徑。
  const traversal = ids.filter((id) => id.split("/").some((s) => s === ".." || s === "." || s === ""));
  if (traversal.length) {
    problems.push(
      `${traversal.length} 個資料集 id 含有路徑穿越或空片段（會改變實際請求的路徑）：` +
        traversal.slice(0, 3).join(", "),
    );
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
  // 只印數字不算守衛。稽核證明過：上游把 schema 改成 array-wrapped $ref，132 筆
  // 全部歸零，而健檢會印「132 個沒有欄位定義」然後回報通過、exit 0。
  if (ids.length && noFields.length > ids.length * MAX_NO_FIELDS_RATIO) {
    problems.push(
      `${noFields.length}/${ids.length} 個資料集沒有欄位定義（上限 ` +
        `${Math.round(MAX_NO_FIELDS_RATIO * 100)}%），上游 schema 解析可能斷了`,
    );
  }
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
