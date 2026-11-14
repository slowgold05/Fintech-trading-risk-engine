import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardChartPreferencesInTests,
  loadChartPreferences,
  saveChartPreferences,
  type ChartPreferences,
} from "./chartPreferences";

const STORAGE_KEY = "sentinel.dailyHistory.chartPreferences";

function preferences(patch: Partial<ChartPreferences> = {}): ChartPreferences {
  return {
    range: "1y",
    indicator: "ema",
    period: "50",
    chartType: "area",
    ...patch,
  };
}

describe("chartPreferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips a complete preference object", () => {
    const value = preferences();
    saveChartPreferences(value);
    expect(loadChartPreferences()).toEqual(value);
  });

  it("returns an empty object when nothing is stored", () => {
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadChartPreferences()).toEqual({});
  });

  it("returns an empty object for invalid JSON without throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(() => loadChartPreferences()).not.toThrow();
    expect(loadChartPreferences()).toEqual({});
  });

  it("returns an empty object for JSON that is not an object", () => {
    for (const raw of ["null", "42", "\"1y\"", "[]"]) {
      window.localStorage.setItem(STORAGE_KEY, raw);
      expect(loadChartPreferences()).toEqual({});
    }
  });

  it("omits an invalid range and keeps the other valid fields", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ range: "3y", indicator: "sma", period: "20", chartType: "line", symbol: "AAPL" }),
    );
    expect(loadChartPreferences()).toEqual({ indicator: "sma", period: "20", chartType: "line" });
  });

  it("omits an invalid indicator, chart type, or period without throwing", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ range: "6m", indicator: "vwap", period: "abc", chartType: "bar" }),
    );
    expect(() => loadChartPreferences()).not.toThrow();
    expect(loadChartPreferences()).toEqual({ range: "6m" });
  });

  it("omits a period that is not one to three digits", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ range: "all", indicator: "rsi", period: "20.5", chartType: "candlestick" }),
    );
    expect(loadChartPreferences()).toEqual({ range: "all", indicator: "rsi", chartType: "candlestick" });

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ range: "1m", indicator: "none", period: 20, chartType: "line" }),
    );
    expect(loadChartPreferences()).toEqual({ range: "1m", indicator: "none", chartType: "line" });
  });

  it("returns an empty object when localStorage.getItem throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadChartPreferences()).toEqual({});
  });

  it("does not throw when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveChartPreferences(preferences())).not.toThrow();
  });

  it("drops the stored key when a test discards preferences", () => {
    saveChartPreferences(preferences());
    discardChartPreferencesInTests();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadChartPreferences()).toEqual({});
  });

  it("does not throw when removing the stored key throws", () => {
    saveChartPreferences(preferences());
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => discardChartPreferencesInTests()).not.toThrow();
  });
});
