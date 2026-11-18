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
