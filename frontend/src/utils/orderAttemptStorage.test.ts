import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderPreviewResponse } from "../api/orderPreview";
import {
  clearPersistedOrderAttempt,
  readPersistedOrderAttempt,
  writePersistedOrderAttempt,
  type PersistedOrderAttempt,
} from "./orderAttemptStorage";

const STORAGE_SLOT = "orderTicket.pendingAttempt.v1";

function validPreview(patch: Partial<OrderPreviewResponse> = {}): OrderPreviewResponse {
  return {
    symbol: "AAPL",
    side: "buy",
    order_type: "limit",
    quantity: "1.000000",
    limit_price: "100.000000",
    read_at: "2026-11-06T15:04:05Z",
    quote_observed_at: "2026-11-06T15:00:00Z",
    status: "eligible",
    reason: null,
    step_up_required: false,
    buying_power: "100000.00",
    sell_available: "0.000000",
    initial_reservation: "100.00",
    estimated_fill_quantity: "0.000000",
    estimated_fill_notional: "0.00",
    unfilled_quantity: "1.000000",
    ...patch,
  };
}

function validPersisted(patch: Partial<PersistedOrderAttempt> = {}): PersistedOrderAttempt {
  const preview = validPreview();
  return {
    attempt: {
      fingerprint: '{"symbol":"AAPL","side":"buy","order_type":"limit","quantity":"1.000000","limit_price":"100.000000"}',
      payload: {
        symbol: "AAPL",
        side: "buy",
        order_type: "limit",
        quantity: "1.000000",
        limit_price: "100.000000",
      },
      key: "sample-persisted-attempt-fixture",
    },
    preview,
    ...patch,
  };
}

describe("orderAttemptStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("round-trips a valid persisted attempt", () => {
    const value = validPersisted();
    writePersistedOrderAttempt(value);
    expect(readPersistedOrderAttempt()).toEqual(value);
  });

  it("returns null after clearPersistedOrderAttempt", () => {
    writePersistedOrderAttempt(validPersisted());
    clearPersistedOrderAttempt();
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("returns null when nothing was written", () => {
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("returns null for non-JSON garbage without throwing", () => {
    sessionStorage.setItem(STORAGE_SLOT, "not json");
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("returns null for valid JSON missing required fields", () => {
    sessionStorage.setItem(STORAGE_SLOT, JSON.stringify({ preview: validPreview() }));
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("returns null for an invalid side enum", () => {
    const value = validPersisted();
    sessionStorage.setItem(
      STORAGE_SLOT,
      JSON.stringify({
        ...value,
        attempt: { ...value.attempt, payload: { ...value.attempt.payload, side: "both" } },
      }),
    );
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("returns null when sessionStorage.getItem throws", () => {
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("does not throw when sessionStorage.setItem throws", () => {
    vi.spyOn(sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writePersistedOrderAttempt(validPersisted())).not.toThrow();
  });
});
