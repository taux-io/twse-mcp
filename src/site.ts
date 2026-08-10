/**
 * site.ts — 官方首頁（`/`）、`robots.txt` 與 `sitemap.xml`。
 * ========================================================
 * 與 MCP 端點同一個 Worker、同一個網域。理由很簡單：貼給使用者的網址是
 * `https://twse-mcp.taux.io/mcp`，那個網域的根目錄本來就該有東西可看，而不是
 * 一句 `Not Found`。另開 Pages 專案只會多一條部署管線與一個會漂移的副本。
 *
 * ## 零 JavaScript 是安全決定，不是風格偏好
 *
 * 沒有腳本就沒有 XSS 的落點，於是 CSP 可以直接鎖成 `script-src 'none'`，而不必
 * 去論證某段 inline script 為什麼安全。`<details>` 取代摺疊用的 JS，
 * `prefers-color-scheme` 取代主題切換的 JS。唯一的 `<script>` 是 JSON-LD，
 * 而依 HTML 規範它是 data block、永遠不會被執行（prepare-the-script 在型別檢查
 * 那一步就中止），所以它既不是 JavaScript 也不受 script-src 管轄。
 *
 * ## 為什麼內容寫在字串裡而不是 .html 檔
 *
 * 一頁而已。用 wrangler 的 assets binding 或 text import 都要動建置設定，換來的是
 * 「模板與資料分家」——而這頁的資料（端點網址、顯名聲明、工具名稱）必須與
 * `src/server.ts` 同步，寫在一起反而比較不會漂。真的長到需要拆的時候再拆。
 */

/** 對外正式網域。canonical、OG、sitemap 都以它為準，不從請求推導。 */
export const SITE_ORIGIN = "https://twse-mcp.taux.io";
/** 使用者唯一需要複製的東西。 */
export const MCP_ENDPOINT = `${SITE_ORIGIN}/mcp`;
const REPO = "https://github.com/taux-io/twse-mcp";

/**
 * 頁面上的問答與 JSON-LD 的 FAQPage 共用同一份資料。
 *
 * 分成兩份的話，改了一邊另一邊會靜默失準——而搜尋結果裡顯示的是沒改到的那份。
 * 測試會斷言每個 `q` 都真的出現在頁面 HTML 裡。
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "要付費嗎？需要註冊或申請 API key 嗎？",
    a: "都不用。服務公開、免費、不需要帳號，Claude 的免費方案就能加。資料來自政府開放資料平臺，本服務只是把它轉成 AI 看得懂的形式。",
  },
  {
    q: "可以查上櫃（興櫃、OTC）股票嗎？",
    a: "只有盤中即時報價可以，查詢時把市場別指定為 otc 即可。上櫃的歷史與統計報表目前取不到——證券櫃檯買賣中心的開放資料主機會拒絕來自雲端的連線，這是已知限制，不是漏做。",
  },
  {
    q: "資料是即時的嗎？",
    a: "盤中即時報價約每 5 秒更新，來自證交所基本市況報導站，屬盡力而為。其餘各類報表最新到前一交易日，而且會快取一小時以免打擾交易所主機。",
  },
  {
    q: "查得到期貨和選擇權嗎？",
    a: "可以。臺灣期貨交易所的 132 個資料集都在裡面，包含每日行情、三大法人、大額交易人未沖銷部位、保證金與契約規格。",
  },
  {
    q: "這算投資建議嗎？",
    a: "不算。數字可能有誤、有延遲或被上游改動，下單前請自行向交易所或券商確認，盈虧自負。",
  },
  {
    q: "我的問題內容會被記錄嗎？",
    a: "不會。服務只是代你去取公開資料。目前為了統計還有多少人使用舊版連線協定，會記錄 AI 工具種類與協定版本，不含你問的內容，統計結束後即移除。",
  },
];

/**
 * 實體消歧。`sameAs` 指向官方網址，是讓搜尋與答案引擎確定「臺灣證券交易所」是**哪一個**
 * 機構、而不是從字面猜的最強訊號。這對本服務特別重要：它的價值主張就是「資料出自這兩個
 * 機構」，引擎認不出機構，那句話就沒有分量。
 */
const ENTITIES = [
  {
    "@type": "Organization",
    name: "臺灣證券交易所",
    alternateName: "TWSE",
    sameAs: ["https://www.twse.com.tw/", "https://zh.wikipedia.org/wiki/臺灣證券交易所"],
  },
  {
    "@type": "Organization",
    name: "臺灣期貨交易所",
    alternateName: "TAIFEX",
    sameAs: ["https://www.taifex.com.tw/", "https://zh.wikipedia.org/wiki/臺灣期貨交易所"],
  },
  {
    "@type": "Organization",
    name: "政府資料開放平臺",
    sameAs: ["https://data.gov.tw/"],
  },
];

