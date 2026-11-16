import { describe, expect, it } from "vitest";
import type { HistoryBar } from "../api/history";
import { buildSeries, chartSummary, sliceBars, trailingYearStats } from "./priceChartData";

const END = "2026-11-13";

function bar(session: string, close = "10", high = "12", low = "8", volume = "100"): HistoryBar {
  return {
    session_date: session,
    open: close,
    high,
    low,
    close,
    volume,
    fetched_at: "2026-11-13T21:00:00Z",
    provider: "massive",
    adjustment_type: "split_adjusted",
    quality_status: "valid",
  };
}

describe("price chart data", () => {
  it("leaves a missing weekday as a gap and does not invent a price", () => {
    const series = buildSeries([
      bar("2026-11-09", "10"),
      bar("2026-11-12", "14"),
    ]);

    expect(series.gapCount).toBe(2);
    expect(series.line.filter((point) => !("value" in point)).map((point) => point.time)).toEqual([
      "2026-11-10",
      "2026-11-11",
    ]);
    expect(series.candles.find((point) => point.time === "2026-11-10")).toEqual({ time: "2026-11-10" });
    expect(series.volume.find((point) => point.time === "2026-11-10")).toEqual({ time: "2026-11-10" });
    expect(series.plotted.map((point) => point.closeText)).toEqual(["$10.00", "$14.00"]);
  });

  it("does not treat a weekend as a missing session", () => {
    const series = buildSeries([
      bar("2026-11-13", "10"),
      bar("2026-11-16", "11"),
    ]);

    expect(series.gapCount).toBe(0);
    expect(series.line.every((point) => "value" in point)).toBe(true);
  });

  it("slices year to date from the server end date and keeps the prior year out", () => {
    const bars = [bar("2025-12-31"), bar("2026-01-02"), bar("2026-11-12")];

    expect(sliceBars(bars, "YTD", END).map((item) => item.session_date)).toEqual([
      "2026-01-02",
      "2026-11-12",
    ]);
    expect(sliceBars(bars, "1M", END).map((item) => item.session_date)).toEqual(["2026-11-12"]);
    expect(sliceBars(bars, "2Y", END).map((item) => item.session_date)).toEqual([
      "2025-12-31",
      "2026-01-02",
      "2026-11-12",
    ]);
  });

  it("computes 52-week high, low, and average volume from the trailing year only", () => {
    const stats = trailingYearStats([
      bar("2024-11-01", "10", "999", "1", "50"),
      bar("2025-11-13", "10", "110", "80", "1000"),
      bar("2026-11-12", "10", "130", "90", "3000"),
    ], END);

    expect(stats).toEqual({ high: 130, low: 80, averageVolume: 2000 });
  });

  it("describes an empty range without a made-up price", () => {
    expect(chartSummary("AAPL", [], 0, "1Y")).toBe(
      "No cached daily bars for AAPL in the 1 year range.",
    );
  });
});
