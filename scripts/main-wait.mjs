/**
 * main-wait.mjs — 等 origin/main 最新提交的 tests workflow 跑完，通過才 exit 0。
 *
 * 合併 PR 之後用：確認 main 上的 tests 真的通過，不是只看合併前的 PR 檢查。
 * 先 git fetch，取 origin/main 的 sha（不是本機 HEAD），等這個 sha 的 tests run 註冊、跑完。
 * 開始等之後 main 又有新提交，不會追新的，只等開始時的那個 sha。
 *
 *   npm run main-wait
 *
 * exit 0 = 通過；1 = 失敗或沒通過（skipped 也算，因為沒跑不能當通過）；
 * 2 = 等不到 run（註冊等 120 秒）、整體超過 15 分鐘、或 gh／git 出錯。
 * 失敗時印出 run 網址與 `gh run view <id> --log-failed`。只下讀取用的指令。
 * 不要把輸出接 pipe：pipe 會讓 shell 看不到這裡的 exit code。
 */
import { execFileSync } from "node:child_process";

/** 從 gh run list 的結果挑出 headSha 相符的 run（重跑時取編號最大的）；還沒註冊回 null。 */
export function pickRun(runs, sha) {
  return runs.filter((r) => r.headSha === sha).reduce((a, b) => (!a || b.databaseId > a.databaseId ? b : a), null);
}

/** "pass"｜"fail"｜"pending"。只有 completed 加 success 算通過；跑完的其他結論（含 skipped）都算失敗。 */
export function classify(run) {
  if (run.status !== "completed") return "pending";
  return run.conclusion === "success" ? "pass" : "fail";
}

const POLL_MS = 5000;

/** 等 sha 對應的 tests run 跑完；回傳結束碼（0 通過、1 失敗、2 等不到或出錯）。 */
export async function waitForMain({ sha, readRuns, sleep, now, log, registerWaitMs = 120_000, timeoutMs = 900_000 }) {
  const start = now();
  for (;;) {
    const run = pickRun(await readRuns(), sha);
    if (!run && now() - start > registerWaitMs) {
      log(`等了 ${registerWaitMs / 1000} 秒，main ${sha.slice(0, 7)} 還沒有 tests run 註冊（沒有這個 sha 的 run）`);
      return 2;
    }
    const state = run && classify(run);
    if (state === "pass") {
      log(`main ${sha.slice(0, 7)} 的 tests 通過：${run.url}`);
      return 0;
    }
    if (state === "fail") {
      const how = run.conclusion === "skipped" ? "skipped（沒有跑，不是通過）" : run.conclusion;
      log(`main ${sha.slice(0, 7)} 的 tests 未通過：${how}\n${run.url}\n查原因：gh run view ${run.databaseId} --log-failed`);
      return 1;
    }
    if (run && now() - start > timeoutMs) {
      log(`等了 ${timeoutMs / 60_000} 分鐘，main ${sha.slice(0, 7)} 的 tests 還沒跑完：${run.url}`);
      return 2;
    }
    await sleep(POLL_MS);
  }
}

/** exec(file, args) 回傳 stdout，失敗就丟錯。 */
export async function main({ exec, sleep, now, log }) {
  try {
    exec("gh", ["--version"]);
  } catch {
    log("找不到 gh");
    return 2;
  }
  try {
    exec("git", ["fetch", "origin", "main"]);
    const sha = exec("git", ["rev-parse", "origin/main"]).trim();
    const readRuns = async () =>
      JSON.parse(
        exec("gh", ["run", "list", "--workflow", "tests", "--branch", "main", "--limit", "20", "--json", "databaseId,headSha,status,conclusion,url"]),
      );
    return await waitForMain({ sha, readRuns, sleep, now, log });
  } catch (e) {
    log(`無法確認 main 的 tests：${e instanceof Error ? e.message : e}${e?.stderr ? `\n${e.stderr}` : ""}`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(
    await main({
      exec: (file, args) => execFileSync(file, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      log: (l) => console.log(l),
    }),
  );
}
