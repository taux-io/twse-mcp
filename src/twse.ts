/**
 * twse.ts — 對交易所的出站層（薄殼）。
 * ====================================
 * 服務兩個上游：證交所（openapi.twse.com.tw）與期交所（openapi.taifex.com.tw）。
 * 分流的依據是 dataset id 的 `taifex/` 前綴——那是**本服務的命名**，不是上游路徑的
 * 一部分（見 scripts/refresh-catalog.mjs 說明前綴的理由），打出去前必須拆掉。
 * v1 快取策略：把 cacheTtl / cacheEverything 掛在 fetch 的 `cf` 上（見 fetchJson），
 * 由邊緣快取出站請求，不自己管 KV，也沒有用到 `caches` 全域。
 * `cf` 是 Workers 專屬欄位，在 Node/Vitest 下會被忽略，所以離線測不需要任何分支
 * （測試 mock globalThis.fetch）。
 */
import { DATA_TTL_SECONDS, type Row } from "./core";

export const BASE = "https://openapi.twse.com.tw/v1";
/** 期交所的 servers.url。裸 path（沒有 /v1）會被 302 導回 Swagger UI 首頁。 */
export const TAIFEX_BASE = "https://openapi.taifex.com.tw/v1";
/** 目錄裡期交所 id 的前綴。只有本服務認得，上游不認得。 */
const TAIFEX_PREFIX = "taifex/";

/** dataset id -> 上游 URL。分流只看前綴，不查目錄——出站層不該依賴目錄能載入。 */
export function datasetUrl(datasetId: string): string {
  return datasetId.startsWith(TAIFEX_PREFIX)
    ? `${TAIFEX_BASE}/${datasetId.slice(TAIFEX_PREFIX.length)}`
    : `${BASE}/${datasetId}`;
}

// twse_etf_snapshot 用到的三個資料集
export const DS_FUND = "opendata/t187ap47_L"; // 基金基本資料彙總表
export const DS_DAY = "exchangeReport/STOCK_DAY_ALL"; // 上市個股日成交資訊
export const DS_RANK = "ETFReport/ETFRank"; // 定期定額交易戶數統計排行月報表

const MIS_BASE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

/**
 * 取整份資料集（兩邊的每個資料集都是一次回整份）。走邊緣快取。
 *
 * `expectedFields` 是目錄宣告的欄位名，只在上游回 CSV 時用得到——見 parseCsv 說明
 * 為什麼需要它。證交所不會走到那條路。
 */
export async function fetchDataset(datasetId: string, expectedFields?: string[]): Promise<Row[]> {
  const url = datasetUrl(datasetId);
  const isTaifex = datasetId.startsWith(TAIFEX_PREFIX);
  const data = await fetchJson(
    url,
    { Accept: "application/json" },
    DATA_TTL_SECONDS,
    // CSV 退路只開給期交所。證交所回非 JSON 一律是上游出事（2xx + HTML 錯誤頁），
    // 把那個 body 餵給 CSV parser 只會把診斷資訊換成一堆假欄位。
    isTaifex ? (body) => parseCsv(body, expectedFields, datasetId) : undefined,
  );
  return Array.isArray(data) ? (data as Row[]) : [data as Row];
}

/**
 * 期交所有**恰好一個**端點回 CSV 而不是 JSON：`/v1/DailyMarketReportOpt`（選擇權
 * 每日行情）。它帶 UTF-8 BOM、CRLF、**中文表頭**，而同一支 swagger 為它宣告的是
 * 英文欄位——目錄的 `fields` 就是從那裡來的。
 *
 * 所以若直接用中文表頭當 key，`twse_describe_dataset` 說「有 Contract 欄位」而
 * `twse_get_dataset` 回的是 `契約`，`code=`／`match=` 全部落空。那不是壞掉，
 * 是安靜地給錯答案——比壞掉難查得多。
 *
 * 實測兩邊都是 18 個欄位且順序一一對應，所以**按位置**改名成 swagger 的英文欄位。
 * 按位置對應是個假設，因此它被一道嚴格守衛保護：數量對不上就丟出錯誤，不做部分
 * 對應、不猜。沒拿到 `expectedFields`（例如直接呼叫出站層）時保留中文表頭原樣——
 * 保留事實，而不是硬套一組可能錯位的英文名。
 */
