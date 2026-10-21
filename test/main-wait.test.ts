import { describe, expect, it } from "vitest";
import { classify, main, pickRun, waitForMain } from "../scripts/main-wait.mjs";

// gh run list --workflow tests --json databaseId,headSha,status,conclusion,url 的一列
const run = (databaseId: number, headSha: string, status = "completed", conclusion: string | null = "success") => ({
  databaseId,
  headSha,
  status,
  conclusion,
  url: `https://github.com/taux-io/twse-mcp/actions/runs/${databaseId}`,
});

describe("pickRun", () => {
  it("從清單挑出 headSha 相符的那一筆，別的 sha 不算", () => {
    const runs = [run(3, "ccc"), run(2, "bbb"), run(1, "aaa")];
    expect(pickRun(runs, "bbb")).toEqual(run(2, "bbb"));
  });

  it("同一個 sha 有重跑時取最新（編號最大）的，不管清單順序", () => {
    const runs = [run(5, "bbb", "completed", "failure"), run(9, "bbb"), run(7, "bbb", "completed", "cancelled")];
    expect(pickRun(runs, "bbb")?.databaseId).toBe(9);
  });

  it("沒有相符的 sha（還沒註冊，或清單是空的）回 null", () => {
    expect(pickRun([run(3, "ccc")], "zzz")).toBeNull();
    expect(pickRun([], "zzz")).toBeNull();
  });
});

describe("classify", () => {
  it("completed 且 success 才是通過", () => {
    expect(classify(run(1, "a", "completed", "success"))).toBe("pass");
  });

  it.each(["failure", "cancelled", "timed_out", "skipped", "action_required", "neutral"])("completed 但結論是 %s 算失敗", (conclusion) => {
    expect(classify(run(1, "a", "completed", conclusion))).toBe("fail");
  });

  it.each(["queued", "in_progress", "waiting", "pending", "requested"])("狀態是 %s 還沒跑完，算進行中（就算 conclusion 是 null）", (status) => {
    expect(classify(run(1, "a", status, null))).toBe("pending");
  });
});

// 預設設定下最多約 181 次（15 分鐘 ÷ 5 秒）；500 不會誤殺正常情況。
const MAX_READS = 500;

describe("waitForMain（讀取、睡眠、時鐘由外部注入）", () => {
  /** 每次 readRuns 依序回一份清單；睡眠只讓假時鐘前進，不真的等。 */
  function harness(reads: ReturnType<typeof run>[][], opts: { registerWaitMs?: number; timeoutMs?: number } = {}) {
    let t = 0;
    let i = 0;
    const lines: string[] = [];
    return {
      deps: {
        sha: "bbb",
        readRuns: async () => {
          // 迴圈全在微任務裡，vitest 的 testTimeout 中斷不了；逾時邏輯壞掉時要報失敗，不能卡死。
          if (i >= MAX_READS) throw new Error(`讀取超過 ${MAX_READS} 次，逾時邏輯可能壞了`);
          return reads[Math.min(i++, reads.length - 1)];
        },
        sleep: async (ms: number) => void (t += ms),
        now: () => t,
        log: (l: string) => lines.push(l),
        ...opts,
      },
      out: () => lines.join("\n"),
      reads: () => i,
    };
  }

  it("run 晚幾輪才註冊、接著進行中、最後成功：回 0", async () => {
    const h = harness([[run(1, "aaa")], [run(1, "aaa")], [run(2, "bbb", "queued", null)], [run(2, "bbb", "in_progress", null)], [run(2, "bbb")]]);
    expect(await waitForMain(h.deps)).toBe(0);
    expect(h.reads()).toBe(5);
    expect(h.out()).toMatch(/通過/);
  });

  it("run 失敗：回 1，印出 run 網址與查原因的指令", async () => {
    const h = harness([[run(2, "bbb", "in_progress", null)], [run(2, "bbb", "completed", "failure")]]);
    expect(await waitForMain(h.deps)).toBe(1);
    expect(h.out()).toContain("https://github.com/taux-io/twse-mcp/actions/runs/2");
    expect(h.out()).toContain("gh run view 2 --log-failed");
  });

  it("跑完卻是 skipped：也回 1，並說它是 skipped，不是通過", async () => {
    const h = harness([[run(2, "bbb", "completed", "skipped")]]);
    expect(await waitForMain(h.deps)).toBe(1);
    expect(h.out()).toContain("skipped");
  });

  it("run 一直沒註冊：超過註冊等待（預設 120 秒）回 2，說明這個 sha 沒有 tests run", async () => {
    const h = harness([[run(1, "aaa")]]);
    expect(await waitForMain({ ...h.deps, registerWaitMs: 20_000 })).toBe(2);
    expect(h.out()).toContain("bbb".slice(0, 7));
    expect(h.out()).toMatch(/沒有.*tests|還沒.*註冊/);
    expect(h.reads()).toBeLessThan(10); // 沒有一直讀下去
  });

  it("run 已註冊但一直沒跑完：超過整體上限回 2，附上 run 網址", async () => {
    const h = harness([[run(2, "bbb", "in_progress", null)]]);
    expect(await waitForMain({ ...h.deps, timeoutMs: 60_000 })).toBe(2);
    expect(h.out()).toContain("https://github.com/taux-io/twse-mcp/actions/runs/2");
    expect(h.out()).toMatch(/還沒跑完|等了/);
    expect(h.reads()).toBeLessThan(20);
  });
});

