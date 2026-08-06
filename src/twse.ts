/**
 * twse.ts — 對證交所的出站層（薄殼）。
 * ====================================
 * v1 快取策略：把 cacheTtl / cacheEverything 掛在 fetch 的 `cf` 上（見 fetchJson），
 * 由邊緣快取出站請求，不自己管 KV，也沒有用到 `caches` 全域。
 * `cf` 是 Workers 專屬欄位，在 Node/Vitest 下會被忽略，所以離線測不需要任何分支
 * （測試 mock globalThis.fetch）。
 */
import { DATA_TTL_SECONDS, type Row } from "./core";

export const BASE = "https://openapi.twse.com.tw/v1";

// twse_etf_snapshot 用到的三個資料集
export const DS_FUND = "opendata/t187ap47_L"; // 基金基本資料彙總表
export const DS_DAY = "exchangeReport/STOCK_DAY_ALL"; // 上市個股日成交資訊
export const DS_RANK = "ETFReport/ETFRank"; // 定期定額交易戶數統計排行月報表

const MIS_BASE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

/** 取整份資料集（證交所每個資料集都是一次回整份）。走邊緣快取。 */
export async function fetchDataset(datasetId: string): Promise<Row[]> {
  const url = `${BASE}/${datasetId}`;
  const data = await fetchJson(url, { Accept: "application/json" }, DATA_TTL_SECONDS);
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
  const ctype = res.headers.get("content-type") ?? "(none)";
  if (!ctype.includes("json")) {
    const body = await res.text();
    throw new Error(
      `上游回的不是 JSON（content-type: ${ctype}，HTTP ${res.status}）for ${url}。` +
        `開頭：${body.slice(0, 120)}`,
    );
  }
  return res.json();
}
