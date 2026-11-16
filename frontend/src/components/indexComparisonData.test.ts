import { describe, expect, it } from "vitest";

import { normalizeCloses } from "./indexComparisonData";

describe("normalizeCloses", () => {
  it("measures percent change from the first close and keeps that point at zero", () => {
    const series = normalizeCloses([
      { session_date: "2026-11-03", close: "100.000000" },
      { session_date: "2026-11-04", close: "110.000000" },
    ]);

    expect(series).toMatchObject({
      firstClose: 100,
      lastClose: 110,
      changePercent: 10,
      asOf: "2026-11-04",
      sessionCount: 2,
      hasGap: false,
    });
    expect(series?.points).toEqual([
      { time: "2026-11-03", value: 0 },
      { time: "2026-11-04", value: 10 },
    ]);
  });

  it("breaks the line across a gap longer than a holiday weekend", () => {
    const series = normalizeCloses([
      { session_date: "2026-11-02", close: "50.000000" },
      { session_date: "2026-11-09", close: "40.000000" },
    ]);

    expect(series?.hasGap).toBe(true);
    expect(series?.points.map((point) => point.time)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-09",
    ]);
    expect(series?.points[1]).toEqual({ time: "2026-11-03" });
    expect(series?.changePercent).toBe(-20);
  });

  it("returns nothing when no positive close can anchor the series", () => {
    expect(normalizeCloses([])).toBeNull();
    expect(normalizeCloses([{ session_date: "2026-11-02", close: "0.000000" }])).toBeNull();
    expect(normalizeCloses([{ session_date: "not-a-date", close: "10.000000" }])).toBeNull();
  });
});
