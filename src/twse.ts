/**
 * twse.ts — 對證交所的出站層（薄殼）。
 * ====================================
 * v1 快取策略：靠 Cloudflare Cache API 快取「出站請求」，不自己管 KV。
 * `caches` 是 Worker-only 全域；在 Node/Vitest 下不存在，這裡優雅退化成直接 fetch，
 * 讓 core 以外的東西也能離線測（測試會 mock globalThis.fetch）。
 */
import { DATA_TTL_SECONDS, type Row, type Source } from "./core";

/** 各交易所的 OpenAPI base。dataset 的 source 決定打哪一個。 */
export const BASES: Record<Source, string> = {
  twse: "https://openapi.twse.com.tw/v1",
  tpex: "https://www.tpex.org.tw/openapi/v1",
};

/** 目錄裡 TPEx 的 id 帶 `tpex/` 前綴（來源一眼可辨），出站前要拿掉。 */
const PREFIXES: Record<Source, string> = { twse: "", tpex: "tpex/" };

const MIS_BASE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

/** 由 dataset id + source 組出實際的 endpoint URL。 */
export function datasetUrl(datasetId: string, source: Source): string {
  const prefix = PREFIXES[source];
  const path = prefix && datasetId.startsWith(prefix) ? datasetId.slice(prefix.length) : datasetId;
  return `${BASES[source]}/${path}`;
}

/** 取整份資料集（兩家交易所的 endpoint 都一次回整份）。走邊緣快取。 */
export async function fetchDataset(datasetId: string, source: Source = "twse"): Promise<Row[]> {
  const data = await fetchJson(
    datasetUrl(datasetId, source),
    { Accept: "application/json" },
    DATA_TTL_SECONDS,
  );
  return Array.isArray(data) ? (data as Row[]) : [data as Row];
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
 * 注意：這個 host 較脆，且可能封 Cloudflare 出口 IP —— v1 realtime 為風險閘控項。
 */
export async function fetchQuotes(codes: string[], market = "tse"): Promise<Quote[]> {
  const exCh = codes
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `${market}_${c}.tw`)
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
  return res.json();
}
