import { apiClient } from "./client";
import type { RiskResponse } from "../types/schemas";

export async function fetchRisk(): Promise<RiskResponse> {
  const response = await apiClient.get<RiskResponse>("/risk/");
  return response.data;
}
