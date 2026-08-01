/**
 * catalog.test.ts — 守住「簽入的目錄」與「程式對它的假設」不會分家。
 *
 * 目錄是機器產生、每週自動刷新的，而程式碼有幾個地方寫死了對它的假設。
 * 這裡把那些假設變成會紅的斷言，而不是等線上壞掉才發現。
 */
import { describe, expect, it } from "vitest";
import catalogJson from "../src/catalog.generated.json";
import { checkCatalog, REQUIRED } from "../scripts/check-catalog.mjs";
import { DS_DAY, DS_FUND, DS_RANK } from "../src/twse";
import { ALIASES, periodNote, type Catalog } from "../src/core";

const catalog = catalogJson as unknown as Catalog;

describe("catalog 健檢腳本", () => {
  it("現行目錄可以通過健檢", () => {
    const { problems, total } = checkCatalog(catalog);
    expect(problems).toEqual([]);
    expect(total).toBeGreaterThan(100);
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
