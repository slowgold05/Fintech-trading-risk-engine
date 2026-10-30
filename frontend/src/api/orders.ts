import { apiClient } from "./client";
import type { CreateOrderPayload, OrderResponse } from "../types/schemas";

export async function fetchOrders(): Promise<{ orders: OrderResponse[] }> {
  const response = await apiClient.get<{ orders: OrderResponse[] }>("/orders/");
  return response.data;
}

export async function createOrder({ idempotencyKey, ...payload }: CreateOrderPayload & { idempotencyKey: string }): Promise<OrderResponse> {
  const response = await apiClient.post<OrderResponse>("/orders/", payload, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return response.data;
}

export async function cancelOrder(id: number): Promise<OrderResponse> {
  const response = await apiClient.post<OrderResponse>(`/orders/${id}/cancel`);
  return response.data;
}