/**
 * 章節錨點。答案引擎會引用到某一節，沒有 id 就只能連到整頁，引用精度掉一層。
 * 用 ASCII slug 而不是中文標題的百分比編碼——後者在被複製貼上時會爛掉。
 */
const SECTIONS = {
  problem: "這解決什麼問題",
  install: "一分鐘裝好",
  shortcuts: "三個現成的快捷入口",
  ask: "可以問什麼",
  scope: "有些查得到，有些查不到",
  caveats: "使用前先知道",
  faq: "常見問題",
  license: "資料來源與授權",
} as const;

/** 安裝步驟。頁面與 HowTo 結構化資料共用，避免兩邊分家後改一邊。 */
const INSTALL_STEPS = [
  {
    name: "打開連接器設定",
    text: "在 Claude 網頁版或桌面版點左下角你的名字，選 Settings（設定），再點左側選單的 Connectors（連接器）。",
  },
  {
    name: "新增自訂連接器",
    text: `按「+ Add custom connector」，名稱隨你取，網址填 ${MCP_ENDPOINT}，然後按 Add。`,
  },
  {
    name: "在對話中打開它",
    text: "回到聊天畫面開一個新對話，點輸入框旁的「+」，選 Connectors，把剛才加的連接器打開。",
  },
];

const FEATURES = [
  "台股上市股票與 ETF 的盤中即時報價",
  "前一交易日的開盤、最高、最低、收盤與成交量",
  "單一 ETF 的基本資料、追蹤指數與定期定額熱度",
  "臺灣期貨交易所的每日行情、三大法人與大額交易人未沖銷部位",
  "臺灣證交所與期交所合計 275 個公開資料集的搜尋與查詢",
];

const SHORTCUTS = [
  { name: "find_dataset", what: "不知道該查哪張表時，用關鍵字找出對的那一個", arg: "關鍵字，例如「三大法人」" },
  { name: "etf_overview", what: "一次看完一檔上市 ETF 的基本資料、前一交易日價量與定期定額熱度", arg: "ETF 代號，例如 0056" },
  { name: "futures_quote", what: "查期貨或選擇權的每日行情", arg: "契約代號，例如 TX" },
];

/** HTML 逸出。頁面內容全是靜態常數，但逸出讓「日後有人接上動態資料」不會變成漏洞。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TITLE = "台股 MCP｜讓 AI 查台灣證交所與期交所的公開資料";
const DESCRIPTION =
  "免費的遠端 MCP 伺服器，讓 Claude 等 AI 助理直接查詢台股即時報價、ETF 資料、" +
  "期貨選擇權行情與臺灣證交所、期交所的 275 個公開資料集。不用安裝、不用註冊，貼一個網址就能用。";

const LD_SOFTWARE = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "台股 MCP（twse-mcp）",
  alternateName: ["twse-mcp", "Taiwan Stock MCP"],
  applicationCategory: "DeveloperApplication",
  applicationSubCategory: "Model Context Protocol Server",
  operatingSystem: "Any",
  url: SITE_ORIGIN,
  description: DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
  isAccessibleForFree: true,
  license: "https://opensource.org/licenses/MIT",
  codeRepository: REPO,
  sameAs: [REPO],
  inLanguage: "zh-Hant-TW",
  featureList: FEATURES,
  // 引擎靠這個確定「這個服務講的兩個交易所」是哪兩個機構。
  mentions: ENTITIES,
};

/**
 * 安裝步驟的 HowTo。它同時服務兩邊：搜尋引擎可能以步驟形式顯示，而答案引擎需要
 * 一組**有順序、自成一句**的指示才有辦法照著回答「怎麼安裝」。
 */
const LD_HOWTO = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "如何在 Claude 裡安裝台股 MCP",
  description: "把台股 MCP 加進 Claude 的自訂連接器，約需一分鐘，不需要帳號或付費。",
  totalTime: "PT1M",
  tool: [{ "@type": "HowToTool", name: "Claude（網頁版或桌面版）" }],
  step: INSTALL_STEPS.map((st, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: st.name,
    text: st.text,
    url: `${SITE_ORIGIN}/#install`,
  })),
};

const LD_FAQ = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

