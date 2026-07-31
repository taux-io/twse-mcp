#!/usr/bin/env node
/**
 * refresh-catalog.mjs
 * -------------------
 * 建置期把各交易所的 swagger 解析成精簡目錄，寫進 src/catalog.generated.json。
 * 執行期的 Worker 只 import 這個靜態檔，永遠不在線上抓 swagger（消掉一個開機失敗點）。
 *
 * 目前兩個來源，規格不同，所以解析器要兩種都吃：
 *   - 證交所 TWSE：Swagger 2.0，欄位在 responses.200.schema.properties
 *   - 櫃買中心 TPEx：OpenAPI 3.0，欄位在 responses.200.content[json].schema.$ref → components.schemas
 *
 * 產出簽入版本控制：任一交易所新增/改欄位時，git diff 就看得到。
 *   用法： npm run refresh-catalog
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog.generated.json");

const SOURCES = [
  {
    source: "twse",
    label: "臺灣證券交易所",
    swagger: "https://openapi.twse.com.tw/v1/swagger.json",
    /** TWSE 的 id 本身帶路徑（exchangeReport/...），已可辨識，不加前綴。 */
    prefix: "",
  },
  {
    source: "tpex",
    label: "證券櫃檯買賣中心",
    swagger: "https://www.tpex.org.tw/openapi/swagger.json",
    /** TPEx 的 id 是扁平字串，加前綴讓來源一眼可辨、也避免日後撞名。 */
    prefix: "tpex/",
  },
];

/** 解析 Swagger 2.0 / OpenAPI 3.0 的回應欄位定義，回傳 {欄位: 說明}。 */
function extractFields(op, spec) {
  const res = op.responses?.["200"];
  if (!res) return {};

  // Swagger 2.0
  let schema = res.schema;
  // OpenAPI 3.0
  if (!schema) schema = res.content?.["application/json"]?.schema;
  if (!schema) return {};

  // 陣列包一層、或用 $ref 指向 components.schemas
  schema = deref(schema, spec);
  if (schema?.type === "array" && schema.items) schema = deref(schema.items, spec);

  const props = schema?.properties ?? {};
  return Object.fromEntries(
    Object.entries(props).map(([k, v]) => [k, v?.description ?? ""]),
  );
}

/** 跟隨 $ref（只處理同檔內的 #/components/schemas/... 與 #/definitions/...）。 */
function deref(node, spec, depth = 0) {
  if (!node?.$ref || depth > 5) return node;
  const path = node.$ref.replace(/^#\//, "").split("/");
  let cur = spec;
  for (const seg of path) cur = cur?.[seg];
  return deref(cur, spec, depth + 1);
}

function buildCatalog(spec, { source, prefix }) {
  const catalog = {};
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const op = item?.get;
    if (!op) continue;
    const bare = path.replace(/^\//, "");
    const id = `${prefix}${bare}`;
    catalog[id] = {
      id,
      source,
      summary: op.summary ?? "",
      description: op.description ?? "",
      tags: op.tags ?? [],
      fields: extractFields(op, spec),
    };
  }
  return catalog;
}

async function main() {
  const merged = {};
  for (const src of SOURCES) {
    process.stderr.write(`fetching ${src.swagger} ...\n`);
    const res = await fetch(src.swagger, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${src.source} swagger fetch failed: HTTP ${res.status}`);
    const spec = await res.json();
    const part = buildCatalog(spec, src);
    const n = Object.keys(part).length;
    if (n === 0) throw new Error(`${src.source} catalog is empty — swagger shape may have changed`);
    const withFields = Object.values(part).filter((d) => Object.keys(d.fields).length).length;
    process.stderr.write(`  ${src.source}: ${n} datasets (${withFields} with field definitions)\n`);
    Object.assign(merged, part);
  }

  const total = Object.keys(merged).length;
  await writeFile(OUT, JSON.stringify(merged, null, 1) + "\n", "utf-8");
  process.stderr.write(`wrote ${total} datasets -> ${OUT}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + "\n");
  process.exit(1);
});
