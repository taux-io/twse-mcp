*[English](README.en.md) ｜ [繁體中文](README.md) ｜ 简体中文 ｜ [日本語](README.ja.md) ｜ [한국어](README.ko.md)*

[![tests](https://github.com/taux-io/twse-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/taux-io/twse-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/taux-io/twse-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://github.com/taux-io/twse-mcp/blob/main/package.json)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://github.com/taux-io/twse-mcp/blob/main/wrangler.jsonc)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28%20%2B%202025-blueviolet)](https://github.com/taux-io/twse-mcp/blob/main/docs/adr/0001-dual-era-and-cache-scope.md)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.taux--io%2Ftwse--mcp-blueviolet)](https://registry.modelcontextprotocol.io/v0.1/servers?search=twse)

# 台股数据小助手（TWSE MCP 服务器）

> **这份简体中文版由繁体中文版转换并做了用词本地化。** 如果发现用词不自然或有错，
> 欢迎[提 issue 或 PR](https://github.com/taux-io/twse-mcp/issues)。
> 完整内容见[繁体中文版](README.md)或[英文版](README.en.md)。

把**台湾证券交易所（证交所／TWSE）与台湾期货交易所（期交所／TAIFEX）的公开数据**
包装成一个**远程 MCP 服务器**，让 AI 用大白话就能查台股行情、ETF 资料、期货与期权
每日行情，以及两家交易所公开的两百多种报表。

不用装软件、不用注册、免费。复制一个网址贴上去，大约一分钟搞定。

## 开始使用

以 **Claude** 为例（浏览器版 claude.ai 或桌面客户端都一样）。
**免费方案就够用**——可以加一个插件，而你只需要一个。

1. **打开设置** — 点左下角你的名字 → **设置** → 左侧菜单的**连接器（Connectors）**。
2. **粘贴网址** — 点 **"+ 添加自定义连接器"**，填两个字段：

   | 字段 | 填什么 |
   |---|---|
   | 名称 | 随便取，例如 `台股` |
   | 网址 | `https://twse-mcp.taux.io/mcp` |

   点**添加**就好了。**不用账号、不用密码、不用付费。**
3. **在对话里打开** — 回到对话，**开一个新会话**，点输入框旁边的 **"+"** →
   **连接器**，把刚加的那个打开。

### 确认能用

> 用台股连接器，0050 现在多少？

如果它回你**一个实际价格**（类似「0050 大约 97.15」），就成了。

## 连接信息

用其他支持 MCP 的工具，就填这几个值。

| 项目 | 值 |
|---|---|
| 网址 | `https://twse-mcp.taux.io/mcp` |
| 连接方式 | Streamable HTTP（远程 MCP），新旧两代 MCP 协议都支持 |
| 认证 | 不需要 |

各家配置文件的字段名不太一样，对应到 **"Streamable HTTP"** 那种，
别选成旧的 **SSE**。

## 使用前先知道几件事

1. **这是个人做着玩的项目。** 我尽量让它一直开着，但可能偶尔限流、临时维护，
   或者以后换网址——不保证随时都在。
2. **实时行情是「尽量实时」。** 数据来自交易所的网页接口，可能有几秒到几分钟延迟、
   偶尔抓不到，或者跟你券商看到的略有出入。
3. **除了实时行情，其他数据最多可能慢一小时。** 为了不老是去打交易所，各类报表会缓存
   一小时；盘中价格不缓存，永远是当下抓的。
4. **数据仅供参考，不是投资建议。** 数字可能有误或延迟，**下单前请自己再向交易所或券商
   确认**，盈亏自负。
5. **不用登录，也不会知道你查了什么。** 只是替你去取公开数据而已。目前为了统计还有多少人
   用旧版连接方式，会记录你的 AI 工具种类和协议版本——**不包含你问的问题**，统计完就移除。

## 上市（TSE）和上柜（OTC）能查的范围不一样

- **上市标的** — 全都支持。实时行情、前一交易日的开高低收和成交量、各类报表。
- **上柜标的** — **只有实时行情**（当前价、当天开高低、昨收、成交量）。
  历史数据和统计报表取不到。

原因是上柜市场的数据源屏蔽了来自云端的访问。详情见
[繁体中文版](README.md#有些查得到有些查不到)。

## 数据来源与授权

臺灣證券交易所 2026 臺灣證券交易所 OpenAPI

金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS

此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

政府数据开放授权条款：<https://data.gov.tw/license>

> **一个例外**：盘中实时行情来自证交所基本市况报导站（`mis.twse.com.tw`），该站未登录于政府数据开放平台，不在上述授权范围内。

本服务仅做代理与转换，不对数据正确性负责；引用时请一并标注上述来源。

*(标示文按授权条款要求保留繁体原文。)*

---

## 许可证与参与

MIT 许可证。源码和 issue 都在
[github.com/taux-io/twse-mcp](https://github.com/taux-io/twse-mcp)。
也欢迎帮忙修翻译。
