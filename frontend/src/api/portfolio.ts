import { apiClient } from "./client";
import type {
  PortfolioPnlResponse,
  PortfolioResponse,
} from "../types/schemas";

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const response = await apiClient.get<PortfolioResponse>("/portfolio/");
  return response.data;
}

export async function fetchPortfolioPnl(): Promise<PortfolioPnlResponse> {
  const response = await apiClient.get<PortfolioPnlResponse>("/portfolio/pnl");
  return response.data;
}
