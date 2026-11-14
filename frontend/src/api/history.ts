import { apiClient } from "./client";

/** One stored series. Adjustment stays a string so the UI can filter unsupported values. */
export type CanonicalHistorySeries = {
  provider: string;
  adjustment_type: string;
};

/**
 * Catalog subset of GET /market/data-status.
 * Series stay split by provider and adjustment_type. No default series is implied.
 */
export type MarketDataStatus = {
  read_at: string;
  collection: "disabled";
  coverage_status: "not_verified";
  expected_session_count: null;
  canonical_history: {
    series: CanonicalHistorySeries[];
  };
};

export type AdjustmentType = "raw" | "split_adjusted";

/** Daily history window. The chart defaults to 2y and can request 1m, 3m, 6m, 1y, 2y, or all. */
export type HistoryRange = "1m" | "3m" | "6m" | "1y" | "2y" | "all";

/** One returned canonical bar. Prices stay fixed 6-decimal strings. Volume stays an integer string. */
export type HistoryBar = {
  session_date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  fetched_at: string;
  provider: string;
  adjustment_type: AdjustmentType;
  quality_status: "valid";
};

/** GET /market/symbols/{symbol}/history body. Status is never "complete". */
/**
 * "not_verified" means the reviewed NYSE calendar could not evaluate the requested window
 * (outside its supported range); expected_session_count is then null. Otherwise the
 * calendar compared returned sessions against the standard annual NYSE schedule:
 * "complete" (every expected session present, nothing extra), "gaps" (expected sessions
 * missing, nothing extra), "unexpected_sessions" (nothing missing, but a returned session
 * falls on a day the calendar marks non-trading), or "gaps_and_unexpected_sessions" (both).
 * The calendar models the standard annual schedule only, not ad hoc closures.
 */
export type HistoryCoverageStatus =
  | "not_verified"
  | "complete"
  | "gaps"
  | "unexpected_sessions"
  | "gaps_and_unexpected_sessions";

export type HistoryResponse = {
  symbol: string;
  interval: "1d";
  range: HistoryRange;
  provider: string;
  adjustment_type: AdjustmentType;
  status: "unavailable" | "partial";
  coverage_status: HistoryCoverageStatus;
  expected_session_count: number | null;
  collection: "disabled";
  read_at: string;
  requested_start: string;
  requested_end: string;
  available_start: string | null;
  available_end: string | null;
  excluded_row_count: number;
  bars: HistoryBar[];
};

const DAILY_INTERVAL = "1d";

export async function fetchCachedSeries(): Promise<MarketDataStatus> {
  const response = await apiClient.get<MarketDataStatus>("/market/data-status");
  return response.data;
}

export async function fetchDailyHistory(
  symbol: string,
  provider: string,
  adjustment_type: string,
  range: HistoryRange,
): Promise<HistoryResponse> {
  const response = await apiClient.get<HistoryResponse>(
    `/market/symbols/${encodeURIComponent(symbol)}/history`,
    {
      params: {
        interval: DAILY_INTERVAL,
        range,
        provider,
        adjustment_type,
      },
    },
  );
  return response.data;
}
