import { apiClient } from "./client";
import type { AttributionResponse } from "../types/schemas";

export async function fetchAttribution(): Promise<AttributionResponse> {
  const response = await apiClient.get<AttributionResponse>("/portfolio/attribution");
  return response.data;
}
