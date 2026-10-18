#!/usr/bin/env node
/**
 * check-required-checks.mjs
 * -------------------------
 * main 的分支保護要求某幾個 check 通過才能合併（設定在 GitHub，不在程式碼裡）。
 * check 名稱就是 workflow 的 job 名稱：job 改名，或它的 pull_request 觸發被加上路徑篩選，
 * PR 就會永遠等一個不會出現的 check，卡住合併，而程式碼裡沒有任何東西會先出聲。
 *
 *   npm run check-required-checks            # 靜態：每個 required check 都有對應的 job，且該 workflow 在 PR 時會跑
 *   npm run check-required-checks -- --remote # 另外用 gh api 讀 GitHub 上實際的 required checks，比對 REQUIRED_CHECKS
 *
 * 靜態那一半由 test/catalog.test.ts 在 CI 跑。--remote 需要有 repo 管理權限的 gh 登入，CI 的 token 讀不到，
 * 所以只在本機、改過分支保護之後跑。
 */
import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");
const REPO = "taux-io/twse-mcp";

/** GitHub 上 main 的 required checks。改分支保護時，這裡要跟著改。 */
export const REQUIRED_CHECKS = ["test"];

/** check 名稱：job 有 name: 就用它，否則用 job id。只認這個 repo 用到的簡單寫法（2 格縮排的 job）。 */
export function jobNames(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const names = [];
  let id = null;
  let name = null;
  const flush = () => id && names.push(name ?? id);
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith("#")) break; // 下一個頂層鍵
    const job = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) {
      flush();
      id = job[1];
      name = null;
      continue;
    }
    const n = /^    name:\s*(.+?)\s*$/.exec(line);
    if (n && id) name = n[1].replace(/^["']|["']$/g, "");
  }
  flush();
  return names;
}

/** on: 區塊的文字（到下一個頂層鍵為止）。 */
function onBlock(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^on:/.test(l));
  if (start < 0) return "";
  const out = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith("#")) break;
    out.push(line);
  }
  return out.join("\n");
}

/** 回傳問題清單；空陣列代表沒事。workflows: [{ file, text }] */
export function findProblems(workflows, required = REQUIRED_CHECKS) {
  const problems = [];
  for (const check of required) {
    const owners = workflows.filter((w) => jobNames(w.text).includes(check));
    if (!owners.length) {
      problems.push(`required check「${check}」沒有任何 workflow 的 job 叫這個名字——PR 會永遠等它`);
      continue;
    }
    for (const w of owners) {
      const on = onBlock(w.text);
      if (!/^\s+pull_request:|\bpull_request\b/m.test(on)) {
        problems.push(`required check「${check}」在 ${w.file}，但它不在 pull_request 時跑——PR 會永遠等它`);
      } else if (/^\s+(paths|paths-ignore):/m.test(on)) {
        problems.push(`required check「${check}」在 ${w.file}，on: 區塊有 paths 篩選——沒碰到那些路徑的 PR 會永遠等它`);
      }
    }
  }
  return problems;
}

export async function readWorkflows() {
  const files = (await readdir(WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)).sort();
  return Promise.all(files.map(async (file) => ({ file, text: await readFile(join(WORKFLOWS, file), "utf-8") })));
}

function liveRequiredChecks() {
  const out = execFileSync(
    "gh",
    ["api", `repos/${REPO}/branches/main/protection`, "--jq", ".required_status_checks.contexts"],
    { encoding: "utf-8" },
  );
  return JSON.parse(out);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = findProblems(await readWorkflows());
  if (process.argv.includes("--remote")) {
    const live = liveRequiredChecks();
    const same = live.length === REQUIRED_CHECKS.length && REQUIRED_CHECKS.every((c) => live.includes(c));
    if (!same) {
      problems.push(`GitHub 上的 required checks 是 ${JSON.stringify(live)}，與 REQUIRED_CHECKS ${JSON.stringify(REQUIRED_CHECKS)} 不同`);
    }
  }
  if (problems.length) {
    process.stderr.write(problems.map((p) => `✗ ${p}`).join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(`required checks 檢查通過：${REQUIRED_CHECKS.join("、")}\n`);
}
