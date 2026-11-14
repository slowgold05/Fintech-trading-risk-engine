import type { HistoryRange } from "../api/history";

export type ChartPreferences = {
  range: HistoryRange;
  indicator: "none" | "sma" | "ema" | "rsi" | "macd" | "bollinger";
  period: string;
  chartType: "candlestick" | "line" | "area";
};

const STORAGE_KEY = "sentinel.dailyHistory.chartPreferences";

const VALID_RANGES = new Set(["1m", "3m", "6m", "1y", "2y", "all"]);
const VALID_INDICATORS = new Set(["none", "sma", "ema", "rsi", "macd", "bollinger"]);
const VALID_CHART_TYPES = new Set(["candlestick", "line", "area"]);

export function loadChartPreferences(): Partial<ChartPreferences> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const candidate = parsed as Record<string, unknown>;
    const result: Partial<ChartPreferences> = {};
    if (typeof candidate.range === "string" && VALID_RANGES.has(candidate.range)) {
      result.range = candidate.range as HistoryRange;
    }
    if (typeof candidate.indicator === "string" && VALID_INDICATORS.has(candidate.indicator)) {
      result.indicator = candidate.indicator as ChartPreferences["indicator"];
    }
    if (typeof candidate.period === "string" && /^\d{1,3}$/.test(candidate.period)) {
      result.period = candidate.period;
    }
    if (typeof candidate.chartType === "string" && VALID_CHART_TYPES.has(candidate.chartType)) {
      result.chartType = candidate.chartType as ChartPreferences["chartType"];
    }
    return result;
  } catch {
    return {};
  }
}

export function saveChartPreferences(preferences: ChartPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Best-effort only. A private window, blocked site data, or a full quota
    // must not break the chart - the page already works correctly without this.
  }
}

export function discardChartPreferencesInTests(): void {
  if (import.meta.env.MODE !== "test") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only, matching saveChartPreferences.
  }
}
