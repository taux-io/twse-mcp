/**
 * catalog.test.ts — 守住「簽入的目錄」與「程式對它的假設」不會分家。
 *
 * 目錄是機器產生、每週自動刷新的，而程式碼有幾個地方寫死了對它的假設。
 * 這裡把那些假設變成會紅的斷言，而不是等線上壞掉才發現。
 */
import { describe, expect, it } from "vitest";
import catalogJson from "../src/catalog.generated.json";
import { checkCatalog, MIN_DATASETS, REQUIRED } from "../scripts/check-catalog.mjs";
import { DS_DAY, DS_FUND, DS_RANK } from "../src/twse";
import { ALIASES, periodNote, type Catalog } from "../src/core";

const catalog = catalogJson as unknown as Catalog;

describe("catalog 健檢腳本", () => {
  it("現行目錄可以通過健檢", () => {
    const { problems, total } = checkCatalog(catalog);
    expect(problems).toEqual([]);
    expect(total).toBeGreaterThan(MIN_DATASETS);
  });

  it("目錄缺了 twse_etf_snapshot 依賴的資料集時要抓出來", () => {
    const broken = { ...catalog };
    delete (broken as Record<string, unknown>)[DS_FUND];
    const { problems } = checkCatalog(broken);
    expect(problems.join()).toContain(DS_FUND);
  });

  // 健檢腳本是 .mjs、程式是 .ts，兩邊各有一份 id。這條斷言讓「只改一邊」變成紅燈。
  it("健檢腳本的必要清單與程式碼的常數一致", () => {
    expect([...REQUIRED].sort()).toEqual([DS_FUND, DS_DAY, DS_RANK].sort());
  });
});

describe("目錄與程式假設的一致性", () => {
  it("ALIASES 指向的資料集都真的存在", () => {
    const targets = [...new Set(Object.values(ALIASES).flat())];
    const missing = targets.filter((id) => !catalog[id]);
    expect(missing).toEqual([]);
  });

  // ALIASES.etf 是同一組 id 的第四份字面複本，先前無人守。
  it("ALIASES.etf 與 twse_etf_snapshot 依賴的常數是同一組", () => {
    expect([...ALIASES.etf].sort()).toEqual([DS_FUND, DS_DAY, DS_RANK].sort());
  });

  it("twse_etf_snapshot 依賴的三個資料集都在目錄裡", () => {
    for (const id of [DS_FUND, DS_DAY, DS_RANK]) {
      expect(catalog[id], id).toBeDefined();
    }
  });
});

describe("periodNote — 期間說明要跟著資料集的實際頻率", () => {
  it("交易類講「前一交易日」", () => {
    expect(periodNote(catalog[DS_DAY])).toContain("前一交易日");
  });

  it("公司治理／財務報表類不可講「前一交易日」（多為年度或季度揭露）", () => {
    const annual = Object.values(catalog).filter((d) =>
      d.tags.some((t) => t === "公司治理" || t === "財務報表"),
    );
    expect(annual.length).toBeGreaterThan(50); // 這類佔目錄六成以上，不是邊緣案例
    for (const ds of annual.slice(0, 20)) {
      expect(periodNote(ds), ds.id).not.toContain("前一交易日");
    }
  });
});

describe("periodNote — 月報也可能掛在「證券交易」分類下", () => {
  // 證交所把月頻報表也歸在 證券交易 分類，純看 tag 會把它們標成日頻。
  // 這幾檔是從真實目錄挑出來的實例。
  it("表名帶「月」的不可標成前一交易日", () => {
    for (const id of ["exchangeReport/FMSRFK_ALL", "block/BFIAUU_m"]) {
      expect(periodNote(catalog[id]), `${id} ${catalog[id].summary}`).not.toContain("前一交易日");
    }
  });

  it("彙總／靜態參考資料也不該標成前一交易日", () => {
    for (const id of ["opendata/t187ap37_L", "fund/MI_QFIIS_sort_20"]) {
      expect(periodNote(catalog[id]), `${id} ${catalog[id].summary}`).not.toContain("前一交易日");
    }
  });

  it("「日收盤價及月平均價」是日頻，不可因為出現「月」就誤判", () => {
    const ds = catalog["exchangeReport/STOCK_DAY_AVG_ALL"];
    expect(periodNote(ds), ds.summary).toContain("前一交易日");
  });
});

describe("checkCatalog — 遇到畸形資料要回報，不能自己爆掉", () => {
  it("條目是 null 時回報問題而非拋錯", () => {
    expect(() => checkCatalog({ bad: null } as never)).not.toThrow();
    const { problems } = checkCatalog({ bad: null } as never);
    expect(problems.join()).toContain("結構不對");
  });

  it("條目缺 fields 時也回報問題", () => {
    const broken = { ...catalog, weird: { id: "weird", summary: "x", description: "", tags: [] } };
    expect(() => checkCatalog(broken as never)).not.toThrow();
    expect(checkCatalog(broken as never).problems.join()).toContain("結構不對");
  });
});
