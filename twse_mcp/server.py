#!/usr/bin/env python3
"""
TWSE OpenAPI MCP Server
=======================
把臺灣證券交易所 OpenAPI (https://openapi.twse.com.tw/v1) 包成 MCP server。

設計重點：
  1. 不要一個 endpoint 一個 tool。證交所有 100+ 個 endpoint，全部展開會塞爆
     context window，模型反而選不出正確的工具。改成把 swagger 當「資料」，
     只暴露 4 個泛用工具，讓模型先查目錄再取資料。
  2. 證交所所有 endpoint 都「不吃參數」，一次回整份資料集
     （STOCK_DAY_ALL 就是 1000+ 檔股票）。所以過濾、投影、分頁一定要在
     server 端做完，不能把原始 JSON 直接丟回模型。
  3. 欄位命名不一致（Code / 公司代號 / 基金代號 / ETFsSecurityCode ...），
     所以 code 過濾要自動偵測代號欄位。
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

BASE = "https://openapi.twse.com.tw/v1"
SWAGGER_URL = f"{BASE}/swagger.json"
CACHE_DIR = Path(os.environ.get("TWSE_MCP_CACHE", Path.home() / ".cache" / "twse-mcp"))
DATA_TTL = int(os.environ.get("TWSE_MCP_TTL", 3600))   # 資料一天才更新一次，快取一小時很夠
SWAGGER_TTL = 86400 * 7
MAX_ROWS = 200                                          # 硬上限，保護 context window

mcp = FastMCP("twse-opendata")

_catalog: dict[str, dict[str, Any]] = {}
_catalog_lock = asyncio.Lock()
_mem_cache: dict[str, tuple[float, Any]] = {}
_fetch_locks: dict[str, asyncio.Lock] = {}
_http_sem = asyncio.Semaphore(2)                        # 對證交所客氣一點

# etf_snapshot 用到的三張表
DS_FUND = "opendata/t187ap47_L"        # 基金基本資料彙總表
DS_DAY = "exchangeReport/STOCK_DAY_ALL"  # 上市個股日成交資訊
DS_RANK = "ETFReport/ETFRank"          # 定期定額交易戶數統計排行月報表

# 證交所各表的「代號」欄位名稱不統一，依序嘗試
CODE_FIELDS = (
    "Code", "證券代號", "股票代號", "公司代號", "基金代號",
    "SecurCode", "ETFsSecurityCode", "STOCKsSecurityCode", "債券代號",
)

# 證交所命名不直覺，關鍵字對不上表名。例如 ETF 主檔叫「基金基本資料彙總表」，
# 搜 "ETF" 是搜不到的。補一層別名。
ALIASES: dict[str, tuple[str, ...]] = {
    "etf": ("opendata/t187ap47_L", "ETFReport/ETFRank", "exchangeReport/STOCK_DAY_ALL"),
    "淨值": ("opendata/t187ap47_L",),
    "成分股": ("opendata/t187ap47_L",),
    "股價": ("exchangeReport/STOCK_DAY_ALL", "exchangeReport/STOCK_DAY_AVG_ALL"),
    "配息": ("opendata/t187ap45_L",),
}


# --------------------------------------------------------------------------
# 目錄：把 swagger.json 解析成資料集清單
# --------------------------------------------------------------------------
def _cache_path(name: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / name


async def _fetch_json(url: str) -> Any:
    async with _http_sem:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
            r = await c.get(url, headers={"Accept": "application/json"})
            r.raise_for_status()
            return r.json()


async def _load_catalog() -> dict[str, dict[str, Any]]:
    """延遲載入 swagger 並建目錄。不要在 import 時做，會撞到 client 的啟動 timeout。"""
    async with _catalog_lock:
        if _catalog:
            return _catalog

        spec = None
        cached = _cache_path("swagger.json")
        if cached.exists() and time.time() - cached.stat().st_mtime < SWAGGER_TTL:
            spec = json.loads(cached.read_text(encoding="utf-8"))
        if spec is None:
            try:
                spec = await _fetch_json(SWAGGER_URL)
                cached.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
            except Exception:
                if cached.exists():          # 證交所掛掉時退回舊快取
                    spec = json.loads(cached.read_text(encoding="utf-8"))
                else:
                    raise

        for path, item in spec.get("paths", {}).items():
            op = item.get("get")
            if not op:
                continue
            props = (
                op.get("responses", {}).get("200", {}).get("schema", {}).get("properties")
                or {}
            )
            _catalog[path.lstrip("/")] = {
                "id": path.lstrip("/"),
                "summary": op.get("summary", ""),
                "description": op.get("description", ""),
                "tags": op.get("tags", []),
                "fields": {k: (v or {}).get("description", "") for k, v in props.items()},
            }
        return _catalog


async def _get_rows(dataset_id: str) -> list[dict[str, Any]]:
    hit = _mem_cache.get(dataset_id)
    if hit and time.time() - hit[0] < DATA_TTL:
        return hit[1]
    # 每個資料集一把鎖：etf_snapshot 會並行抓多張表，避免同一張表被重複下載
    lock = _fetch_locks.setdefault(dataset_id, asyncio.Lock())
    async with lock:
        hit = _mem_cache.get(dataset_id)
        if hit and time.time() - hit[0] < DATA_TTL:
            return hit[1]
        data = await _fetch_json(f"{BASE}/{dataset_id}")
        rows = data if isinstance(data, list) else [data]
        _mem_cache[dataset_id] = (time.time(), rows)
        return rows


def _num(v: Any) -> float | None:
    """證交所的數字都是字串，還可能帶逗號、'--'、空白。"""
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    if not s or s in {"--", "-", "N/A"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _first_row(rows: list[dict[str, Any]], field: str, code: str) -> dict[str, Any] | None:
    code = code.strip()
    for r in rows:
        if str(r.get(field, "")).strip() == code:
            return r
    return None


def _detect_code_field(row: dict[str, Any]) -> str | None:
    for f in CODE_FIELDS:
        if f in row:
            return f
    return None


# --------------------------------------------------------------------------
# Tools
# --------------------------------------------------------------------------
@mcp.tool()
async def twse_search_datasets(query: str = "", tag: str = "", limit: int = 25) -> str:
    """搜尋證交所 OpenAPI 有哪些資料集可用。取資料前先用這個找 dataset_id。

    會比對資料集代號、中文說明與欄位名稱。

    Args:
        query: 關鍵字，例如 "ETF"、"基金"、"融資"、"本益比"、"月營收"。留空列出全部。
        tag: 依分類過濾，例如 "證券交易"、"公司治理"、"財務報表"、"指數"、"券商資料"。
        limit: 最多回傳幾筆（預設 25）。
    """
    cat = await _load_catalog()
    q = query.lower().strip()
    aliased = set(ALIASES.get(q, ()))
    out = []
    for ds in cat.values():
        if tag and tag not in ds["tags"]:
            continue
        if q and ds["id"] not in aliased:
            hay = " ".join(
                [ds["id"], ds["summary"], ds["description"], *ds["fields"].keys()]
            ).lower()
            if q not in hay:
                continue
        out.append(
            {"dataset_id": ds["id"], "summary": ds["summary"], "tags": ds["tags"],
             **({"note": "別名命中"} if ds["id"] in aliased else {})}
        )
    return json.dumps(
        {"total_matched": len(out), "results": out[:limit]},
        ensure_ascii=False, indent=1,
    )


@mcp.tool()
async def twse_describe_dataset(dataset_id: str) -> str:
    """查看某個資料集的完整欄位定義，取資料前用來確認要過濾／投影哪些欄位。

    Args:
        dataset_id: 來自 twse_search_datasets 的代號，例如 "exchangeReport/STOCK_DAY_ALL"。
    """
    cat = await _load_catalog()
    ds = cat.get(dataset_id.lstrip("/"))
    if not ds:
        return json.dumps(
            {"error": f"找不到 {dataset_id}，請先用 twse_search_datasets 查詢"},
            ensure_ascii=False,
        )
    return json.dumps(ds, ensure_ascii=False, indent=1)


@mcp.tool()
async def twse_get_dataset(
    dataset_id: str,
    code: str = "",
    match: dict[str, str] | None = None,
    fields: list[str] | None = None,
    limit: int = 30,
    offset: int = 0,
) -> str:
    """取得證交所資料集內容，支援伺服器端過濾、欄位投影與分頁。

    證交所每個 endpoint 都是一次回整份資料（可能上千筆），所以務必用
    code / match / fields 縮小範圍，不要無條件拉全部。

    Args:
        dataset_id: 資料集代號，例如 "exchangeReport/STOCK_DAY_ALL"。
        code: 證券／基金代號，例如 "0050"。會自動偵測該表的代號欄位名稱。
        match: 其他欄位的子字串過濾，例如 {"基金類型": "ETF"}。
        fields: 只回傳這些欄位，例如 ["Code", "Name", "ClosingPrice"]。
        limit: 回傳筆數上限（硬上限 200）。
        offset: 分頁位移。
    """
    ds_id = dataset_id.lstrip("/")
    cat = await _load_catalog()
    if ds_id not in cat:
        return json.dumps(
            {"error": f"找不到 {ds_id}，請先用 twse_search_datasets 查詢"},
            ensure_ascii=False,
        )

    rows = await _get_rows(ds_id)
    total_raw = len(rows)

    if code and rows:
        cf = _detect_code_field(rows[0])
        if cf:
            rows = [r for r in rows if str(r.get(cf, "")).strip() == code.strip()]
        else:
            return json.dumps(
                {"error": f"{ds_id} 沒有可辨識的代號欄位，請改用 match",
                 "available_fields": list(rows[0].keys())},
                ensure_ascii=False,
            )

    for k, v in (match or {}).items():
        rows = [r for r in rows if v.lower() in str(r.get(k, "")).lower()]

    matched = len(rows)
    page = rows[offset: offset + min(limit, MAX_ROWS)]
    if fields:
        page = [{k: r.get(k) for k in fields if k in r} for r in page]

    return json.dumps(
        {
            "dataset_id": ds_id,
            "summary": cat[ds_id]["summary"],
            "rows_in_source": total_raw,
            "rows_matched": matched,
            "returned": len(page),
            "offset": offset,
            "note": "資料為前一交易日；盤中即時報價請用 twse_realtime_quote",
            "data": page,
        },
        ensure_ascii=False, indent=1,
    )


async def _fetch_quotes(codes: list[str], market: str = "tse") -> list[dict[str, Any]]:
    ex_ch = "|".join(f"{market}_{c.strip()}.tw" for c in codes if c.strip())
    url = (
        "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
        f"?ex_ch={ex_ch}&json=1&delay=0&_={int(time.time() * 1000)}"
    )
    async with _http_sem:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers={"Referer": "https://mis.twse.com.tw/stock/index.jsp"})
            r.raise_for_status()
            payload = r.json()
    return [
        {
            "code": q.get("c"), "name": q.get("n"),
            "last": q.get("z"), "open": q.get("o"),
            "high": q.get("h"), "low": q.get("l"),
            "prev_close": q.get("y"), "volume": q.get("v"),
            "time": q.get("t"),
        }
        for q in payload.get("msgArray", [])
    ]


@mcp.tool()
async def twse_realtime_quote(codes: list[str], market: str = "tse") -> str:
    """取得盤中即時報價（約 5 秒更新一次）。

    OpenAPI 只有前一交易日資料，要當下的價格得走基本市況報導站。
    ETF 與上市股票用 market="tse"，上櫃用 "otc"。

    Args:
        codes: 代號清單，例如 ["0050", "0056", "2330"]。
        market: "tse"（上市）或 "otc"（上櫃）。
    """
    out = await _fetch_quotes(codes, market)
    return json.dumps({"count": len(out), "quotes": out}, ensure_ascii=False, indent=1)


@mcp.tool()
async def etf_snapshot(code: str, include_realtime: bool = True) -> str:
    """一次取得單一上市 ETF 的完整概況：基本資料 + 當日價量 + 定期定額熱度。

    合併三張證交所的表並行查詢，比分別呼叫 twse_get_dataset 快也不易出錯。
    任何一段查不到都會標成 null 並記在 caveats，不會整個失敗。

    Args:
        code: ETF 代號，例如 "0056"、"0050"、"00878"。
        include_realtime: 是否附上盤中即時報價（盤後或休市時可能為空）。
    """
    code = code.strip()

    tasks = [_get_rows(DS_FUND), _get_rows(DS_DAY), _get_rows(DS_RANK)]
    if include_realtime:
        tasks.append(_fetch_quotes([code]))
    got = await asyncio.gather(*tasks, return_exceptions=True)

    def _ok(x):
        return None if isinstance(x, BaseException) else x

    funds, days, ranks = _ok(got[0]) or [], _ok(got[1]) or [], _ok(got[2]) or []
    rt = _ok(got[3]) if include_realtime and len(got) > 3 else None

    caveats: list[str] = []
    for src, val in (("基金基本資料", got[0]), ("日成交資訊", got[1]), ("定期定額排行", got[2])):
        if isinstance(val, BaseException):
            caveats.append(f"{src}取得失敗：{type(val).__name__}")

    # --- 1. 基本資料 -------------------------------------------------------
    f = _first_row(funds, "基金代號", code)
    profile = None
    if f:
        profile = {
            "基金簡稱": f.get("基金簡稱"),
            "基金中文名稱": f.get("基金中文名稱"),
            "基金類型": f.get("基金類型"),
            "追蹤指數": f.get("標的指數/追蹤指數名稱"),
            "客製化指數": f.get("標的指數是否為客製化或需揭露相關資訊之指數"),
            "含國外成分股": f.get("是否包含國外成分股"),
            "成立日期": f.get("成立日期"),
            "上市日期": f.get("上市日期"),
            "基金經理人": f.get("基金經理人"),
            "發行單位數": f.get("發行單位數/轉換數"),
            "保管機構": f.get("保管機構"),
            "資料日期": f.get("出表日期"),
        }
    else:
        caveats.append(
            f"{code} 不在證交所基金基本資料彙總表中 —— 可能不是上市基金、"
            "是上櫃 ETF（需查櫃買中心），或代號有誤"
        )

    is_etf = bool(f and "ETF" in str(f.get("基金類型", "")).upper())
    if f and not is_etf:
        caveats.append(f"{code} 的基金類型是「{f.get('基金類型')}」，不是 ETF")

    # --- 2. 當日（前一交易日）價量 -----------------------------------------
    d = _first_row(days, "Code", code)
    quote = None
    if d:
        quote = {
            "日期": d.get("Date"),
            "開盤": _num(d.get("OpeningPrice")),
            "最高": _num(d.get("HighestPrice")),
            "最低": _num(d.get("LowestPrice")),
            "收盤": _num(d.get("ClosingPrice")),
            "漲跌": _num(d.get("Change")),
            "成交股數": _num(d.get("TradeVolume")),
            "成交金額": _num(d.get("TradeValue")),
            "成交筆數": _num(d.get("Transaction")),
        }
        prev = None
        if quote["收盤"] is not None and quote["漲跌"] is not None:
            prev = quote["收盤"] - quote["漲跌"]
        if prev:
            quote["漲跌幅%"] = round(quote["漲跌"] / prev * 100, 2)
    else:
        caveats.append(f"{code} 不在上市日成交資訊中（上櫃 ETF 或當日無成交）")

    # --- 3. 定期定額熱度 ---------------------------------------------------
    rk = _first_row(ranks, "ETFsSecurityCode", code)
    savings = None
    if rk:
        savings = {
            "排名": rk.get("No"),
            "交易戶數": _num(rk.get("ETFsNumberofTradingAccounts")),
            "說明": "證交所定期定額交易戶數統計排行月報表",
        }
    else:
        caveats.append(
            f"{code} 不在定期定額排行榜上（該表只收錄前段班，不代表沒有人定期定額）"
        )

    # --- 4. 衍生指標 -------------------------------------------------------
    derived = {}
    units = _num(profile.get("發行單位數")) if profile else None
    close = quote["收盤"] if quote else None
    if units and close:
        derived["市值粗估_億元"] = round(units * close / 1e8, 2)
        caveats.append(
            "市值粗估 = 發行單位數 × 收盤價。這不是基金規模："
            "規模應以淨值計算，而證交所 OpenAPI 不提供淨值，需向各投信取得"
        )

    return json.dumps(
        {
            "code": code,
            "name": (profile or {}).get("基金簡稱") or (d or {}).get("Name"),
            "is_etf": is_etf,
            "profile": profile,
            "quote": quote,
            "realtime": (rt or None) if include_realtime else "未查詢",
            "regular_savings": savings,
            "derived": derived or None,
            "caveats": caveats,
        },
        ensure_ascii=False, indent=1,
    )


def main() -> None:
    """console_scripts 進入點。"""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
