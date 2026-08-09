*[English](README.en.md) ｜ [繁體中文](README.md) ｜ [简体中文](README.zh-CN.md) ｜ 日本語 ｜ [한국어](README.ko.md)*

[![tests](https://github.com/taux-io/twse-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/taux-io/twse-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/taux-io/twse-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://github.com/taux-io/twse-mcp/blob/main/package.json)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://github.com/taux-io/twse-mcp/blob/main/wrangler.jsonc)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28%20%2B%202025-blueviolet)](https://github.com/taux-io/twse-mcp/blob/main/docs/adr/0001-dual-era-and-cache-scope.md)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.taux--io%2Ftwse--mcp-blueviolet)](https://registry.modelcontextprotocol.io/v0.1/servers?search=twse)

# 台湾株データアシスタント（TWSE MCP サーバー）

> **この日本語版は機械翻訳です。** 誤訳や不自然な表現を見つけたら、
> [Issue や Pull Request](https://github.com/taux-io/twse-mcp/issues) で修正してください。
> 完全な内容は[英語版](README.en.md)または[繁体字中国語版](README.md)にあります。

**台湾証券取引所（TWSE／證交所）と台湾先物取引所（TAIFEX／期交所）の公開データ**を、
AI から自然な言葉で調べられるようにする**リモート MCP サーバー**です。台湾株の株価、
ETF の情報、先物・オプションの日次相場、両取引所が公開している 200 種類以上の
レポートを扱えます。

インストール不要・アカウント不要・無料。URL を 1 つ貼り付けるだけ、約 1 分で終わります。

## 使い始める

**Claude** を例にします（ブラウザ版 claude.ai でもデスクトップアプリでも同じです）。
**無料プランで足ります**——プラグインを 1 つ追加でき、必要なのは 1 つだけです。

1. **設定を開く** — 左下の自分の名前 → **設定** → 左メニューの **コネクタ**。
2. **URL を貼り付ける** — **「＋ カスタムコネクタを追加」** をクリックします。
   **名前**は好きなもので構いません（例：`台湾株`）。**URL** には次の行を貼り付けて
   ください（枠にカーソルを合わせると右上にコピーボタンが出ます）。

   ```
   https://twse-mcp.taux.io/mcp
   ```

   **追加**を押せば完了です。**アカウントもパスワードも支払いも不要です。**
3. **チャットで有効にする** — **新しい会話を開始**し、入力欄の横の **「＋」** →
   **コネクタ** から、追加したものをオンにします。

### 動作確認

> 台湾株コネクタを使って、0050 は今いくら？

**実際の価格**（「0050 は約 97.15」など）が返ってくれば成功です。

## 3 つのショートカット

自然な言葉で聞く以外に、3 つのショートカットコマンドが**コネクタと一緒に自動で現れます**
（追加インストールは不要です）。

| コマンド | 内容 | 渡すもの |
|---|---|---|
| `find_dataset` | どのデータセットを使えばよいか分からないとき、キーワードから探します | キーワード（例：`三大法人`） |
| `etf_overview` | 上場 ETF 1 銘柄の基本情報・前営業日の値動き・積立人気をまとめて表示 | ETF コード（例：`0056`） |
| `futures_quote` | 先物・オプションの日次相場 | 契約コードまたは商品名（例：`TX`） |

**Claude Desktop** では入力欄の横の **「＋」** メニューから、
**Claude Code** では `/` を入力すると `/mcp__twse__find_dataset` の形で表示されます。

使わなくても構いません。よくある聞き方をあらかじめ書いてあるだけで、
普通に日本語で聞いても同じように動きます。

## 接続情報

他の MCP 対応ツールを使う場合は、この値を入力してください。

| 項目 | 値 |
|---|---|
| URL | `https://twse-mcp.taux.io/mcp` |
| 接続方式 | Streamable HTTP（リモート MCP）、新旧どちらの MCP プロトコルにも対応 |
| 認証 | 不要 |

設定項目の名称はツールによって異なります。**「Streamable HTTP」** を選んでください。
古い **SSE** ではありません。

## 使う前に知っておくこと

1. **個人の趣味プロジェクトです。** できる限り稼働させますが、混雑時の制限、一時的な
   メンテナンス、将来的な URL 変更の可能性があります。常時稼働の保証はありません。
2. **「リアルタイム」株価はベストエフォートです。** 証券取引所のウェブ画面が情報源のため、
   数秒から数分の遅延、取得失敗、証券会社の表示との差異が起こりえます。
3. **リアルタイム株価以外は最大 1 時間古い可能性があります。** 各種レポートは取引所への
   負荷を避けるため 1 時間キャッシュされます。取引時間中の価格はキャッシュされません。
4. **参考情報であり投資助言ではありません。** 数値に誤りや遅延がある可能性があります。
   **取引の前に取引所または証券会社で必ず確認してください。** 損益は自己責任です。
5. **ログイン不要、質問内容は記録しません。** 公開データを取得して返すだけです。
   現在、旧プロトコルでの接続数を計測するため、利用中の AI ツールの種類とプロトコル
   バージョンのみを記録しています——**質問の内容は含みません**。計測が終わり次第削除します。

## 上場（TSE）と店頭（OTC）で扱える範囲が違います

- **上場銘柄** — すべて対応。リアルタイム株価、前営業日の四本値と出来高、各種レポート。
- **店頭銘柄** — **リアルタイム株価のみ**（現在値、当日の始値・高値・安値、前日終値、出来高）。
  過去データや統計レポートは取得できません。

店頭市場のデータ元がクラウドからのアクセスを遮断しているためです。詳しくは
[英語版](README.en.md#what-it-can-and-cannot-look-up)を参照してください。

## データ出典とライセンス

臺灣證券交易所 2026 臺灣證券交易所 OpenAPI

金融監督管理委員會證券期貨局 2026 臺灣期貨交易所 OAS

此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。

政府資料開放授權條款：<https://data.gov.tw/license>

> **例外**：リアルタイム株価は証券取引所の基本市況報導站（`mis.twse.com.tw`）が出典で、政府データ公開プラットフォームに登録されていないため、上記ライセンスの対象外です。

本サービスは中継と整形のみを行い、データの正確性は保証しません。引用の際は上記の出典表示を併記してください。

*(表示文はライセンスの要求どおり中国語原文のまま掲載しています。)*

---

## ライセンスと貢献

MIT ライセンス。ソースコードと Issue は
[github.com/taux-io/twse-mcp](https://github.com/taux-io/twse-mcp) にあります。
翻訳の修正も歓迎します。
