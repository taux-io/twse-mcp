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
import catalogJson from "./catalog.generated.json";
import { headerMatches } from "./csv-header.mjs";
import {
  DATA_TTL_SECONDS,
  firstRow,
  rocToIso,
  type FinancialsInput,
  type Row,
  type SourceError,
} from "./core";

export const BASE = "https://openapi.twse.com.tw/v1";
/** 期交所的 servers.url。裸 path（沒有 /v1）會被 302 導回 Swagger UI 首頁。 */
const TAIFEX_BASE = "https://openapi.taifex.com.tw/v1";
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

// twse_stock_snapshot 另外用到的資料集（日成交資訊與 ETF 快照共用 DS_DAY）
export const DS_COMPANY = "opendata/t187ap03_L"; // 上市公司基本資料
export const DS_VALUATION = "exchangeReport/BWIBBU_ALL"; // 上市個股日本益比、殖利率及股價淨值比
export const DS_REVENUE = "opendata/t187ap05_L"; // 上市公司每月營業收入彙總表
export const DS_EX_RIGHTS = "exchangeReport/TWT48U_ALL"; // 上市股票除權除息預告表
export const DS_NOTICE = "announcement/notice"; // 集中市場當日公布注意股票
export const DS_PUNISH = "announcement/punish"; // 集中市場公布處置股票

// twse_stock_snapshot 的 include_financials：六種業別各一張損益表與資產負債表。
// 一般業（ci）涵蓋絕大多數公司，所以先查它；查不到才查其餘五種（都很小）。
export const FIN_TYPE_KEYS = ["ci", "basi", "bd", "fh", "ins", "mim"] as const;
export const dsIncome = (t: string) => `opendata/t187ap06_L_${t}`;
export const dsBalance = (t: string) => `opendata/t187ap07_L_${t}`;

// twse_stock_snapshot 的 include_governance
export const DS_CHAIRMAN = "opendata/t187ap33_L"; // 董事長是否兼任總經理
export const DS_PLEDGE = "opendata/t187ap09_L"; // 董監質權設定占持股比例
export const DS_PENALTIES = "opendata/t187ap22_L"; // 金管會證期局裁罰案件
export const DS_SHORTFALL = "opendata/t187ap08_L"; // 董監持股不足法定成數
export const DS_SHORTFALL_MONTHS = "opendata/t187ap10_L"; // 董監持股連續不足 3 個月以上

// twse_market_overview
export const DS_INDICES = "exchangeReport/MI_INDEX"; // 每日收盤行情-大盤統計資訊
export const DS_TURNOVER = "exchangeReport/FMTQIK"; // 集中市場每日市場成交資訊
export const DS_BREADTH = "opendata/twtazu_od"; // 集中市場漲跌證券數統計表
export const DS_TOP20 = "exchangeReport/MI_INDEX20"; // 成交量前二十名
export const DS_INST_TOTAL = "taifex/MarketDataOfMajorInstitutionalTradersGeneralBytheDate";
export const DS_INST_CONTRACTS = "taifex/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate";
export const DS_PCR = "taifex/PutCallRatio";
export const DS_LARGE_TRADERS = "taifex/OpenInterestOfLargeTradersFutures";

/**
 * 快照類工具寫死依賴的全部資料集。scripts/check-catalog.mjs 的 REQUIRED 必須與它
 * 一致（test/catalog.test.ts 斷言），目錄刷新時少了任何一個都會在建置期被擋下。
 */
export const SNAPSHOT_DATASETS = [
  DS_FUND, DS_DAY, DS_RANK,
  DS_COMPANY, DS_VALUATION, DS_REVENUE, DS_EX_RIGHTS, DS_NOTICE, DS_PUNISH,
  ...FIN_TYPE_KEYS.map(dsIncome), ...FIN_TYPE_KEYS.map(dsBalance),
  DS_CHAIRMAN, DS_PLEDGE, DS_PENALTIES, DS_SHORTFALL, DS_SHORTFALL_MONTHS,
  DS_INDICES, DS_TURNOVER, DS_BREADTH, DS_TOP20,
  DS_INST_TOTAL, DS_INST_CONTRACTS, DS_PCR, DS_LARGE_TRADERS,
];

