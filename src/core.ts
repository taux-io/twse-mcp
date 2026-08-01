/**
 * core.ts — 純資料轉換，與網路/runtime 無關。
 * =================================================
 * 這裡是證交所開放資料所有「髒資料」怪癖的處理中心，也是測試主要打的地方：
 *   - 欄位命名跨表不一致（Code / 基金代號 / ETFsSecurityCode ...）
 *   - 數字都是字串，還帶逗號、'--'、空白
 *   - 每個 endpoint 一次回整份資料，過濾/投影/分頁一定要在這端做完
 *
 * 函式全部是純函式：吃「已經抓好的 rows」，不碰 fetch、不碰 caches。
 */

export type Row = Record<string, unknown>;

export interface Dataset {
  id: string;
  summary: string;
  description: string;
  tags: string[];
  fields: Record<string, string>;
}

export type Catalog = Record<string, Dataset>;

/** 硬上限，保護 client 的 context window。 */
export const MAX_ROWS = 200;
/** 資料一天才更新一次，快取一小時很夠。 */
export const DATA_TTL_SECONDS = 3600;

/** 證交所各表的「代號」欄位名稱不統一，依序嘗試。 */
export const CODE_FIELDS = [
  "Code", "證券代號", "股票代號", "公司代號", "基金代號",
  "SecurCode", "ETFsSecurityCode", "STOCKsSecurityCode", "債券代號",
] as const;

/**
 * 證交所命名不直覺，關鍵字對不上表名。例如 ETF 主檔叫「基金基本資料彙總表」，
 * 搜 "ETF" 是搜不到的。補一層別名。
 */
export const ALIASES: Record<string, readonly string[]> = {
  etf: ["opendata/t187ap47_L", "ETFReport/ETFRank", "exchangeReport/STOCK_DAY_ALL"],
  "淨值": ["opendata/t187ap47_L"],
  "成分股": ["opendata/t187ap47_L"],
  "股價": ["exchangeReport/STOCK_DAY_ALL", "exchangeReport/STOCK_DAY_AVG_ALL"],
  "配息": ["opendata/t187ap45_L"],
};

/** 證交所的數字都是字串，還可能帶逗號、'--'、空白。轉不出來就回 null。 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s || s === "--" || s === "-" || s === "N/A") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** 依 CODE_FIELDS 順序偵測這張表用哪個欄位當代號。 */
export function detectCodeField(row: Row): string | null {
  for (const f of CODE_FIELDS) {
    if (f in row) return f;
  }
  return null;
}

/** 取第一筆 field === code 的列（去頭尾空白比對）。 */
export function firstRow(rows: Row[], field: string, code: string): Row | null {
  const c = code.trim();
  for (const r of rows) {
    if (String(r[field] ?? "").trim() === c) return r;
  }
  return null;
}

export interface SearchResult {
  dataset_id: string;
  summary: string;
  tags: string[];
  note?: string;
}

