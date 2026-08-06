#!/usr/bin/env node
/**
 * refresh-catalog.mjs
 * -------------------
 * 建置期把證交所 swagger.json 解析成精簡目錄，寫進 src/catalog.generated.json。
 * 執行期的 Worker 只 import 這個靜態檔，永遠不在線上抓 swagger（消掉一個開機失敗點）。
 *
 * 產出簽入版本控制：證交所新增/改欄位時，git diff 就看得到。
 *   用法： npm run refresh-catalog
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SWAGGER_URL = "https://openapi.twse.com.tw/v1/swagger.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog.generated.json");

/** swagger.paths -> { [datasetId]: { id, summary, description, tags, fields } } */
function buildCatalog(spec) {
  const catalog = {};
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const op = item?.get;
    if (!op) continue;
    const props =
      op.responses?.["200"]?.schema?.properties ?? {};
    const id = path.replace(/^\//, "");
    catalog[id] = {
      id,
      summary: op.summary ?? "",
      description: op.description ?? "",
      tags: op.tags ?? [],
      fields: Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, v?.description ?? ""]),
      ),
    };
  }
  return catalog;
}

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
async function fetchSpec() {
  const attempts = 3;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      process.stderr.write(`fetching ${SWAGGER_URL} (attempt ${i}/${attempts}) ...\n`);
      const res = await fetch(SWAGGER_URL, { headers: { Accept: "application/json" } });
      const ctype = res.headers.get("content-type") ?? "(none)";
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}, content-type: ${ctype}`);
      // res.ok 擋不住「2xx + HTML」。先讀成文字，parse 不過時才有 body 可以印。
      // 判準是「parse 得過嗎」而不是 content-type——證交所另一個端點（MIS 即時
      // 報價站）就是回 text/html 卻給合法 JSON，拿 content-type 當閘門會誤殺。
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
  const spec = await fetchSpec();
  const catalog = buildCatalog(spec);
  const count = Object.keys(catalog).length;
  if (count === 0) throw new Error("catalog is empty — swagger shape may have changed");
  await writeFile(OUT, JSON.stringify(catalog, null, 1) + "\n", "utf-8");
  process.stderr.write(`wrote ${count} datasets -> ${OUT}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + "\n");
  process.exit(1);
});
