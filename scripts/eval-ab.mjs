/**
 * eval-ab.mjs — 改動前後的工具選擇測試，兩邊都在本機、交錯執行。
 *
 * 為什麼不直接拿正式環境對本機比：模型的表現會隨時段起伏，兩邊分開跑，落差可能
 * 只是時段不同。2026-09-26 就發生過（AGENTS.md「要比就在同一段時間、同一種環境比」）。
 * 另外，正式環境跑在 Workers 免費方案，大量 eval 請求會吃掉 CPU 的寬容額度（#104）。
 *
 * 做法：
 *   1. 把改動前的版本（EVAL_BASE，預設 main）放進暫時的 git worktree，起在 8788；
 *      目前的工作目錄（含未 commit 的改動）起在 8787。
 *   2. 每一輪、每一題都依序各問兩邊一次（改動前 → 改動後），兩邊落在同一段時間。
 *   3. 輸出每題兩邊的通過數；改動後比較差的題目標出來。
 *   4. 結束（含 Ctrl-C）時關掉兩個伺服器、移除 worktree。
 *
 *   npm run eval:ab
 *   EVAL_REPEAT=10 EVAL_ONLY=screen-top-yield EVAL_MODEL=sonnet npm run eval:ab
 *   EVAL_BASE=v0.9.0 npm run eval:ab       # 改動前改成某個 tag 或 commit
 *
 * 只支援 claude-code 跑法（與 eval-tools.mjs 的預設相同，不產生 API 帳單）。
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askClaudeCode, matchCall } from "./eval-tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIDES = [
  { key: "base", label: "改動前", port: 8788 },
  { key: "new", label: "改動後", port: 8787 },
];
const CONCURRENCY = 3;

/** 起一個 wrangler dev，等到 Ready 才回傳。獨立 process group，結束時整組關掉（npx 底下還有子行程）。 */
function startServer(cwd, port) {
  return new Promise((resolve, reject) => {
    // 兩個 wrangler dev 同時起，預設都搶 9229 的除錯埠，後起的那個會直接結束。
    const child = spawn("npx", ["wrangler", "dev", "--port", String(port), "--inspector-port", String(port + 1000)], {
      cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const timer = setTimeout(() => reject(new Error(`${port} 60 秒內沒有啟動：\n${log.slice(-500)}`)), 60_000);
    const onData = (d) => {
      log += d;
      if (log.includes(`Ready on http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${port} 的 wrangler dev 結束（${code}）：\n${log.slice(-500)}`)));
  });
}

async function portInUse(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const base = process.env.EVAL_BASE ?? "main";
  const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
  const model = process.env.EVAL_MODEL;
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());
  const { cases: all } = JSON.parse(await readFile(path.join(ROOT, "evals/tool-selection.json"), "utf-8"));
  const cases = only ? all.filter((c) => only.includes(c.id)) : all;
  if (!cases.length) throw new Error(`EVAL_ONLY 沒有對到任何題目：${only}`);

  for (const s of SIDES) {
    if (await portInUse(s.port)) throw new Error(`port ${s.port} 已被占用，先關掉那邊的 wrangler dev`);
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "twse-ab-"));
  const worktree = path.join(tmp, "base");
  const cwd = path.join(tmp, "cwd"); // claude -p 的空目錄：不讓 repo 的設定進到 session
  const servers = [];
  const cleanup = () => {
    for (const s of servers) {
      try { process.kill(-s.pid); } catch {}
    }
    try { execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: ROOT, stdio: "ignore" }); } catch {}
  };
  process.on("SIGINT", () => { cleanup(); process.exit(130); });

  try {
    execFileSync("git", ["worktree", "add", "--detach", worktree, base], { cwd: ROOT, stdio: "ignore" });
    await symlink(path.join(ROOT, "node_modules"), path.join(worktree, "node_modules"));
    await mkdir(cwd);
    servers.push(...(await Promise.all([startServer(worktree, 8788), startServer(ROOT, 8787)])));
    console.log(`改動前：${base} @ 8788 ｜ 改動後：工作目錄 @ 8787 ｜ ${cases.length} 題 × ${repeat} 輪${model ? ` ｜ ${model}` : ""}\n`);

    // 工作清單的順序就是交錯：同一題的改動前、改動後相鄰，同時跑的幾個工作也兩邊都有。
    const jobs = [];
    for (let r = 0; r < repeat; r++) for (const c of cases) for (const s of SIDES) jobs.push({ c, s });
    const tally = new Map(cases.map((c) => [c.id, { base: 0, new: 0, misses: [] }]));
    let next = 0;
    let fatal = null;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < jobs.length && !fatal) {
          const { c, s } = jobs[next++];
          const r = await askClaudeCode(c.question, { endpoint: `http://localhost:${s.port}/mcp`, model, cwd });
          if (r.fatal) fatal = r.note;
          const t = tally.get(c.id);
          if (matchCall(r.call, c.expect)) t[s.key]++;
          else t.misses.push(`${s.label}：${r.call ? `${r.call.name} ${JSON.stringify(r.call.input)}` : r.note}`);
        }
      }),
    );
    if (fatal) throw new Error(fatal);

    let sumBase = 0;
    let sumNew = 0;
    for (const c of cases) {
      const t = tally.get(c.id);
      sumBase += t.base;
      sumNew += t.new;
      const mark = t.new < t.base ? "⚠️ " : t.new === repeat && t.base === repeat ? "✅" : "・";
      console.log(`${mark} ${c.id}：改動前 ${t.base}/${repeat} ｜ 改動後 ${t.new}/${repeat}`);
      for (const m of t.misses) console.log(`     ${m.slice(0, 160)}`);
    }
    const n = cases.length * repeat;
    console.log(`\n合計：改動前 ${sumBase}/${n} ｜ 改動後 ${sumNew}/${n}`);
    console.log("⚠️ 是改動後較差的題目；單輪的差距可能只是隨機，用 EVAL_ONLY + EVAL_REPEAT=10 再確認。");
  } finally {
    cleanup();
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
