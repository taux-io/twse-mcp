*[English](README.en.md) ｜ [繁體中文](README.md) ｜ [简体中文](README.zh-CN.md) ｜ [日本語](README.ja.md) ｜ 한국어*

[![tests](https://github.com/taux-io/twse-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/taux-io/twse-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/taux-io/twse-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://github.com/taux-io/twse-mcp/blob/main/package.json)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://github.com/taux-io/twse-mcp/blob/main/wrangler.jsonc)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28%20%2B%202025-blueviolet)](https://github.com/taux-io/twse-mcp/blob/main/docs/adr/0001-dual-era-and-cache-scope.md)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.taux--io%2Ftwse--mcp-blueviolet)](https://registry.modelcontextprotocol.io/v0.1/servers?search=twse)

# 대만 주식 데이터 도우미 (TWSE MCP 서버)

> **이 한국어 문서는 기계 번역입니다.** 어색한 표현이나 오역을 발견하시면
> [이슈나 Pull Request](https://github.com/taux-io/twse-mcp/issues)로 알려주세요.
> 전체 내용은 [영어판](README.en.md) 또는 [번체 중국어판](README.md)에 있습니다.

**대만증권거래소(TWSE)와 대만선물거래소(TAIFEX)의 공개 데이터**를 AI에게 평범한 말로
물어볼 수 있게 해주는 **원격 MCP 서버**입니다. 대만 주식 시세, ETF 정보, 선물·옵션
일일 시세, 두 거래소가 공개하는 200종 이상의 보고서를 다룹니다.

설치 불필요, 계정 불필요, 무료. URL 하나를 붙여넣으면 약 1분이면 끝납니다.

## 시작하기

**Claude**를 예로 듭니다(브라우저의 claude.ai든 데스크톱 앱이든 동일합니다).
**무료 플랜이면 충분합니다** — 플러그인을 하나 추가할 수 있고, 하나면 됩니다.

1. **설정 열기** — 왼쪽 아래 내 이름 → **설정** → 왼쪽 메뉴의 **커넥터**.
2. **URL 붙여넣기** — **"+ 사용자 지정 커넥터 추가"**를 누릅니다.
   **이름**은 원하는 대로(예: `대만 주식`), **URL**에는 아래 줄을 붙여넣으세요
   (상자에 마우스를 올리면 오른쪽 위에 복사 버튼이 나옵니다).

   ```
   https://twse-mcp.taux.io/mcp
   ```

   **추가**를 누르면 끝입니다. **계정도, 비밀번호도, 결제도 필요 없습니다.**
3. **대화에서 켜기** — **새 대화를 시작**하고 입력창 옆의 **"+"** → **커넥터**에서
   방금 추가한 것을 켭니다.

### 잘 되는지 확인

> 대만 주식 커넥터를 써서, 0050 지금 얼마야?

**실제 가격**("0050은 약 97.15" 같은)이 돌아오면 성공입니다.

## 바로 쓰는 단축 명령 3 가지

평범한 말로 묻는 것 외에, 단축 명령 3 개가 **커넥터와 함께 자동으로 나타납니다**
(따로 설치할 것은 없습니다).

| 명령 | 하는 일 | 넘기는 값 |
|---|---|---|
| `find_dataset` | 어떤 데이터셋을 써야 할지 모를 때 키워드로 찾아줍니다 | 키워드(예: `三大法人`) |
| `etf_overview` | 상장 ETF 한 종목의 기본 정보·전 거래일 시세·적립식 인기를 한 번에 | ETF 코드(예: `0056`) |
| `futures_quote` | 선물·옵션 일일 시세 | 계약 코드나 상품명(예: `TX`) |

**Claude Desktop**에서는 입력창 옆 **"+"** 메뉴에서,
**Claude Code**에서는 `/`를 입력하면 `/mcp__twse__find_dataset` 형태로 나옵니다.

쓰지 않아도 괜찮습니다. 자주 쓰는 표현을 미리 적어둔 것뿐이라,
그냥 한국어로 물어봐도 똑같이 동작합니다.

## 연결 정보

다른 MCP 지원 도구를 쓴다면 이 값을 입력하세요.

| 항목 | 값 |
|---|---|
| URL | `https://twse-mcp.taux.io/mcp` |
| 연결 방식 | Streamable HTTP(원격 MCP), 구버전과 신버전 MCP 프로토콜 모두 지원 |
| 인증 | 필요 없음 |

설정 항목 이름은 도구마다 다릅니다. **"Streamable HTTP"**를 고르세요.
예전 방식인 **SSE**가 아닙니다.

## 쓰기 전에 알아둘 것

1. **개인 프로젝트입니다.** 최대한 계속 열어두려 하지만, 가끔 제한이 걸리거나
   일시적으로 점검하거나 앞으로 주소가 바뀔 수 있습니다. 상시 가동을 보장하지 않습니다.
2. **"실시간" 시세는 최선을 다한 값입니다.** 거래소 웹 화면에서 가져오기 때문에
   몇 초에서 몇 분 지연되거나, 가끔 못 가져오거나, 증권사 화면과 조금 다를 수 있습니다.
3. **실시간 시세를 뺀 나머지는 최대 1시간 지날 수 있습니다.** 거래소에 부담을 주지 않으려고
   각종 보고서는 1시간 캐시합니다. 장중 가격은 캐시하지 않습니다.
4. **참고용이며 투자 조언이 아닙니다.** 수치가 틀리거나 늦을 수 있습니다.
   **거래 전에 거래소나 증권사에서 반드시 확인하세요.** 손익은 본인 책임입니다.
5. **로그인 불필요, 질문 내용은 기록하지 않습니다.** 공개 데이터를 가져와 돌려줄 뿐입니다.
   현재 구버전 프로토콜로 접속하는 이용자가 얼마나 남았는지 측정하려고, 쓰고 있는 AI 도구
   종류와 프로토콜 버전만 기록합니다 — **질문 내용은 포함하지 않습니다**. 측정이 끝나면
   제거합니다.

## 상장(TSE)과 장외(OTC)는 다루는 범위가 다릅니다

- **상장 종목** — 전부 지원. 실시간 시세, 전 거래일 시가·고가·저가·종가와 거래량, 각종 보고서.
- **장외 종목** — **실시간 시세만**(현재가, 당일 시가·고가·저가, 전일 종가, 거래량).
  과거 데이터나 통계 보고서는 가져올 수 없습니다.

장외 시장 데이터 출처가 클라우드에서의 접근을 차단하기 때문입니다. 자세한 내용은
[영어판](README.en.md#what-it-can-and-cannot-look-up)을 보세요.

## 데이터 출처와 라이선스

臺灣證券交易所 2026 臺灣證券交易所 OpenAPI

金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS

此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

정부 데이터 개방 라이선스(政府資料開放授權條款): <https://data.gov.tw/license>

> **예외**: 실시간 시세는 거래소의 기본시황보도참(`mis.twse.com.tw`)에서 오며, 정부 데이터 개방 플랫폼에 등록되어 있지 않아 위 라이선스의 적용을 받지 않습니다.

이 서비스는 중계와 변환만 수행하며 데이터 정확성을 보증하지 않습니다. 인용 시 위 출처 표시를 함께 남겨주세요.

*(표시문은 라이선스가 요구하는 대로 중국어 원문 그대로 실었습니다.)*

---

## 라이선스와 기여

MIT 라이선스. 소스 코드와 이슈는
[github.com/taux-io/twse-mcp](https://github.com/taux-io/twse-mcp)에 있습니다.
번역 수정도 환영합니다.
