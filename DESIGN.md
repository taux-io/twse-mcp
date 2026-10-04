---
name: Taiwan Market Open Data (Unofficial)
description: 安靜、可信的交易所公告欄：中性底色，一個港灣藍重點色，只講事實
colors:
  harbour-blue: "#2f5d8a"
  harbour-blue-night: "#8ab6e2"
  harbour-mist: "#eef3f8"
  harbour-mist-night: "#1a2430"
  paper: "#fcfcfb"
  paper-night: "#121416"
  sheet: "#ffffff"
  sheet-night: "#181b1e"
  ink: "#17181a"
  ink-night: "#e8eaec"
  pencil: "#5f6570"
  pencil-night: "#9aa1aa"
  rule-line: "#e4e6e8"
  rule-line-night: "#282c31"
  code-well: "#f4f5f6"
  code-well-night: "#1e2226"
typography:
  display:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1.9rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  display-narrow:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1.55rem"
    fontWeight: 700
    lineHeight: 1.35
  headline:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    letterSpacing: "-0.005em"
  title:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1rem"
    fontWeight: 700
  lede:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "1.1rem"
    fontWeight: 400
  body:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    letterSpacing: "0.02em"
  small:
    fontFamily: "system-ui, -apple-system, \"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
  code:
    fontSize: "0.95rem"
rounded:
  focus: "2px"
  code: "4px"
  control: "6px"
  well: "8px"
  pill: "999px"
spacing:
  gutter: "1.25rem"
  gutter-mobile: "1rem"
  section: "3rem"
  measure: "44rem"
components:
  endpoint-block:
    backgroundColor: "{colors.harbour-mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.well}"
    padding: "0.9rem 2.9rem 0.9rem 1rem"
  code-block:
    backgroundColor: "{colors.code-well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.well}"
    padding: "0.9rem 1rem"
  copy-button:
    textColor: "{colors.pencil}"
    rounded: "{rounded.control}"
    size: "2rem"
  copy-button-hover:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.harbour-blue}"
  language-switch:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.pencil}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.8rem"
  language-switch-hover:
    textColor: "{colors.harbour-blue}"
  step-marker:
    backgroundColor: "{colors.harbour-mist}"
    textColor: "{colors.harbour-blue}"
    size: "1.55rem"
  note:
    backgroundColor: "{colors.harbour-mist}"
    textColor: "{colors.ink}"
    padding: "0.1rem 1rem"
---

# Design System: Taiwan Market Open Data (Unofficial)

## Overview

**Creative North Star: "交易所公告欄"（The Exchange Notice Board）**

首頁讀起來像一張貼在公告欄上的通知：

- 白紙黑字、單欄、由上往下讀。
- 唯一的顏色用來指路（連結、步驟、要複製的網址）。

讀者是不寫程式的一般投資人。他們只為一件事而來：把 connector 加進自己的 AI。所以版面上的一切都要讓這件事顯得簡單、可信。

這個系統刻意「不像行情」：

- 不用紅綠（台股紅漲綠跌，用了會被讀成漲跌訊號）。
- 不用 K 線或儀表板語彙，不做任何讓人聯想到即時看盤的裝飾。

這個服務也是非官方的，所以設計不借用交易所的配色、標誌或制式外觀。

版面平面、無陰影，深淺兩套主題由系統設定自動切換，沒有切換按鈕。

**Key Characteristics:**

- 單欄閱讀版面，寬 44rem。
- 中性紙色底，搭配一個港灣藍重點色。
- 系統字體，不另外載入任何字型檔。
- 層次靠細線與淡藍底塊表現，不靠陰影。
- 深淺主題完全由 `prefers-color-scheme` 決定。

## Colors

整套配色是中性灰階，加上一個沉穩的港灣藍；藍色只在需要指路的地方出現。

### Primary

- **港灣藍 Harbour Blue**（`harbour-blue`；深色模式用 `harbour-blue-night`）：
  - 用在連結、焦點外框、步驟編號、複製按鈕的 hover 與完成狀態、`.note` 左側的直線、connector 網址區塊的邊框。
  - 頁面上的「可以點、要注意」都由它表示。
