import { describe, expect, it } from "vitest";
import { historyCandles } from "./historyData";

const READ_AT = "2026-11-06T12:00:00Z";
const REQUESTED_START = "2024-11-06";
const REQUESTED_END = "2026-11-06";

function bar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_date: REQUESTED_START,
    open: "101.250000",
    high: "105.500000",
    low: "99.500000",
    close: "103.750000",
    volume: "0",
    fetched_at: READ_AT,
    provider: "fixture",
    adjustment_type: "raw",
    quality_status: "valid",
    ...overrides,
  };
}

/** Two sessions on the inclusive window edges, with every calendar day between them absent. */
function barsWithGap(): Record<string, unknown>[] {
  return [
    bar(),
    bar({
      session_date: REQUESTED_END,
      open: "103.750000",
      high: "110.000000",
      low: "100.000000",
      close: "108.500000",
      volume: "2500",
    }),
  ];
}

function dailyPayload(
  bars: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    symbol: "TEST",
    interval: "1d",
    range: "2y",
    provider: "fixture",
    adjustment_type: "raw",
    status: bars.length === 0 ? "unavailable" : "partial",
    coverage_status: "not_verified",
    expected_session_count: null,
    collection: "disabled",
    read_at: READ_AT,
    requested_start: REQUESTED_START,
    requested_end: REQUESTED_END,
    available_start: bars.length === 0 ? null : bars[0].session_date,
    available_end: bars.length === 0 ? null : bars[bars.length - 1].session_date,
    excluded_row_count: 0,
    bars,
    ...overrides,
  };
}

