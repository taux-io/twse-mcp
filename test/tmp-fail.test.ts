import { expect, it } from "vitest";
it("故意失敗（驗證 pr:wait 的失敗路徑，會關掉這個 PR）", () => {
  expect(1).toBe(2);
});
