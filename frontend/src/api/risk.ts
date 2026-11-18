import { apiClient } from "./client";
import type { RiskAssessmentResponse, TradeRiskResponse } from "../types/schemas";

type RecordedAssessment = Omit<RiskAssessmentResponse, "trade"> & {
  trade: (NonNullable<RiskAssessmentResponse["trade"]> & { demo_seed?: boolean }) | null;
};
type RecordedRisk = { assessments: RecordedAssessment[] };

export async function fetchRisk(): Promise<RecordedRisk> {
  const response = await apiClient.get<RecordedRisk>("/risk/");
  return response.data;
}

export async function fetchTradeRisk(tradeId: number): Promise<TradeRiskResponse> {
  const response = await apiClient.get<TradeRiskResponse>(`/risk/trade/${tradeId}`);
  return response.data;
}
