import { parseEstimatedExecution, type OrderPreviewPayload, type OrderPreviewResponse } from "../api/orderPreview";
import type { TradeSide } from "../types/schemas";
import { ORDER_ATTEMPT_SLOT } from "./orderAttemptSlot";
export { clearPersistedOrderAttempt } from "./orderAttemptSlot";

export type PersistedAttempt = {
  fingerprint: string;
  payload: OrderPreviewPayload & { expected_quote_observed_at?: string };
  key: string;
};

export type PersistedOrderAttempt = {
  attempt: PersistedAttempt;
  preview: OrderPreviewResponse;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isSide(value: unknown): value is TradeSide {
  return value === "buy" || value === "sell";
}

function isOrderType(value: unknown): value is OrderPreviewPayload["order_type"] {
  return value === "limit" || value === "market";
}

function isPreviewStatus(value: unknown): value is OrderPreviewResponse["status"] {
  return value === "eligible" || value === "blocked" || value === "unavailable";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parsePayload(value: unknown): PersistedAttempt["payload"] | null {
  if (!isRecord(value)) return null;
  if (typeof value.symbol !== "string") return null;
  if (!isSide(value.side)) return null;
  if (!isOrderType(value.order_type)) return null;
  if (typeof value.quantity !== "string") return null;

  const payload: PersistedAttempt["payload"] = {
    symbol: value.symbol,
    side: value.side,
    order_type: value.order_type,
    quantity: value.quantity,
  };
  if (Object.prototype.hasOwnProperty.call(value, "limit_price")) {
    if (typeof value.limit_price !== "string") return null;
    payload.limit_price = value.limit_price;
  }
  if (value.expected_quote_observed_at !== undefined) {
    if (!isNonEmptyString(value.expected_quote_observed_at)) return null;
    payload.expected_quote_observed_at = value.expected_quote_observed_at;
  }
  return payload;
}

function parseAttempt(value: unknown): PersistedAttempt | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.fingerprint)) return null;
  if (!isNonEmptyString(value.key)) return null;
  const payload = parsePayload(value.payload);
  if (payload === null) return null;
  return {
    fingerprint: value.fingerprint,
    payload,
    key: value.key,
  };
}

function parsePreview(value: unknown): OrderPreviewResponse | null {
  if (!isRecord(value)) return null;
  if (typeof value.symbol !== "string") return null;
  if (!isSide(value.side)) return null;
  if (!isOrderType(value.order_type)) return null;
  if (typeof value.quantity !== "string") return null;
  if (!isStringOrNull(value.limit_price)) return null;
  if (typeof value.read_at !== "string") return null;
  if (!isStringOrNull(value.quote_observed_at)) return null;
  if (!isPreviewStatus(value.status)) return null;
  if (!isStringOrNull(value.reason)) return null;
  if (typeof value.step_up_required !== "boolean" && value.step_up_required !== null) return null;
  if (typeof value.buying_power !== "string") return null;
  if (!isStringOrNull(value.sell_available)) return null;
  if (!isStringOrNull(value.initial_reservation)) return null;
  if (!isStringOrNull(value.estimated_fill_quantity)) return null;
  if (!isStringOrNull(value.estimated_fill_notional)) return null;
  if (!isStringOrNull(value.unfilled_quantity)) return null;

  const preview: OrderPreviewResponse = {
    symbol: value.symbol,
    side: value.side,
    order_type: value.order_type,
    quantity: value.quantity,
    limit_price: value.limit_price,
    read_at: value.read_at,
    quote_observed_at: value.quote_observed_at,
    status: value.status,
    reason: value.reason,
    step_up_required: value.step_up_required,
    buying_power: value.buying_power,
    sell_available: value.sell_available,
    initial_reservation: value.initial_reservation,
    estimated_fill_quantity: value.estimated_fill_quantity,
    estimated_fill_notional: value.estimated_fill_notional,
    unfilled_quantity: value.unfilled_quantity,
  };
  try {
    return { ...preview, ...parseEstimatedExecution(value, preview) };
  } catch {
    // Optional display metadata must not drop the pending idempotency key.
    return preview;
  }
}

function parsePersistedOrderAttempt(value: unknown): PersistedOrderAttempt | null {
  if (!isRecord(value)) return null;
  const attempt = parseAttempt(value.attempt);
  const preview = parsePreview(value.preview);
  if (attempt === null || preview === null) return null;
  return { attempt, preview };
}

export function readPersistedOrderAttempt(): PersistedOrderAttempt | null {
  try {
    const raw = sessionStorage.getItem(ORDER_ATTEMPT_SLOT);
    if (raw === null) return null;
    return parsePersistedOrderAttempt(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePersistedOrderAttempt(value: PersistedOrderAttempt): void {
  try {
    sessionStorage.setItem(ORDER_ATTEMPT_SLOT, JSON.stringify(value));
  } catch {
    // A storage failure only drops reload recovery. The in-memory attempt is still correct.
  }
}
