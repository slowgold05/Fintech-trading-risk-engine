import { apiClient } from "./client";
import type { TradeSide } from "../types/schemas";

const REQUEST_ERROR = "Invalid order preview request";
const RESPONSE_ERROR = "Invalid order preview response";

const ORDER_DECIMAL = /^(?:(\d{1,12})(?:\.(\d{1,6}))?|\.(\d{1,6}))$/;
const MONEY_SIGNED = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
const MONEY_NONNEG = /^(?:0|[1-9]\d*)\.\d{2}$/;
const QTY_SIGNED = /^-?(?:0|[1-9]\d*)\.\d{6}$/;
const QTY_NONNEG = /^(?:0|[1-9]\d*)\.\d{6}$/;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;

export interface OrderPreviewPayload {
  symbol: string;
  side: TradeSide;
  order_type: "limit" | "market";
  quantity: string;
  limit_price?: string;
}

export interface OrderPreviewResponse {
  symbol: string;
  side: TradeSide;
  order_type: "limit" | "market";
  quantity: string;
  limit_price: string | null;
  read_at: string;
  quote_observed_at: string | null;
  status: "eligible" | "blocked" | "unavailable";
  reason: string | null;
  step_up_required: boolean | null;
  buying_power: string;
  sell_available: string | null;
  initial_reservation: string | null;
  estimated_fill_quantity: string | null;
  estimated_fill_notional: string | null;
  unfilled_quantity: string | null;
}

type PreviewStatus = OrderPreviewResponse["status"];
type OrderType = OrderPreviewPayload["order_type"];

interface NormalizedPreviewRequest {
  symbol: string;
  side: TradeSide;
  order_type: OrderType;
  quantity: string;
  limit_price?: string;
}

function failResponse(): never {
  throw new Error(RESPONSE_ERROR);
}

function stripZeros(digits: string): string {
  const stripped = digits.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

export function normalizeOrderDecimal(value: string): string | null {
  if (typeof value !== "string") return null;
  const match = ORDER_DECIMAL.exec(value.trim());
  if (!match) return null;
  const whole = stripZeros(match[1] ?? "0");
  const fraction = (match[2] ?? match[3] ?? "").padEnd(6, "0");
  if (BigInt(stripZeros(whole + fraction)) === 0n) return null;
  return `${whole}.${fraction}`;
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
  // Python datetime years start at 1, so year 0000 is not a backend UTC instant.
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month];
}

