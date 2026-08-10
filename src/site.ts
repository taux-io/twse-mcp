/**
 * site.ts — 官方首頁（`/` 與 `/en`）、`robots.txt`、`sitemap.xml`、`llms.txt`。
 * ========================================================================
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
 * ## 兩個語系共用版型，各自寫文案
 *
 * 英文版不是翻譯層，是第二份文案——中文版對台灣散戶說話，英文版對 MCP 生態的
 * 開發者說話，兩者該強調的重點不同。共用的是**結構**：章節 id、FAQ 則數、安裝步驟、
 * 快捷指令都必須對齊，而 test/server.test.ts 有一組斷言守著。五份 README 已經
 * 證明過內容會悄悄漂移，`check-readmes` 就是為此存在的，這裡用同一招。
 *
 * OGDL 的顯名聲明**不翻譯**：條款要求的就是那組中文措辭，翻過去等於沒盡義務。
 * 英文版原樣附上並加一句說明為什麼——五份 README 也是這樣處理的。
 */

/** 對外正式網域。canonical、OG、sitemap 都以它為準，不從請求推導。 */
export const SITE_ORIGIN = "https://twse-mcp.taux.io";
/** 使用者唯一需要複製的東西。 */
export const MCP_ENDPOINT = `${SITE_ORIGIN}/mcp`;
const REPO = "https://github.com/taux-io/twse-mcp";

export type Locale = "zh" | "en";

/** 語系表。hreflang、語言切換連結、sitemap 都從這裡長出來，不各寫一份。 */
const LOCALES: Record<Locale, { path: string; lang: string; hreflang: string; label: string }> = {
  zh: { path: "/", lang: "zh-Hant-TW", hreflang: "zh-Hant", label: "繁體中文" },
  en: { path: "/en", lang: "en", hreflang: "en", label: "English" },
};

/**
 * 章節 id。兩個語系必須用同一組——答案引擎會引用到某一節，跨語系錨點一致才對得起來。
 * 用 ASCII slug 而不是標題的百分比編碼，後者被複製貼上時會爛掉。
 */
