"""離線驗證：把網路層換成 fixture，確認 swagger 解析 / 過濾 / 分頁邏輯正確。"""
import asyncio, json, sys, tempfile, os
os.environ["TWSE_MCP_CACHE"] = tempfile.mkdtemp()
from twse_mcp import server

FAKE_SWAGGER = {
    "paths": {
        "/exchangeReport/STOCK_DAY_ALL": {"get": {
            "tags": ["證券交易"], "summary": "上市個股日成交資訊",
            "description": "上市個股日成交資訊",
            "responses": {"200": {"schema": {"properties": {
                "Code": {"description": "證券代號"}, "Name": {"description": "證券名稱"},
                "ClosingPrice": {"description": "收盤價"}, "TradeVolume": {"description": "成交股數"}}}}}}},
        "/opendata/t187ap47_L": {"get": {
            "tags": ["其他"], "summary": "基金基本資料彙總表",
            "description": "基金基本資料彙總表",
            "responses": {"200": {"schema": {"properties": {
                "基金代號": {"description": "基金代號"}, "基金簡稱": {"description": "基金簡稱"},
                "基金類型": {"description": "基金類型"},
                "標的指數/追蹤指數名稱": {"description": "追蹤指數"}}}}}}},
        "/ETFReport/ETFRank": {"get": {
            "tags": ["券商資料"], "summary": "定期定額交易戶數統計排行月報表",
            "description": "", "responses": {"200": {"schema": {"properties": {
                "ETFsSecurityCode": {"description": "ETF代號"},
                "ETFsName": {"description": "ETF名稱"}}}}}}},
    }
}

FAKE_ROWS = {
    "exchangeReport/STOCK_DAY_ALL": [
        {"Date": "20260727", "Code": "0050", "Name": "元大台灣50", "ClosingPrice": "102.50",
         "OpeningPrice": "99.50", "HighestPrice": "103.00", "LowestPrice": "99.20",
         "Change": "3.30", "TradeVolume": "95733000", "TradeValue": "9800000000",
         "Transaction": "48000"},
        {"Date": "20260727", "Code": "0056", "Name": "元大高股息", "ClosingPrice": "38.20",
         "OpeningPrice": "37.90", "HighestPrice": "38.35", "LowestPrice": "37.85",
         "Change": "0.30", "TradeVolume": "44120000", "TradeValue": "1685000000",
         "Transaction": "21000"},
        {"Date": "20260727", "Code": "2330", "Name": "台積電", "ClosingPrice": "1150.00",
         "OpeningPrice": "1140.00", "HighestPrice": "1155.00", "LowestPrice": "1138.00",
         "Change": "10.00", "TradeVolume": "31000000", "TradeValue": "3.5e10",
         "Transaction": "60000"},
    ] + [{"Code": f"{i:04d}", "Name": f"股票{i}", "ClosingPrice": "10", "TradeVolume": "1"}
         for i in range(1000, 1050)],
    "opendata/t187ap47_L": [
        {"出表日期": "1150727", "基金代號": "0050", "基金簡稱": "元大台灣50", "基金類型": "ETF",
         "基金中文名稱": "元大台灣卓越50證券投資信託基金",
         "標的指數/追蹤指數名稱": "臺灣50指數", "成立日期": "0920625", "上市日期": "0920630",
         "基金經理人": "某經理", "發行單位數/轉換數": "8,000,000,000", "保管機構": "某銀行"},
        {"出表日期": "1150727", "基金代號": "0056", "基金簡稱": "元大高股息", "基金類型": "ETF",
         "基金中文名稱": "元大台灣高股息證券投資信託基金",
         "標的指數/追蹤指數名稱": "臺灣高股息指數", "成立日期": "0961213", "上市日期": "0961226",
         "基金經理人": "某經理", "發行單位數/轉換數": "30,000,000,000", "保管機構": "某銀行"},
        {"出表日期": "1150727", "基金代號": "00878", "基金簡稱": "國泰永續高股息",
         "基金類型": "ETF", "標的指數/追蹤指數名稱": "MSCI台灣ESG永續高股息精選30指數",
         "發行單位數/轉換數": "20,000,000,000"},
        {"出表日期": "1150727", "基金代號": "9999", "基金簡稱": "某某平衡基金",
         "基金類型": "平衡型", "標的指數/追蹤指數名稱": ""},
    ],
    "ETFReport/ETFRank": [
        {"No": "1", "STOCKsSecurityCode": "2330", "STOCKsName": "台積電",
         "STOCKsNumberofTradingAccounts": "500000",
         "ETFsSecurityCode": "0050", "ETFsName": "元大台灣50",
         "ETFsNumberofTradingAccounts": "410000"},
        {"No": "2", "STOCKsSecurityCode": "2317", "STOCKsName": "鴻海",
         "STOCKsNumberofTradingAccounts": "300000",
         "ETFsSecurityCode": "0056", "ETFsName": "元大高股息",
         "ETFsNumberofTradingAccounts": "380000"},
    ],
}