/**
 * 必定有資料的資料集。回 0 筆一律當成上游故障，不當成「查無資料」。
 *
 * 為什麼需要這道：`fetchJson` 只在 body **無法** JSON.parse 時大聲失敗（擋 2xx+HTML）。
 * 一個格式正確的空陣列 `[]` 通過所有檢查，於是 twse_etf_snapshot 對 0050 回
 * `is_etf: false`——對台灣最大的 ETF 之一做出肯定的錯誤陳述，而 cf.cacheTtl 把它釘在
 * 邊緣一小時。這與 2xx+HTML 是同一類問題，只差在 body 是合法 JSON。
 *
 * 為什麼**只**涵蓋這三個、不對整個目錄套用：目錄裡有可能合法回 0 筆的資料集
 * （當日無事件的公告類）。這些是快照類工具依賴的、寫死的常數，每一個都是涵蓋
 * 全體上市標的的主檔——執行期補上與建置期 refresh-catalog `min:100` 對應的守衛。
 */
export const ALWAYS_POPULATED: ReadonlySet<string> = new Set([
  DS_FUND, DS_DAY, DS_RANK,
  // 個股快照與代號查詢的三個主檔：上千家上市公司，任何一天都不可能是 0 筆。
  // 除權除息預告、注意股、處置股**不在此列**——它們合法地會是空的（當天沒有事件）。
  DS_COMPANY, DS_VALUATION, DS_REVENUE,
  // 一般業財報涵蓋上千家公司；董事長兼任表每家一列；收盤指數表兩百多列。都不可能合法地是 0 筆。
  // 其餘新依賴（質押、裁罰、持股不足、當月成交資訊、期交所各表）都可能合法地為空，不列入。
  dsIncome("ci"), dsBalance("ci"), DS_CHAIRMAN, DS_INDICES,
]);

const MIS_BASE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

/**
 * 期交所 CSV 退路的表頭契約：直接取目錄宣告的欄位（英文 key）與欄位說明（中文，對應 CSV 表頭）。
 *
 * 為什麼退路對整個 `taifex/` 前綴開，而不是只對指名的幾個：期交所會讓端點在 JSON 與 CSV
 * 之間來回切換，2026-09-26 一天內就觀察到五個。指名清單追不上，清單外的端點一切成 CSV，
 * 工具就壞到有人補清單為止。
 *
 * 為什麼這樣不會解除「上游回非 JSON 要大聲失敗」的守衛（#29／#31）：
 *   - 退路只在表頭通過 `headerMatches`（src/csv-header.mjs）時才成立。空 body、HTML 錯誤頁、
 *     欄位被調換的 CSV 都過不了，照樣大聲失敗；上游維護時回的空 200 不會變成「查無資料」。
 *   - 目錄若被上游 schema 變動清空（稽核指出過這條路），欄位數是 0，`headerMatches`
 *     一律不成立——目錄壞掉不會連帶把守衛拆掉。
 *
 * 證交所那邊沒有這個退路：證交所沒有回過 CSV，非 JSON 一律視為上游故障。
 */
function csvSpecFor(datasetId: string): { fields: string[]; descriptions: string[] } | null {
  if (!datasetId.startsWith(TAIFEX_PREFIX)) return null;
  const ds = (catalogJson as Record<string, { fields?: Record<string, string> }>)[datasetId];
  if (!ds?.fields) return null;
  return { fields: Object.keys(ds.fields), descriptions: Object.values(ds.fields) };
}

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

/**
 * 出站資料集抓取的並行上限。
 *
 * 這是真正釘住記憶體的那道守衛。`MAX_BODY_BYTES` 是**每次** fetch 的上限，擋不住
 * 「同時有 N 次 fetch」——一個 JSON-RPC 批次會被 SDK 同時分派，275 個元素就是 275 份
 * 並行的 body，而 isolate 只有 128 MB。有了這個閘門，最壞情況固定是
 * MAX_CONCURRENT_FETCHES × MAX_BODY_BYTES，與請求形狀無關。批次大小另在 server.ts
 * 進 SDK 前先擋一道，兩者合起來把扇出釘死。
 *
 * 值取 3：twse_etf_snapshot 本來就會同時抓三個資料集（DS_FUND/DS_DAY/DS_RANK），
 * 那是既有的正常行為，semaphore 不該把它拖慢，所以上限剛好容得下它。
 *
 * twse_stock_snapshot 要抓七個，**刻意不為它調高**：這個值乘上 MAX_BODY_BYTES 就是
 * isolate 的最壞記憶體，7 × 48 MB 已超過 128 MB。代價是邊緣快取未命中時分三輪
 * （3+3+1）抓完，期間同一個 isolate 的其他呼叫要排隊。這七個資料集最大約 1.3 MB，
 * 每輪都短，而且邊緣快取命中時幾乎不花時間——延遲是有意識的取捨，記憶體上限不是。
 */
