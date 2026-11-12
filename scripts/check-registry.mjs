#!/usr/bin/env node
/**
 * 讀官方 MCP Registry 上本專案的最新條目，確認它的 `remotes` 與 repo 裡的 server.json 相同。
 *
 * 為什麼需要：registry 條目的 `remotes[0].url` 是所有從 registry 安裝的 client 連過去的位址。
 * 發布用的 OIDC 憑證在 repo 這一側鎖不住——environment 的 required reviewer 只管宣告了它的
 * job，有 write 權限的人可以另外推一支不宣告 environment 的 workflow 拿到同一張憑證。
 * 擋不住，就每天看一次結果：條目被改指到別的主機時，這裡會紅，並由 smoke.yml 開 issue。
 *
 * 讀不到 registry 也算失敗：一個讀不到就放行的偵測，等於沒有偵測。
 *
 * 只用 Node 內建模組：CI 的這個 job 拿的是 issues write token。
 */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REGISTRY = "https://registry.modelcontextprotocol.io";

// registry 的內容是第三方文字，會進公開 issue：去掉反引號與換行、截短、包成行內程式碼。
const code = (v) => `\`${String(v).replace(/[`\r\n]/g, " ").slice(0, 200)}\``;

/**
 * 純函式：比對 registry 回的條目與 repo 的 server.json。回傳問題清單，空陣列代表一致。
 * 比的是整個 `remotes`（數量、type、url），多一個 remote 也算不一致。
 */
export function registryProblems(entry, expected) {
  if (entry?.name !== expected.name) {
    return [`registry 回的條目名稱是 ${code(entry?.name)}，預期 ${code(expected.name)}`];
  }
  const got = Array.isArray(entry.remotes) ? entry.remotes : [];
  const same =
    got.length === expected.remotes.length &&
    expected.remotes.every((r, i) => got[i]?.type === r.type && got[i]?.url === r.url);
  if (same) return [];
  const show = (rs) => (rs.length ? rs.map((r) => `${code(r?.type)} ${code(r?.url)}`).join("、") : "（沒有）");
  return [
    `**registry 條目的連線位址與 repo 不一致。** registry（版本 ${code(entry.version)}）：${show(got)}；` +
      `repo 的 server.json：${show(expected.remotes)}。若不是你自己發布的，視為條目被竄改。`,
  ];
}

async function main() {
  const expected = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  const url = `${REGISTRY}/v0/servers/${encodeURIComponent(expected.name)}/versions/latest`;
  let problems;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    problems = registryProblems((await res.json()).server, expected);
  } catch (e) {
    problems = [`讀不到官方 MCP Registry 的條目（${code(e?.message ?? e)}），無法確認連線位址有沒有被改。`];
  }
  const report = [
    `官方 MCP Registry 條目：${url}`,
    "",
    problems.length ? `**失敗 ${problems.length} 項**` : "與 server.json 一致",
    ...problems.map((p) => `- ${p}`),
  ].join("\n");
  if (process.env.REGISTRY_REPORT) await writeFile(process.env.REGISTRY_REPORT, report + "\n");
  console.log(report);
  process.exit(problems.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
