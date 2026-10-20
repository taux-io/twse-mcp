/**
 * pr-wait.mjs — 等 PR 的檢查全部跑完，全部通過才 exit 0。
 *
 * 為什麼不直接 `gh pr checks --watch`：剛開出 PR 的幾秒內，檢查還沒註冊，watch 會看到空清單
 * 或只有一部分檢查，提早以非 0 結束（#167 就是這樣，合併被擋）。這支先等檢查出現，
 * watch 結束後再查一次最終狀態，還有未完成的就繼續等。
 *
 *   npm run pr:wait            # 目前分支的 PR
 *   npm run pr:wait -- 170     # 指定 PR 編號
 *
 * exit 0 = 全部通過（略過的不算失敗）；1 = 有失敗或取消；2 = 等不到檢查或 gh 出錯。
 * 不要把輸出接 pipe：pipe 會讓 shell 看不到這裡的 exit code。
 */
import { execFileSync, spawnSync } from "node:child_process";

const pr = process.argv[2] ? [process.argv[2]] : [];
const REGISTER_WAIT_MS = 120_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 目前的檢查清單；gh 在「還沒有任何檢查」時會以非 0 結束，當成空清單。 */
export function readChecks() {
  const r = spawnSync("gh", ["pr", "checks", ...pr, "--json", "name,bucket"], { encoding: "utf-8" });
  if (r.error) throw r.error;
  try {
    return JSON.parse(r.stdout || "[]");
  } catch {
    return [];
  }
}

/** pass／skipping 之外都算沒過；pending 是還沒跑完。 */
export function summarize(checks) {
  const bad = checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  const pending = checks.filter((c) => c.bucket === "pending");
  return { bad, pending, done: checks.length > 0 && !pending.length };
}

async function main() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
  } catch {
    console.error("找不到 gh");
    return 2;
  }
  const start = Date.now();
  while (readChecks().length === 0) {
    if (Date.now() - start > REGISTER_WAIT_MS) {
      console.error(`等了 ${REGISTER_WAIT_MS / 1000} 秒，這個 PR 還是沒有任何檢查`);
      return 2;
    }
    await sleep(5000);
  }
  for (;;) {
    spawnSync("gh", ["pr", "checks", ...pr, "--watch", "--interval", "10"], { stdio: "inherit" });
    const { bad, pending, done } = summarize(readChecks());
    if (done) {
      if (bad.length) {
        console.error(`未通過：${bad.map((c) => c.name).join("、")}`);
        return 1;
      }
      console.log("所有檢查都通過");
      return 0;
    }
    console.log(`還有 ${pending.length} 項未完成，繼續等…`);
    await sleep(5000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
