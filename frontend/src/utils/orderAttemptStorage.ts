import { normalizeOrderDecimal, type OrderPreviewPayload } from "../api/orderPreview";
import { ORDER_ATTEMPT_SLOT } from "./orderAttemptSlot";
export { clearPersistedOrderAttempt } from "./orderAttemptSlot";

export type PersistedAttempt = {
  payload: OrderPreviewPayload & { expected_quote_observed_at?: string };
  key: string;
};

export type PersistedOrderAttempt = {
  attempt: PersistedAttempt;
  stepUpRequired: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAttempt(value: unknown): PersistedAttempt | null {
  if (!isRecord(value) || typeof value.key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.key)) return null;
  const payload = value.payload;
  if (!isRecord(payload)) return null;
  if (typeof payload.symbol !== "string" || !payload.symbol.trim() || payload.symbol.length > 20) return null;
  if (payload.side !== "buy" && payload.side !== "sell") return null;
  if (payload.order_type !== "market" && payload.order_type !== "limit") return null;
  if (typeof payload.quantity !== "string" || normalizeOrderDecimal(payload.quantity) === null) return null;
  if (payload.order_type === "limit") {
    if (typeof payload.limit_price !== "string" || normalizeOrderDecimal(payload.limit_price) === null) return null;
  } else if (payload.limit_price !== undefined) {
    return null;
  }
  const quote = payload.expected_quote_observed_at;
  if (quote !== undefined && (typeof quote !== "string" || !quote || !Number.isFinite(Date.parse(quote)))) return null;
  // Keep the literal request fields. Formatting them again changes the replay fingerprint.
  return {
    key: value.key,
    payload: {
      symbol: payload.symbol,
      side: payload.side,
      order_type: payload.order_type,
      quantity: payload.quantity,
      ...(typeof payload.limit_price === "string" ? { limit_price: payload.limit_price } : {}),
      ...(typeof quote === "string" ? { expected_quote_observed_at: quote } : {}),
    },
  };
}

export function readPersistedOrderAttempt(owner?: number): PersistedOrderAttempt | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(ORDER_ATTEMPT_SLOT) ?? "null");
    if (!isRecord(value)) return null;
    const attempt = parseAttempt(value.attempt);
    if ("owner" in value) {
      if (value.owner !== (owner ?? null) || typeof value.stepUpRequired !== "boolean") return null;
      return attempt && { attempt, stepUpRequired: value.stepUpRequired };
    }
    // The previous format was cleared on auth changes in this tab. Keep its existing
    // key when upgrading a running session, and discard the stored preview.
    if (!isRecord(value.preview) || value.preview.status !== "eligible"
      || typeof value.preview.step_up_required !== "boolean") return null;
    return attempt && { attempt, stepUpRequired: value.preview.step_up_required };
  } catch {
    return null;
  }
}

export function writePersistedOrderAttempt(value: PersistedOrderAttempt, owner?: number): void {
  try {
    const attempt = parseAttempt(value.attempt);
    if (attempt === null) return;
    sessionStorage.setItem(ORDER_ATTEMPT_SLOT, JSON.stringify({ attempt, stepUpRequired: value.stepUpRequired, owner: owner ?? null }));
  } catch {
    // The same attempt remains available in memory if session storage is blocked.
  }
}
