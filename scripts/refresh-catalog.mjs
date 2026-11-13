#!/usr/bin/env node
/**
 * refresh-catalog.mjs
 * -------------------
 * 建置期把各交易所的 swagger 解析成一份精簡目錄，寫進 src/catalog.generated.json。
 * 執行期的 Worker 只 import 這個靜態檔，永遠不在線上抓 swagger（消掉一個開機失敗點）。
 *
 * 產出簽入版本控制：上游新增/改欄位時，git diff 就看得到。
 *   用法： npm run refresh-catalog
 *
 * ## 為什麼是一份目錄而不是兩份
 *
 * 使用者問「三大法人」時，期貨與現貨的答案都該出現。兩份目錄會讓搜尋得跑兩次、
 * 或漏掉一邊。所以合併成一份，用 `source` 欄位區分——那個欄位同時承載授權差異：
 * 證交所與期交所是不同機關，OGDL 顯名聲明的措辭不同。
 *
 * ## 為什麼期交所的 id 加前綴而證交所的不加
 *
 * 證交所的 id 是 swagger 路徑（`exchangeReport/STOCK_DAY_ALL`），已經是對外契約的
 * 一部分，改了會破壞既有呼叫端。期交所的路徑不含斜線（`/PutCallRatio`），加上
 * `taifex/` 前綴有兩個好處：永遠不可能與證交所的 id 相撞（實測目前 0 相撞，但那是
 * 觀測值不是保證），而且看到 id 就知道來源。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { headerMatches } from "../src/csv-header.mjs";
import { csvHeader, fetchBody } from "./check-upstream.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog.generated.json");

/**
 * 期交所的逐筆成交端點刻意排除在目錄之外。
 *
 * 單日大小實測：TimeAndSalesData 255.8 MB、OptionsTimeAndSalesData 162.9 MB、
 * TimeAndSalesDataOnCalendarSpreadOrders 9.7 MB——三個加起來是其餘 132 個端點總和
 * （約 8 MB）的五十倍。這些端點沒有進目錄，不是因為資料不好，而是因為
 * `dataset.get` 會一次抓整份再於 Worker 內過濾：抓 255 MB 進一個 128 MB 的
 * isolate，結果是把工具打爛，而不是給出答案。
 *
 * 這是刻意的取捨，不是遺漏——所以寫在這裡，而不是讓後人從缺漏中推測。
 */
const TAIFEX_EXCLUDE = new Set([
  "TimeAndSalesData",
  "OptionsTimeAndSalesData",
  "TimeAndSalesDataOnCalendarSpreadOrders",
]);

/**
 * swagger 漏寫、但實際資料有的欄位。refresh 時補回去，目錄才不會每週被「欄位消失」誤報
 * （workflow 看的是產出的檔案有沒有變，不是 catalog-diff 的摘要）。
 *
 * 只補 swagger 沒有的鍵，放在欄位最後；swagger 日後補回來就以它的說明為準。
 * key 是 swagger 路徑去掉開頭斜線（不含 `taifex/` 前綴）。
 *
 * 2026-10-31 確認：期交所 /v1/AnnualTradingVolume 的每一列都有 ProductCategory
 * （例如 "指數期貨"），但 swagger 沒有（issue #152）。上游修好後可刪掉這一項。
 * 風險：期交所若真的把欄位從資料裡拿掉，這個覆寫會蓋住它，刷新不會再提醒。
 */
const TAIFEX_FIELD_OVERRIDES = {
  AnnualTradingVolume: { ProductCategory: "商品類別" },
};

/**
 * swagger 寫錯的欄位說明。欄位說明是 CSV 備援對表頭的依據（src/csv-header.mjs），寫錯的那一欄
 * 對不上表頭，整份資料就讀不到。這裡改成實際 CSV 表頭的文字（2026-11-13 記錄）。
 *
 *   FuturesAndOptionsFeeSchedule：swagger 寫「期貨交易稅率」，表頭是「期貨交易稅比率」，互不包含。
 *   SSOLists：swagger 寫「股票期貨商品契約代碼」，是從股票期貨那一份抄來的；表頭是「股票選擇權…」。
 *   TotalMarketPositionLimit…：swagger 把一個含頓號的說明從頓號切成兩段，後半段落到下一欄，
 *     「比例」的說明因此不見。
 *   DailyForeignExchangeRates：swagger 寫「美元／新台幣(匯率)」（全形斜線），表頭是「美元_新台幣(匯率)」。
 *     表頭是 GitHub runner 上的每日健檢記錄的；同一天從台灣抓到的是 JSON。
 *
 * 只改 swagger 有的鍵。與 TAIFEX_FIELD_OVERRIDES 相反，這裡蓋過 swagger：上游改了 CSV 表頭的話，
 * 每日健檢會回報 format，那時再改這張表。
 */