function parseCsv(body: string, expectedFields: string[] | undefined, datasetId: string): Row[] {
  const text = body.replace(/^\ufeff/, "");
  const rows = splitCsv(text);
  const header = rows.shift();
  if (!header) return [];
  let keys = header;
  if (expectedFields?.length) {
    if (expectedFields.length !== header.length) {
      throw new Error(
        `${datasetId} 的 CSV 欄位數與目錄不符（上游 ${header.length}、目錄 ` +
          `${expectedFields.length}）。上游表頭：${header.join(",")}。` +
          `按位置對應已停用，請重跑 npm run refresh-catalog 確認上游是否改版。`,
      );
    }
    keys = expectedFields;
  }
  const out: Row[] = [];
  for (const cells of rows) {
    if (cells.length !== header.length) {
      throw new Error(
        `${datasetId} 的 CSV 有一列欄位數不符（表頭 ${header.length}、該列 ` +
          `${cells.length}）：${cells.join(",").slice(0, 200)}`,
      );
    }
    const r: Row = {};
    keys.forEach((k, i) => (r[k] = cells[i]));
    out.push(r);
  }
  return out;
}

/**
 * 最小 RFC 4180 切割：處理雙引號包起來的欄位與其中的逗號、跳脫雙引號（""）與 CRLF。
 * 目前上游那份完全沒有引號，但中文品名裡出現逗號只是遲早的事，而那會讓天真的
 * `split(",")` 整列錯位——錯位不會丟錯誤，只會給出對齊錯誤的答案。
 */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      // 尾端換行不該產生一列空資料
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export interface Quote {
  code: string | undefined;
  name: string | undefined;
  last: string | undefined;
  open: string | undefined;
  high: string | undefined;
  low: string | undefined;
  prev_close: string | undefined;
  volume: string | undefined;
  time: string | undefined;
}

/**
 * 盤中即時報價（基本市況報導站，約 5 秒更新）。
 * 這個 host 是證交所營運、同時涵蓋上市與上櫃（market="otc"）。上線後已實測
 * Cloudflare 邊緣可正常連線（見 spec 的 egress 探測紀錄），但它是非官方網頁介面、
 * 無服務條款背書，仍可能改變；失敗時上層會降級成 null + caveat。
 */
export async function fetchQuotes(codes: string[], market = "tse"): Promise<Quote[]> {
  // 一定要 encode：`|` 是分隔語法所以留著不編碼，但代號本身若帶 `#`，
  // 整個 fragment 之後的東西會被丟掉——連同後面釘死的 json=1&delay=0，
  // 上游會回一份格式完全不同的東西。`&`、`?`、空白同理。
  const exCh = codes
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `${market}_${encodeURIComponent(c)}.tw`)
    .join("|");
  const url = `${MIS_BASE}?ex_ch=${exCh}&json=1&delay=0`;
  // 即時報價不快取（cacheTtl 0）。
  const payload = await fetchJson(
    url,
    { Referer: "https://mis.twse.com.tw/stock/index.jsp" },
    0,
  );
  const arr = (payload as { msgArray?: Record<string, string>[] }).msgArray ?? [];
  return arr.map((q) => ({
    code: q.c,
    name: q.n,
    last: q.z,
    open: q.o,
    high: q.h,
    low: q.l,
    prev_close: q.y,
    volume: q.v,
    time: q.t,
  }));
}

/** fetch + JSON，附 Cloudflare 邊緣快取（cacheTtl 秒）。cacheTtl<=0 則不快取。 */
async function fetchJson(
  url: string,
  headers: Record<string, string>,
  cacheTtl: number,
  /** JSON 解析失敗時的退路。只有已知會回非 JSON 的上游才傳，其餘維持原本的錯誤。 */
  fallback?: (body: string) => unknown,
): Promise<unknown> {
  const init: RequestInit = { headers };
  // `cf` 是 Workers 專屬；在 Node 下被忽略，無害。
  if (cacheTtl > 0) {
    (init as RequestInit & { cf?: unknown }).cf = {
      cacheTtl,
      cacheEverything: true,
    };
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // res.ok 擋不住「2xx + HTML」：證交所前面那層 nginx 擋流量或維護時，會用 2xx
  // 送出一張裸錯誤頁（2026-08-03 的 refresh-catalog 排程就是這樣掛的）。
  // 若直接 res.json()，模型收到的是一句生的 "Unexpected token '<'"，
  // 看不出那是上游問題而非它自己參數給錯。
  //
  // 但**不能拿 content-type 當判準**：MIS 即時報價站回的是
  // `text/html;charset=UTF-8`，body 卻是前面墊了一堆換行的合法 JSON。
  // 拿 content-type 當閘門會把這條正常路徑整個擋掉（實際發生過）。
  // 所以先讀文字再 parse，parse 不過才丟出附診斷資訊的錯誤。
  const ctype = res.headers.get("content-type") ?? "(none)";
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    // 順序是 JSON 優先：上游哪天把 CSV 端點改成 JSON，這裡自動跟上，不需要改碼。
    if (fallback) return fallback(body);
    throw new Error(
      `上游回的不是 JSON（content-type: ${ctype}，HTTP ${res.status}）for ${url}。` +
        `開頭：${body.trim().slice(0, 120)}`,
    );
  }
}
