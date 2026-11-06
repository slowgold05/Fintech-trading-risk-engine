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
export type HistoryResponse = {
  symbol: string;
  interval: "1d";
  range: "2y";
  provider: string;
  adjustment_type: AdjustmentType;
  status: "unavailable" | "partial";
  coverage_status: "not_verified";
  expected_session_count: null;
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
const DAILY_RANGE = "2y";

export async function fetchCachedSeries(): Promise<MarketDataStatus> {
  const response = await apiClient.get<MarketDataStatus>("/market/data-status");
  return response.data;
}

export async function fetchDailyHistory(
  symbol: string,
  provider: string,
  adjustment_type: string,
): Promise<HistoryResponse> {
  const response = await apiClient.get<HistoryResponse>(
    `/market/symbols/${encodeURIComponent(symbol)}/history`,
    {
      params: {
        interval: DAILY_INTERVAL,
        range: DAILY_RANGE,
        provider,
        adjustment_type,
      },
    },
  );
  return response.data;
}
