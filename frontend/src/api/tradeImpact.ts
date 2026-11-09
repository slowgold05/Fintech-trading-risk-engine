import { apiClient } from "./client";
import type { TradeImpactRequestBody, TradeImpactResponse } from "../types/schemas";

export async function previewTradeImpact(
  payload: TradeImpactRequestBody,
): Promise<TradeImpactResponse> {
  const response = await apiClient.post<TradeImpactResponse>(
    "/portfolio/trade-impact",
    payload,
  );
  return response.data;
}
