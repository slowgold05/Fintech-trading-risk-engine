import { describe, expect, it } from "vitest";
import { indicatorOverlay } from "./historyData";

const READ_AT = "2026-11-06T18:30:00.000Z";
const FETCHED_AT = "2026-01-20T21:05:00.000Z";
const REQUESTED_START = "2024-11-06";
const REQUESTED_END = "2026-11-06";
const DATES = [
  "2026-01-02",
  "2026-01-05",
  "2026-01-08",
  "2026-01-12",
  "2026-01-15",
  "2026-01-20",
] as const;
const CLOSES = ["1.000000", "4.000000", "2.000000", "8.000000", "3.000000", "9.000000"] as const;
const SMA_VALUES = [null, null, "2.333333", "4.666667", "4.333333", "6.666667"] as const;

const REQUEST = {
  symbol: "BRK/B",
  provider: "fixture",
  adjustment_type: "split_adjusted",
  name: "sma" as const,
  period: 3,
};

type PointValue = string | null;

function historyFor(count: number) {
  const dates = DATES.slice(0, count);
  const bars = dates.map((session_date, index) => ({
    session_date,
    open: CLOSES[index],
    high: CLOSES[index],
    low: CLOSES[index],
    close: CLOSES[index],
    volume: String(1000 + index),
    fetched_at: FETCHED_AT,
    provider: REQUEST.provider,
    adjustment_type: REQUEST.adjustment_type,
    quality_status: "valid" as const,
  }));
  return {
    symbol: REQUEST.symbol,
    interval: "1d" as const,
    range: "2y" as const,
    provider: REQUEST.provider,
    adjustment_type: REQUEST.adjustment_type,
    status: count === 0 ? ("unavailable" as const) : ("partial" as const),
    coverage_status: "not_verified" as const,
    expected_session_count: null,
    collection: "disabled" as const,
    read_at: READ_AT,
    requested_start: REQUESTED_START,
    requested_end: REQUESTED_END,
    available_start: dates[0] ?? null,
    available_end: dates[dates.length - 1] ?? null,
    excluded_row_count: 0,
    bars,
  };
}

function indicatorStatus(count: number, period: number): "unavailable" | "insufficient" | "partial" {
  if (count === 0) {
    return "unavailable";
  }
  if (count < period) {
    return "insufficient";
  }
  return "partial";
}

function payloadFor(
  count: number,
  options?: {
    name?: "sma" | "ema";
    period?: number;
    values?: PointValue[];
    status?: string;
  },
) {
  const period = options?.period ?? REQUEST.period;
  const history = historyFor(count);
  const values =
    options?.values ??
    DATES.slice(0, count).map((_, index) =>
      index < Math.min(period - 1, count) ? null : SMA_VALUES[index],
    );
  const flat: Omit<ReturnType<typeof historyFor>, "bars"> = { ...history };
  Reflect.deleteProperty(flat, "bars");
  return {
    ...flat,
    history,
    name: options?.name ?? REQUEST.name,
    period,
    source: "observed_valid_closes",
    session_basis: "not_exchange_sessions",
    observed_valid_closes: count,
    status: options?.status ?? indicatorStatus(count, period),
    points: DATES.slice(0, count).map((session_date, index) => ({
      session_date: String(session_date),
      value: values[index] ?? null,
    })),
  };
}

function overlay(
  payload: ReturnType<typeof payloadFor>,
  request: Partial<typeof REQUEST> = {},
) {
  return indicatorOverlay(payload, { ...REQUEST, period: payload.period, name: payload.name, ...request });
}

