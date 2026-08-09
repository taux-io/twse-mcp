# 不提供 `.mcpb` 安裝包

有人問「加一個 `.mcpb` 讓 Claude Desktop 一鍵安裝」是很自然的事——它是官方格式，
而本專案是個 MCP server。這份 ADR 記錄為什麼不做，以及三條查證過的事實，
讓下一個人（或下一個 agent）不必再花一輪重查。

**程式碼裡永遠不會有 `.mcpb` 的痕跡，所以「為什麼沒有」只能靠文件承載。**

查證日期：2026-08-09。

## 一、`.mcpb` 的 schema 不支援遠端 server

[MCPB manifest 規範](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md) 的
`server.type` 只接受四個值，全部是本機 stdio：

| 值 | 意義 |
|---|---|
| `node` | Node.js server，相依全部打包 |
| `python` | Python server，相依全部打包 |
| `binary` | 編譯好的執行檔 |
| `uv` | 用 UV runtime 的 Python server |

整份 schema **沒有任何欄位能指向遠端 URL**，而且明文要求
「All dependencies must be bundled」。

本服務是一個部署在 Cloudflare Workers 上的**遠端** server
（`https://twse-mcp.taux.io/mcp`）。所以本專案的 `.mcpb` 不可能是「一個指向網址的
薄殼」——它必須在裡面塞一個本機 Node 代理程序，把 stdio 轉發到那個網址。

### 代價

- 使用者要有 Node，而現在**什麼都不用裝**
- 要打包 `node_modules`、跟著版本走、還要簽章
- 五份 README 都寫著「**不用裝軟體、不用註冊**」，那句話會變成只對一半
- 本專案在此之前才刻意刪掉 Python stdio 版（保存於 tag `python-stdio-v0.1`），
  這等於把那個決定反過來

**零安裝是這個專案最強的地方。`.mcpb` 是拿零安裝去換一個點兩下的檔案。**

## 二、不存在可以預填的 deeplink

沒有官方的 URL scheme 能開啟 Claude Desktop 的「新增自訂連接器」對話框並帶入網址。
查過官方說明文件與支援中心，都沒有這種東西。所以「一鍵」在遠端連接器這條路上，
目前不存在中間選項——不是 `.mcpb`，就是手動貼網址。

## 三、Connectors Directory 上架這條路對本專案是關的

Anthropic 有正式的
[Remote MCP Server Submission Guide](https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide)，
上架後使用者可以在 Claude 裡直接瀏覽安裝，不必貼網址。三道門檻：

1. **提交入口需要 Team 或 Enterprise 組織**，而且只有 Owner 能提交。個人方案進不去。
2. 需要隱私權政策 URL、測試帳號與存取說明、至少三個示範 prompt、圖示。
3. [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
   要求：**「開發者必須證明擁有或控制其軟體所連線的任何 API 端點、網域、使用者介面，
   以及它所取得或呈現的任何外部資源。」**

第 3 條是硬的。本服務代理的是證交所與期交所的公開資料，那不是我們擁有或控制的資源。
作為公開資料的代理，本專案在結構上就不符合這條。

## 四、而且要解決的問題並不存在

否決一個功能之前要先確認它想解決什麼。這裡的答案是「希望安裝門檻再低一點」，
而**沒有觀測到任何人裝不起來**。

盤點下來，現況已經相當低：

- **遠端自訂連接器在 Claude Desktop 的免費方案就能用**
  （Free / Pro / Max / Team / Enterprise 全支援），也就是 README 現在寫的那條路
- 五份 README 都有三步驟教學 + 連線資訊表 + 一句可驗證是否裝好的測試問句
- 兩份完整版另有附錄放 `claude mcp add` 與 `codex mcp add`

**`.mcpb` 也幫不到 Claude Code。** Claude Code（CLI 與桌面版）不吃 `.mcpb`，
它加遠端 server 的方式本來就是一行 `claude mcp add --transport http`，沒有安裝負擔。

## 決定

不提供 `.mcpb`。改為把安裝說明本身做得更好：網址獨立成 fenced code block（GitHub 才
會給複製按鈕，表格儲存格裡的 inline code 不會），並把「裝不起來怎麼辦」移到步驟旁邊。

同時**撤回**先前那個「五份 README 改寫成軟體開發人員導向」的決定：那會拆掉這五份
文件現在一致的「講人話就好、不用記任何指令」定位，而開發者本來看附錄兩行就夠了。

## 什麼情況下要重讀這份文件

- **MCPB 的 schema 加入遠端 server 支援。** 那會讓第一節整節失效，`.mcpb` 就變成
  一個真正的薄殼，代價幾乎歸零。
- **出現真實的安裝失敗回報。** 第四節的前提就不成立了。
- **Directory Policy 對「公開資料代理」放寬，或本服務改成不代理第三方端點。**
- **本專案取得 Team/Enterprise 組織**——那只解掉三道門檻裡的第一道，第 3 條仍在。