const TAIFEX_DESCRIPTION_CORRECTIONS = {
  DailyForeignExchangeRates: {
    "USD/NTD": "美元_新台幣(匯率)",
    "RMB/NTD": "人民幣_新台幣(匯率)",
    "EUR/USD": "歐元_美元(匯率)",
    "USD/JPY": "美元_日幣(匯率)",
    "GBP/USD": "英鎊_美元(匯率)",
    "AUD/USD": "澳幣_美元(匯率)",
    "USD/HKD": "美元_港幣(匯率)",
    "USD/RMB": "美元_人民幣(匯率)",
    "USD/ZAR": "美元_南非幣(匯率)",
    "NZD/USD": "紐幣_美元(匯率)",
  },
  FuturesAndOptionsFeeSchedule: { FuturesTransactionTaxRate: "期貨交易稅比率" },
  SSOLists: { Contract: "股票選擇權商品契約代碼" },
  TotalMarketPositionLimitForSingleStockFuturesAndEquityOptions: {
    NumberOfSharesOutstandingOfUnderlyingStockOrNumberOfUnitsOutstandingOfETF:
      "標的證券在外流通股數或已發行(募集、銷售)單位數)(B)",
    Ratio: "比例(=A/B)%",
  },
};

/**
 * 排除清單比對的是**正規化後的最後一段路徑**，不是字面值。
 *
 * 它保護的是一個「大小」問題，而它的判準是一個「名字」。稽核實測
 * `/v1/./TimeAndSalesData`、`/v1//TimeAndSalesData`、`/v1/x/../TimeAndSalesData`、
 * `/v1/%2e/TimeAndSalesData` 全都回 200 與 255,751,505 bytes——字面比對一個都擋不住。
 * scripts/check-catalog.mjs 有一份對應的第二道守衛。
 */
function lastSegment(path) {
  const out = [];
  for (const seg of path.split("/")) {
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
  return out.join("/");
}

/** 證交所：swagger 2.0，欄位在 responses.200.schema.properties。 */
function buildTwse(spec) {
  const out = Object.create(null);
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const op = item?.get;
    if (!op) continue;
    const props = op.responses?.["200"]?.schema?.properties ?? {};
    const id = path.replace(/^\//, "");
    out[id] = {
      id,
      source: "twse",
      summary: op.summary ?? "",
      description: op.description ?? "",
      tags: op.tags ?? [],
      fields: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v?.description ?? ""])),
    };
  }
  return out;
}

/**
 * 期交所：OpenAPI 3.0，欄位在 responses.200.content['application/json'].schema.$ref
 * 指向的 components.schemas。所有 135 個 schema 都是 object + properties。
 *
 * 每個 operation 的 tag 都是同一個字串「資料查詢API」，對搜尋毫無鑑別力，所以
 * 改用一個固定 tag「期貨與選擇權」——它至少能讓 `tag=` 過濾把期交所的東西挑出來。
 *
 * `$ref` 要處理兩種寫法。期交所目前對 list 端點宣告的是**裸 `$ref`**（嚴格說不太
 * 對），但慣例寫法是 `{type:"array", items:{$ref}}`。稽核證明過：只認裸 `$ref` 的話，
 * 上游哪天把它改成慣例寫法，`ref` 會變成空字串、132 筆全部零欄位，而所有數量門檻
 * 都會通過。那不是理論上的——它是上游把 OpenAPI **寫對**時就會發生的事。
 */
