import { describe, expect, it } from "vitest";
import { compareCloses, type Close } from "./closeComparison";

function close(day: string, value: string | null, account: string | null, spy: string | null): Close {
  return {session_date: day, account_value: value, twr_index: account, benchmark_index: spy};
}

describe("closing session comparison", () => {
  it("matches SPY to both account dates and names intervening and trailing gaps", () => {
    const rows = [close("2026-11-12", "100", "1", "0.8"), close("2026-11-13", null, null, "1.9"),
      close("2026-11-16", "215", "1.15", "0.88"), close("2026-11-17", null, null, null)];
    const result = compareCloses(rows);
    expect(result.prior).toBe(rows[0]);
    expect(result.latest).toBe(rows[2]);
    expect(result.gaps).toEqual([rows[1]]);
    expect(result.newer).toEqual([rows[3]]);
    expect(result.accountReturn).toBeCloseTo(15);
    expect(result.spyReturn).toBeCloseTo(10);
  });
  it("does not substitute another SPY date or turn missing values into zero", () => {
    const result = compareCloses([close("12","100","1",null), close("13",null,null,"0.5"), close("16","100","1","1")]);
    expect(result.accountReturn).toBe(0);
    expect(result.spyReturn).toBeNull();
    expect(compareCloses([close("12","0",null,null)]).prior).toBeUndefined();
    expect(compareCloses([close("12","",null,null)]).latest).toBeUndefined();
  });
});
