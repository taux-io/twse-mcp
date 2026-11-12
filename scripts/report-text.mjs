/**
 * 把不是我們寫的文字放進報告之前的清理。smoke.mjs 與 check-upstream.mjs 共用。
 *
 * 這些報告會由機器人貼進公開 issue，也會印到 Actions log。上游回的文字原樣放進去的話，
 * `@某人` 會通知到人、連結看起來像維護者的機器人發的，換行之後的 `::add-mask::` 這類字串
 * 會被 runner 當成 workflow command 執行。
 *
 * 做法：反引號與控制字元（含換行）換成空白、連續空白壓成一個、截短、包成行內程式碼。
 * 行內程式碼裡的提及與連結本來就不會生效；`@` 另外換成全形，報告被轉貼到別處時也不會生效。
 *
 * 只用 Node 內建功能：呼叫它的 job 拿的是 issues write token。
 */
export function quoted(value, max = 300) {
  const text = String(value ?? "")
    .replace(/[`\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("@", "＠");
  const chars = [...text];
  return `\`${chars.length > max ? `${chars.slice(0, max).join("")}…` : text}\``;
}