function utcMicrosKey(value: string): string {
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) failResponse();
  const year = match[1];
  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  const second = match[6];
  if (!year || !month || !day || !hour || !minute || !second) failResponse();
  const fraction = (match[7] ?? "").padEnd(6, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction}Z`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(body: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(body, key)) failResponse();
  return body[key];
}

function isSide(value: unknown): value is TradeSide {
  return value === "buy" || value === "sell";
}

function isOrderType(value: unknown): value is OrderType {
  return value === "limit" || value === "market";
}

function isStatus(value: unknown): value is PreviewStatus {
  return value === "eligible" || value === "blocked" || value === "unavailable";
}

function expectFixed(value: unknown, scale: 2 | 6, signed: boolean): string {
  if (typeof value !== "string") failResponse();
  const pattern =
    scale === 2 ? (signed ? MONEY_SIGNED : MONEY_NONNEG) : signed ? QTY_SIGNED : QTY_NONNEG;
  if (!pattern.test(value)) failResponse();
  return value;
}

function scaledFixed(value: string): bigint {
  // Whole*scale+fraction drops the sign on "-0.250000". Drop the dot, then strip zeros.
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(".", "");
  const magnitude = digits.replace(/^0+/, "") || "0";
  const parsed = BigInt(magnitude);
  return negative ? -parsed : parsed;
}

function scaled6(value: string): bigint {
  return scaledFixed(value);
}

function scaled2(value: string): bigint {
  return scaledFixed(value);
}

function normalizeRequest(payload: OrderPreviewPayload): NormalizedPreviewRequest {
  if (typeof payload.symbol !== "string" || !isSide(payload.side) || !isOrderType(payload.order_type)) {
    throw new Error(REQUEST_ERROR);
  }
  const symbol = payload.symbol.trim().toUpperCase();
  if (symbol === "" || symbol.length > 20 || typeof payload.quantity !== "string") {
    throw new Error(REQUEST_ERROR);
  }
  const quantity = normalizeOrderDecimal(payload.quantity);
  if (quantity === null) throw new Error(REQUEST_ERROR);

  const request: NormalizedPreviewRequest = {
    symbol,
    side: payload.side,
    order_type: payload.order_type,
    quantity,
  };
  if (payload.order_type === "market") return request;
  if (typeof payload.limit_price !== "string") throw new Error(REQUEST_ERROR);
  const limit_price = normalizeOrderDecimal(payload.limit_price);
  if (limit_price === null) throw new Error(REQUEST_ERROR);
  request.limit_price = limit_price;
  return request;
}

function parseReason(status: PreviewStatus, value: unknown): string | null {
  if (status === "eligible") {
    if (value !== null) failResponse();
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") failResponse();
  return value;
}

function parseStepUp(status: PreviewStatus, orderType: OrderType, value: unknown): boolean | null {
  if (typeof value !== "boolean" && value !== null) failResponse();
  if (value === null && (status === "eligible" || orderType === "limit")) failResponse();
  return value;
}

function parseSellAvailable(value: unknown): string | null {
  if (value === null) return null;
  return expectFixed(value, 6, true);
}

function parseEstimates(
  body: Record<string, unknown>,
  status: PreviewStatus,
  side: TradeSide,
  orderType: OrderType,
  quantity: string,
): Pick<
  OrderPreviewResponse,
  | "initial_reservation"
  | "estimated_fill_quantity"
  | "estimated_fill_notional"
  | "unfilled_quantity"
> {
  const initial = field(body, "initial_reservation");
  const fillQuantity = field(body, "estimated_fill_quantity");
  const fillNotional = field(body, "estimated_fill_notional");
  const unfilled = field(body, "unfilled_quantity");

  if (status !== "eligible") {
    if (initial !== null || fillQuantity !== null || fillNotional !== null || unfilled !== null) {
      failResponse();
    }
    return {
      initial_reservation: null,
      estimated_fill_quantity: null,
      estimated_fill_notional: null,
      unfilled_quantity: null,
    };
  }

  const estimated_fill_quantity = expectFixed(fillQuantity, 6, false);
  const unfilled_quantity = expectFixed(unfilled, 6, false);
  const estimated_fill_notional = expectFixed(fillNotional, 2, false);
  // Two half-cent slices can fill 0.02 while the limit reservation is 0.01.
  if (scaled6(estimated_fill_quantity) + scaled6(unfilled_quantity) !== scaled6(quantity)) {
    failResponse();
  }
  const fillIsZero = scaled6(estimated_fill_quantity) === 0n;
  const notionalIsZero = scaled2(estimated_fill_notional) === 0n;
  if (fillIsZero !== notionalIsZero) failResponse();

  if (side === "sell") {
    if (initial !== null) failResponse();
    return {
      initial_reservation: null,
      estimated_fill_quantity,
      estimated_fill_notional,
      unfilled_quantity,
    };
  }

  const initial_reservation = expectFixed(initial, 2, false);
  // Market buys reserve the summed per-fill cents, which is the fill notional.
  if (orderType === "market" && initial_reservation !== estimated_fill_notional) failResponse();
  return {
    initial_reservation,
    estimated_fill_quantity,
    estimated_fill_notional,
    unfilled_quantity,
  };
}

function parseOrderPreview(data: unknown, request: NormalizedPreviewRequest): OrderPreviewResponse {
  if (!isRecord(data)) failResponse();

  const symbol = field(data, "symbol");
  const side = field(data, "side");
  const orderType = field(data, "order_type");
  const quantity = field(data, "quantity");
  const limitPrice = field(data, "limit_price");
  if (symbol !== request.symbol || !isSide(side) || side !== request.side) failResponse();
  if (!isOrderType(orderType) || orderType !== request.order_type) failResponse();
  if (typeof quantity !== "string" || !QTY_NONNEG.test(quantity) || quantity !== request.quantity) {
    failResponse();
  }

  let limit_price: string | null;
  if (request.limit_price === undefined) {
    if (limitPrice !== null) failResponse();
    limit_price = null;
  } else if (limitPrice !== request.limit_price || !QTY_NONNEG.test(request.limit_price)) {
    failResponse();
  } else {
    limit_price = request.limit_price;
  }

  const statusValue = field(data, "status");
  if (!isStatus(statusValue)) failResponse();

  const readAtRaw = field(data, "read_at");
  if (!isUtcTimestamp(readAtRaw)) failResponse();
  const quoteObserved = field(data, "quote_observed_at");
  let quote_observed_at: string | null;
  if (quoteObserved === null) {
    quote_observed_at = null;
  } else if (isUtcTimestamp(quoteObserved)) {
    quote_observed_at = quoteObserved;
  } else {
    failResponse();
  }
  if (
    statusValue === "eligible" &&
    (quote_observed_at === null || utcMicrosKey(quote_observed_at) > utcMicrosKey(readAtRaw))
  ) {
    failResponse();
  }

  const buying_power = expectFixed(field(data, "buying_power"), 2, true);
  const sell_available = parseSellAvailable(field(data, "sell_available"));
  const estimates = parseEstimates(data, statusValue, side, orderType, quantity);
  if (statusValue === "eligible" && side === "buy") {
    const reservation = estimates.initial_reservation;
    if (reservation === null || scaled2(reservation) > scaled2(buying_power)) failResponse();
  }
  if (statusValue === "eligible" && side === "sell") {
    if (sell_available === null || scaled6(sell_available) < scaled6(quantity)) failResponse();
  }

  return {
    symbol: request.symbol,
    side,
    order_type: orderType,
    quantity,
    limit_price,
    read_at: readAtRaw,
    quote_observed_at,
    status: statusValue,
    reason: parseReason(statusValue, field(data, "reason")),
    step_up_required: parseStepUp(statusValue, orderType, field(data, "step_up_required")),
    buying_power,
    sell_available,
    ...estimates,
  };
}

export async function previewOrder(payload: OrderPreviewPayload): Promise<OrderPreviewResponse> {
  const request = normalizeRequest(payload);
  const response = await apiClient.post<unknown>("/orders/preview", request);
  return parseOrderPreview(response.data, request);
}
