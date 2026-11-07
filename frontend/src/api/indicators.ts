import { apiClient } from "./client";
import type { HistoryRange } from "./history";

/** Public indicator names for one daily snapshot. No default is applied. */
export type IndicatorName = "sma" | "ema" | "rsi";

const DAILY_INTERVAL = "1d";

/**
 * GET /market/symbols/{symbol}/indicators.
 * The body is the original history read plus flat metadata and points.
 * This call does not request /history again and does not fill defaults.
 */
export async function fetchDailyIndicators(
  symbol: string,
  provider: string,
  adjustment_type: string,
  range: HistoryRange,
  name: IndicatorName,
  period: number,
): Promise<unknown> {
  const response = await apiClient.get<unknown>(
    `/market/symbols/${encodeURIComponent(symbol)}/indicators`,
    {
      params: {
        interval: DAILY_INTERVAL,
        range,
        provider,
        adjustment_type,
        name,
        period,
      },
    },
  );
  return response.data;
}
