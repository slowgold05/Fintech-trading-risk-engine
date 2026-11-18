import { describe, expect, it } from "vitest";
import { accountWeight, performanceSeries } from "./valuation";
import type { PerformanceSession } from "../../../api/portfolio";

function session(date: string, value: string | null, twr: string | null, spy: string | null, cumulative: string | null): PerformanceSession {
  return { session_date: date, account_value: value, twr_index: twr, benchmark_index: spy, cumulative_pnl: cumulative };
}

describe("portfolio session readings", () => {
  it("uses the account's funded start for SPY and breaks both lines on missing account sessions", () => {
    const { start, points } = performanceSeries([
      session("2026-03-02", "0", null, "1", "0"),
      session("2026-03-03", "1000", "1", "2", "0"),
      session("2026-03-04", null, null, "4", null),
      session("2026-03-05", "2110", "1.11", "3", "110"),
      session("2026-03-06", "2000", "1", null, "0"),
    ]);
    expect(start).toBe(1);
    expect(points.map(row => row.spy)).toEqual([null, 0, null, 50, null]);
    expect(points[2].account).toBeNull();
    expect(points[3].account).toBeCloseTo(11);
    expect(points[3].cumulative).toBe(110);
    expect(points[4].cumulative).toBe(0);
  });
  it("never substitutes a neighbor when the first portfolio session lacks a benchmark", () => {
    const { points } = performanceSeries([
      session("2026-03-02", "10", "1", null, null),
      session("2026-03-03", "11", "1.1", "1.4", "1"),
    ]);
    expect(points.every(p => p.spy === null)).toBe(true);
    expect(points[1].account).toBeCloseTo(10);
  });
  it("keeps legacy absent fields, stale marks and unfunded denominators unavailable", () => {
    const { points } = performanceSeries([{ session_date: "2026-03-02", account_value: "100" },
      { ...session("2026-03-03", "999", "2", "2", "50"), status: "unavailable" }]);
    expect(points.every(p => p.account === null && p.cumulative === null && p.spy === null)).toBe(true);
    expect(accountWeight(10, 0)).toBeNull();
    expect(accountWeight(10, null)).toBeNull();
    expect(accountWeight(0, 100)).toBe(0);
    expect(accountWeight(100, 500)).toBe(20);
  });
});
