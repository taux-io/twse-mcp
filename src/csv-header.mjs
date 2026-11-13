/**
 * 上游 CSV 表頭與目錄欄位說明的對應規則。src/twse.ts（執行期）與
 * scripts/check-upstream.mjs（每日健檢）共用這一份，兩邊的判斷才不會分岔。
 *
 * 為什麼需要通用規則：期交所會在沒有公告的情況下讓端點在 JSON 與 CSV 之間來回切換，
 * 2026-09-26 一天內就觀察到五個端點切換。逐一指名追不上，而指名清單之外的端點一切成
 * CSV，工具就壞到有人補清單為止。
 *
 * 規則（每一欄都要成立，否則整份拒絕，交回「上游回非 JSON」的大聲失敗）：
 *   1. 欄數與目錄宣告的欄位數相同，且不為 0。目錄若被上游 schema 變動清空，欄數是 0，
 *      規則自動不成立——不會因為目錄壞掉而把守衛解除。
 *   2. 第 i 欄的表頭等於第 i 個欄位說明；或兩者互相包含（上游 CSV 常比 swagger 多幾個字：
 *      「契約代號」對「契約」、「前五大交易人買方數量」對「前五大交易人買方」）。
 *   3. 但若第 i 欄的表頭**完全等於另一個位置**的欄位說明，一律拒絕。沒有這條的話，
 *      「最高價」與「歷史最高價」對調會被第 2 條的包含關係放行——正是要防的欄位錯位。
 */
export function headerMatches(header, descriptions) {
  if (!descriptions.length || header.length !== descriptions.length) return false;
  return header.every((raw, i) => {
    const h = raw.trim();
    const d = descriptions[i];
    if (h === d) return true;
    if (descriptions.some((other, j) => j !== i && other === h)) return false;
    return Boolean(h && d && (h.includes(d) || d.includes(h)));
  });
}

/**
 * 回應本文該用哪種編碼解。只看第一塊，所以不必為了判斷編碼把整份本文留在記憶體裡。
 *
 * 期交所有端點用 Big5 送 CSV，沒有 BOM 也沒有 charset（2026-11-13：InterestRateFuturesMargining）。
 * 當成 UTF-8 解，中文表頭整行變成替代字元，對不上目錄。
 *
 * JSON 一律當 UTF-8：規格如此，而且 JSON 裡夾一個壞位元組時改用 Big5，會把整份的中文安靜地換成別的字。
 * 其餘的只有在第一塊不是合法 UTF-8 時才當 Big5。第一塊結尾切在一個字中間不算不合法。
 *
 * @param {Uint8Array} firstChunk
 * @returns {"utf-8" | "big5"}
 */
export function bodyEncoding(firstChunk) {
  const first = firstChunk.find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
  if (first === 0x5b || first === 0x7b) return "utf-8";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(firstChunk, { stream: true });
    return "utf-8";
  } catch {
    return "big5";
  }
}
