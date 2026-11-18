import { describe, expect, it } from "vitest";
import type { HistoryResponse } from "../../../api/history";
import { matchingPrices, priceReturn, windowLimit, type Simulation } from "./simulation";

const dates = ["2025-01-31", "2025-02-03"];
const result: Simulation = {
  symbol: "SPY", mode: "recurring", coverage: "available",
  source: { provider: "yahoo", session_date: dates[1], basis: "split_adjusted", coverage: "available", observed_at: null },
  start_used: dates[0], end_used: dates[1], end_value_usd: "1125.00", contributed_usd: "1100.00", price_return: "0.025000",
  assumptions: [], skipped_months: [],
  points: dates.map((session_date, i) => ({session_date, contributed_usd: i ? "1100.00" : "1000.00", value_usd: i ? "1125.00" : "1000.00"})),
};
const history: HistoryResponse = {
  symbol: "SPY", interval: "1d", range: "all", provider: "yahoo", adjustment_type: "split_adjusted",
  read_at: dates[1], requested_start: dates[0], requested_end: dates[1], available_start: dates[0], available_end: dates[1],
  status: "partial", coverage_status: "complete", expected_session_count: 2, collection: "disabled", excluded_row_count: 0,
  bars: dates.map((session_date, i) => ({
    session_date, provider: "yahoo", adjustment_type: "split_adjusted", quality_status: "valid", close: i ? "102.5" : "100",
    open: "100", high: "103", low: "99", volume: "100", fetched_at: dates[1],
  })),
};
describe("underlying price history", () => {
  it("uses only the run's sessions and underlying closes, independently of contributions", () => {
    const points = matchingPrices(result, history);
    expect(points?.map(p => p.date)).toEqual(dates);
    expect(priceReturn(points![1].ratio)).toBe("+2.50%");
  });
  it("declines incomplete, incompatible and divergent history", () => {
    expect(matchingPrices(result, {...history, bars: history.bars.slice(1)})).toBeNull();
    expect(matchingPrices(result, {...history, symbol: "AAPL"})).toBeNull();
    expect(matchingPrices(result, {...history, provider: "massive"})).toBeNull();
    expect(matchingPrices(result, {...history, adjustment_type: "raw"})).toBeNull();
    expect(matchingPrices(result, {...history, bars: history.bars.map(bar => ({...bar, adjustment_type: "raw"}))})).toBeNull();
    expect(matchingPrices({...result, price_return: "0.026000"}, history)).toBeNull();
  });
});
it("bounds windows to today and clamps leap-day anniversaries", () => {
  expect(windowLimit("2024-02-29", "2030-01-01")).toBe("2027-02-28");
  expect(windowLimit("2025-02-28", "2026-03-01")).toBe("2026-03-01");
});