/**
 * 配色：中性底 + 一個藍色重點色。
 *
 * 刻意**不用紅綠當品牌色**——台股的紅是漲、綠是跌，拿它們當介面色會讓人把版面
 * 讀成行情訊號。深淺兩套由 prefers-color-scheme 切換，沒有切換按鈕（那需要 JS）。
 */
const CSS = `
:root{
  --bg:#fcfcfb; --surface:#fff; --text:#17181a; --muted:#5f6570;
  --line:#e4e6e8; --accent:#2f5d8a; --soft:#eef3f8; --code:#f4f5f6;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#121416; --surface:#181b1e; --text:#e8eaec; --muted:#9aa1aa;
    --line:#282c31; --accent:#8ab6e2; --soft:#1a2430; --code:#1e2226;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--text);
  font:16px/1.75 system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;
  word-break:break-word;
}
.wrap{max-width:44rem;margin:0 auto;padding:3rem 1.25rem 5rem}
header{margin-bottom:3rem}
h1{font-size:1.9rem;line-height:1.35;margin:0 0 .6rem;letter-spacing:-.01em}
.lede{font-size:1.1rem;color:var(--muted);margin:0 0 1.75rem}
h2{font-size:1.2rem;margin:3rem 0 .9rem;letter-spacing:-.005em}
h3{font-size:1rem;margin:1.75rem 0 .4rem}
p,li{margin:.6rem 0}
ul{padding-left:1.2rem}
a{color:var(--accent)}
a:hover{text-decoration-thickness:2px}
code{background:var(--code);padding:.12em .38em;border-radius:4px;font-size:.9em}
pre{
  background:var(--code);border:1px solid var(--line);border-radius:8px;
  padding:.9rem 1rem;overflow-x:auto;margin:.75rem 0;
}
pre code{background:none;padding:0;font-size:.95rem}
.endpoint{border-color:var(--accent);background:var(--soft)}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.95rem;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--line);padding:.55rem .6rem;text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.85rem;letter-spacing:.02em}
.steps{counter-reset:s;list-style:none;padding:0}
.steps>li{counter-increment:s;position:relative;padding-left:2.2rem;margin:1.1rem 0}
.steps>li::before{
  content:counter(s);position:absolute;left:0;top:.15rem;
  width:1.55rem;height:1.55rem;border-radius:50%;
  background:var(--soft);color:var(--accent);border:1px solid var(--line);
  font-size:.85rem;font-weight:600;display:grid;place-items:center;
}
.note{border-left:3px solid var(--accent);background:var(--soft);padding:.75rem 1rem;margin:1.25rem 0;border-radius:0 6px 6px 0}
details{border-bottom:1px solid var(--line);padding:.35rem 0}
summary{cursor:pointer;padding:.6rem 0;font-weight:500}
summary::marker{color:var(--muted)}
details p{margin:.2rem 0 .9rem;color:var(--muted)}
footer{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
.langs{display:flex;gap:.9rem;flex-wrap:wrap;margin:.5rem 0 0;padding:0;list-style:none}
.attr{font-size:.85rem;line-height:1.7}
@media (max-width:32rem){ .wrap{padding:2rem 1rem 3.5rem} h1{font-size:1.55rem} }
`.trim();

