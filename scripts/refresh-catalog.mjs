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

async function main() {
  process.stderr.write(`fetching ${SWAGGER_URL} ...\n`);
  const res = await fetch(SWAGGER_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`swagger fetch failed: HTTP ${res.status}`);
  const spec = await res.json();
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