const SECTION_IDS = [
  "problem",
  "install",
  "shortcuts",
  "ask",
  "scope",
  "caveats",
  "faq",
  "license",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

/**
 * 實體消歧。`sameAs` 指向官方網址，是讓搜尋與答案引擎確定「臺灣證券交易所」是**哪一個**
 * 機構、而不是從字面猜的最強訊號。這對本服務特別重要：它的價值主張就是「資料出自這兩個
 * 機構」，引擎認不出機構，那句話就沒有分量。跨語系共用，機構本身與語言無關。
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
    alternateName: "data.gov.tw",
    sameAs: ["https://data.gov.tw/"],
  },
];

/** 三個快捷指令。名稱是英文識別字，跨語系共用；說明各寫各的。 */
const SHORTCUT_NAMES = ["find_dataset", "etf_overview", "futures_quote"] as const;
type ShortcutName = (typeof SHORTCUT_NAMES)[number];

/** OGDL 顯名聲明。**不翻譯**——條款要求的就是這組措辭。 */
const ATTRIBUTION_ZH = [
  "臺灣證券交易所 2026 臺灣證券交易所 OpenAPI",
  "金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS",
  "此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，" +
    "使用者於遵守本條款各項規定之前提下，得利用之。",
];

interface Page {
  title: string;
  description: string;
  h1: string;
  /** 首句必須自帶主詞：答案引擎抽走它時要能獨立成立。 */
  lede: string;
  features: string[];
  installSteps: { name: string; text: string }[];
  shortcuts: Record<ShortcutName, { what: string; arg: string }>;
  faq: { q: string; a: string }[];
  headings: Record<SectionId, string>;
  /** 純散文章節的本文（HTML）。結構性章節由 render 產生，這裡留空字串。 */
  body: Record<SectionId, string>;
  ui: {
    shortcutCols: [string, string, string];
    installPrimary: string;
    otherTools: string;
    transportNote: string;
    verify: string;
    shortcutIntro: string;
    shortcutOutro: string;
    licenceLabel: string;
    attributionKeptInChinese: string;
    exception: string;
    disclaimer: string;
    footerLead: string;
    footerIssue: string;
    howToName: string;
    howToDesc: string;
    otherLangLabel: string;
  };
}

const ZH: Page = {
  title: "台股 MCP｜讓 AI 查台灣證交所與期交所的公開資料",
  description:
    "免費的遠端 MCP 伺服器，讓 Claude 等 AI 助理直接查詢台股即時報價、ETF 資料、" +
    "期貨選擇權行情與臺灣證交所、期交所的 275 個公開資料集。不用安裝、不用註冊，貼一個網址就能用。",
  h1: "讓 AI 查得到真正的台股資料",
  lede:
    "<strong>台股 MCP</strong> 是一個免費的遠端 MCP 伺服器，讓 Claude 等 AI 助理直接查詢" +
    "臺灣證券交易所與臺灣期貨交易所的公開資料。不用安裝、不用註冊、不需要 API key——複製一個網址就好。",
  features: [
    "台股上市股票與 ETF 的盤中即時報價",
    "前一交易日的開盤、最高、最低、收盤與成交量",
    "單一 ETF 的基本資料、追蹤指數與定期定額熱度",
    "臺灣期貨交易所的每日行情、三大法人與大額交易人未沖銷部位",
    "臺灣證交所與期交所合計 275 個公開資料集的搜尋與查詢",
  ],
  installSteps: [
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
  ],
  shortcuts: {
    find_dataset: {
      what: "不知道該查哪張表時，用關鍵字找出對的那一個",
      arg: "關鍵字，例如「三大法人」",
    },
    etf_overview: {
      what: "一次看完一檔上市 ETF 的基本資料、前一交易日價量與定期定額熱度",
      arg: "ETF 代號，例如 0056",
    },
    futures_quote: { what: "查期貨或選擇權的每日行情", arg: "契約代號，例如 TX" },
  },
  faq: [
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
  ],
  headings: {
    problem: "這解決什麼問題",
    install: "一分鐘裝好",
    shortcuts: "三個現成的快捷入口",
    ask: "可以問什麼",
    scope: "有些查得到，有些查不到",
    caveats: "使用前先知道",
    faq: "常見問題",
    license: "資料來源與授權",
  },
  body: {
    problem: `
<p><strong>AI 講台股時會編數字。</strong>它們的訓練資料有時效，而且沒有連到交易所。問「0050 昨天收多少」，得到的可能是一個看起來很合理、但憑空生成的價格——而你無從分辨。台股 MCP 讓 AI 去取<strong>交易所發布的原始開放資料</strong>，答案有出處。</p>
<p><strong>資料分散、名稱不直覺。</strong>證交所與期交所各有一套 OpenAPI，加起來 275 張報表，而命名對一般人幾乎無法搜尋——ETF 的主檔叫「基金基本資料彙總表」，搜「ETF」是找不到它的。台股 MCP 把兩邊合併成一份可搜尋的目錄，讓 AI 自己找到對的那一張。</p>
<p><strong>不想寫程式，也不想申請什麼。</strong>沒有 API key、沒有註冊、沒有 SDK。貼一個網址，用中文問就好。</p>`,
    ask: `
<ul>
<li>「台積電現在多少？」——盤中即時報價，一次問好幾檔也行。</li>
<li>「0050 昨天收盤多少、量多大？」——前一交易日的開高低收與成交量。</li>
<li>「0056 這檔 ETF 到底是什麼？」——追蹤哪個指數、多少人定期定額，還會提醒哪些數字不能當真。</li>
<li>「台指期昨天收在哪？」——期貨與選擇權的每日行情、三大法人、未平倉。</li>
<li>「交易所有沒有 ⋯⋯ 的資料？」——在兩百多張公開報表裡找到對的那一張。</li>
</ul>`,
    scope: `
<div class="note">
<p><strong>上櫃股票目前只有即時報價。</strong>歷史與統計報表取不到——證券櫃檯買賣中心的開放資料主機會拒絕來自雲端的連線。這是已知限制，寫在這裡免得你以為是查詢方式錯了。</p>
</div>
<ul>
<li><strong>上市股票與 ETF</strong>：即時報價、前一交易日價量、基本資料、定期定額熱度、財報與公司治理揭露。</li>
<li><strong>期貨與選擇權</strong>：每日行情、三大法人、大額交易人未沖銷部位、保證金、契約規格。</li>
<li><strong>不提供</strong>：技術指標、選股、投資建議，以及任何本服務自行計算的預測。</li>
</ul>`,
    caveats: `
<ul>
<li><strong>這是個人做的免費專案。</strong>盡量讓它一直開著，但可能偶爾限流、臨時維護，或日後換網址。</li>
<li><strong>即時報價是「盡量即時」。</strong>來自交易所的網頁介面，可能有幾秒到幾分鐘延遲，或與你的券商略有出入。</li>
<li><strong>其餘資料最多可能慢一小時</strong>（快取），且最新只到前一交易日。</li>
<li><strong>僅供參考，不是投資建議。</strong>下單前請自行向交易所或券商確認，盈虧自負。</li>
</ul>`,
    install: "",
    shortcuts: "",
    faq: "",
    license: "",
  },
  ui: {
    shortcutCols: ["指令", "做什麼", "帶什麼"],
    installPrimary: "Claude（網頁版或桌面版）",
    otherTools: "Claude Code、Codex 或其他支援遠端 MCP 的工具",
    transportNote:
      "其他工具請選 <strong>Streamable HTTP</strong>（遠端 MCP），不要選舊的 SSE；不需要認證。",
    verify: "免費方案就能用。裝好後問一句「0050 現在多少？」，回得出具體價格就成功了。",
    shortcutIntro:
      "它們跟著連接器自動出現，不用另外安裝。Claude Desktop 在「+」選單裡，Claude Code 輸入 <code>/</code> 就會列出來。",
    shortcutOutro: "不用也沒關係——它們只是把常見問法先寫好，直接用中文問一樣有效。",
    licenceLabel: "政府資料開放授權條款",
    attributionKeptInChinese: "",
    exception:
      "<strong>一個例外</strong>：盤中即時報價來自證交所基本市況報導站（<code>mis.twse.com.tw</code>），該站未登錄於政府資料開放平臺，不在上述授權範圍內。",
    disclaimer: "本服務僅為代理與轉換，不對資料正確性負責；引用時請一併標示上述來源。",
    footerLead: "開源專案，程式碼與問題回報都在",
    footerIssue: "。用起來覺得怪、查不到想要的資料，都歡迎開一個 issue。",
    howToName: "如何在 Claude 裡安裝台股 MCP",
    howToDesc: "把台股 MCP 加進 Claude 的自訂連接器，約需一分鐘，不需要帳號或付費。",
    otherLangLabel: "其他語言的完整說明",
  },
};

const EN: Page = {
  title: "Taiwan Stock MCP | TWSE and TAIFEX data for AI",
  // 長度是為搜尋結果片段抓的：Google 大約 155 字元就截斷，超過的部分等於白寫。
  // test/server.test.ts 有守衛，改文案時會擋下超長。
  description:
    "Free remote MCP server. Let Claude query Taiwan stock quotes, ETF data, futures and " +
    "options, and 275 TWSE/TAIFEX open datasets. No install, no signup.",
  h1: "Give your AI real Taiwan market data",
  lede:
    "<strong>Taiwan Stock MCP</strong> is a free remote MCP server that lets Claude and other AI " +
    "assistants query open data published by the Taiwan Stock Exchange (TWSE) and the Taiwan Futures " +
    "Exchange (TAIFEX). No install, no signup, no API key — just paste one URL.",
  features: [
    "Intraday quotes for TWSE-listed stocks and ETFs",
    "Previous trading day's open, high, low, close and volume",
    "Per-ETF profile, tracked index and regular-savings popularity",
    "TAIFEX daily futures and options quotes, institutional flows and large-trader open interest",
    "Search and query across 275 open datasets from TWSE and TAIFEX combined",
  ],
  installSteps: [
    {
      name: "Open connector settings",
      text: "In Claude on the web or desktop, click your name in the bottom-left corner, choose Settings, then Connectors in the left-hand menu.",
    },
    {
      name: "Add a custom connector",
      text: `Click "+ Add custom connector". Name it anything you like, set the URL to ${MCP_ENDPOINT}, then click Add.`,
    },
    {
      name: "Switch it on in a chat",
      text: 'Go back to the chat, start a new conversation, click the "+" next to the message box, choose Connectors, and switch on the one you just added.',
    },
  ],
  shortcuts: {
    find_dataset: {
      what: "Finds the right dataset when you do not know which one to use",
      arg: 'A keyword, e.g. "institutional investors"',
    },
    etf_overview: {
      what: "Profile, previous trading day's prices and regular-savings popularity for one listed ETF",
      arg: "An ETF code, e.g. 0056",
    },
    futures_quote: { what: "Daily futures or options quotes", arg: "A contract code, e.g. TX" },
  },
  faq: [
    {
      q: "Is it free? Do I need an account or an API key?",
      a: "None of those. The service is public and free, no account is required, and Claude's free plan can add it. The data comes from Taiwan's government open-data platform; this service only reshapes it into something an AI can query.",
    },
    {
      q: "Can it look up over-the-counter (TPEx) stocks?",
      a: 'Intraday quotes only — pass the market as "otc". Historical and statistical reports for OTC listings are not available: the Taipei Exchange open-data host refuses connections originating from cloud providers. That is a known limitation, not an oversight.',
    },
    {
      q: "Is the data real-time?",
      a: "Intraday quotes refresh roughly every 5 seconds and come from the exchange's market-information site on a best-effort basis. Everything else is current to the previous trading day and is cached for an hour so the exchange is not hammered.",
    },
    {
      q: "Does it cover futures and options?",
      a: "Yes. All 132 TAIFEX datasets are included: daily quotes, institutional investor flows, large-trader open interest, margin requirements and contract specifications.",
    },
    {
      q: "Is this investment advice?",
      a: "No. Figures may be wrong, delayed, or changed upstream. Verify with the exchange or your broker before trading; you carry the risk.",
    },
    {
      q: "Are my questions logged?",
      a: "No. The service only fetches public data on your behalf. It currently records which AI client and protocol version connect, so we can tell how many callers still use the older protocol — never the content of your questions — and that measurement will be removed once it is done.",
    },
  ],
  headings: {
    problem: "What it solves",
    install: "Set up in a minute",
    shortcuts: "Three ready-made shortcuts",
    ask: "What you can ask",
    scope: "What it covers, and what it does not",
    caveats: "Before you rely on it",
    faq: "Frequently asked questions",
    license: "Data source and licence",
  },
  body: {
    problem: `
<p><strong>AI assistants make up Taiwan market numbers.</strong> Their training data has a cutoff and they are not wired to any exchange. Ask "where did 0050 close yesterday" and you may get a plausible-looking price that was invented — with nothing to tell the two apart. Taiwan Stock MCP makes the assistant fetch <strong>the exchange's own published open data</strong>, so the answer has a source.</p>
<p><strong>The data is split across two APIs and named unsearchably.</strong> TWSE and TAIFEX each publish their own OpenAPI; together that is 275 reports whose names defeat keyword search — the ETF master table is called 「基金基本資料彙總表」 (fund master data), so searching "ETF" never finds it. Taiwan Stock MCP merges both into one searchable catalogue so the assistant can locate the right table itself.</p>
<p><strong>No code, no paperwork.</strong> There is no API key, no registration and no SDK. Paste a URL and ask in plain language — Chinese or English.</p>`,
    ask: `
<ul>
<li>"What's TSMC trading at right now?" — intraday quotes, several tickers at once.</li>
<li>"Where did 0050 close yesterday, and on what volume?" — the previous session's open, high, low, close and volume.</li>
<li>"What exactly is the ETF 0056?" — which index it tracks, how popular it is for regular savings, plus which figures not to take at face value.</li>
<li>"Where did the TAIEX futures settle yesterday?" — daily futures and options quotes, institutional flows, open interest.</li>
<li>"Does the exchange publish data on …?" — finds the right one among two hundred-plus public reports.</li>
</ul>`,
    scope: `
<div class="note">
<p><strong>OTC (TPEx) stocks currently have intraday quotes only.</strong> Historical and statistical reports are unavailable because the Taipei Exchange open-data host refuses cloud-originated connections. Stated here so you do not assume you phrased the query wrong.</p>
</div>
<ul>
<li><strong>Listed stocks and ETFs</strong>: intraday quotes, previous-day prices and volume, profiles, regular-savings popularity, financial statements and governance disclosures.</li>
<li><strong>Futures and options</strong>: daily quotes, institutional investor flows, large-trader open interest, margins, contract specifications.</li>
<li><strong>Not provided</strong>: technical indicators, stock screening, investment advice, or any figure this service computes on its own.</li>
</ul>`,
    caveats: `
<ul>
<li><strong>This is a free personal project.</strong> It is kept running as much as possible, but expect occasional rate limits, brief maintenance, or a future change of address.</li>
<li><strong>"Real-time" quotes are best-effort.</strong> They come from the exchange's web interface and may lag by seconds to minutes, or differ slightly from your broker's screen.</li>
<li><strong>Everything else can be up to an hour stale</strong> (cached) and is current only to the previous trading day.</li>
<li><strong>Reference only, not investment advice.</strong> Verify with the exchange or your broker before trading; you carry the risk.</li>
</ul>`,
    install: "",
    shortcuts: "",
    faq: "",
    license: "",
  },
  ui: {
    shortcutCols: ["Command", "What it does", "What to pass"],
    installPrimary: "Claude (web or desktop)",
    otherTools: "Claude Code, Codex, or any other tool that supports remote MCP",
    transportNote:
      "For any other tool, choose <strong>Streamable HTTP</strong> (remote MCP) rather than the older SSE transport. No authentication is needed.",
    verify:
      'The free plan is enough. Once it is on, ask "what is 0050 trading at?" — a concrete price means it worked.',
    shortcutIntro:
      'They appear automatically with the connector; nothing extra to install. In Claude Desktop they are in the "+" menu; in Claude Code, type <code>/</code> to list them.',
    shortcutOutro:
      "You do not have to use them — they only pre-write common phrasings. Asking in plain language works just as well.",
    licenceLabel: "Open Government Data License",
    attributionKeptInChinese:
      "The attribution above is reproduced in its original Chinese wording. The Open Government Data License requires that exact form of notice, so translating it would not satisfy the obligation.",
    exception:
      "<strong>One exception</strong>: intraday quotes come from the exchange's market-information site (<code>mis.twse.com.tw</code>), which is not registered on the government open-data platform and therefore falls outside the licence above.",
    disclaimer:
      "This service only proxies and reshapes the data; it makes no warranty as to accuracy. Please carry the attribution above when you cite it.",
    footerLead: "Open source. Code and issue tracker are on",
    footerIssue:
      ". If something looks wrong, or you cannot find the data you need, please open an issue.",
    howToName: "How to install Taiwan Stock MCP in Claude",
    howToDesc:
      "Add Taiwan Stock MCP as a custom connector in Claude. It takes about a minute and needs no account or payment.",
    otherLangLabel: "Full documentation in other languages",
  },
};

const PAGES: Record<Locale, Page> = { zh: ZH, en: EN };

/** HTML 逸出。內容全是靜態常數，但逸出讓「日後有人接上動態資料」不會變成漏洞。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
.wrap{max-width:44rem;margin:0 auto;padding:2rem 1.25rem 5rem}
.switch{display:flex;justify-content:flex-end;margin:0 0 1.5rem;font-size:.85rem}
header{margin-bottom:3rem}
h1{font-size:1.9rem;line-height:1.35;margin:0 0 .6rem;letter-spacing:-.01em;text-wrap:balance}
.lede{font-size:1.1rem;color:var(--muted);margin:0 0 1.75rem}
h2{font-size:1.2rem;margin:3rem 0 .9rem;letter-spacing:-.005em}
h3{font-size:1rem;margin:1.75rem 0 .4rem}
p,li{margin:.6rem 0}
ul{padding-left:1.2rem}
a{color:var(--accent)}
a:hover{text-decoration-thickness:2px}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
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
.note{border-left:3px solid var(--accent);background:var(--soft);padding:.1rem 1rem;margin:1.25rem 0;border-radius:0 6px 6px 0}
details{border-bottom:1px solid var(--line);padding:.35rem 0}
summary{cursor:pointer;padding:.6rem 0;font-weight:500}
summary::marker{color:var(--muted)}
details p{margin:.2rem 0 .9rem;color:var(--muted)}
footer{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
.langs{display:flex;gap:.9rem;flex-wrap:wrap;margin:.5rem 0 0;padding:0;list-style:none}
.attr{font-size:.85rem;line-height:1.7}
@media (max-width:32rem){ .wrap{padding:1.5rem 1rem 3.5rem} h1{font-size:1.55rem} }
`.trim();

function ldSoftware(loc: Locale, p: Page) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: loc === "zh" ? "台股 MCP（twse-mcp）" : "Taiwan Stock MCP (twse-mcp)",
    alternateName: ["twse-mcp", "台股 MCP", "Taiwan Stock MCP"],
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Model Context Protocol Server",
    operatingSystem: "Any",
    url: SITE_ORIGIN + LOCALES[loc].path,
    description: p.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses/MIT",
    codeRepository: REPO,
    sameAs: [REPO],
    inLanguage: loc === "zh" ? "zh-Hant-TW" : "en",
    featureList: p.features,
    mentions: ENTITIES,
  };
}

function ldHowTo(loc: Locale, p: Page) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: p.ui.howToName,
    description: p.ui.howToDesc,
    totalTime: "PT1M",
    tool: [{ "@type": "HowToTool", name: p.ui.installPrimary }],
    step: p.installSteps.map((st, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: st.name,
      text: st.text,
      url: `${SITE_ORIGIN}${LOCALES[loc].path}#install`,
    })),
  };
}

function ldFaq(p: Page) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function installHtml(p: Page): string {
  return `
<h3>${esc(p.ui.installPrimary)}</h3>
<ol class="steps">
${p.installSteps.map((st) => `<li>${esc(st.text)}</li>`).join("\n")}
</ol>
<p>${esc(p.ui.verify)}</p>

<h3>${esc(p.ui.otherTools)}</h3>
<pre><code>claude mcp add twse --transport http ${MCP_ENDPOINT}</code></pre>
<pre><code>codex mcp add twse --url ${MCP_ENDPOINT}</code></pre>
<p>${p.ui.transportNote}</p>`;
}

function shortcutsHtml(p: Page): string {
  const rows = SHORTCUT_NAMES.map((n) => {
    const s = p.shortcuts[n];
    return `<tr><td><code>${n}</code></td><td>${esc(s.what)}</td><td>${esc(s.arg)}</td></tr>`;
  }).join("\n");
  return `
<p>${p.ui.shortcutIntro}</p>
<table>
<thead><tr>${p.ui.shortcutCols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p>${esc(p.ui.shortcutOutro)}</p>`;
}

function faqHtml(p: Page): string {
  return p.faq
    .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("\n");
}

function licenseHtml(p: Page): string {
  const kept = p.ui.attributionKeptInChinese
    ? `<p class="attr">${esc(p.ui.attributionKeptInChinese)}</p>`
    : "";
  return `
<p class="attr">
${ATTRIBUTION_ZH.map(esc).join("<br>\n")}<br>
${esc(p.ui.licenceLabel)}：<a href="https://data.gov.tw/license">https://data.gov.tw/license</a>
</p>
${kept}
<p class="attr">${p.ui.exception}</p>
<p class="attr">${esc(p.ui.disclaimer)}</p>`;
}

function sectionHtml(p: Page, id: SectionId): string {
  const structural: Partial<Record<SectionId, string>> = {
    install: installHtml(p),
    shortcuts: shortcutsHtml(p),
    faq: faqHtml(p),
    license: licenseHtml(p),
  };
  return `<h2 id="${id}">${esc(p.headings[id])}</h2>${structural[id] ?? p.body[id]}`;
}

export function renderPage(loc: Locale): string {
  const p = PAGES[loc];
  const me = LOCALES[loc];
  const other: Locale = loc === "zh" ? "en" : "zh";
  const canonical = `${SITE_ORIGIN}${me.path}`;
  // hreflang 要把**全部**版本列出來（含自己）並指定 x-default，否則搜尋引擎只看到
  // 單向宣告而不採信。x-default 給中文版：主要使用者在台灣。
  const alternates = (Object.keys(LOCALES) as Locale[])
    .map(
      (l) =>
        `<link rel="alternate" hreflang="${LOCALES[l].hreflang}" href="${SITE_ORIGIN}${LOCALES[l].path}">`,
    )
    .concat(`<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/">`)
    .join("\n");

  return `<!doctype html>
<html lang="${me.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${canonical}">
${alternates}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="${loc === "zh" ? "zh_TW" : "en_US"}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="robots" content="index,follow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%93%88%3C/text%3E%3C/svg%3E">
<link rel="alternate" type="text/markdown" href="${SITE_ORIGIN}/llms.txt" title="Plain-text summary for AI">
<script type="application/ld+json">${JSON.stringify(ldSoftware(loc, p))}</script>
<script type="application/ld+json">${JSON.stringify(ldHowTo(loc, p))}</script>
<script type="application/ld+json">${JSON.stringify(ldFaq(p))}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">

<nav class="switch"><a href="${SITE_ORIGIN}${LOCALES[other].path}" hreflang="${LOCALES[other].hreflang}">${esc(LOCALES[other].label)}</a></nav>

<header>
<h1>${esc(p.h1)}</h1>
<p class="lede">${p.lede}</p>
<pre class="endpoint"><code>${MCP_ENDPOINT}</code></pre>
</header>

${SECTION_IDS.map((id) => sectionHtml(p, id)).join("\n")}

<footer>
<p>${esc(p.ui.footerLead)} <a href="${REPO}">GitHub</a>${esc(p.ui.footerIssue)}</p>
<p>${esc(p.ui.otherLangLabel)}：</p>
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
 * `/llms.txt`——llmstxt.org 的約定：給大型語言模型讀的精簡版。
 *
 * 與 HTML 首頁的分工是「人 vs 機器」：首頁有排版與漸進揭露，這份每一行都自帶主詞、
 * 沒有指代、沒有「見上文」，答案引擎抽走任何一段都仍然完整。
 *
 * **雙語並列，不是選一種。** 答案引擎回答中文問題時需要中文句子可引用，回答英文問題
 * 時需要英文句子。這是機器讀的檔案，多一份的成本只是位元組。
 */
export const LLMS_TXT = `# Taiwan Stock MCP / 台股 MCP (twse-mcp)

> Taiwan Stock MCP is a free remote MCP (Model Context Protocol) server that lets Claude and other AI assistants query open data published by the Taiwan Stock Exchange (TWSE) and the Taiwan Futures Exchange (TAIFEX). It requires no installation, no account and no API key.
> 台股 MCP 是一個免費的遠端 MCP 伺服器，讓 Claude 等 AI 助理直接查詢臺灣證券交易所（TWSE）與臺灣期貨交易所（TAIFEX）的公開資料。使用者不需要安裝軟體、不需要註冊帳號、也不需要 API key。

## Connection / 連線方式

- Endpoint / 端點：${MCP_ENDPOINT}
- Transport / 傳輸：Streamable HTTP (remote MCP). Both the 2025 and 2026 protocol revisions are supported.
- Authentication / 認證：none required / 不需要
- Cost / 費用：free; Claude's free plan can add it as a custom connector. 免費，Claude 免費方案即可加入。

## What it can answer

${EN.features.map((f) => `- ${f}`).join("\n")}

## 能查什麼

${ZH.features.map((f) => `- ${f}`).join("\n")}

## Limits / 查不到什麼

- Over-the-counter (TPEx) stocks have intraday quotes only; historical and statistical reports are unavailable because the Taipei Exchange open-data host refuses cloud-originated connections.
- 上櫃（OTC）股票只有盤中即時報價；歷史與統計報表取不到，因為證券櫃檯買賣中心的開放資料主機會拒絕來自雲端的連線。
- Taiwan Stock MCP does not provide technical indicators, stock screening or investment advice, and computes no forecasts of its own.
- 台股 MCP 不提供技術指標、選股或投資建議，也不做任何自行計算的預測。

## Freshness / 資料新鮮度

- Intraday quotes refresh roughly every 5 seconds, sourced from the exchange's market-information site, best-effort.
- Every other report is current to the previous trading day and cached at the edge for one hour.
- 盤中即時報價約每 5 秒更新，來源是證交所基本市況報導站，屬盡力而為；其餘報表最新到前一交易日，並在邊緣快取一小時。

## Licence / 資料來源與授權

- 臺灣證券交易所 2026 臺灣證券交易所 OpenAPI
- 金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS
- 此開放資料依政府資料開放授權條款（Open Government Data License）進行公眾釋出：https://data.gov.tw/license
- The attribution above is kept in its original Chinese wording because the licence requires that exact form of notice.
- Exception / 例外：intraday quotes come from mis.twse.com.tw, which is not registered on the government open-data platform and falls outside the licence above.

## Pages / 延伸資料

- Homepage (Traditional Chinese) / 官方首頁：${SITE_ORIGIN}/
- Homepage (English)：${SITE_ORIGIN}/en
- Source code and issue tracker / 原始碼與問題回報：${REPO}
- Setup guide (Traditional Chinese)：${REPO}/blob/main/README.md
- Setup guide (English)：${REPO}/blob/main/README.en.md
- Licence verification record / 授權查證紀錄：${REPO}/blob/main/docs/licensing-taifex.md
`;

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
 * 兩個語系都列，並互相宣告 xhtml:link——sitemap 是 hreflang 的第二個載體，
 * 而 Google 明確要求兩處宣告必須一致。
 */
export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${(Object.keys(LOCALES) as Locale[])
  .map(
    (l) => `  <url>
    <loc>${SITE_ORIGIN}${LOCALES[l].path}</loc>
${(Object.keys(LOCALES) as Locale[])
  .map(
    (o) =>
      `    <xhtml:link rel="alternate" hreflang="${LOCALES[o].hreflang}" href="${SITE_ORIGIN}${LOCALES[o].path}"/>`,
  )
  .join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/"/>
    <changefreq>monthly</changefreq>
    <priority>${l === "zh" ? "1.0" : "0.9"}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
