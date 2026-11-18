import { apiClient } from "./client";
import type {
  CreateTradePayload,
  CreateTradeResponse,
  TradeResponse,
  TradesResponse,
} from "../types/schemas";

export const TRADE_ACTIVITY_LIMIT = 20;

export type ActivityTrade = TradeResponse & { simulated_quote_source?: string | null };
type TradeList = TradesResponse & { trades: ActivityTrade[] };

export async function fetchTrades(): Promise<TradeList> {
  const response = await apiClient.get<TradeList>("/trades/");
  return response.data;
}

export async function createTrade(
  { idempotencyKey, ...payload }: CreateTradePayload & { idempotencyKey: string },
): Promise<CreateTradeResponse> {
  const response = await apiClient.post<CreateTradeResponse>("/trades/", payload, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return response.data;
}
