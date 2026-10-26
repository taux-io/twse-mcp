# Privacy Policy / 隱私權政策

The full, current policy is served at **https://twse-mcp.taux.io/privacy** (Traditional Chinese and English).
完整、最新的版本在 **https://twse-mcp.taux.io/privacy**（繁體中文與英文）。

Summary / 摘要：

- What you ask and tool arguments are not logged or stored. MCP connections need no account and set no cookies.
  不記錄你問的內容與工具參數；MCP 連線不需帳號、不設 cookie。
- The website's web pages (not the MCP endpoint) use Google Analytics 4, which sets cookies (`_ga`, `_ga_*`) to count page views. Google signals and ad personalization are off; there is no consent banner.
  網站的網頁（不含 MCP 端點）使用 Google Analytics 4 統計瀏覽量，會設定 cookie（`_ga`、`_ga_*`）；已關閉 Google signals 與廣告個人化，不顯示同意橫幅。
- Cloudflare Workers Logs keep per-request connection metadata (IP and derived location, network/ASN,
  User-Agent and request headers — which may include the MCP tool name — URL, status) for **3 days**,
  used only for troubleshooting and abuse prevention; never sold or shared.
  Cloudflare 會保存每個請求的連線中繼資料（IP 與推估位置、網路業者、User-Agent 與請求標頭——可能含工具名稱——網址、狀態碼）**3 天**，
  只用於排查問題與防止濫用；不出售、不分享。
- Requests to the Taiwan Stock Exchange carry the connecting IP in Cloudflare's `CF-Connecting-IP` header,
  which this service cannot remove.
  向證交所發出的請求，Cloudflare 會在 `CF-Connecting-IP` 標頭附上連線來源 IP，本服務無法移除。

Contact / 聯絡：dev@taux.io
