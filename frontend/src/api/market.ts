import { apiClient } from "./client";
import type {
  MarketHeatmapResponse,
  MarketOverviewResponse,
  MarketResearchResponse,
  MarketTrendingResponse,
} from "../types/schemas";

export async function fetchMarketHeatmap(): Promise<MarketHeatmapResponse> {
  const response = await apiClient.get<MarketHeatmapResponse>(
    "/market/heatmap",
    { params: { limit: 1000 } },
  );
  return response.data;
}

export async function fetchMarketOverview(): Promise<MarketOverviewResponse> {
  const response =
    await apiClient.get<MarketOverviewResponse>("/market/overview");
  return response.data;
}

export async function fetchMarketTrending(): Promise<MarketTrendingResponse> {
  const response =
    await apiClient.get<MarketTrendingResponse>("/market/trending");
  return response.data;
}

export async function fetchMarketResearch(
  symbol: string,
): Promise<MarketResearchResponse> {
  const response = await apiClient.get<MarketResearchResponse>(
    `/market/research/${encodeURIComponent(symbol)}`,
  );
  return response.data;
}
