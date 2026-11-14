import { apiClient } from "./client";
import type { RiskResponse, TradeRiskResponse } from "../types/schemas";

export async function fetchRisk(): Promise<RiskResponse> {
  const response = await apiClient.get<RiskResponse>("/risk/");
  return response.data;
}

export async function fetchTradeRisk(tradeId: number): Promise<TradeRiskResponse> {
  const response = await apiClient.get<TradeRiskResponse>(`/risk/trade/${tradeId}`);
  return response.data;
}
