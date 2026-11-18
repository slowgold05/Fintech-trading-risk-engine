import { apiClient } from "./client";
import type { PortfolioResponse } from "../types/schemas";

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const response = await apiClient.get<PortfolioResponse>("/portfolio/");
  return response.data;
}

export async function resetDemoPortfolio(idempotencyKey: string): Promise<void> {
  await apiClient.post("/portfolio/reset", undefined, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

type PortfolioPerformance = {
  money_weighted_return_pct: string | null;
  series: { session_date: string; account_value: string | null }[];
};

export async function fetchPortfolioPerformance(): Promise<PortfolioPerformance> {
  const response = await apiClient.get<PortfolioPerformance>("/portfolio/performance", {
    params: { range: "1y" },
  });
  return response.data;
}
