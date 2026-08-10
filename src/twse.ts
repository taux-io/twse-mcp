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
 * 期交所**唯一**會回 CSV 的端點，以及它的表頭契約。
 *
 * 為什麼要指名而不是對整個 `taifex/` 前綴開退路：退路一旦全開，就等於刪掉
 * 「上游回非 JSON 要大聲失敗」這道守衛（見 fetchJson 的說明，#29／#31 加的）。
 * 上游維護時回一個空的 200，CSV parser 會安靜地回 0 筆，而 `cf.cacheTtl` 把那個
 * 假的「查無資料」釘在邊緣一小時——每個使用者都會收到「期交所沒有這筆資料」，
 * 而真相是上游掛了。131 個端點不該為了 1 個端點放棄那道守衛。
 *
 * 為什麼連表頭**內容**一起釘死：只比對欄位數量的守衛不是守衛。上游把 18 欄的順序
 * 調換，數量仍是 18，於是每一列的最高價變成最低價——正是這裡要防的「安靜給錯答案」。
 * 只比數量的版本被 code review 抓出來過。
 *
 * 為什麼不從目錄推導英文欄位：稽核證明那條路會被解除武裝。上游若把 200 回應的
 * schema 從裸 `$ref` 改成慣例的 `{type:"array", items:{$ref}}`，`buildTaifex` 會
 * 取到空字串，132 筆全部變成零欄位，於是 `expectedFields` 是空的、守衛自動關閉。
 * 釘死在這裡，再由 test/catalog.test.ts 斷言它與目錄一致——常數重複但有測試綁著，
 * 是這個 repo 既有的作法。
 *
 * 這個端點**會變格式**：同一天實測到 877,988 bytes 的 CSV 與 4,188,322 bytes 的
 * JSON。所以 JSON 優先不是為了將來，是現在就會交替發生。
 */
export const TAIFEX_CSV_DATASETS: Record<
  string,
  { header: readonly string[]; fields: readonly string[] }
> = {
  "taifex/DailyMarketReportOpt": {
    header: [
      "日期", "契約", "到期月份(週別)", "履約價", "買賣權", "開盤價", "最高價", "最低價",
      "最後成交價", "成交量", "結算價", "未沖銷契約量", "最後最佳買價", "最後最佳賣價",
      "歷史最高價", "歷史最低價", "是否因訊息面暫停交易", "交易時段",
    ],
    fields: [
      "Date", "Contract", "ContractMonth(Week)", "StrikePrice", "CallPut", "Open", "High", "Low",
      "Close", "Volume", "SettlementPrice", "OpenInterest", "BestBid", "BestAsk",
      "HistoricalHigh", "HistoricalLow", "TradingHalt", "TradingSession",
    ],
  },
};

/** 錯誤訊息裡引用上游文字的長度上限。 */
const UPSTREAM_ECHO_LIMIT = 200;

/**
 * 上游回應的大小上限。
 *
 * 排除清單（TAIFEX_EXCLUDE）是拿「名字黑名單」去防一個「大小」問題——只要任何一個
 * 已收錄端點在上游長大，同樣的 OOM 就會發生，完全不需要路徑技巧。那是稽核留下的
 * hardening note，這裡才是根因的守衛。
 *
 * 48 MB 的依據：目錄裡最大的資料集實測 36.1 MB（`opendata/t187ap37_L`，在真的
 * 128 MB production isolate 上回 200、耗時 2.15 秒），留約三成成長空間；而被排除的
 * 逐筆成交端點是 255.8 MB，遠在界線之外。上限落在「已知會動的」與「已知會爆的」之間。
 */
const MAX_BODY_BYTES = 48 * 1024 * 1024;

/**
 * 讀取回應本文，超過上限就中止。
 *
 * **只看 content-length 不夠。** 分塊傳輸沒有那個標頭，而它本身也可以說謊。所以
 * 宣告值先擋一次（省下整趟傳輸），然後邊讀邊數——第二道才是真正的守衛。
 *
 * 中止的方式是 `reader.cancel()`：讓上游連線立刻收掉，而不是讀完再丟棄。
 */
async function readCapped(res: Response, label: string): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error(tooLarge(label, declared));
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error(tooLarge(label, seen, true));
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return out + decoder.decode();
}

function tooLarge(label: string, bytes: number, partial = false): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return (
    `${label} 的回應過大（${partial ? "已讀取超過 " : ""}${mb(bytes)}（${bytes} bytes），` +
    `上限 ${mb(MAX_BODY_BYTES)}）。整份資料會被讀進記憶體，超過上限會把 Worker 打爛` +
    `而不是給出答案。若這個資料集確實長大了，請調整 MAX_BODY_BYTES 並重新評估記憶體。`
  );
}