- **港灣霧 Harbour Mist**（`harbour-mist`；深色模式用 `harbour-mist-night`）：港灣藍的淡底。用在 connector 網址區塊、步驟編號圓圈、提示框的底色。

### Neutral

- **紙 Paper**（`paper` / `paper-night`）：頁面底色，比純白暖一點點。
- **紙卡 Sheet**（`sheet` / `sheet-night`）：浮在頁面上的小元件底色，例如語言切換膠囊、複製按鈕的 hover。
- **墨 Ink**（`ink` / `ink-night`）：正文與標題。
- **鉛筆 Pencil**（`pencil` / `pencil-night`）：用在以下地方：
  - 導言與頁尾；
  - 表頭；
  - FAQ 的答案；
  - 未啟用的控制項。
- **格線 Rule Line**（`rule-line` / `rule-line-night`）：表格分隔線、FAQ 分隔線、頁尾上方的線、程式碼區塊的邊框。
- **程式碼井 Code Well**（`code-well` / `code-well-night`）：行內程式碼與程式碼區塊的底色。

### Named Rules

**The No Red-Green Rule.** 介面上永遠不出現紅色或綠色。即使是成功、錯誤這類狀態，也用港灣藍與文字表達，不靠紅綠。

**The One Voice Rule.** 港灣藍是唯一的彩度來源。要新增顏色前，先問：能不能用港灣藍、港灣霧，或一條格線解決？

**The Paired Token Rule.** 每個顏色都有對應的 `-night` 版本，兩者同時新增、同時修改，不能只做淺色版。

## Typography

**Display Font:** 系統字體（system-ui、-apple-system），中文退回 Noto Sans TC、PingFang TC、Microsoft JhengHei
**Body Font:** 同上
**Label/Mono Font:** 程式碼用瀏覽器預設的等寬字體

**Character:** 只用作業系統內建的字體，載入零成本，中英文都穩定。這套系統的個性來自行距與留白，而不是字體本身。

### Hierarchy

- **Display**（粗體，1.9rem，行高 1.35，字距 -0.01em，`text-wrap: balance`）：只用於頁面 h1。窄螢幕（32rem 以下）縮成 1.55rem。
- **Lede**（一般字重，1.1rem，鉛筆色）：h1 下方的一句導言。
- **Headline**（粗體，1.2rem）：各節的 h2，上方留 3rem。
- **Title**（粗體，1rem）：節內的小標 h3。
- **Body**（一般字重，16px，行高 1.75）：正文。行距特別寬，是為了讓中文長段落好讀；行長由 44rem 的欄寬限制。
- **Label**（600 字重，0.85rem，字距 0.02em，鉛筆色）：表頭、語言切換、步驟編號裡的數字、網址區塊上方的動作說明。
- **Small**（一般字重，0.9rem）：表格內文與頁尾。
- **Code**（0.95rem，等寬）：程式碼區塊與網址區塊裡的網址。

### Named Rules

**The System Font Rule.** 不載入任何網頁字型。首頁要輕（見 PRODUCT.md），字型檔也算重量。

**The Generous Leading Rule.** 正文行高維持 1.75。中文段落壓緊了就難讀。

## Layout

- 單欄，置中，最大寬度 44rem（`measure`）。
- 內距：上 2rem，左右 1.25rem，下 5rem。32rem 以下的窄螢幕改成 1.5rem / 1rem / 3.5rem。
- 節與節之間靠 h2 上方的 3rem 留白分隔，不另外畫線。
- 版面最上方是語言切換，靠右對齊。接著是標頭：h1 加導言，下方留 3rem。
- 表格是區塊元素，可以橫向捲動，所以窄螢幕上不會撐破版面。
- 長指令會自動換行（`pre-wrap` 加 `overflow-wrap: anywhere`），所以手機上不必左右捲動。

## Elevation & Depth

完全平面，沒有任何 `box-shadow`。

需要表達層次時用三種手段：

- 1px 的格線邊框；
- 港灣霧淡底；
- 提示框左側 3px 的港灣藍直線。

只有網址區塊同時用了藍色邊框和淡藍底，它是頁面上最重要的東西。

**The Flat Notice Rule.** 公告欄上的紙是貼平的。不加陰影、不加漸層、不加模糊；需要強調時，換成港灣霧底色或港灣藍邊框。