const MAX_CONCURRENT_FETCHES = 3;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** 取整份資料集（兩邊的每個資料集都是一次回整份）。走邊緣快取。 */
export async function fetchDataset(datasetId: string): Promise<Row[]> {
  const csv = csvSpecFor(datasetId);
  const data = await withFetchSlot(() =>
    fetchJson(
      datasetUrl(datasetId),
      { Accept: "application/json" },
      DATA_TTL_SECONDS,
      // CSV 退路只給期交所、且只在表頭對得上目錄時成立（見 csvSpecFor）。
      csv ? (body) => parseCsv(body, csv, datasetId) : undefined,
      datasetId,
    ),
  );
  const rows = Array.isArray(data) ? (data as Row[]) : [data as Row];
  // 必定有資料的資料集回 0 筆 = 上游故障。拋錯讓上層的 errors/failed 機制接手
  // （twse_etf_snapshot 走第三態、twse_get_dataset 回錯誤），而不是把假的空結果
  // 當成「查無」回傳並被邊緣快取釘住。訊息比照既有上游診斷：帶代號與 0 筆說明。
  if (rows.length === 0 && ALWAYS_POPULATED.has(datasetId)) {
    throw new Error(
      `${datasetId} 上游回 0 筆（HTTP 200 但空陣列）。這個資料集必定有資料，` +
        `0 筆代表上游異常而非查無——不當成有效結果，以免把假的空結果釘進邊緣快取。`,
    );
  }
  return rows;
}

/**
 * 錯誤轉成給人讀的一行字。保留 message：只記 name 的話，線上問題會退化成一句沒有
 * 資訊的 "TypeError"，查不出是逾時、被重導、還是被對方擋掉。
 */
export function errorText(reason: unknown): string {
  const e = reason as Error | undefined;
  return [e?.name ?? "Error", e?.message].filter(Boolean).join(": ");
}

/**
 * 同時抓多個資料集，任何一個失敗都不拖垮其他。
 *
 * 快照類工具共用這一段：每一段的成敗要各自回報（`errors` 以來源標籤指認），
 * core 才能分辨「上游掛了」與「查無此標的」——那是這個 repo 修過三次的同一類錯誤，
 * 抓取的形狀只寫一次，新工具就不會各自重新發明一個少了守衛的版本。
 * 失敗的那段給空陣列，是否據此做否定陳述由 core 看 `errors` 決定。
 */
export async function fetchSources<K extends string>(
  sources: Record<K, { dataset: string; label: string }>,
): Promise<{ rows: Record<K, Row[]>; errors: SourceError[] }> {
  const keys = Object.keys(sources) as K[];
  const settled = await Promise.allSettled(keys.map((k) => fetchDataset(sources[k].dataset)));
  const rows = {} as Record<K, Row[]>;
  const errors: SourceError[] = [];
  settled.forEach((r, i) => {
    const k = keys[i];
    if (r.status === "fulfilled") {
      rows[k] = r.value;
    } else {
      rows[k] = [];
      errors.push({ source: sources[k].label, error: errorText(r.reason) });
    }
  });
  return { rows, errors };
}

/**
 * 找一家公司的損益表與資產負債表列。
 *
 * 六種業別各一對表，而一家公司只會出現在其中一種。一般業（ci）涵蓋絕大多數公司，
 * 先只查它；查不到才查其餘五種（每張都只有十幾列）。第一階段抓失敗就停在那裡：
 * 那時無從判斷公司在不在一般業，再去翻其他業別找不到，也不能說「沒有財報」。
 */
