*English ｜ [繁體中文](CHANGELOG.md)*

# Changelog

What changed in each version and how it affects you. Only user-visible changes are listed;
internal refactors, tests and doc fixes are left out. Each version links to the full diff on GitHub.

This is a hosted service, so **there is nothing to update on your side**: once a version is live,
your AI uses it on its next connection.

## [0.13.0] - 2026-09-28

- The service is now named **Taiwan Market Open Data (Unofficial)**, and the README, homepage and llms.txt state plainly that it is unofficial and not affiliated with, or endorsed by, the Taiwan Stock Exchange or the Taiwan Futures Exchange. The endpoint URL and tool names are unchanged.
- When a page of dataset rows would be too large (for example 200 rows of a very wide table), fewer rows come back with a note on how to get the rest, so the result stays within what an AI assistant can read in one go. Upstream calls now have timeouts and one retry, so a brief upstream hiccup is less likely to fail a query.
- Added a [privacy policy](https://twse-mcp.taux.io/privacy), and corrected the README and homepage, which had said the service does not know what you look up: what you ask and the arguments are not recorded, but Cloudflare keeps per-request connection logs (IP, User-Agent and so on) for 3 days. The homepage footer now lists the contact address dev@taux.io.
- Every tool now has an English title, and each description leads with English (Chinese follows) stating the data source, update frequency and limits, so non-Chinese users and AI clients can tell the tools apart. Tool names and parameters are unchanged.

## [0.12.0] - 2026-09-28

- After a long weekend or typhoon day, the data date is older than the previous weekday. The stock, ETF, futures, market overview and live quote tools now say which days in between the market was closed (for example "2026-09-25 (Fri) Mid-Autumn Festival"), so the AI no longer reports a holiday as missing data; if the holiday table can't be fetched, they say it can't be confirmed rather than claiming there was no holiday.

## [0.11.0] - 2026-09-27

- **Tools renamed** (only matters if you hard-coded tool names; nothing to do if you use it from claude.ai or ChatGPT):
  dataset search, describe and fetch → `dataset.search`, `dataset.describe`, `dataset.get`;
  stock, ETF, futures contract and market overview → `snapshot.stock`, `snapshot.etf`, `snapshot.futures`, `snapshot.market`;
  live quote and code lookup → `quote.realtime`, `quote.lookup`. They used to be named like `twse_stock_snapshot`.
  Claude Code allowlists become `mcp__twse__snapshot_stock` (dots turn into underscores), or just use `mcp__twse__*`.

## [0.10.2] - 2026-09-27

- The dataset search, describe and fetch tools now also return structured data, so all 9 tools do; an unknown dataset or field name is now flagged as an error (the list of available fields is still included).

## [0.10.1] - 2026-09-27

- Fixed stock snapshots that could be cancelled, or leave the service stuck, when several queries arrived at the same time.

## [0.10.0] - 2026-09-27

- New **ESG disclosures** in the stock snapshot: 21 topics such as greenhouse gases, energy, water, waste, the board, workforce and information security, up to 6 per call. Figures are annual filings (currently the 114 / 2025 report year); about half the topics are industry-specific; a company missing from a topic, or an N/A value, is reported as such, never as zero.
- New **events calendar** in the market overview: ask "which stocks go ex-dividend this week" or "who is under disposition" and get ex-dividend dates and shareholders' meetings in the next two weeks, today's attention-stock notices, and stocks under or about to enter disposition (listed companies only).

## [0.9.0] - 2026-09-26

- New **futures contract snapshot** (the 9th tool): one futures contract's open, high, low, close, settlement and
  open interest for each month (regular and after-hours sessions), plus institutional and large-trader positions and the
  final settlement price. Takes codes (TX, MTX, TMF, CDF) or everyday names (台指期, 小台, 微台, 台積電期貨); when a
  name matches more than one contract it asks you to pick first.
- New margin option on the stock snapshot: margin and short buying, selling, balances and daily change, utilisation,
  short-to-margin ratio, suspension or allocation flags, and today's shares available to borrow and sell short
  (the last one works for OTC stocks too).
- The stock snapshot now includes **dividends for each period over the past year**: cash and stock dividend per share,
  and whether the board or the shareholders' meeting has approved it, with dates.
- The homepage has a copy icon next to the endpoint and install commands; one click copies them.
  Long commands wrap instead of hiding under the icon.
- Homepage examples now cover financials, governance, the market overview and looking up a code by name.

## [0.8.0] - 2026-09-26

- The stock snapshot, ETF snapshot, market overview, name lookup and realtime quote tools now also return
  structured data (`structuredContent`), so clients that support it can read fields directly. Answers are unchanged.
- Fixed the pre-tax income check in financials: 39 general-industry companies had a valid pre-tax figure
  dropped by mistake; it now shows correctly.
- Two tool descriptions were reworded so questions like "book value per share" or "how many stocks rose today"
  reach the right tool more reliably.

## [0.7.0] - 2026-09-26

- **OpenAI Codex CLI works again**, along with other programs on the older MCP protocol.
  Support was dropped in 0.5.0, which locked Codex users out; this restores it.
- JSON-RPC batch requests are now always rejected (the MCP spec removed batching; current clients don't send it).

## [0.6.2] - 2026-09-26

- The market overview now counts advancers, decliners and unchanged stocks itself from daily trading data.
  The exchange's official advance/decline table has not been updated since 2026-06-05; before this,
  the overview could only attach a warning.

## [0.6.1] - 2026-09-26

- Fixed futures data sometimes failing to load: some TAIFEX endpoints switch between JSON and CSV,
  and both are now read. The large-trader section of the market overview works again.

## [0.6.0] - 2026-09-26

- Two new options on the stock snapshot:
  - **Financials**: the latest quarter's income statement and balance sheet highlights, with gross, operating
    and net margins and the debt ratio.
  - **Governance**: whether the chair is also CEO, director share pledge ratio, and FSC penalties.
- New **market overview**: TAIEX, turnover, advancers/decliners, the ten most-traded stocks, and on the futures
  side institutional open interest, the put/call ratio and large traders in TAIEX futures.
- Realtime quotes now include the best bid/ask and the day's limit-up and limit-down prices. When nothing has
  traded at that moment, the bid/ask answers "what is it trading at now".
- Fixed two TAIFEX endpoints that stopped loading after switching to CSV.

## [0.5.1] - 2026-09-26

- Realtime quotes carry the **trading date**, so the AI no longer mistakes Friday's quote for today's.
- Realtime quotes explain their units: prices in NTD, volume in lots (1 lot = 1,000 shares), and "-" means
  no trade at that moment, not zero.

## [0.5.0] - 2026-09-26

- Only the latest MCP protocol (2026-07-28) was served. **This locked out Codex CLI; restored in 0.7.0.**

## [0.4.0] - 2026-09-26

- New **stock snapshot**: company profile, the day's trading, P/E, dividend yield and P/B in one call.
- New **name lookup**: find a stock code from a name such as 台積電 or 隴華.
- Smarter dataset search: 臺/台 and full-width/half-width characters now match.
- Added 132 datasets from the **Taiwan Futures Exchange**, taking the total from 143 to 275.
- Three shortcuts: find a dataset, ETF overview, futures quote (slash commands or the "+" menu in Claude).
- Official homepage: <https://twse-mcp.taux.io/en> (English) and `/` (Chinese).
- Fixed three bugs where an answer looked fine but was wrong.

## [0.3.0] - 2026-08-09

- First public release: a hosted MCP service, nothing to install; paste `https://twse-mcp.taux.io/mcp` and go.
- Search, describe and fetch 143 public TWSE datasets, plus an ETF snapshot and realtime quotes.
- Serves both the new and the older MCP protocol.
- Listed on the official MCP Registry.
- README in Traditional Chinese, English, Simplified Chinese, Japanese and Korean.

[0.13.0]: https://github.com/taux-io/twse-mcp/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/taux-io/twse-mcp/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/taux-io/twse-mcp/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/taux-io/twse-mcp/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/taux-io/twse-mcp/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/taux-io/twse-mcp/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/taux-io/twse-mcp/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/taux-io/twse-mcp/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/taux-io/twse-mcp/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/taux-io/twse-mcp/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/taux-io/twse-mcp/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/taux-io/twse-mcp/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/taux-io/twse-mcp/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/taux-io/twse-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/taux-io/twse-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/taux-io/twse-mcp/releases/tag/v0.3.0
