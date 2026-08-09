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
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog.generated.json");

/**
 * 期交所的逐筆成交端點刻意排除在目錄之外。
 *
 * 單日大小實測：TimeAndSalesData 255.8 MB、OptionsTimeAndSalesData 162.9 MB、
 * TimeAndSalesDataOnCalendarSpreadOrders 9.7 MB——三個加起來是其餘 132 個端點總和
 * （約 8 MB）的五十倍。這些端點沒有進目錄，不是因為資料不好，而是因為
 * `twse_get_dataset` 會一次抓整份再於 Worker 內過濾：抓 255 MB 進一個 128 MB 的
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
    out[id] = {
      id,
      source: "taifex",
      summary: op.summary ?? "",
      description: op.description ?? "",
      tags: ["期貨與選擇權"],
      fields: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v?.description ?? ""])),
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
  const count = Object.keys(catalog).length;
  await writeFile(OUT, JSON.stringify(catalog, null, 1) + "\n", "utf-8");
  process.stderr.write(`wrote ${count} datasets -> ${OUT}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + "\n");
  process.exit(1);
});