export async function fetchFinancials(
  code: string,
  label: string,
): Promise<{ input: FinancialsInput; errors: SourceError[] }> {
  const find = (rows: Row[], type: string) => {
    const row = firstRow(rows, "公司代號", code);
    return row ? { type, row } : null;
  };
  const first = await fetchSources({
    income: { dataset: dsIncome("ci"), label },
    balance: { dataset: dsBalance("ci"), label },
  });
  const input: FinancialsInput = {
    income: find(first.rows.income, "ci"),
    balance: find(first.rows.balance, "ci"),
  };
  if (input.income || input.balance || first.errors.length) return { input, errors: first.errors };

  const others = FIN_TYPE_KEYS.filter((t) => t !== "ci");
  const rest = await fetchSources(
    Object.fromEntries(
      others.flatMap((t) => [
        [`income_${t}`, { dataset: dsIncome(t), label }],
        [`balance_${t}`, { dataset: dsBalance(t), label }],
      ]),
    ) as Record<string, { dataset: string; label: string }>,
  );
  for (const t of others) {
    input.income ??= find(rest.rows[`income_${t}`], t);
    input.balance ??= find(rest.rows[`balance_${t}`], t);
  }
  // 十張小表同一個標籤，失敗時只回報第一筆，免得 caveats 裡同一句話重複十次。
  return { input, errors: rest.errors.slice(0, 1) };
}

/**
 * 把期交所的 CSV 解析成物件陣列，key 換成目錄宣告的英文欄位。
 *
 * 為什麼要換：目錄的 `fields` 來自 swagger，是英文；CSV 表頭是中文。若直接用中文
 * 當 key，`twse_describe_dataset` 說有 `Contract` 而 `twse_get_dataset` 回的是
 * `契約`，`code=`／`match=`／`fields=` 全部落空。那不是壞掉，是安靜地給錯答案。
 *
 * 表頭必須通過 `headerMatches`——對不上就丟錯，不做部分對應。壞掉且說得出原因，
 * 好過活著卻在說謊。
 */
function parseCsv(
  body: string,
  spec: { fields: string[]; descriptions: string[] },
  datasetId: string,
): Row[] {
  const rows = splitCsv(body);
  const header = rows.shift();
  // 沒有表頭代表這根本不是 CSV（空 body、HTML 錯誤頁）。交回給 fetchJson 的
  // 診斷訊息處理，那裡會帶上 content-type、狀態碼與 body 開頭。
  if (!header) return NOT_CSV;
  // 先判斷「這是不是那份 CSV」，再判斷「它有沒有變」。兩者的正確訊息不同：
  // 前者（空 body、HTML 錯誤頁）該講上游狀態碼與 content-type，後者該講表頭差異。
  // 認得的欄名過半才算是那份 CSV——順序被調換仍算，所以會走到下面的大聲失敗；
  // HTML 一個欄名都對不上，落回 fetchJson 的上游診斷。
  const recognised = header.filter((h) => {
    const t = h.trim();
    return t && spec.descriptions.some((d) => d && (t === d || t.includes(d) || d.includes(t)));
  }).length;
  if (recognised * 2 < spec.descriptions.length) return NOT_CSV;
  if (!headerMatches(header, spec.descriptions)) {
    throw new Error(
      `${datasetId} 的 CSV 表頭與目錄不符（目錄 ${spec.descriptions.length} 欄、` +
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
  /** 最佳一檔委買價／委賣價。盤中 last 常是「-」（那 5 秒沒有成交），這時它們才是「現在大概多少」。 */
  bid: string | null;
  ask: string | null;
  /** 當日漲停價／跌停價。 */
  limit_up: string | undefined;
  limit_down: string | undefined;
  /** 報價所屬的交易日（ISO）。沒有它，非交易時段查到的「最後一筆」會被模型當成今天。 */
  date: string | null;
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
    bid: bestLevel(q.b),
    ask: bestLevel(q.a),
    limit_up: q.u,
    limit_down: q.w,
    date: rocToIso(q.d),
    time: q.t,
  }));
}

/**
 * 五檔報價字串取第一檔：上游寫成 `"112.3500_112.3000_…_"`。沒有委託時是空字串或「-」，回 null。
 */
function bestLevel(v: string | undefined): string | null {
  const first = (v ?? "").split("_")[0].trim();
  return first && first !== "-" ? first : null;
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
