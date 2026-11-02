import { apiClient } from "./client";
import type {
  CreateTradePayload,
  CreateTradeResponse,
  TradesResponse,
} from "../types/schemas";

export async function fetchTrades(): Promise<TradesResponse> {
  const response = await apiClient.get<TradesResponse>("/trades/");
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
