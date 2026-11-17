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
  it("leaves a weekday without a bar as a gap and does not invent a price", () => {
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

  it("does not draw or count a market holiday when the calendar check found no missing session", () => {
    // Thanksgiving, 2025-11-27, is a weekday with no session.
    const holidayWeek = [bar("2025-11-26", "10"), bar("2025-11-28", "11")];

    for (const status of ["complete", "unexpected_sessions"] as const) {
      const series = buildSeries(holidayWeek, status);
      expect(series.gapCount).toBe(0);
      expect(series.line).toEqual([
        { time: "2025-11-26", value: 10 },
        { time: "2025-11-28", value: 11 },
      ]);
      expect(series.candles.every((point) => "close" in point)).toBe(true);
      expect(series.volume.every((point) => "value" in point)).toBe(true);
      expect(chartSummary("AAPL", series.plotted, series.gapCount, "1M", status)).toBe(
        "AAPL daily prices, 1 month, 2025-11-26 to 2025-11-28, 2 sessions. No trading sessions are missing against the NYSE calendar.",
      );
    }
  });

  it("does not call a holiday missing data when the calendar check is not clean", () => {
    const holidayWeek = [bar("2025-11-26", "10"), bar("2025-11-28", "11")];

    for (const status of ["gaps", "gaps_and_unexpected_sessions", "not_verified", undefined] as const) {
      const series = buildSeries(holidayWeek, status);
      expect(series.gapCount).toBe(1);
      const summary = chartSummary("AAPL", series.plotted, series.gapCount, "1M", status);
      expect(summary).toContain(
        "1 weekday without a bar is shown as a gap and not filled in. That count includes market holidays.",
      );
      expect(summary).not.toMatch(/missing/i);
    }
  });

  it("says every weekday has a bar only when none is absent", () => {
    const series = buildSeries([bar("2026-11-12", "10"), bar("2026-11-13", "11")], "gaps");

    expect(chartSummary("AAPL", series.plotted, series.gapCount, "1M", "gaps")).toContain(
      "Every weekday in this range has a bar.",
    );
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

  it("keeps fractional Massive volume in the plotted bar and yearly average", () => {
    const bars = [bar("2026-11-12", "50", "52", "49", "100.25")];
    const series = buildSeries(bars);
    expect(series.plotted[0]).toMatchObject({ close: 50, volume: 100.25, volumeText: "100.25" });
    expect(series.volume[0]).toMatchObject({ value: 100.25 });
    expect(trailingYearStats(bars, END).averageVolume).toBe(100.25);
  });

  it("describes an empty range without a made-up price", () => {
    expect(chartSummary("AAPL", [], 0, "1Y")).toBe(
      "No cached daily bars for AAPL in the 1 year range.",
    );
  });
});
