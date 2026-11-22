import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedOrderAttempt,
  readPersistedOrderAttempt,
  writePersistedOrderAttempt,
  type PersistedOrderAttempt,
} from "./orderAttemptStorage";

const STORAGE_SLOT = "orderTicket.pendingAttempt.v1";

function validPersisted(): PersistedOrderAttempt {
  return {
    attempt: {
      key: "sample-persisted-attempt-fixture",
      payload: {
        symbol: "AAPL",
        side: "buy",
        order_type: "limit",
        quantity: "1.000000",
        limit_price: "100.000000",
        expected_quote_observed_at: "2026-11-06T15:00:00Z",
      },
    },
    stepUpRequired: true,
  };
}

describe("orderAttemptStorage", () => {
  beforeEach(() => sessionStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("restores the literal request only for its owner", () => {
    const value = validPersisted();
    writePersistedOrderAttempt(value, 7);
    expect(readPersistedOrderAttempt(7)).toEqual(value);
    expect(readPersistedOrderAttempt(8)).toBeNull();
    expect(readPersistedOrderAttempt()).toBeNull();
    clearPersistedOrderAttempt(8);
    expect(readPersistedOrderAttempt(7)).toEqual(value);
  });

  it("recovers the legacy key and strips the saved preview", () => {
    const value = validPersisted();
    sessionStorage.setItem(STORAGE_SLOT, JSON.stringify({
      attempt: value.attempt,
      preview: { status: "eligible", step_up_required: true, buying_power: "100000.00" },
    }));
    expect(readPersistedOrderAttempt(7)).toEqual(value);
    writePersistedOrderAttempt(value, 7);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_SLOT) ?? "{}")).toEqual({ ...value, owner: 7 });
  });

  it("clears scoped state on auth changes", () => {
    writePersistedOrderAttempt(validPersisted(), 7);
    clearPersistedOrderAttempt();
    expect(readPersistedOrderAttempt(7)).toBeNull();
  });

  it("returns null for missing or invalid persisted values", () => {
    expect(readPersistedOrderAttempt()).toBeNull();
    sessionStorage.setItem(STORAGE_SLOT, "not json");
    expect(readPersistedOrderAttempt()).toBeNull();
    sessionStorage.setItem(STORAGE_SLOT, JSON.stringify({ stepUpRequired: false, owner: 7 }));
    expect(readPersistedOrderAttempt(7)).toBeNull();
    const value = validPersisted();
    sessionStorage.setItem(STORAGE_SLOT, JSON.stringify({
      ...value, owner: 7, attempt: { ...value.attempt, payload: { ...value.attempt.payload, side: "both" } },
    }));
    expect(readPersistedOrderAttempt(7)).toBeNull();
  });

  it("tolerates unavailable session storage", () => {
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(readPersistedOrderAttempt()).toBeNull();
    expect(() => writePersistedOrderAttempt(validPersisted())).not.toThrow();
  });
});
