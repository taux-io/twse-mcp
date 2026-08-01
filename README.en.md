*English ｜ [繁體中文](README.md)*

# Taiwan Stock Data Helper (TWSE MCP)

Ask your AI about Taiwan stock and ETF public data **in plain language** — live
prices, yesterday's close and volume, a full profile of an ETF, and what public
reports the exchange publishes. No coding, no terminal: add one URL to whichever
AI you already use and start asking.

This is an open MCP service, and **any AI that supports remote MCP can use it**.

> A personal, free-of-charge side project. All data comes from public sources
> published by the Taiwan Stock Exchange.

---

## What it can do for you

Once it is connected, just ask in plain language, for example:

- **What's the price right now?** — Intraday quotes, several tickers at once.
- **What did it close at yesterday, and on what volume?** — Previous trading day's open, high, low, close and volume.
- **What exactly is this ETF?** — Tracked index, rough market value, how popular it is for regular savings plans, plus the caveats you should know.
- **Does the exchange publish data on X?** — Finds the right one among a hundred-plus public reports.

You do not need to memorise any commands or field names. Ask in your own words
and the AI will look it up.

### Listed (TWSE) vs. over-the-counter (TPEx)

**Listed** stocks and ETFs (mostly 4-digit tickers such as 2330, 0050) — everything above works.

**Over-the-counter** stocks and ETFs (such as 6488 GlobalWafers, 00679B Yuanta US Treasury 20+ Year) —
**intraday quotes only**. Yesterday's close, historical prices and statistical
reports are not available. The reason: the OTC data source blocks connections
from cloud servers, so this service cannot reach it from the cloud. Intraday
quotes come from a different source that is not blocked, so they are unaffected.

---

## How to add it to your AI

Pick whichever way suits you.

### Graphical interface

Using Claude (web or desktop) as the example:

1. Go to **Customize → Connectors**.
2. Click **"+" → "Add custom connector"**, give it any name you like (for example `Taiwan Stocks`), and paste this URL:

   ```
   https://twse-mcp.taux.io/mcp
   ```

   Click **"Add"**. No account, password or OAuth required.
3. Back in the chat, click **"+" → "Connectors"** at the bottom left, switch the connector on, and start asking.

> Note: custom connectors in Claude require a **Pro / Max** plan (free plans can add one).

Other AIs with a connector settings screen work much the same way: find "add a
custom connector / MCP server" and paste the URL above.

### Terminal tools

The server name is up to you; `twse` is used here:

Claude Code:

```
claude mcp add twse --transport http https://twse-mcp.taux.io/mcp
```

Codex (OpenAI):

```
codex mcp add twse --url https://twse-mcp.taux.io/mcp
```

### Other tools

For any other AI or tool that supports remote MCP, fill these connection details
into its settings:

| Field | Value |
|---|---|
| URL | `https://twse-mcp.taux.io/mcp` |
| Transport | Streamable HTTP (remote MCP) |
| Authentication | None |

Field names differ between tools — pick the "Streamable HTTP" option, not the
older SSE one.

---

## Things you can ask (examples)

> **You ask:** "What's 0056 trading at right now?"
>
> **The AI will answer something like:** 0056 (Yuanta High Dividend) is around **48.19**,
> down about **3.6%** from yesterday's close (50.00), trading between 48.14 and 49.26 today.
>
> *(Illustrative figures — actual values depend on when you ask.)*

> **You ask:** "What did 0050 close at yesterday, and how much volume?"
>
> **The AI will answer something like:** 0050 (Yuanta Taiwan 50) closed at **97.15**
> on the previous trading day, on roughly **40 million shares**, opening at 98.35,
> with a high of 98.35 and a low of 96.90.
>
> *(Illustrative.)*

> **You ask:** "Give me a full profile of the ETF 0056."
>
> **The AI will answer something like:** 0056 tracks the "Taiwan High Dividend Index",
> is popular for regular savings plans (near the top of the rankings), and has a
> **rough** market value of about **NT$710 billion** — while noting that this rough
> figure is shares outstanding × closing price, which is **not the same as the fund's actual size**.
>
> *(Illustrative.)*

> **You ask:** "Does the exchange publish data on regular savings plan account numbers?"
>
> **The AI will answer something like:** Yes — the exchange publishes a monthly
> ranking of regular savings plan account numbers, and I can look up a specific
> ticker's rank and account count.

You can ask about several tickers at once, for example: "Give me live quotes for
0050, 0056 and TSMC."

---

## Before you start, a few things to know

1. **This is a personal side project.** I try to keep it running, but it may occasionally rate-limit, go down for maintenance, or change address in future — no guarantee it is always up.
2. **"Live" quotes are best-effort.** They come from the exchange's web interface and can lag by seconds to minutes, occasionally fail, or differ slightly from what your broker shows.
3. **For reference only, not investment advice.** Figures may be wrong or delayed. **Verify with the exchange or your broker before you trade** — your gains and losses are your own responsibility.
4. **No login, no personal data collected.** Your questions go through this service to fetch **public** data from the exchange, and that is all.

---

## Help make it better

This is an open source project and contributions are welcome — the source is on
[GitHub](https://github.com/taux-io/twse-mcp).

Every kind of input helps: if something behaves oddly, if you cannot find data
you need, or if you wish it could do one more thing, just
[open an issue](https://github.com/taux-io/twse-mcp/issues). Pull requests are
equally welcome if you write code.

**The one thing most needed right now: making OTC data available.**
The OTC data source (the Taipei Exchange) blocks connections from cloud servers.
We tested this: it is reachable from an ordinary Taiwanese connection but blocked
from the cloud where this service runs, and it is not something a different
request header can work around. Solving it needs a machine in Taiwan that can
relay requests reliably over time. If you happen to have that kind of setup, or
know a better approach, please get in touch.