describe("indicatorOverlay", () => {
  it("keeps the original nested history, SMA strings, and warmup whitespace", () => {
    const payload = payloadFor(6);
    const before = structuredClone(payload);

    const result = overlay(payload);

    expect(result.history).toBe(payload.history);
    expect(payload).toEqual(before);
    expect(result.history).toEqual(before.history);
    expect(result.name).toBe("sma");
    expect(result.period).toBe(3);
    expect(result.status).toBe("partial");
    expect(result.values).toEqual([...SMA_VALUES]);
    expect(result.values.filter((value) => value !== null).every((value) => typeof value === "string")).toBe(
      true,
    );
    expect(result.candles.map((candle) => candle.time)).toEqual([...DATES]);
    expect(result.candles.map((candle) => candle.close)).toEqual(CLOSES.map(Number));
    expect(result.line).toEqual([
      { time: DATES[0] },
      { time: DATES[1] },
      { time: DATES[2], value: Number("2.333333") },
      { time: DATES[3], value: Number("4.666667") },
      { time: DATES[4], value: Number("4.333333") },
      { time: DATES[5], value: Number("6.666667") },
    ]);
    expect(Object.hasOwn(result.line[0], "value")).toBe(false);
    expect(Object.hasOwn(result.line[1], "value")).toBe(false);
    for (const key of [
      "symbol",
      "interval",
      "range",
      "provider",
      "adjustment_type",
      "coverage_status",
      "expected_session_count",
      "collection",
      "read_at",
      "requested_start",
      "requested_end",
      "available_start",
      "available_end",
      "excluded_row_count",
    ] as const) {
      expect(payload[key]).toEqual(payload.history[key]);
    }
    expect(result.history.symbol).toBe(REQUEST.symbol);
    expect(result.history.provider).toBe(REQUEST.provider);
    expect(result.history.adjustment_type).toBe(REQUEST.adjustment_type);
    expect(result.history.bars[0]?.volume).toBe("1000");
    expect(result.history.bars[0]?.close).toBe("1.000000");
  });

  it("accepts stored ema 3 strings without recomputing them", () => {
    const emaValues = [null, null, "2.333333", "5.166667", "4.083333", "6.541667"] as const;
    const payload = payloadFor(6, { name: "ema", values: [...emaValues] });
    const result = overlay(payload);
    expect(result.name).toBe("ema");
    expect(result.values).toEqual([...emaValues]);
    expect(result.status).toBe("partial");
  });

  it("accepts an empty snapshot only as unavailable", () => {
    const payload = payloadFor(0, { period: 3 });
    const result = overlay(payload);
    expect(result.status).toBe("unavailable");
    expect(result.candles).toEqual([]);
    expect(result.line).toEqual([]);
    expect(result.values).toEqual([]);
    expect(result.history.available_start).toBeNull();
    expect(result.history.available_end).toBeNull();
    expect(result.history.bars).toEqual([]);
  });

  it("accepts a short snapshot as insufficient with only warmup points", () => {
    const payload = payloadFor(2, { period: 3, values: [null, null] });
    const result = overlay(payload);
    expect(result.status).toBe("insufficient");
    expect(result.values).toEqual([null, null]);
    expect(result.line).toEqual([{ time: DATES[0] }, { time: DATES[1] }]);
    expect(result.line.every((point) => !Object.hasOwn(point, "value"))).toBe(true);
    expect(result.history.available_start).toBe(DATES[0]);
    expect(result.history.available_end).toBe(DATES[1]);
  });

  it.each([
    ["period 2 sma", { count: 6, period: 2, values: [null, "2.500000", "3.000000", "5.000000", "5.500000", "6.000000"] }],
    ["period 200", { count: 6, period: 200, values: [null, null, null, null, null, null] }],
    ["period 200 empty", { count: 0, period: 200, values: [] }],
  ] as const)("accepts boundary %s", (_label, spec) => {
    const payload = payloadFor(spec.count, { period: spec.period, values: [...spec.values] });
    const result = overlay(payload);
    expect(result.period).toBe(spec.period);
    expect(result.status).toBe(indicatorStatus(spec.count, spec.period));
    expect(result.values).toEqual([...spec.values]);
  });

  it("rejects malformed nested OHLC without returning a partial line", () => {
    const payload = payloadFor(6);
    payload.history.bars[2].low = "9.000000";
    payload.history.bars[2].high = "1.000000";
    expect(() => overlay(payload)).toThrow(/OHLC/);
  });

  it.each([
    ["symbol", { symbol: "OTHER" }],
    ["provider", { provider: "other-feed" }],
    ["adjustment_type", { adjustment_type: "raw" }],
  ] as const)("rejects request %s that the body does not use", (field, requestPatch) => {
    const payload = payloadFor(6);
    expect(() => overlay(payload, requestPatch)).toThrow(/request identity/i);
    expect(payload.history[field]).not.toBe((requestPatch as Record<string, unknown>)[field]);
  });

  it.each([
    ["name SMA", { name: "SMA" }, /name is invalid/i],
    ["name mismatch", { name: "ema" }, /name does not match/i],
    ["period 1", { period: 1 }, /period is invalid/i],
    ["period 201", { period: 201 }, /period is invalid/i],
    ["period 2.5", { period: 2.5 }, /period is invalid/i],
    ["period string", { period: "3" }, /period is invalid/i],
    ["period mismatch", { period: 4 }, /period does not match/i],
  ] as const)("rejects %s", (_label, patch, pattern) => {
    const payload = payloadFor(6) as Record<string, unknown>;
    Object.assign(payload, patch);
    expect(() =>
      indicatorOverlay(payload, {
        ...REQUEST,
        name: "name" in patch && patch.name === "ema" ? "sma" : REQUEST.name,
      }),
    ).toThrow(pattern);
  });

  it.each([
    ["read_at", "read_at", "2026-11-06T18:31:00.000Z"],
    ["excluded_row_count", "excluded_row_count", 1],
    ["available_end", "available_end", DATES[4]],
    ["interval", "interval", "1h"],
  ] as const)("rejects flat %s that differs from nested history", (_label, key, value) => {
    const payload = payloadFor(6);
    (payload as Record<string, unknown>)[key] = value;
    expect(() => overlay(payload)).toThrow(/metadata does not match/i);
  });

  it.each([
    ["short point list", (payload: ReturnType<typeof payloadFor>) => {
      payload.points = payload.points.slice(0, 5);
    }],
    ["long point list", (payload: ReturnType<typeof payloadFor>) => {
      payload.points = [...payload.points, { session_date: "2026-01-21", value: "1.000000" }];
    }],
    ["shifted date", (payload: ReturnType<typeof payloadFor>) => {
      payload.points[3].session_date = DATES[4];
    }],
    ["observed count 5", (payload: ReturnType<typeof payloadFor>) => {
      payload.observed_valid_closes = 5;
    }],
    ["observed count string", (payload: ReturnType<typeof payloadFor>) => {
      (payload as { observed_valid_closes: unknown }).observed_valid_closes = "6";
    }],
  ])("rejects %s", (_label, mutate) => {
    const payload = payloadFor(6);
    mutate(payload);
    expect(() => overlay(payload)).toThrow();
  });

  it.each([
    ["empty partial", 0, "partial"],
    ["empty complete", 0, "complete"],
    ["short partial", 2, "partial"],
    ["short unavailable", 2, "unavailable"],
    ["full insufficient", 6, "insufficient"],
    ["full complete", 6, "complete"],
    ["full unavailable", 6, "unavailable"],
  ] as const)("rejects status %s", (_label, count, status) => {
    const period = 3;
    const values = Array.from({ length: count }, (_, index) =>
      index < Math.min(period - 1, count) ? null : "1.000000",
    );
    const payload = payloadFor(count, { period, values, status });
    expect(() => overlay(payload)).toThrow(/status is invalid/i);
  });

  it.each([
    ["source", "source", "exchange_closes"],
    ["session basis", "session_basis", "exchange_sessions"],
  ] as const)("rejects %s", (_label, key, value) => {
    const payload = payloadFor(6);
    (payload as Record<string, unknown>)[key] = value;
    expect(() => overlay(payload)).toThrow();
  });

  it.each([
    ["non-null warmup", 0, "1.000000"],
    ["missing warmup", 0, undefined],
    ["null computed", 2, null],
    ["numeric zero", 2, 0],
    ["string zero", 2, "0.000000"],
    ["short decimal", 2, "2.33333"],
    ["long decimal", 2, "2.3333333"],
    ["NaN string", 2, "NaN"],
    ["Infinity", 2, Infinity],
    ["float", 2, 2.333333],
  ] as const)("rejects %s", (_label, index, value) => {
    const payload = payloadFor(6);
    payload.points[index].value = value as never;
    expect(() => overlay(payload)).toThrow();
    expect(payload.history.bars.map((bar) => bar.close)).toEqual([...CLOSES]);
  });
});