/** 取整份資料集（兩邊的每個資料集都是一次回整份）。走邊緣快取。 */
export async function fetchDataset(datasetId: string): Promise<Row[]> {
  const csv = TAIFEX_CSV_DATASETS[datasetId];
  const data = await fetchJson(
    datasetUrl(datasetId),
    { Accept: "application/json" },
    DATA_TTL_SECONDS,
    // CSV 退路只給指名的那一個資料集。其餘一律維持「非 JSON = 上游出事」。
    csv ? (body) => parseCsv(body, csv, datasetId) : undefined,
    datasetId,
  );
  return Array.isArray(data) ? (data as Row[]) : [data as Row];
}

/**
 * 把期交所那一個 CSV 端點解析成物件陣列，key 換成 swagger 宣告的英文欄位。
 *
 * 為什麼要換：目錄的 `fields` 來自 swagger，是英文；CSV 表頭是中文。若直接用中文
 * 當 key，`twse_describe_dataset` 說有 `Contract` 而 `twse_get_dataset` 回的是
 * `契約`，`code=`／`match=`／`fields=` 全部落空。那不是壞掉，是安靜地給錯答案。
 *
 * 表頭必須與 TAIFEX_CSV_DATASETS 記錄的完全相同（順序也算）——對不上就丟錯，
 * 不做部分對應。壞掉且說得出原因，好過活著卻在說謊。
 */
function parseCsv(
  body: string,
  spec: { header: readonly string[]; fields: readonly string[] },
  datasetId: string,
): Row[] {
  const rows = splitCsv(body);
  const header = rows.shift();
  // 沒有表頭代表這根本不是那份 CSV（空 body、HTML 錯誤頁）。交回給 fetchJson 的
  // 診斷訊息處理，那裡會帶上 content-type、狀態碼與 body 開頭。
  if (!header) return NOT_CSV;
  // 先判斷「這是不是那份 CSV」，再判斷「它有沒有變」。兩者的正確訊息不同：
  // 前者（空 body、HTML 錯誤頁）該講上游狀態碼與 content-type，後者該講表頭差異。
  // 用「認得的欄名過半」當判準——順序被調換仍算是那份 CSV，所以會走到下面的
  // 大聲失敗；而 HTML 一個欄名都對不上，落回 fetchJson 的上游診斷。
  const known = new Set(spec.header);
  const recognised = header.filter((h) => known.has(h.trim())).length;
  if (recognised * 2 < spec.header.length) return NOT_CSV;
  if (
    header.length !== spec.header.length ||
    header.some((h, i) => h.trim() !== spec.header[i])
  ) {
    throw new Error(
      `${datasetId} 的 CSV 表頭與預期不符（預期 ${spec.header.length} 欄、` +
        `上游 ${header.length} 欄）。上游表頭：` +
        `${header.join(",").slice(0, UPSTREAM_ECHO_LIMIT)}。` +
        `按位置對應已停用，請確認上游是否改版。`,
    );
  }
  const out: Row[] = [];
  for (const cells of rows) {
    if (cells.length !== header.length) {
      throw new Error(
        `${datasetId} 的 CSV 有一列欄位數不符（表頭 ${header.length}、該列 ` +
          `${cells.length}）：${cells.join(",").slice(0, UPSTREAM_ECHO_LIMIT)}`,
      );
    }
    const r: Row = {};
    spec.fields.forEach((k, i) => (r[k] = cells[i]));
    out.push(r);
  }
  return out;
}

/** parseCsv 用來說「這不是 CSV」的哨兵值。用身分比對，不用內容。 */
const NOT_CSV: Row[] = [];

/**
 * 最小 RFC 4180 切割：引號**只有在欄位開頭**才有特殊意義。
 *
 * 那個限定是重點。原本的版本在任何位置遇到 `"` 都進入引號模式，於是一個 `12"`
 * 這種值會把後面所有逗號與換行吞進同一格，整份檔案從那裡起錯位——而錯位不會
 * 丟錯誤，只會給出對齊錯誤的答案（或讓整天的資料因為列長度不符而全部失敗）。
 */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;
  const endCell = () => { row.push(cell); cell = ""; atCellStart = true; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && atCellStart) { quoted = true; atCellStart = false; }
    else if (ch === ",") endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endCell();
      // 尾端換行不該產生一列空資料
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else { cell += ch; atCellStart = false; }
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
  /** 錯誤訊息裡用來指認來源的標籤。給了 dataset id 就比裸 URL 好讀。 */
  label = url,
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
  const body = await readCapped(res, label);
  try {
    return JSON.parse(body);
  } catch {
    // 順序是 JSON 優先：上游哪天把 CSV 端點改成 JSON，這裡自動跟上，不需要改碼。
    // 退路說「這也不是我認得的格式」時（空 body、HTML 錯誤頁）就落回原本的診斷，
    // 而不是把空結果當成「查無資料」——後者會被邊緣快取釘住一小時。
    if (fallback) {
      const parsed = fallback(body);
      if (parsed !== NOT_CSV) return parsed;
    }
    throw new Error(
      `上游回的不是 JSON（content-type: ${ctype}，HTTP ${res.status}）for ${url}。` +
        `開頭：${body.trim().slice(0, 120)}`,
    );
  }
}