## Shapes

- 圓角很小，只是讓角不那麼銳利：
  - 行內程式碼 4px；
  - 按鈕 6px；
  - 程式碼區塊 8px。
- 兩個例外：
  - 語言切換做成膠囊形（999px）；
  - 步驟編號是正圓。
- 提示框只有右側兩個角是圓的，左側保持直角接住那條藍線。

## Components

### Connector 網址區塊（signature）

整頁最重要的元件：使用者要複製的 `https://twse-mcp.taux.io/mcp`。

- **外觀**：程式碼區塊的形狀，但邊框改成港灣藍、底色改成港灣霧。頁面上沒有其他元素同時用這兩種處理。
- **內容**：使用者點一下就會全選（`user-select: all`），長網址會自動換行。
- **標籤**：區塊正上方一行 label 字級的動作說明（「把這個網址貼進 AI 的連接器設定：」），讓網址的用途不必從導言推敲。
- **只出現一次**：安裝步驟裡貼網址的那一步，就地附上同一個網址的一般程式碼區塊（可複製、不用藍框），藍框淡底只留給頁首這一個。

### 程式碼區塊與複製按鈕

- **區塊**：程式碼井底色、1px 格線邊框、8px 圓角；右側留 2.9rem 給按鈕。
- **複製按鈕**：
  - 位置與大小：2rem 的正方形圖示按鈕，固定在區塊右上角。
  - 平時：透明、鉛筆色。
  - hover 或鍵盤 focus：出現紙卡底色和格線邊框，圖示變港灣藍。
  - 複製完成：圖示換成勾號，顏色是港灣藍。
- **沒有腳本時**：按鈕維持 `hidden`，退回點擊區塊全選。

### 安裝步驟（編號清單）

- 不用預設的數字編號，改成 1.55rem 的圓形標記：港灣霧底、港灣藍數字、格線邊框。
- 每個步驟左側內縮 2.2rem。

### 語言切換

- 靠右的膠囊形連結：紙卡底色、格線邊框、鉛筆色、0.85rem。
- hover 時邊框和文字都變成港灣藍。

### 提示框

- 用港灣霧淡底，左側一條 3px 的港灣藍直線，右側兩角圓角。
- 只用來放補充說明，不用來表示警告。

### 表格

- 只畫水平格線，不畫直線。
- 表頭用鉛筆色的 label 字級。
- 窄螢幕上可以橫向捲動。

### FAQ（`details`）

- 每題之間一條格線。
- 問題用 500 字重；答案用鉛筆色，比正文退後一層。
- 展開與收合用瀏覽器原生的 `details`，不寫腳本。

### Favicon

港灣藍圓角方塊上三條白色橫線，像一張公告。用 inline SVG 的 data URI，不用 emoji（📈 是行情圖示，有些平台畫成紅綠）。

### 連結

- 港灣藍，保留底線；hover 時底線加粗到 2px。
- 鍵盤 focus 時顯示 2px 的港灣藍外框，與文字間隔 2px，圓角 `focus`（2px）。

## Do's and Don'ts

### Do:

- **Do** 所有顏色都透過 `:root` 的 CSS 變數取用，並同時提供 `-night` 版本。
- **Do** 把 connector 網址放在網址區塊元件裡：港灣霧底色加港灣藍邊框。
- **Do** 要強調時先用留白、港灣霧或格線；陰影永遠不是選項。
- **Do** 新內容維持在 44rem 的單欄裡，窄螢幕不能出現橫向捲動。
- **Do** 所有互動元素都要保留可見的 `:focus-visible` 樣式（港灣藍）。

### Don't:

- **Don't** 在介面上使用紅色或綠色：會被讀成台股的漲跌訊號。
- **Don't** 使用證交所、期交所的標誌、配色，或任何讓人以為是官方服務的視覺元素。
- **Don't** 加 `box-shadow`、漸層或模糊效果。
- **Don't** 載入網頁字型、外部圖片或其他外部資源：首頁要輕，CSP 也只放行頁面內嵌的內容。
- **Don't** 加主題切換按鈕：深淺主題交給 `prefers-color-scheme` 決定。
