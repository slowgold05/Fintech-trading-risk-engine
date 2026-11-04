import { apiClient } from "./client";
import type { CreateOrderPayload, OrderResponse } from "../types/schemas";

export async function fetchOrders(): Promise<{ orders: OrderResponse[] }> {
  const response = await apiClient.get<{ orders: OrderResponse[] }>("/orders/");
  return response.data;
}

export async function createOrder({ idempotencyKey, stepUpCode, ...payload }: CreateOrderPayload & { idempotencyKey: string; stepUpCode?: string }): Promise<OrderResponse> {
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  if (stepUpCode) headers["X-Step-Up-Code"] = stepUpCode;
  const response = await apiClient.post<OrderResponse>("/orders/", payload, { headers });
  return response.data;
}

export async function cancelOrder(id: number): Promise<OrderResponse> {
  const response = await apiClient.post<OrderResponse>(`/orders/${id}/cancel`);
  return response.data;
}
