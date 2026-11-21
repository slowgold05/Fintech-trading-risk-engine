import { apiClient } from "./client";
import type { PortfolioPositionResponse, PortfolioResponse } from "../types/schemas";

type ValuedPortfolio = Omit<PortfolioResponse, "positions"> & {
  positions: Array<PortfolioPositionResponse & { realized_pnl?: number | null }>;
};

export async function fetchPortfolio(): Promise<ValuedPortfolio> {
  const response = await apiClient.get<ValuedPortfolio>("/portfolio/");
  return response.data;
}

export async function resetDemoPortfolio(idempotencyKey: string): Promise<void> {
  await apiClient.post("/portfolio/reset", undefined, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export type PerformanceRange = "1y" | "2y";
export type PerformanceSession = {
  session_date: string;
  status?: "available" | "unavailable";
  account_value: string | null;
  twr_index?: string | null;
  benchmark_index?: string | null;
  daily_pnl?: string | null;
  cumulative_pnl?: string | null;
  unavailable_symbols?: string[];
};

export type PortfolioPerformance = {
  money_weighted_return_pct: string | null;
  series: PerformanceSession[];
  requested_start?: string;
  requested_end?: string;
  demo_price_series?: Record<string, { provider: string; adjustment: string }>;
  split_adjusted_history_sources?: Record<string, string>;
};

export async function fetchPerformanceRange(range: PerformanceRange): Promise<PortfolioPerformance> {
  const response = await apiClient.get<PortfolioPerformance>("/portfolio/performance", {
    params: { range },
  });
  return response.data;
}

export function fetchPortfolioPerformance() {
  return fetchPerformanceRange("1y");
}