function buildTaifex(spec) {
  const out = Object.create(null);
  const schemas = spec.components?.schemas ?? {};
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const op = item?.get;
    if (!op) continue;
    const name = path.replace(/^\//, "");
    if (TAIFEX_EXCLUDE.has(lastSegment(name))) continue;
    const schema = op.responses?.["200"]?.content?.["application/json"]?.schema ?? {};
    const ref = schema.$ref ?? schema.items?.$ref ?? "";
    const props = ref ? (schemas[ref.split("/").pop()]?.properties ?? {}) : {};
    const id = `taifex/${name}`;
    const fields = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v?.description ?? ""]));
    for (const [k, desc] of Object.entries(TAIFEX_FIELD_OVERRIDES[name] ?? {})) {
      if (!Object.hasOwn(fields, k)) fields[k] = desc;
    }
    for (const [k, desc] of Object.entries(TAIFEX_DESCRIPTION_CORRECTIONS[name] ?? {})) {
      if (Object.hasOwn(fields, k)) fields[k] = desc;
    }
    out[id] = {
      id,
      source: "taifex",
      summary: op.summary ?? "",
      description: op.description ?? "",
      tags: ["期貨與選擇權"],
      fields,
    };
  }
  return out;
}

const SOURCES = [
  {
    source: "twse",
    url: "https://openapi.twse.com.tw/v1/swagger.json",
    build: buildTwse,
    /** 少於這個數量幾乎必然是上游出事，而不是真的縮編。 */
    min: 100,
  },
  {
    source: "taifex",
    url: "https://openapi.taifex.com.tw/swagger.json",
    build: buildTaifex,
    min: 100,
  },
];

/**
 * 抓 swagger，附狀態碼／content-type 檢查與退避重試。
 *
 * 2026-08-03 的排程執行就是死在這裡：證交所前面那層 nginx 用 2xx 狀態碼回了一張
 * 裸錯誤頁，`res.ok` 因此通過，`res.json()` 才丟出 `Unexpected token '<'`。
 * 光看那個 SyntaxError 完全無法判斷是被擋、維護中、還是格式變了——狀態碼、
 * content-type、body 一個都沒留下。所以這裡把三者都寫進錯誤訊息。
 *
 * 重試：一週只跑一次，失敗代價是整整一週沒有目錄漂移偵測，而上述症狀是暫時性的
 * （同一支腳本前後都跑得過）。退避從 2 秒起跳。
 */