describe("main（git 與 gh 由外部注入）", () => {
  /** 假的 exec：依「指令 參數…」回傳 stdout；沒列到的指令丟錯，像指令不存在。 */
  function harness(replies: Record<string, string | Error>) {
    const calls: string[] = [];
    const lines: string[] = [];
    return {
      deps: {
        exec: (file: string, args: string[]) => {
          const key = [file, ...args].join(" ");
          calls.push(key);
          // now 固定是 0、sleep 不等：run 沒通過時迴圈永遠不會逾時，要靠這個上限報失敗，不能卡死。
          if (calls.length > MAX_READS) throw new Error(`指令超過 ${MAX_READS} 次，迴圈可能停不下來`);
          const r = replies[key];
          if (r === undefined) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
          if (r instanceof Error) throw r;
          return r;
        },
        sleep: async () => {},
        now: () => 0,
        log: (l: string) => lines.push(l),
      },
      calls,
      out: () => lines.join("\n"),
    };
  }

  it("找不到 gh：回 2 並說找不到 gh", async () => {
    const h = harness({});
    expect(await main(h.deps)).toBe(2);
    expect(h.out()).toContain("gh");
  });

  const LIST = "gh run list --workflow tests --branch main --limit 20 --json databaseId,headSha,status,conclusion,url";
  const ok = {
    "gh --version": "gh version 2.0",
    "git fetch origin main": "",
    "git rev-parse origin/main": "bbbbbbb1234567\n",
    [LIST]: JSON.stringify([run(2, "bbbbbbb1234567"), run(1, "aaa")]),
  };

  it("fetch 後取 origin/main 的 sha，讀 tests run，通過回 0；只下讀取用的指令", async () => {
    const h = harness(ok);
    expect(await main(h.deps)).toBe(0);
    expect(h.out()).toContain("bbbbbbb");
    expect(h.calls).toEqual(["gh --version", "git fetch origin main", "git rev-parse origin/main", LIST]);
    // 沒有任何會改東西的 gh／git 指令
    expect(h.calls.join("\n")).not.toMatch(/merge|push|delete|checkout|switch|reset|rerun|cancel/);
  });

  it("git fetch 或 gh run list 出錯：回 2，印出原因，不丟例外", async () => {
    const h1 = harness({ ...ok, "git fetch origin main": new Error("fatal: unable to access origin") });
    expect(await main(h1.deps)).toBe(2);
    expect(h1.out()).toContain("unable to access origin");
    const h2 = harness({ ...ok, [LIST]: new Error("gh: To use GitHub CLI, run: gh auth login") });
    expect(await main(h2.deps)).toBe(2);
    expect(h2.out()).toContain("gh auth login");
  });
});

