/**
 * check-readmes.mjs — 守住多語 README 之間的一致性。
 *
 * 五份文件、兩種角色：
 *   - **完整版**（zh-TW、en）：逐節同步，H2 章節數必須一致。
 *   - **精簡版**（ja、ko、zh-CN）：刻意只涵蓋「設定 + 連線 + 須知 + 涵蓋範圍」，
 *     不跟完整版比章節，但必須具備一組最小章節，且不得少於它。
 *
 * 這支存在的理由是維護成本：一份改動要做五次，而漂移的典型長相是「英文版加了一節、
 * 日文版沒跟上」或「網址改了、只改了兩份」。這些用眼睛看不出來，用測試看得出來。
 *
 * 不檢查翻譯品質——那要母語者，不是腳本。只檢查結構與那些一旦不同步就會真的害到
 * 使用者的字面值（端點網址、語言切換器的連結完整性）。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 端點網址錯一個字，使用者就連不上——五份都必須一模一樣。 */
const ENDPOINT = "https://twse-mcp.taux.io/mcp";

const FULL = ["README.md", "README.en.md"];
const CONCISE = ["README.ja.md", "README.ko.md", "README.zh-CN.md"];
const ALL = [...FULL, ...CONCISE];

/** 精簡版最少要有這幾節。標題語言各異，所以比的是「有幾節」而不是標題字面。 */
const MIN_CONCISE_SECTIONS = 5;

/** 語言切換器裡應該出現的檔名（當前語言那項是純文字，不會有連結）。 */
const SWITCHER_TARGETS = ALL;

function h2s(text) {
  return text.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
}

async function main() {
  const docs = new Map();
  for (const f of ALL) {
    docs.set(f, await readFile(path.join(ROOT, f), "utf-8"));
  }

  const problems = [];

  // 1. 完整版之間的 H2 數量必須一致
  const [a, b] = FULL;
  const na = h2s(docs.get(a)).length;
  const nb = h2s(docs.get(b)).length;
  if (na !== nb) {
    problems.push(`${a} 有 ${na} 個 H2，${b} 有 ${nb} 個——完整版必須逐節同步`);
  }

  // 2. 精簡版的章節數下限
  for (const f of CONCISE) {
    const n = h2s(docs.get(f)).length;
    if (n < MIN_CONCISE_SECTIONS) {
      problems.push(`${f} 只有 ${n} 個 H2，精簡版至少要 ${MIN_CONCISE_SECTIONS} 個`);
    }
  }

  // 3. 端點網址：五份都要有，而且不能有別的 /mcp 網址混進來
  for (const f of ALL) {
    const text = docs.get(f);
    if (!text.includes(ENDPOINT)) {
      problems.push(`${f} 找不到端點網址 ${ENDPOINT}`);
    }
    for (const m of text.matchAll(/https:\/\/[^\s`)"]+\/mcp\b/g)) {
      if (m[0] !== ENDPOINT) problems.push(`${f} 出現非預期的端點網址：${m[0]}`);
    }
  }

  // 4. 語言切換器：每一份都要連到其他四份，且必須在前三行內
  for (const f of ALL) {
    const head = docs.get(f).split("\n").slice(0, 3).join("\n");
    for (const target of SWITCHER_TARGETS) {
      if (target === f) {
        // 當前語言不該自連結
        if (head.includes(`(${target})`)) {
          problems.push(`${f} 的語言切換器自我連結到 ${target}，當前語言應為純文字`);
        }
        continue;
      }
      if (!head.includes(`(${target})`)) {
        problems.push(`${f} 的語言切換器缺少 ${target} 的連結`);
      }
    }
  }

  // 5. 精簡版的翻譯聲明必須指回完整版。
  //    刻意跳過第一行：語言切換器本來就連到每一份，拿它當證據的話這條永遠為真——
  //    第一版就是這樣寫的，實測弄壞也抓不到，等於沒有檢查。
  for (const f of CONCISE) {
    const body = docs.get(f).split("\n").slice(1).join("\n");
    const linksBack = FULL.some((full) => new RegExp(`\\(${full.replace(".", "\\.")}[#)]`).test(body));
    if (!linksBack) {
      problems.push(`${f} 的內文沒有指回任何一份完整版（語言切換器不算）`);
    }
  }

  if (problems.length) {
    console.error("README 一致性檢查失敗：");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`README 一致性檢查通過（完整版 ${FULL.length} 份、精簡版 ${CONCISE.length} 份）`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