async function fetchSpec(url) {
  const attempts = 3;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      process.stderr.write(`fetching ${url} (attempt ${i}/${attempts}) ...\n`);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const ctype = res.headers.get("content-type") ?? "(none)";
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}, content-type: ${ctype}`);
      // res.ok 擋不住「2xx + HTML」。先讀成文字，parse 不過時才有 body 可以印。
      // 判準是「parse 得過嗎」而不是 content-type——期交所的 OpenAPI 主機一律回
      // application/octet-stream，拿 content-type 當閘門會把 135 個端點全部誤殺。
      const body = await res.text();
      try {
        return JSON.parse(body);
      } catch (e) {
        throw new Error(
          `body is not valid JSON (${e.message}). content-type: ${ctype}, HTTP ${res.status}. ` +
            `body starts with: ${JSON.stringify(body.trim().slice(0, 200))}`,
        );
      }
    } catch (err) {
      lastErr = err;
      process.stderr.write(`  attempt ${i} failed: ${err.message}\n`);
      if (i < attempts) {
        const waitMs = 2000 * 2 ** (i - 1);
        process.stderr.write(`  retrying in ${waitMs}ms\n`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw new Error(`swagger fetch failed after ${attempts} attempts: ${lastErr.message}`);
}

/** @type {(id: string) => Record<string, string>} */
const NO_CORRECTIONS = () => ({});

/**
 * swagger 的欄位說明變了的資料集：只有新說明對得上實際的 CSV 表頭時才採用，否則保留原本的。
 *
 * 欄位說明是 CSV 備援對表頭的依據（src/csv-header.mjs），而 swagger 的說明與 CSV 表頭不保證一致。
 * 期交所的 swagger 會在較長與較短的說明之間變動；較短的那一份會讓 4 個資料集在上游回 CSV 時讀不到，
 * 其中兩個正是 #214 修過的。
 *
 * 為什麼是「沒有證據就不換」：原本的說明是已知讀得到的那一份。同一個端點的格式在不同次抓取之間會變，
 * 刷新當下拿到 JSON 不代表它之後不回 CSV。第一版的規則在上游回 JSON 時照新的走，2026-11-13 的 runner
 * 執行（run 43376653807）就這樣把那 4 個資料集全部換掉了。
 *
 * 只處理欄位鍵與順序都沒變、只有說明不同的資料集；欄位有增減是要人看的變動，照新的走。
 * 整個資料集的說明一起保留，不逐欄混用：混出來的清單沒有被任何表頭驗證過。
 * 例外是 `corrections`：那是我們刻意蓋過 swagger 的更正，只出現在新產生的那一份，保留時要再套回去。
 *
 * 直接改 `next`，回傳保留了哪些資料集與原因：
 *   header      上游回 CSV，表頭對不上新說明
 *   no-header   上游回 JSON，沒有表頭可對
 *   unverified  抓不到資料
 *
 * @param {(id: string) => Record<string, string>} [corrections]
 */
export async function keepReadableFields(previous, next, fetchDataset = fetchBody, corrections = NO_CORRECTIONS) {
  const kept = [];
  for (const [id, ds] of Object.entries(next)) {
    if (!Object.hasOwn(previous, id)) continue;
    const before = previous[id].fields ?? {};
    const keys = Object.keys(ds.fields);
    if (keys.join("\n") !== Object.keys(before).join("\n")) continue;
    if (keys.every((k) => before[k] === ds.fields[k])) continue;
    const { status, body } = await fetchDataset(id);
    let reason;
    if (status < 200 || status >= 300) {
      reason = "unverified";
    } else {
      let isJson = true;
      try {
        JSON.parse(body);
      } catch {
        isJson = false;
      }
      if (isJson) reason = "no-header";
      else if (!headerMatches(csvHeader(body), Object.values(ds.fields))) reason = "header";
    }
    if (reason) {
      const fields = { ...before };
      for (const [k, desc] of Object.entries(corrections(id))) {
        if (Object.hasOwn(fields, k)) fields[k] = desc;
      }
      ds.fields = fields;
      kept.push({ id, reason });
    }
  }
  return kept;
}

const KEPT_REASON = {
  header: "上游回 CSV，表頭對不上 swagger 的新說明",
  "no-header": "上游回 JSON，沒有 CSV 表頭可以證實 swagger 的新說明",
  unverified: "抓不到實際資料，無法驗證 swagger 的新說明",
};

/** 資料集 id → 我們刻意蓋過 swagger 的欄位說明。目前只有期交所有。 */
const correctionsFor = (id) => (id.startsWith("taifex/") ? (TAIFEX_DESCRIPTION_CORRECTIONS[id.slice("taifex/".length)] ?? {}) : {});

/** 目前簽入的目錄。第一次產生時還沒有檔案，當成空的。 */
async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, "utf-8"));
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

async function main() {
  // null 原型：上游路徑若是 __proto__，普通物件的指派會改到原型而不是新增鍵。
  const catalog = Object.create(null);
  for (const src of SOURCES) {
    const spec = await fetchSpec(src.url);
    const part = src.build(spec);
    const n = Object.keys(part).length;
    // 每個來源各自把關。合併後才檢查總數的話，一邊整批消失會被另一邊蓋過去。
    if (n < src.min) {
      throw new Error(`${src.source}: 只解析出 ${n} 個資料集（門檻 ${src.min}），上游 shape 可能變了`);
    }
    // 數量對、欄位全空，是 schema 解析斷掉的樣子——而數量門檻看不見它。
    const empty = Object.values(part).filter((d) => !Object.keys(d.fields).length).length;
    if (empty > n * 0.2) {
      throw new Error(
        `${src.source}: ${empty}/${n} 個資料集沒有解析出任何欄位，schema 的形狀可能變了`,
      );
    }
    for (const [id, ds] of Object.entries(part)) {
      // hasOwn 而非真值判斷：id 若是 constructor／toString，catalog[id] 會取到
      // Object.prototype 上的東西，於是報出一個不存在的「id 相撞」。
      if (Object.hasOwn(catalog, id)) {
        throw new Error(`資料集 id 相撞：${id}（${catalog[id].source} vs ${ds.source}）`);
      }
      catalog[id] = ds;
    }
    process.stderr.write(`  ${src.source}: ${n} datasets\n`);
  }
  for (const { id, reason } of await keepReadableFields(await readPrevious(), catalog, fetchBody, correctionsFor)) {
    process.stderr.write(`  ${id}: 保留原本的欄位說明（${KEPT_REASON[reason]}）\n`);
  }
  const count = Object.keys(catalog).length;
  await writeFile(OUT, JSON.stringify(catalog, null, 1) + "\n", "utf-8");
  process.stderr.write(`wrote ${count} datasets -> ${OUT}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack ?? err) + "\n");
    process.exit(1);
  });
}
