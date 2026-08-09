# 期交所資料的授權依據與查證紀錄

本服務把期交所的 132 個資料集再散布出去。這件事**預設是被禁止的**，能做是因為一條
豁免；這份文件記錄那條豁免的原文、成立條件，以及條件實際被驗證過的方法與結果。

沒有這份紀錄的話，「為什麼可以用」只存在於某次對話裡，而下一個人只會看到程式碼把
兩個交易所一視同仁——那正是最容易在不知情下違約的狀態。

查證日期：**2026-08-09**。

## 一、預設是禁止的

[臺灣期貨交易所網站使用條款](https://www.taifex.com.tw/cht/edu/userTerms) 第三條
（智慧財產權聲明）原文：

> 本網站所使用之軟體或程式、網站上所有內容，包括但不限於文字敘述、著作、圖片、影像、
> 檔案、資訊、資料、網站架構、網站畫面的安排、網頁設計，除依著作權法規定不得為著作權
> 之標的（如法律、命令或公文，請參考著作權法第九條規定）外，均由臺灣期貨交易所或其他
> 權利人依法擁有其智慧財產權。任何人不得逕自使用、修改、重製、公開播送、改作、散布、
> 發行、公開發表、進行還原工程、解編或反向組譯等侵害智慧財產權之行為，**但臺灣期貨
> 交易所已授權「政府資料開放平臺」（https://data.gov.tw）提供公眾使用之本網站資料，
> 不在此限。**

關鍵在最後那個但書。它不是說「期交所的開放資料都可以用」，而是說**只有經由
data.gov.tw 授權公眾使用的那些**不在禁止之列。範圍由 data.gov.tw 界定，不由
`openapi.taifex.com.tw` 界定——兩者不必然相同，這正是需要查證的地方。

## 二、豁免範圍內的授權條款

以 [期貨每日交易行情（data.gov.tw dataset 11319）](https://data.gov.tw/dataset/11319)
為代表查證：

| 項目 | 值 |
|---|---|
| 提供機關 | 金融監督管理委員會證券期貨局 |
| 授權方式 | 政府資料開放授權條款－第 1 版（OGDL v1） |
| API 規格文件 | `https://openapi.taifex.com.tw/swagger.json` |
| CSV 下載 | `https://www.taifex.com.tw/data_gov/taifex_open_data.asp?data_name=DailyMarketReportFut` |

兩件事值得記下來：

- **提供機關是證期局，不是期交所。** 顯名聲明要寫登錄機關，所以
  `src/server.ts` 的 `OGDL_ATTRIBUTION` 寫的是「金融監督管理委員會證券期貨局」。
  照直覺寫「臺灣期貨交易所」會是錯的顯名。
- **data.gov.tw 的頁面直接把 `openapi.taifex.com.tw/swagger.json` 列為 API 規格文件。**
  也就是說 OpenAPI 服務本身就是 data.gov.tw 認可的取得管道，不是另一條未授權的側門。

OGDL v1 的顯名義務同樣是授權成立的條件（條款三之(二)：「未盡顯名標示義務者，視為自始
未取得開放資料之授權」），與證交所那份相同。`test/server.test.ts` 有兩條測試分別守著
證交所與期交所的顯名，掉了會紅。

## 三、豁免範圍涵蓋了全部 132 個資料集——實測

上面那條但書的範圍是「已授權 data.gov.tw 的資料」，而目錄裡有 132 個期交所端點。
**抽樣不夠**：只要有一個端點不在授權範圍內，那一個就是未經授權的散布。

可驗證的著力點是 CSV 下載網址的形狀：

```
https://www.taifex.com.tw/data_gov/taifex_open_data.asp?data_name=DailyMarketReportFut
                          ^^^^^^^^ data.gov.tw 專用通道      ^^^^^^^^^^^^^^^^^^^^ 與 OpenAPI 端點同名
```

`data_name` 的值就是 OpenAPI 的端點名。所以「這個端點是否在 data.gov.tw 授權範圍內」
可以直接問上游，而不必逐一去 data.gov.tw 翻頁。

對目錄裡全部 132 個端點名逐一請求 `data_gov` 通道：

```
回應數 132 / 132
✓ 通過 132，未通過 0
```

（判準：HTTP 200 且 body 不是空的。冷門端點如 `CCP_CMLists`、`productsExemptedAH`
也在其中。）

**結論：目錄涵蓋的 132 個資料集全部落在 data.gov.tw 授權範圍內，因此全部落在使用條款
第三條的但書之內，可依 OGDL v1 再散布。**

### 這個結論何時會失效

- **目錄新增端點時。** `npm run refresh-catalog` 會把上游新增的端點自動納入，而新端點
  不必然已登錄 data.gov.tw。刷新後若端點數變多，要對新增的那些重跑上面的驗證。
- **期交所修改使用條款時。** 條款第一條保留隨時修改的權利，且不會通知。
- **豁免但書被拿掉或縮小範圍時。** 那會讓整批資料回到「預設禁止」。

## 四、被排除的三個端點

`TimeAndSalesData`、`OptionsTimeAndSalesData`、
`TimeAndSalesDataOnCalendarSpreadOrders` 不在目錄裡。排除理由是技術性的（單日 255.8 MB
／162.9 MB／9.7 MB，抓進 128 MB 的 isolate 會把工具打爛），不是授權問題——它們同樣在
data.gov.tw 上。理由寫在 `scripts/refresh-catalog.mjs` 的 `TAIFEX_EXCLUDE`，
`scripts/check-catalog.mjs` 有第二道守衛防止它們在某次刷新後悄悄回來。

## 五、與其他來源的對照

| 來源 | 授權 | 狀態 |
|---|---|---|
| `openapi.twse.com.tw` | OGDL v1，提供機關臺灣證券交易所 | 已顯名 |
| `openapi.taifex.com.tw` | OGDL v1，提供機關金融監督管理委員會證券期貨局 | 已顯名（本文件） |
| `mis.twse.com.tw`（`twse_realtime_quote`） | **未登錄於 data.gov.tw** | 不在 OGDL 範圍內，顯名聲明中明列為例外 |

`mis` 那條是懸而未決的產品決定，不是本文件的範圍；記在這裡只是為了讓三個來源的授權
狀態能在同一個地方被讀到。
