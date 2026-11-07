import { apiClient } from "./client";

const REQUEST_ERROR = "Invalid order detail request";
const RESPONSE_ERROR = "Invalid order detail response";

const QTY = /^(?:0|[1-9]\d*)\.\d{6}$/;
const MONEY = /^(?:0|[1-9]\d*)\.\d{2}$/;
const MONEY_SIGNED = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;

export interface OrderFill {
  trade_id: number;
  quantity: string;
  execution_price: string;
  notional: string;
  realized_pnl: string;
  executed_at: string;
}

export interface OrderDetailResponse {
  order_id: number;
  symbol: string;
  side: "buy" | "sell";
  order_type: "limit" | "market";
  status: "open" | "filled" | "canceled";
  currency: "USD";
  quantity: string;
  filled_quantity: string;
  remaining_quantity: string;
  limit_price: string | null;
  created_at: string;
  canceled_at: string | null;
  read_at: string;
  limit: number;
  total_fill_count: number;
  has_more: boolean;
  next_after_id: number | null;
  fills: OrderFill[];
}

export interface OrderDetailOptions {
  limit?: number;
  afterId?: number;
}

function fail(): never {
  throw new Error(RESPONSE_ERROR);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month];
}

function scaled6(value: string): bigint {
  return BigInt(value.replace(".", ""));
}

function requireQty(value: unknown, positive: boolean): string {
  if (typeof value !== "string" || !QTY.test(value)) fail();
  if (positive && scaled6(value) === 0n) fail();
  return value;
}

function requireMoney(value: unknown, signed: boolean): string {
  const pattern = signed ? MONEY_SIGNED : MONEY;
  if (typeof value !== "string" || !pattern.test(value)) fail();
  return value;
}

function requireUtc(value: unknown): string {
  if (!isUtcTimestamp(value)) fail();
  return value;
}

function parseFill(value: unknown, afterId: number): OrderFill {
  if (!isRecord(value)) fail();
  const tradeId = value.trade_id;
  if (!isPositiveSafeInteger(tradeId) || tradeId <= afterId) fail();
  return {
    trade_id: tradeId,
    quantity: requireQty(value.quantity, true),
    execution_price: requireQty(value.execution_price, true),
    notional: requireMoney(value.notional, false),
    realized_pnl: requireMoney(value.realized_pnl, true),
    executed_at: requireUtc(value.executed_at),
  };
}

function parseOrderDetail(data: unknown, orderId: number, limit: number, afterId: number): OrderDetailResponse {
  if (!isRecord(data)) fail();
  if (data.order_id !== orderId || data.currency !== "USD") fail();
  if (data.side !== "buy" && data.side !== "sell") fail();
  if (data.order_type !== "limit" && data.order_type !== "market") fail();
  if (data.status !== "open" && data.status !== "filled" && data.status !== "canceled") fail();
  if (typeof data.symbol !== "string" || data.symbol.length === 0 || data.symbol.length > 20 || data.symbol !== data.symbol.trim()) {
    fail();
  }
  if (data.limit !== limit || !isSafeCount(data.total_fill_count) || typeof data.has_more !== "boolean") fail();

  const quantity = requireQty(data.quantity, true);
  const filled = requireQty(data.filled_quantity, false);
  const remaining = requireQty(data.remaining_quantity, false);
  if (scaled6(filled) + scaled6(remaining) !== scaled6(quantity)) fail();
  if (scaled6(remaining) > scaled6(quantity)) fail();
  if (data.status === "filled" && scaled6(remaining) !== 0n) fail();

  let limitPrice: string | null;
  if (data.order_type === "market") {
    if (data.limit_price !== null) fail();
    limitPrice = null;
  } else {
    limitPrice = requireQty(data.limit_price, true);
  }

  const canceledAt = data.canceled_at === null ? null : requireUtc(data.canceled_at);
  if (!Array.isArray(data.fills) || data.fills.length > limit) fail();

  let cursor = afterId;
  let pageQuantity = 0n;
  const filledUnits = scaled6(filled);
  const fills = data.fills.map((fill) => {
    const parsed = parseFill(fill, cursor);
    cursor = parsed.trade_id;
    pageQuantity += scaled6(parsed.quantity);
    if (pageQuantity > filledUnits) fail();
    return parsed;
  });

  const count = data.total_fill_count;
  if (count < fills.length) fail();
  let nextAfterId: number | null;
  if (data.has_more) {
    const last = fills[fills.length - 1];
    if (fills.length !== limit || last === undefined || data.next_after_id !== last.trade_id || count <= fills.length) {
      fail();
    }
    nextAfterId = last.trade_id;
  } else if (data.next_after_id !== null) {
    fail();
  } else {
    nextAfterId = null;
  }

  return {
    order_id: orderId,
    symbol: data.symbol,
    side: data.side,
    order_type: data.order_type,
    status: data.status,
    currency: "USD",
    quantity,
    filled_quantity: filled,
    remaining_quantity: remaining,
    limit_price: limitPrice,
    created_at: requireUtc(data.created_at),
    canceled_at: canceledAt,
    read_at: requireUtc(data.read_at),
    limit,
    total_fill_count: count,
    has_more: data.has_more,
    next_after_id: nextAfterId,
    fills,
  };
}

export async function fetchOrderDetail(
  orderId: number,
  options?: OrderDetailOptions,
  signal?: AbortSignal,
): Promise<OrderDetailResponse> {
  if (!isPositiveSafeInteger(orderId)) throw new Error(REQUEST_ERROR);
  const limit = options?.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error(REQUEST_ERROR);
  const afterId = options?.afterId;
  if (afterId !== undefined && !isPositiveSafeInteger(afterId)) throw new Error(REQUEST_ERROR);

  const params: { limit: number; after_id?: number } = { limit };
  if (afterId !== undefined) params.after_id = afterId;

  const response = await apiClient.get<unknown>(`/orders/${orderId}`, { params, signal });
  return parseOrderDetail(response.data, orderId, limit, afterId ?? 0);
}