describe("historyCandles", () => {
  it("returns exactly the two supplied sessions across a gap and converts only the chart points", () => {
    const rows = barsWithGap();
    const body = dailyPayload(rows);
    const original = structuredClone(body);

    const points = historyCandles(body);

    expect(points).toEqual([
      {
        time: "2024-11-06",
        open: 101.25,
        high: 105.5,
        low: 99.5,
        close: 103.75,
      },
      {
        time: "2026-11-06",
        open: 103.75,
        high: 110,
        low: 100,
        close: 108.5,
      },
    ]);
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.time)).toEqual(["2024-11-06", "2026-11-06"]);
    for (const point of points) {
      expect(Object.keys(point).sort()).toEqual(["close", "high", "low", "open", "time"]);
      expect(typeof point.open).toBe("number");
      expect(typeof point.high).toBe("number");
      expect(typeof point.low).toBe("number");
      expect(typeof point.close).toBe("number");
    }

    expect(body).toEqual(original);
    expect(rows.map((entry) => entry.open)).toEqual(["101.250000", "103.750000"]);
    expect(rows.map((entry) => entry.volume)).toEqual(["0", "2500"]);
    expect(typeof rows[0].volume).toBe("string");
    expect(rows[0].volume).toBe("0");
  });

  it("returns no points for the known unavailable empty fixture", () => {
    const body = dailyPayload([]);
    const original = structuredClone(body);

    expect(body).toMatchObject({
      symbol: "TEST",
      interval: "1d",
      range: "2y",
      provider: "fixture",
      adjustment_type: "raw",
      status: "unavailable",
      coverage_status: "not_verified",
      expected_session_count: null,
      collection: "disabled",
      read_at: READ_AT,
      requested_start: REQUESTED_START,
      requested_end: REQUESTED_END,
      available_start: null,
      available_end: null,
      excluded_row_count: 0,
      bars: [],
    });
    expect(historyCandles(body)).toEqual([]);
    expect(body).toEqual(original);
  });

  it("accepts a positive sub-cent price and keeps the canonical string on the input", () => {
    const rows = [
      bar({
        session_date: "2025-06-16",
        open: "0.000001",
        high: "0.000001",
        low: "0.000001",
        close: "0.000001",
        volume: "0",
      }),
    ];
    const body = dailyPayload(rows);

    const points = historyCandles(body);

    expect(points).toEqual([
      {
        time: "2025-06-16",
        open: Number("0.000001"),
        high: Number("0.000001"),
        low: Number("0.000001"),
        close: Number("0.000001"),
      },
    ]);
    expect(points[0].open).toBeGreaterThan(0);
    expect(rows[0].open).toBe("0.000001");
    expect(rows[0].volume).toBe("0");
    expect(typeof rows[0].volume).toBe("string");
  });

  it("rejects the whole series when a later bar is invalid", () => {
    const rows = barsWithGap();
    rows[1] = { ...rows[1], close: "" };

    expect(() => historyCandles(dailyPayload(rows))).toThrow();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ close: "103.750000", volume: "0" });
    expect(rows[1]).toMatchObject({ close: "" });
  });

  it.each([null, undefined, "TEST", 0, true, []])(
    "rejects a non-object payload %j",
    (payload) => {
      expect(() => historyCandles(payload)).toThrow();
    },
  );

  it("rejects an object that does not contain a bars array", () => {
    expect(() => historyCandles({ symbol: "TEST", interval: "1d", range: "2y" })).toThrow();
    expect(() => historyCandles(dailyPayload(barsWithGap(), { bars: null }))).toThrow();
    expect(() => historyCandles(dailyPayload(barsWithGap(), { bars: {} }))).toThrow();
  });

  it.each([
    ["open", ""],
    ["high", null],
    ["low", 0],
    ["close", "NaN"],
    ["open", "Infinity"],
    ["high", "-1.000000"],
    ["low", "0.000000"],
    ["close", "1e2"],
  ])("rejects %s price %j", (field, price) => {
    expect(() => historyCandles(dailyPayload([bar({ [field]: price })]))).toThrow();
  });

  it.each([
    {
      open: "10.000000",
      high: "10.500000",
      low: "9.000000",
      close: "11.000000",
    },
    {
      open: "10.000000",
      high: "12.000000",
      low: "10.500000",
      close: "11.000000",
    },
  ])("rejects OHLC bounds %j", (prices) => {
    expect(() =>
      historyCandles(
        dailyPayload([
          bar({
            session_date: "2025-06-16",
            ...prices,
          }),
        ]),
      ),
    ).toThrow();
  });

  it("rejects a low that exceeds open by 0.000001 at a magnitude where IEEE rounding collapses them", () => {
    // 999999999999.000001 is not a distinct Number from 999999999999.000000.
    const rows = [
      bar({
        session_date: "2025-06-16",
        open: "999999999999.000000",
        high: "999999999999.000001",
        low: "999999999999.000001",
        close: "999999999999.000000",
        volume: "0",
      }),
    ];

    expect(Number(rows[0].low)).toBe(Number(rows[0].open));
    expect(() => historyCandles(dailyPayload(rows))).toThrow();
  });

  it.each(["2026-02-30", "2026-11-06T00:00:00Z"])(
    "rejects an impossible session date %j",
    (sessionDate) => {
      expect(() => historyCandles(dailyPayload([bar({ session_date: sessionDate })]))).toThrow();
    },
  );

  it("rejects an impossible date on the requested window", () => {
    expect(() => historyCandles(dailyPayload([bar()], { requested_end: "2026-02-30" }))).toThrow();
    expect(() =>
      historyCandles(dailyPayload([bar()], { requested_start: "2024-11-06T00:00:00Z" })),
    ).toThrow();
  });

  it("rejects duplicate session dates", () => {
    expect(() =>
      historyCandles(
        dailyPayload([
          bar({ session_date: "2025-03-03" }),
          bar({ session_date: "2025-03-03" }),
        ]),
      ),
    ).toThrow();
  });

  it("rejects session dates that go backwards", () => {
    expect(() =>
      historyCandles(
        dailyPayload([
          bar({ session_date: "2025-03-04" }),
          bar({ session_date: "2025-03-03" }),
        ]),
      ),
    ).toThrow();
  });

  it("rejects a session before the requested window", () => {
    expect(() => historyCandles(dailyPayload([bar({ session_date: "2024-11-05" })]))).toThrow();
  });

  it("rejects a later session after the requested window", () => {
    const rows = barsWithGap();
    rows[1] = { ...rows[1], session_date: "2026-11-07" };

    expect(() => historyCandles(dailyPayload(rows))).toThrow();
    expect(rows).toHaveLength(2);
  });

  it.each([
    { provider: "other" },
    { adjustment_type: "split_adjusted" },
  ])("rejects a later bar whose provenance does not match the response %j", (patch) => {
    const rows = barsWithGap();
    rows[1] = { ...rows[1], ...patch };

    expect(() => historyCandles(dailyPayload(rows))).toThrow();
  });

  it.each(["rejected", "flagged"])("rejects quality_status %s", (qualityStatus) => {
    const rows = barsWithGap();
    rows[1] = { ...rows[1], quality_status: qualityStatus };

    expect(() => historyCandles(dailyPayload(rows))).toThrow();
  });

  it.each([
    { interval: "1w" },
    { range: "1y" },
    { status: "complete" },
    { coverage_status: "verified" },
    { expected_session_count: 0 },
    { collection: "enabled" },
    { excluded_row_count: -1 },
  ])("rejects a populated series with a malformed envelope %j", (overrides) => {
    expect(() => historyCandles(dailyPayload(barsWithGap(), overrides))).toThrow();
  });

  it.each([
    "interval",
    "range",
    "status",
    "coverage_status",
    "expected_session_count",
    "collection",
    "excluded_row_count",
  ])("rejects a populated series that omits %s", (field) => {
    const body = dailyPayload(barsWithGap());
    delete body[field];

    expect(() => historyCandles(body)).toThrow();
  });

  it("rejects an empty bar list when the daily envelope is missing", () => {
    expect(() => historyCandles({})).toThrow();
    expect(() => historyCandles({ bars: [] })).toThrow();
    expect(() =>
      historyCandles({
        symbol: "TEST",
        status: "unavailable",
        bars: [],
      }),
    ).toThrow();
  });

  it.each([
    { interval: "1w" },
    { range: "1y" },
    { status: "complete" },
    { coverage_status: "verified" },
    { expected_session_count: 0 },
    { collection: "enabled" },
    { excluded_row_count: -1 },
  ])("rejects an empty series with a malformed envelope %j", (overrides) => {
    expect(() => historyCandles(dailyPayload([], overrides))).toThrow();
  });
});
