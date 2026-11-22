import { describe, expect, it } from "vitest";
import type { HistoryResponse } from "../../api/history";
import type { MarketSectorResponse } from "../../types/schemas";
import { buildRidges, windowSurface } from "./terrainData";

const sector: MarketSectorResponse = {
  symbol: "FUND",
  sector: "Fixture sector",
  weight: "small",
  leaders: [],
  change_percent: 0,
};
const sessions = [
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-11-16",
  "2026-11-17",
];
const response: HistoryResponse = {
  symbol: sector.symbol,
  interval: "1d",
  range: "2y",
  provider: "fixture",
  adjustment_type: "split_adjusted",
  status: "partial",
  coverage_status: "gaps",
  expected_session_count: null,
  collection: "disabled",
  read_at: "2026-11-18T00:00:00Z",
  requested_start: sessions[0],
  requested_end: sessions[7],
  available_start: sessions[0],
  available_end: sessions[7],
  excluded_row_count: 0,
  bars: sessions.map((session_date, i) => ({
    session_date,
    provider: "fixture",
    adjustment_type: "split_adjusted",
    quality_status: "valid",
    open: "100",
    close: "100",
    low: "100",
    high: String(100 + i),
    volume: "0",
    fetched_at: "2026-11-18T00:00:00Z",
  })),
};

describe("sector volatility relief", () => {
  it("averages five observed daily ranges, preserves a true zero volume and leaves missing dates absent", () => {
    const [ridge] = buildRidges([sector], [response], "fixture");
    expect(ridge.points.get(sessions[4])).toMatchObject({ amplitude: 2, volume: 0 });
    expect(ridge.points.has(sessions[3])).toBe(false);
    expect(ridge.points.has("2026-10-15")).toBe(false);
    const surface = windowSurface([ridge], "1M");
    expect(surface.dates).toEqual(sessions.slice(-2));
    expect(surface.ridges[0]).toMatchObject({ low: 100, high: 107 });
    expect(surface.ceiling).toBe(5);
  });
  it("uses the observed daily range in single-session mode, including the first stored bar", () => {
    const [ridge] = buildRidges([sector], [response], "fixture", 1);
    expect(ridge.points.get(sessions[0])?.amplitude).toBe(0);
    expect(ridge.points.get(sessions[4])?.amplitude).toBe(4);
  });
  it("keeps the final session of a shorter month inside the trailing window", () => {
    const dates = ["2025-02-20", "2025-02-21", "2025-02-24", "2025-02-25", "2025-02-28", "2025-03-31"];
    const bars = dates.map((session_date, i) => ({ ...response.bars[i], session_date }));
    const ridges = buildRidges([sector], [{ ...response, bars }], "fixture");
    expect(windowSurface(ridges, "1M").dates).toEqual(["2025-02-28", "2025-03-31"]);
  });
  it("requires the requested fund, window, provider and adjustment before drawing a ridge", () => {
    for (const mismatch of [
      { symbol: "OTHER" },
      { range: "1m" as const },
      { provider: "other" },
      { adjustment_type: "raw" as const },
    ]) {
      expect(buildRidges([sector], [{ ...response, ...mismatch }], "fixture")).toEqual([]);
    }
  });
});