FAKE_QUOTES = [{"code": "0056", "name": "元大高股息", "last": "38.45", "open": "38.20",
                "high": "38.50", "low": "38.15", "prev_close": "38.20",
                "volume": "12345", "time": "13:30:00"}]


async def fake_fetch(url):
    if url.endswith("swagger.json"):
        return FAKE_SWAGGER
    return FAKE_ROWS[url.split("/v1/", 1)[1]]


server._fetch_json = fake_fetch


async def fake_quotes(codes, market="tse"):
    return [q for q in FAKE_QUOTES if q["code"] in codes]


server._fetch_quotes = fake_quotes


async def main():
    ok = lambda label, cond: print(("  PASS  " if cond else "  FAIL  ") + label) or cond

    results = []

    # 1. swagger -> 目錄
    cat = await server._load_catalog()
    results.append(ok(f"catalog built ({len(cat)} datasets)", len(cat) == 3))

    # 2. 關鍵字搜尋（含欄位名比對）
    r = json.loads(await server.twse_search_datasets(query="ETF"))
    ids = {x["dataset_id"] for x in r["results"]}
    results.append(ok(f"search 'ETF' -> {sorted(ids)}", {"ETFReport/ETFRank","opendata/t187ap47_L"} <= ids))

    r = json.loads(await server.twse_search_datasets(query="追蹤指數"))
    results.append(ok("search matches field names too",
                      r["results"][0]["dataset_id"] == "opendata/t187ap47_L"))

    # 3. tag 過濾
    r = json.loads(await server.twse_search_datasets(tag="證券交易"))
    results.append(ok("tag filter", r["total_matched"] == 1))

    # 4. describe
    r = json.loads(await server.twse_describe_dataset("exchangeReport/STOCK_DAY_ALL"))
    results.append(ok("describe returns fields", "ClosingPrice" in r["fields"]))

    # 5. code 過濾 — 英文欄位 Code
    r = json.loads(await server.twse_get_dataset("exchangeReport/STOCK_DAY_ALL", code="0050"))
    results.append(ok(f"code filter (Code) -> {r['data'][0]['Name']}",
                      r["rows_matched"] == 1 and r["data"][0]["Name"] == "元大台灣50"))

    # 6. code 過濾 — 中文欄位 基金代號（自動偵測）
    r = json.loads(await server.twse_get_dataset("opendata/t187ap47_L", code="00878"))
    results.append(ok(f"code filter (基金代號) -> {r['data'][0]['基金簡稱']}",
                      r["rows_matched"] == 1))

    # 7. code 過濾 — ETFsSecurityCode
    r = json.loads(await server.twse_get_dataset("ETFReport/ETFRank", code="0050"))
    results.append(ok("code filter (ETFsSecurityCode)", r["rows_matched"] == 1))

    # 8. match 過濾 + 欄位投影
    r = json.loads(await server.twse_get_dataset(
        "opendata/t187ap47_L", match={"基金類型": "ETF"}, fields=["基金代號", "基金簡稱"]))
    results.append(ok(f"match filter -> {r['rows_matched']} ETFs, keys={list(r['data'][0])}",
                      r["rows_matched"] == 3 and set(r["data"][0]) == {"基金代號", "基金簡稱"}))

    # 9. 分頁 + 回報總筆數（context 保護的關鍵）
    r = json.loads(await server.twse_get_dataset("exchangeReport/STOCK_DAY_ALL", limit=5, offset=1))
    results.append(ok(f"paging: source={r['rows_in_source']} returned={r['returned']}",
                      r["rows_in_source"] == 53 and r["returned"] == 5
                      and r["data"][0]["Code"] == "0056"))

    # 10. 硬上限
    r = json.loads(await server.twse_get_dataset("exchangeReport/STOCK_DAY_ALL", limit=99999))
    results.append(ok(f"MAX_ROWS cap -> {r['returned']}", r["returned"] <= server.MAX_ROWS))

    # 11. 快取：第二次呼叫不應再打網路
    c11 = []
    prev11 = server._fetch_json
    async def counting11(url):
        c11.append(url); return await prev11(url)
    server._fetch_json = counting11
    await server.twse_get_dataset("exchangeReport/STOCK_DAY_ALL", code="0050")
    results.append(ok(f"cache hit (network calls={len(c11)})", len(c11) == 0))
    server._fetch_json = prev11          # 一定要還原，否則後面的計數會疊加

    # 12. 未知 dataset 要好好報錯
    r = json.loads(await server.twse_get_dataset("nope/NOPE"))
    results.append(ok("unknown dataset -> error", "error" in r))

    # 13. tool 真的註冊進 MCP 了
    tools = await server.mcp.list_tools()
    names = sorted(t.name for t in tools)
    results.append(ok(f"registered tools: {names}", len(names) == 5))
    schema = next(t for t in tools if t.name == "twse_get_dataset").inputSchema
    results.append(ok(f"schema params: {sorted(schema['properties'])}",
                      "code" in schema["properties"] and "match" in schema["properties"]))

    # --- etf_snapshot ------------------------------------------------------
    print("\n  -- etf_snapshot --")

    # 14. happy path：三段都要有值
    s = json.loads(await server.etf_snapshot("0056"))
    results.append(ok(f"snapshot 0056 name={s['name']} is_etf={s['is_etf']}",
                      s["name"] == "元大高股息" and s["is_etf"] is True))
    results.append(ok(f"  profile 追蹤指數={s['profile']['追蹤指數']}",
                      s["profile"]["追蹤指數"] == "臺灣高股息指數"))
    results.append(ok(f"  quote 收盤={s['quote']['收盤']} 漲跌幅={s['quote']['漲跌幅%']}%",
                      s["quote"]["收盤"] == 38.2 and s["quote"]["漲跌幅%"] == 0.79))
    results.append(ok(f"  定期定額 排名={s['regular_savings']['排名']} "
                      f"戶數={s['regular_savings']['交易戶數']:,.0f}",
                      s["regular_savings"]["交易戶數"] == 380000))
    results.append(ok(f"  realtime last={s['realtime'][0]['last']}",
                      s["realtime"][0]["last"] == "38.45"))
    # 發行單位數帶逗號，要能解析；30e9 * 38.2 / 1e8 = 11460 億
    results.append(ok(f"  市值粗估={s['derived']['市值粗估_億元']} 億",
                      s["derived"]["市值粗估_億元"] == 11460.0))
    results.append(ok("  淨值 caveat 有出現",
                      any("淨值" in c for c in s["caveats"])))

    # 15. include_realtime=False
    s = json.loads(await server.etf_snapshot("0050", include_realtime=False))
    results.append(ok(f"realtime off -> {s['realtime']}", s["realtime"] == "未查詢"))

    # 16. 有基本資料、但不在定期定額排行榜 -> 降級不報錯
    s = json.loads(await server.etf_snapshot("00878", include_realtime=False))
    results.append(ok(f"00878 profile ok / savings={s['regular_savings']}",
                      s["is_etf"] is True and s["regular_savings"] is None
                      and any("定期定額排行榜" in c for c in s["caveats"])))
    results.append(ok("  00878 無日成交 -> quote=None + caveat",
                      s["quote"] is None and any("日成交" in c for c in s["caveats"])))

    # 17. 不是 ETF
    s = json.loads(await server.etf_snapshot("9999", include_realtime=False))
    results.append(ok(f"9999 is_etf={s['is_etf']}",
                      s["is_etf"] is False
                      and any("不是 ETF" in c for c in s["caveats"])))

    # 18. 完全查無此代號
    s = json.loads(await server.etf_snapshot("1234", include_realtime=False))
    results.append(ok("unknown code -> profile None + caveat，不丟例外",
                      s["profile"] is None and s["is_etf"] is False
                      and any("上櫃" in c for c in s["caveats"])))

    # 19. 單一資料源掛掉時要降級，不能整個失敗
    orig_fetch = server._fetch_json
    server._mem_cache.clear()
    async def flaky(url):
        if url.endswith(server.DS_RANK):
            raise RuntimeError("TWSE 502")
        return await orig_fetch(url)
    server._fetch_json = flaky
    s = json.loads(await server.etf_snapshot("0056", include_realtime=False))
    results.append(ok(f"one source down -> still returns; caveat={s['caveats'][0][:20]}...",
                      s["quote"] is not None
                      and any("定期定額排行取得失敗" in c for c in s["caveats"])))
    server._fetch_json = orig_fetch
    server._mem_cache.clear()

    # 20. 並行去重：三張表同時抓，每張只能下載一次
    import collections
    c20 = []
    prev20 = server._fetch_json
    async def counting20(url):
        c20.append(url.rsplit("/v1/", 1)[-1]); return await prev20(url)
    server._fetch_json = counting20
    await asyncio.gather(*[server.etf_snapshot("0056", include_realtime=False)
                           for _ in range(4)])
    server._fetch_json = prev20
    breakdown = dict(collections.Counter(c20))
    results.append(ok(f"concurrent de-dupe: {len(c20)} fetches for 4 parallel calls "
                      f"{breakdown}",
                      len(c20) == 3 and set(breakdown.values()) == {1}))

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


asyncio.run(main())
