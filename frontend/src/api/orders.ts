import { apiClient } from "./client";
import type { CreateOrderPayload, OrderResponse } from "../types/schemas";

export async function fetchOrders(): Promise<{ orders: OrderResponse[] }> {
  const response = await apiClient.get<{ orders: OrderResponse[] }>("/orders/");
  return response.data;
}

export async function createOrder({ idempotencyKey, stepUpCode, ...payload }: CreateOrderPayload & { idempotencyKey: string; stepUpCode?: string }): Promise<OrderResponse> {
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  if (stepUpCode) headers["X-Step-Up-Code"] = stepUpCode;
  const response = await apiClient.post<unknown>("/orders/", payload, { headers });
  if (
    !isVerifiedOrder(response.data, {
      symbol: payload.symbol.trim().toUpperCase(),
      side: payload.side,
      order_type: payload.order_type,
    })
  ) {
    throw new Error("Order result could not be verified");
  }
  return response.data;
}

export async function cancelOrder(id: number): Promise<OrderResponse> {
  const response = await apiClient.post<unknown>(`/orders/${id}/cancel`);
  if (!isCanceledAcknowledgement(response.data, id)) {
    throw new Error("Cancellation result could not be verified");
  }
  return response.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isOrderStatus(value: unknown): value is OrderResponse["status"] {
  return value === "open" || value === "filled" || value === "canceled";
}

function isSide(value: unknown): value is OrderResponse["side"] {
  return value === "buy" || value === "sell";
}

function isOrderType(value: unknown): value is OrderResponse["order_type"] {
  return value === "limit" || value === "market";
}

// Each match reports both sides, so a present trade_ids list has even length.
function isTradeIdPairList(value: unknown): boolean {
  return Array.isArray(value) && value.length % 2 === 0 && value.every(isPositiveInteger);
}

function isLegacyOrder(value: unknown): value is OrderResponse {
  if (!isRecord(value)) return false;

  const quantity = value.quantity;
  const remaining = value.remaining_quantity;
  const limitPrice = value.limit_price;
  const createdAt = value.created_at;
  const tradeIds = value.trade_ids;

  if (!isPositiveInteger(value.id)) return false;
  if (typeof value.symbol !== "string" || value.symbol.length === 0 || value.symbol.length > 20 || value.symbol !== value.symbol.trim()) {
    return false;
  }
  if (!isSide(value.side) || !isOrderType(value.order_type) || !isOrderStatus(value.status)) return false;
  // Legacy acknowledgement numbers stay as returned. Do not coerce request decimals or compare them.
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) return false;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0 || remaining > quantity) {
    return false;
  }
  if (value.order_type === "limit") {
    if (typeof limitPrice !== "number" || !Number.isFinite(limitPrice) || limitPrice <= 0) return false;
  } else if (limitPrice !== null) {
    return false;
  }
  if (typeof createdAt !== "string" || createdAt.length === 0) return false;
  if (tradeIds !== undefined && !isTradeIdPairList(tradeIds)) return false;
  return true;
}

function isVerifiedOrder(
  value: unknown,
  expected: {
    symbol: string;
    side: CreateOrderPayload["side"];
    order_type: CreateOrderPayload["order_type"];
  },
): value is OrderResponse {
  return (
    isLegacyOrder(value) &&
    value.symbol === expected.symbol &&
    value.side === expected.side &&
    value.order_type === expected.order_type
  );
}

function isCanceledAcknowledgement(value: unknown, id: number): value is OrderResponse {
  return isLegacyOrder(value) && value.id === id && value.status === "canceled";
}
