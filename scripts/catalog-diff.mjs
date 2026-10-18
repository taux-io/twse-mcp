#!/usr/bin/env node
/**
 * catalog-diff.mjs
 * ----------------
 * 比兩份 catalog，列出資料集與欄位名稱的增減，給每週刷新的 issue 內文用：
 *   node scripts/catalog-diff.mjs <舊.json> <新.json>
 *
 * 為什麼需要：issue 只放「有變動」與比較連結，維護者得自己開 diff 才知道是證交所還是期交所、
 * 動了哪個資料集（#152 就是期交所少一個欄位，標題與 commit 卻寫證交所）。
 * 只比 id 與欄位鍵，不比說明文字——說明文字的改動由 diff 本身看。
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** 上游字串進 issue 內文前：去掉反引號與換行，免得破壞排版或夾帶 Markdown。 */
const clean = (v) => String(v).replace(/[`\r\n]/g, " ").slice(0, 120);
const code = (v) => `\`${clean(v)}\``;

export function diffCatalogs(oldCat, newCat) {
  const oldIds = new Set(Object.keys(oldCat));
  const newIds = new Set(Object.keys(newCat));
  const added = [...newIds].filter((id) => !oldIds.has(id)).sort();
  const removed = [...oldIds].filter((id) => !newIds.has(id)).sort();
  const fields = [];
  for (const id of [...newIds].filter((id) => oldIds.has(id)).sort()) {
    const o = Object.keys(oldCat[id].fields ?? {});
    const n = Object.keys(newCat[id].fields ?? {});
    const addedF = n.filter((k) => !o.includes(k));
    const removedF = o.filter((k) => !n.includes(k));
    if (addedF.length || removedF.length) fields.push({ id, added: addedF, removed: removedF });
  }
  return { added, removed, fields };
}

/** 一行一項；超過 MAX 行就截斷並指向 diff。 */
export function formatDiff(d, max = 40) {
  const lines = [];
  for (const id of d.added) lines.push(`- 新增資料集 ${code(id)}`);
  for (const id of d.removed) lines.push(`- 移除資料集 ${code(id)}`);
  for (const f of d.fields) {
    const parts = [];
    if (f.added.length) parts.push(`新增欄位 ${f.added.map(code).join("、")}`);
    if (f.removed.length) parts.push(`移除欄位 ${f.removed.map(code).join("、")}`);
    lines.push(`- ${code(f.id)}：${parts.join("；")}`);
  }
  if (!lines.length) return "資料集與欄位名稱沒有增減，只有說明文字等內容變動（看 diff）。";
  if (lines.length > max) return [...lines.slice(0, max), `- …另有 ${lines.length - max} 項，看 diff`].join("\n");
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [oldPath, newPath] = process.argv.slice(2);
  if (!oldPath || !newPath) {
    process.stderr.write("用法：node scripts/catalog-diff.mjs <舊.json> <新.json>\n");
    process.exit(2);
  }
  const [o, n] = await Promise.all([oldPath, newPath].map(async (p) => JSON.parse(await readFile(p, "utf-8"))));
  process.stdout.write(formatDiff(diffCatalogs(o, n)) + "\n");
}
