import { apiClient } from "./client";
import type { RiskMetricsResponse } from "../types/schemas";

export async function fetchRiskMetrics(range: "1y" | "2y"): Promise<RiskMetricsResponse> {
  const response = await apiClient.get<RiskMetricsResponse>("/portfolio/risk-metrics", {
    params: { range },
  });
  return response.data;
}
