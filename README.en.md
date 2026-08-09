*English ｜ [繁體中文](README.md)*

# Taiwan Stock Data Helper (TWSE MCP)

**Ask your AI about Taiwan stock data, in plain language.**

What's TSMC trading at? Where did 0056 close yesterday? What index does this ETF
actually track? You used to look these up yourself — now you can just ask.

No coding, nothing to install. **You copy one URL and paste it into your AI's
settings** — about a minute's work.

> **What is MCP?** Think of it as **a plug-in for your AI**. The AI cannot look
> up Taiwan stock data on its own; with this plug-in installed, it gains that
> skill. (MCP is the common standard for such plug-ins — Claude, ChatGPT and
> others all support it.)

> A personal, free-of-charge side project. All data comes from public sources
> published by the Taiwan Stock Exchange.

---

## What it can do for you

Once installed, just ask in your own words, for example:

- **"What's TSMC at right now?"** — Live prices, several tickers at once.
- **"Where did 0050 close yesterday, and on what volume?"** — Previous trading day's open, high, low, close and volume.
- **"What exactly is the ETF 0056?"** — Which index it tracks, how popular it is for regular savings plans, plus which figures you should not take at face value.
- **"Does the exchange publish data on …?"** — Finds the right one among a hundred-plus public reports.

You do not need to memorise commands or field names. **Just ask normally** and
the AI will look it up.

---

## Getting started

Using **Claude** as the example (claude.ai in a browser, or the desktop app —
both work the same way). **The free plan is enough**: it allows one plug-in, and
one is all you need.
(Per [Anthropic's documentation](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
checked August 2026; plan rules may change.)

### Step 1: Open "Connectors" in settings

Click **your name in the bottom-left corner** → choose **Settings** → find
**Connectors** in the left-hand menu.

### Step 2: Paste the URL

Click **"+ Add custom connector"**. A small dialog asks for two things:

| Field | What to enter |
|---|---|
| Name | Anything you like, e.g. `Taiwan Stocks` |
| URL | `https://twse-mcp.taux.io/mcp` |

Click **Add** and you are done. **No account, no password, no payment.**

### Step 3: Switch it on in the chat

Go back to the chat, **start a new conversation**, click the **"+"** next to the
message box → **Connectors**, and switch on the one you just added.

### Check that it worked

Ask it:

> Use the Taiwan Stocks connector — what's 0050 trading at?

If it comes back with **an actual price** (something like "0050 is around
97.15"), you are set. If it says it cannot find anything, or starts searching
the web, see the next section.

---

## Something not working?

**The AI says it cannot find the data, or searches the web instead**
Usually the connector is **not switched on**, or you are still in a conversation
that **started before you added it**. Open a new conversation and check under
"+" that it is on. If it still will not use it, tell it plainly: **"use the
Taiwan Stocks connector to look up 0056"** — naming it directly usually does it.

**Over-the-counter tickers return less detail**
That is a limitation, not a fault. OTC tickers (such as 6488 GlobalWafers or
00679B Yuanta US Treasury 20+ Year) do give you the **current price, today's
open/high/low, yesterday's close and volume** — but nothing further back, no
statistical reports, and no full ETF profile. See "What it can and cannot look
up" below.

**There is no Connectors option in settings**
On a **company or team account**, an administrator usually has to add the
connector before members can switch it on. Personal accounts — including the
free plan — can add it themselves.

---

## Things you can ask (examples)

> **You ask:** "What's 0056 trading at right now?"
>
> **The AI will answer something like:** 0056 (Yuanta High Dividend) is around **48.19**,
> down about **3.6%** from yesterday's close (50.00), trading between 48.14 and 49.26 today.
>
> *(Illustrative figures — actual values depend on when you ask.)*

> **You ask:** "Where did 0050 close yesterday, and how much volume?"
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

You can ask about several tickers at once, for example: "Give me live prices for
0050, 0056 and TSMC."

---

## What it can and cannot look up

**Listed** stocks and ETFs (mostly 4-digit tickers, e.g. 2330 TSMC, 0050) —
**everything above works**.

**Over-the-counter** stocks and ETFs (e.g. 6488 GlobalWafers, 00679B Yuanta US
Treasury 20+ Year) — **whatever the live quote carries**: current price, today's
open/high/low, **yesterday's close**, and volume. Nothing further back, no
statistical reports, and no full ETF profile (tracked index, fund size and so on).

The reason: the source for OTC **reports** blocks connections coming from cloud
servers, and this service runs on one. Live quotes come from a different source
that is not blocked, so they are unaffected — and yesterday's close arrives as
part of that quote.
(We are looking for help fixing this — see "Help make it better" below.)

---

## Before you start, a few things to know

1. **This is a personal side project.** I try to keep it running, but it may occasionally rate-limit, go down for maintenance, or change address in future — no guarantee it is always up.
2. **"Live" quotes are best-effort.** They come from the exchange's web interface and can lag by seconds to minutes, occasionally fail, or differ slightly from what your broker shows.
3. **For reference only, not investment advice.** Figures may be wrong or delayed. **Verify with the exchange or your broker before you trade** — your gains and losses are your own responsibility.
4. **Everything except live quotes may be up to an hour old.** Reports are cached for an hour so the exchange is not hit on every request; intraday prices are never cached and are always fetched fresh.
5. **No login, and your questions are not recorded.** They go through this service to fetch **public** data from the exchange. While we measure how many people still connect with the older protocol, the service logs which AI tool you use and which protocol version it speaks — **not what you ask** — and that logging will be removed once the measurement is done.

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

---

## Appendix: adding it to other tools

*For people comfortable with a terminal or using other AI tools — everyone else
can skip this.*

**Claude Code**

```
claude mcp add twse --transport http https://twse-mcp.taux.io/mcp
```

**Codex (OpenAI)**

```
codex mcp add twse --url https://twse-mcp.taux.io/mcp
```

**Any other tool that supports remote MCP** — fill in these connection details:

| Field | Value |
|---|---|
| URL | `https://twse-mcp.taux.io/mcp` |
| Transport | Streamable HTTP (remote MCP); both the older and newer MCP protocol revisions work |
| Authentication | None |

Field names differ between tools — pick the "Streamable HTTP" option, not the
older SSE one.