/** 依關鍵字/分類搜尋目錄。比對 id、說明與欄位名；別名可命中命名對不上的表。 */
export function searchDatasets(
  catalog: Catalog,
  opts: { query?: string; tag?: string; limit?: number } = {},
): { total_matched: number; results: SearchResult[] } {
  const query = opts.query ?? "";
  const tag = opts.tag ?? "";
  const limit = opts.limit ?? 25;
  const q = query.toLowerCase().trim();
  const aliased = new Set(ALIASES[q] ?? []);
  const out: SearchResult[] = [];

  for (const ds of Object.values(catalog)) {
    if (tag && !ds.tags.includes(tag)) continue;
    if (q && !aliased.has(ds.id)) {
      const hay = [ds.id, ds.summary, ds.description, ...Object.keys(ds.fields)]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({
      dataset_id: ds.id,
      summary: ds.summary,
      tags: ds.tags,
      ...(aliased.has(ds.id) ? { note: "別名命中" } : {}),
    });
  }

  return { total_matched: out.length, results: out.slice(0, limit) };
}

/**
 * dataset id 可能帶開頭斜線：正規化後查目錄。找不到回統一的 error 物件。
 * 目錄查找與「找不到」訊息只此一處，避免 core 與 server 兩邊各寫一份而悄悄分歧。
 */
export function resolveDataset(
  catalog: Catalog,
  datasetId: string,
): { ds: Dataset } | { error: string } {
  const id = datasetId.replace(/^\//, "");
  const ds = catalog[id];
  if (!ds) return { error: `找不到 ${id}，請先用 twse_search_datasets 查詢` };
  return { ds };
}

/** 描述單一資料集的欄位定義。找不到回 error 物件。 */
export function describeDataset(catalog: Catalog, datasetId: string): Dataset | { error: string } {
  const r = resolveDataset(catalog, datasetId);
  return "error" in r ? r : r.ds;
}

export interface GetDatasetOpts {
  code?: string;
  match?: Record<string, string> | null;
  fields?: string[] | null;
  limit?: number;
  offset?: number;
}

/**
 * 在「已抓好的 rows」上做 code 過濾 / match 子字串過濾 / 欄位投影 / 分頁。
 * dataset 是否存在、要不要抓資料，由 caller（server 層）先判斷。
 */
export function getDataset(
  ds: Dataset,
  rows: Row[],
  opts: GetDatasetOpts = {},
): Record<string, unknown> {
  const { code = "", match = null, fields = null, limit = 30, offset = 0 } = opts;
  const totalRaw = rows.length;
  let working = rows;

  if (code && working.length) {
    const cf = detectCodeField(working[0]);
    if (cf) {
      const c = code.trim();
      working = working.filter((r) => String(r[cf] ?? "").trim() === c);
    } else {
      return {
        error: `${ds.id} 沒有可辨識的代號欄位，請改用 match`,
        available_fields: Object.keys(working[0]),
      };
    }
  }

  for (const [k, v] of Object.entries(match ?? {})) {
    const needle = v.toLowerCase();
    working = working.filter((r) => String(r[k] ?? "").toLowerCase().includes(needle));
  }

  const matched = working.length;
  const pageSize = Math.min(limit, MAX_ROWS);
  let page: Row[] = working.slice(offset, offset + pageSize);
  if (fields) {
    page = page.map((r) => {
      const proj: Row = {};
      for (const k of fields) if (k in r) proj[k] = r[k];
      return proj;
    });
  }

  return {
    dataset_id: ds.id,
    summary: ds.summary,
    rows_in_source: totalRaw,
    rows_matched: matched,
    returned: page.length,
    offset,
    note: "資料為前一交易日（非盤中即時報價）",
    data: page,
  };
}

/**
 * 上櫃標的取不到資料集，但即時報價這條路是通的。兩處 caveat 都要給這個指引，
 * 而測試會對它的字面文字斷言——只寫一次，改的時候不會有一處漏掉。
 */
const OTC_HINT = '改用 twse_realtime_quote 並帶 market="otc" 取盤中即時報價';

export interface EtfSnapshotSources {
  funds: Row[];
  days: Row[];
  ranks: Row[];
  /** null = 未查詢即時報價；[] = 查了但沒資料。 */
  realtime?: Row[] | null;
  includeRealtime: boolean;
  /** 三張表哪幾張抓失敗（來源標籤 -> 錯誤型別名），用來補 caveat。 */
  errors?: { source: string; error: string }[];
}

/**
 * 合併三張證交所的表成單一 ETF 概況。任何一段缺就標 null + 記 caveat，不整包失敗。
 * 對應 Python 版 etf_snapshot 的合併邏輯。
 */
export function buildEtfSnapshot(code: string, src: EtfSnapshotSources): Record<string, unknown> {
  code = code.trim();
  const caveats: string[] = [];
  for (const e of src.errors ?? []) {
    caveats.push(`${e.source}取得失敗：${e.error}`);
  }

  // --- 1. 基本資料 ---
  const f = firstRow(src.funds, "基金代號", code);
  let profile: Record<string, unknown> | null = null;
  if (f) {
    profile = {
      "基金簡稱": f["基金簡稱"],
      "基金中文名稱": f["基金中文名稱"],
      "基金類型": f["基金類型"],
      "追蹤指數": f["標的指數/追蹤指數名稱"],
      "客製化指數": f["標的指數是否為客製化或需揭露相關資訊之指數"],
      "含國外成分股": f["是否包含國外成分股"],
      "成立日期": f["成立日期"],
      "上市日期": f["上市日期"],
      "基金經理人": f["基金經理人"],
      "發行單位數": f["發行單位數/轉換數"],
      "保管機構": f["保管機構"],
      "資料日期": f["出表日期"],
    };
  } else {
    caveats.push(
      `${code} 不在證交所基金基本資料彙總表中 —— 該表只收上市基金。` +
        `若這是上櫃標的，本服務仍可取得它的盤中即時報價：${OTC_HINT}` +
        "（上櫃的歷史與統計資料則無法取得）。也可能單純是代號有誤，或該標的不是基金。",
    );
  }

  // 證交所對 ETF 的「基金類型」實際寫法是「…指數股票型基金」，字面不含 "ETF"
  // （例如 0056 是「國內成分證券指數股票型基金」）。所以認「指數股票型」這個真實
  // 標記，"ETF" 字樣只是保險。含國外成分、期貨型、槓桿反向 ETF 也都帶「指數股票型」。
  const fundType = f ? String(f["基金類型"] ?? "") : "";
  const isEtf = !!(f && (fundType.includes("指數股票型") || fundType.toUpperCase().includes("ETF")));
  if (f && !isEtf) {
    caveats.push(`${code} 的基金類型是「${f["基金類型"]}」，不是 ETF`);
  }

  // --- 2. 當日（前一交易日）價量 ---
  const d = firstRow(src.days, "Code", code);
  let quote: Record<string, unknown> | null = null;
  if (d) {
    const close = num(d["ClosingPrice"]);
    const change = num(d["Change"]);
    quote = {
      "日期": d["Date"],
      "開盤": num(d["OpeningPrice"]),
      "最高": num(d["HighestPrice"]),
      "最低": num(d["LowestPrice"]),
      "收盤": close,
      "漲跌": change,
      "成交股數": num(d["TradeVolume"]),
      "成交金額": num(d["TradeValue"]),
      "成交筆數": num(d["Transaction"]),
    };
    let prev: number | null = null;
    if (close !== null && change !== null) prev = close - change;
    if (prev) quote["漲跌幅%"] = Math.round((change! / prev) * 100 * 100) / 100;
  } else {
    caveats.push(
      `${code} 不在上市日成交資訊中（可能是上櫃標的，或當日無成交）。上櫃標的請${OTC_HINT}。`,
    );
  }

  // --- 3. 定期定額熱度 ---
  const rk = firstRow(src.ranks, "ETFsSecurityCode", code);
  let savings: Record<string, unknown> | null = null;
  if (rk) {
    savings = {
      "排名": rk["No"],
      "交易戶數": num(rk["ETFsNumberofTradingAccounts"]),
      "說明": "證交所定期定額交易戶數統計排行月報表",
    };
  } else {
    caveats.push(`${code} 不在定期定額排行榜上（該表只收錄前段班，不代表沒有人定期定額）`);
  }

  // --- 4. 衍生指標 ---
  const derived: Record<string, unknown> = {};
  const units = profile ? num(profile["發行單位數"]) : null;
  const close = quote ? (quote["收盤"] as number | null) : null;
  if (units && close) {
    derived["市值粗估_億元"] = Math.round((units * close) / 1e8 * 100) / 100;
    caveats.push(
      "市值粗估 = 發行單位數 × 收盤價。這不是基金規模：" +
        "規模應以淨值計算，而證交所 OpenAPI 不提供淨值，需向各投信取得",
    );
  }

  return {
    code,
    name: (profile?.["基金簡稱"] ?? d?.["Name"]) ?? null,
    is_etf: isEtf,
    profile,
    quote,
    realtime: src.includeRealtime ? (src.realtime && src.realtime.length ? src.realtime : null) : "未查詢",
    regular_savings: savings,
    derived: Object.keys(derived).length ? derived : null,
    caveats,
  };
}