function faqHtml(): string {
  return FAQ.map(
    (f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`,
  ).join("\n");
}

function shortcutRows(): string {
  return SHORTCUTS.map(
    (s) =>
      `<tr><td><code>${esc(s.name)}</code></td><td>${esc(s.what)}</td><td>${esc(s.arg)}</td></tr>`,
  ).join("\n");
}

export function renderHome(): string {
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="canonical" href="${SITE_ORIGIN}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${SITE_ORIGIN}/">
<meta property="og:locale" content="zh_TW">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESCRIPTION)}">
<meta name="robots" content="index,follow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%93%88%3C/text%3E%3C/svg%3E">
<link rel="alternate" type="text/markdown" href="${SITE_ORIGIN}/llms.txt" title="給 AI 讀的精簡版">
<script type="application/ld+json">${JSON.stringify(LD_SOFTWARE)}</script>
<script type="application/ld+json">${JSON.stringify(LD_HOWTO)}</script>
<script type="application/ld+json">${JSON.stringify(LD_FAQ)}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">

<header>
<h1>讓 AI 查得到真正的台股資料</h1>
<p class="lede"><strong>台股 MCP</strong> 是一個免費的遠端 MCP 伺服器，讓 Claude 等 AI 助理直接查詢臺灣證券交易所與臺灣期貨交易所的公開資料。不用安裝、不用註冊、不需要 API key——複製一個網址就好。</p>
<pre class="endpoint"><code>${MCP_ENDPOINT}</code></pre>
</header>

<h2 id="problem">這解決什麼問題</h2>
<p><strong>AI 講台股時會編數字。</strong>它們的訓練資料有時效，而且沒有連到交易所。問「0050 昨天收多少」，得到的可能是一個看起來很合理、但憑空生成的價格——而你無從分辨。這個服務讓 AI 去取<strong>交易所發布的原始開放資料</strong>，答案有出處。</p>
<p><strong>資料分散、名稱不直覺。</strong>證交所與期交所各有一套 OpenAPI，加起來 275 張報表，而命名對一般人幾乎無法搜尋——ETF 的主檔叫「基金基本資料彙總表」，搜「ETF」是找不到它的。這個服務把兩邊合併成一份可搜尋的目錄，讓 AI 自己找到對的那一張。</p>
<p><strong>不想寫程式，也不想申請什麼。</strong>沒有 API key、沒有註冊、沒有 SDK。貼一個網址，用中文問就好。</p>

<h2 id="install">一分鐘裝好</h2>
<h3>Claude（網頁版或桌面版）</h3>
<ol class="steps">
${INSTALL_STEPS.map((st) => `<li>${esc(st.text)}</li>`).join("\n")}
</ol>
<p>免費方案就能用。裝好後問一句「0050 現在多少？」，回得出具體價格就成功了。</p>

<h3>Claude Code、Codex 或其他支援遠端 MCP 的工具</h3>
<pre><code>claude mcp add twse --transport http ${MCP_ENDPOINT}</code></pre>
<pre><code>codex mcp add twse --url ${MCP_ENDPOINT}</code></pre>
<p>其他工具請選 <strong>Streamable HTTP</strong>（遠端 MCP），不要選舊的 SSE；不需要認證。</p>

<h2 id="shortcuts">三個現成的快捷入口</h2>
<p>它們跟著連接器自動出現，不用另外安裝。Claude Desktop 在「+」選單裡，Claude Code 輸入 <code>/</code> 就會列出來。</p>
<table>
<thead><tr><th>指令</th><th>做什麼</th><th>帶什麼</th></tr></thead>
<tbody>
${shortcutRows()}
</tbody>
</table>
<p>不用也沒關係——它們只是把常見問法先寫好，直接用中文問一樣有效。</p>

<h2 id="ask">可以問什麼</h2>
<ul>
<li>「台積電現在多少？」——盤中即時報價，一次問好幾檔也行。</li>
<li>「0050 昨天收盤多少、量多大？」——前一交易日的開高低收與成交量。</li>
<li>「0056 這檔 ETF 到底是什麼？」——追蹤哪個指數、多少人定期定額，還會提醒哪些數字不能當真。</li>
<li>「台指期昨天收在哪？」——期貨與選擇權的每日行情、三大法人、未平倉。</li>
<li>「交易所有沒有 ⋯⋯ 的資料？」——在兩百多張公開報表裡找到對的那一張。</li>
</ul>

<h2 id="scope">有些查得到，有些查不到</h2>
<div class="note">
<p style="margin:0"><strong>上櫃股票目前只有即時報價。</strong>歷史與統計報表取不到——證券櫃檯買賣中心的開放資料主機會拒絕來自雲端的連線。這是已知限制，寫在這裡免得你以為是查詢方式錯了。</p>
</div>
<ul>
<li><strong>上市股票與 ETF</strong>：即時報價、前一交易日價量、基本資料、定期定額熱度、財報與公司治理揭露。</li>
<li><strong>期貨與選擇權</strong>：每日行情、三大法人、大額交易人未沖銷部位、保證金、契約規格。</li>
<li><strong>不提供</strong>：技術指標、選股、投資建議，以及任何本服務自行計算的預測。</li>
</ul>

<h2 id="caveats">使用前先知道</h2>
<ul>
<li><strong>這是個人做的免費專案。</strong>盡量讓它一直開著，但可能偶爾限流、臨時維護，或日後換網址。</li>
<li><strong>即時報價是「盡量即時」。</strong>來自交易所的網頁介面，可能有幾秒到幾分鐘延遲，或與你的券商略有出入。</li>
<li><strong>其餘資料最多可能慢一小時</strong>（快取），且最新只到前一交易日。</li>
<li><strong>僅供參考，不是投資建議。</strong>下單前請自行向交易所或券商確認，盈虧自負。</li>
</ul>

<h2 id="faq">常見問題</h2>
${faqHtml()}

<h2 id="license">資料來源與授權</h2>
<p class="attr">
臺灣證券交易所 2026 臺灣證券交易所 OpenAPI<br>
金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS<br>
此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。<br>
政府資料開放授權條款：<a href="https://data.gov.tw/license">https://data.gov.tw/license</a>
</p>
<p class="attr"><strong>一個例外</strong>：盤中即時報價來自證交所基本市況報導站（<code>mis.twse.com.tw</code>），該站未登錄於政府資料開放平臺，不在上述授權範圍內。</p>
<p class="attr">本服務僅為代理與轉換，不對資料正確性負責；引用時請一併標示上述來源。</p>

<footer>
<p>開源專案，程式碼與問題回報都在 <a href="${REPO}">GitHub</a>。用起來覺得怪、查不到想要的資料，都歡迎<a href="${REPO}/issues">開一個 issue</a>。</p>
<ul class="langs">
<li><a href="${REPO}/blob/main/README.md">繁體中文</a></li>
<li><a href="${REPO}/blob/main/README.en.md">English</a></li>
<li><a href="${REPO}/blob/main/README.ja.md">日本語</a></li>
<li><a href="${REPO}/blob/main/README.ko.md">한국어</a></li>
<li><a href="${REPO}/blob/main/README.zh-CN.md">简体中文</a></li>
</ul>
</footer>

</div>
</body>
</html>
`;
}

/**
 * `/mcp` 對 GET 只會回 405，讓爬蟲去敲它沒有意義，所以 Disallow。
 * 這不是安全措施——robots.txt 不擋任何人，它只是省下無謂的抓取。
 */
export const ROBOTS_TXT = `# 完整說明見 ${SITE_ORIGIN}/llms.txt

User-agent: *
Allow: /
Disallow: /mcp

# 下面這些是明示，不是變更：上面的 * 已經允許它們。
# 寫出來是為了讓「我們歡迎 AI 引用這個服務」成為讀得到的意圖，而不是靠預設值推測。
# 這個服務本身就是給 AI 用的，攔住 AI 爬蟲會與它存在的理由矛盾。

# 檢索型（回答問題當下抓取並引用）
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
Allow: /
Disallow: /mcp

# 訓練型
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
Allow: /
Disallow: /mcp

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;

/**
 * `/llms.txt`——llmstxt.org 的約定：給大型語言模型讀的精簡版，H1 標題、blockquote
 * 一句話摘要，然後是分節連結。
 *
 * 它與 HTML 首頁的分工：首頁是給人看的，有排版與漸進揭露；這份是給機器讀的，
 * 每一行都自帶主詞、沒有指代、沒有「見上文」。答案引擎抽走任何一段都仍然完整。
 */
export const LLMS_TXT = `# 台股 MCP（twse-mcp）

> 台股 MCP 是一個免費的遠端 MCP（Model Context Protocol）伺服器，讓 Claude 等 AI 助理直接查詢臺灣證券交易所（TWSE）與臺灣期貨交易所（TAIFEX）的公開資料。使用者不需要安裝軟體、不需要註冊帳號、也不需要 API key。

## 連線方式

- 端點：${MCP_ENDPOINT}
- 傳輸：Streamable HTTP（遠端 MCP），2025 與 2026 兩代協定修訂版皆支援
- 認證：不需要
- 費用：免費。Claude 的免費方案即可加入自訂連接器。

## 能查什麼

${FEATURES.map((f) => `- ${f}`).join("\n")}

## 查不到什麼

- 上櫃（OTC）股票只有盤中即時報價；歷史與統計報表取不到，因為證券櫃檯買賣中心的開放資料主機會拒絕來自雲端的連線。
- 台股 MCP 不提供技術指標、選股或投資建議，也不做任何自行計算的預測。

## 資料新鮮度

- 盤中即時報價約每 5 秒更新，來源是證交所基本市況報導站，屬盡力而為。
- 其餘各類報表最新到前一交易日，並在邊緣快取一小時。

## 資料來源與授權

- 臺灣證券交易所 2026 臺灣證券交易所 OpenAPI
- 金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS
- 此開放資料依政府資料開放授權條款（Open Government Data License）進行公眾釋出：https://data.gov.tw/license
- 例外：盤中即時報價來自 mis.twse.com.tw，該站未登錄於政府資料開放平臺，不在上述授權範圍內。

## 延伸資料

- 官方首頁：${SITE_ORIGIN}/
- 原始碼與問題回報：${REPO}
- 安裝說明（繁體中文）：${REPO}/blob/main/README.md
- 安裝說明（English）：${REPO}/blob/main/README.en.md
- 授權查證紀錄：${REPO}/blob/main/docs/licensing-taifex.md
`;

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
