import { apiClient } from "./client";
import type { RiskScenarioShock, RiskScenariosResponse } from "../types/schemas";

export async function previewRiskScenarios(
  shocks: RiskScenarioShock[],
): Promise<RiskScenariosResponse> {
  const response = await apiClient.post<RiskScenariosResponse>("/risk/scenarios", { shocks });
  return response.data;
}
