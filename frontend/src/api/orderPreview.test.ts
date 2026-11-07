import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateOrderPayload } from "../types/schemas";
import { apiClient } from "./client";
import {
  normalizeOrderDecimal,
  previewOrder,
  type OrderPreviewPayload,
  type OrderPreviewResponse,
} from "./orderPreview";

vi.mock("./client", () => ({
  apiClient: { post: vi.fn() },
}));

const READ_AT = "2026-11-06T15:04:05.123456Z";
const QUOTE_AT = "2026-11-06T15:04:04.000001Z";

const LIMIT: OrderPreviewPayload = {
  symbol: "AAPL",
  side: "buy",
  order_type: "limit",
  quantity: "1.500000",
  limit_price: "10.250000",
};

function respond(data: unknown) {
  vi.mocked(apiClient.post).mockResolvedValueOnce({
    data,
  } as Awaited<ReturnType<typeof apiClient.post>>);
}

function contract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "AAPL",
    side: "buy",
    order_type: "limit",
    quantity: "1.500000",
    limit_price: "10.250000",
    read_at: READ_AT,
    quote_observed_at: QUOTE_AT,
    status: "eligible",
    reason: null,
    step_up_required: false,
    buying_power: "100.00",
    sell_available: "3.000000",
    initial_reservation: "15.38",
    estimated_fill_quantity: "1.000000",
    estimated_fill_notional: "10.25",
    unfilled_quantity: "0.500000",
    ...overrides,
  };
}

async function expectRejected(data: unknown, payload: OrderPreviewPayload = LIMIT) {
  respond(data);
  await expect(previewOrder(payload)).rejects.toThrow("Invalid order preview response");
}

describe("normalizeOrderDecimal", () => {
  it("pads positive decimals to six places without changing the value", () => {
    expect(normalizeOrderDecimal("1")).toBe("1.000000");
    expect(normalizeOrderDecimal("1.20")).toBe("1.200000");
    expect(normalizeOrderDecimal(".5")).toBe("0.500000");
    expect(normalizeOrderDecimal("1.234567")).toBe("1.234567");
    expect(normalizeOrderDecimal("0001.2")).toBe("1.200000");
    expect(normalizeOrderDecimal("123456789012.6")).toBe("123456789012.600000");
    expect(normalizeOrderDecimal(" 0.500000 ")).toBe("0.500000");
  });

  it("rejects zero, signed, exponent, non-finite, and over-wide input", () => {
    for (const value of [
      "0",
      "0.0",
      "0.000000",
      ".0",
      "-1",
      "-0.000001",
      "+1",
      "1e2",
      "1E-2",
      "NaN",
      "Infinity",
      "-Infinity",
      "1.2345678",
      "1234567890123",
      "1.",
      "",
      " ",
      "1,000.00",
    ]) {
      expect(normalizeOrderDecimal(value)).toBeNull();
    }
  });
});

describe("previewOrder", () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it("posts exact decimals and does not send idempotency or step-up headers", async () => {
    const echoed = contract({
      quantity: "1.200000",
      limit_price: "0.500000",
      buying_power: "10.00",
      initial_reservation: "0.60",
      estimated_fill_quantity: "0.500000",
      estimated_fill_notional: "0.25",
      unfilled_quantity: "0.700000",
      source: "do-not-leak",
      fee: "0.01",
    });
    respond(echoed);

    const payload = {
      symbol: " aapl ",
      side: "buy" as const,
      order_type: "limit" as const,
      quantity: "1.20",
      limit_price: ".5",
      idempotencyKey: "do-not-send",
      stepUpCode: "123456",
    };
    const result = await previewOrder(payload);

    expect(vi.mocked(apiClient.post).mock.calls[0]).toEqual([
      "/orders/preview",
      {
        symbol: "AAPL",
        side: "buy",
        order_type: "limit",
        quantity: "1.200000",
        limit_price: "0.500000",
      },
    ]);
    const contractBody: OrderPreviewResponse = {
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      quantity: "1.200000",
      limit_price: "0.500000",
      read_at: READ_AT,
      quote_observed_at: QUOTE_AT,
      status: "eligible",
      reason: null,
      step_up_required: false,
      buying_power: "10.00",
      sell_available: "3.000000",
      initial_reservation: "0.60",
      estimated_fill_quantity: "0.500000",
      estimated_fill_notional: "0.25",
      unfilled_quantity: "0.700000",
    };
    expect(result).toEqual(contractBody);
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("fee");
  });

  it("omits limit price on a market order", async () => {
    respond(
      contract({
        symbol: "MSFT",
        side: "sell",
        order_type: "market",
        quantity: "0.500000",
        limit_price: null,
        initial_reservation: null,
        estimated_fill_quantity: "0.500000",
        estimated_fill_notional: "1.00",
        unfilled_quantity: "0.000000",
      }),
    );

    await previewOrder({
      symbol: "msft",
      side: "sell",
      order_type: "market",
      quantity: ".5",
      limit_price: "999",
    });

    expect(vi.mocked(apiClient.post).mock.calls[0]).toEqual([
      "/orders/preview",
      {
        symbol: "MSFT",
        side: "sell",
        order_type: "market",
        quantity: "0.500000",
      },
    ]);
  });

  it("rejects malformed requests before the network", async () => {
    const invalid: OrderPreviewPayload[] = [
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "0", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "-1", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "1e2", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "NaN", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "Infinity", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "1.2345678", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "1", limit_price: "0" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "1", limit_price: "1e-1" },
      { symbol: "   ", side: "buy", order_type: "limit", quantity: "1", limit_price: "1" },
      { symbol: "AAPL", side: "buy", order_type: "limit", quantity: "1" },
      { symbol: "A".repeat(21), side: "buy", order_type: "limit", quantity: "1", limit_price: "1" },
      // Runtime-only bad side and order type. `as unknown` is test-only so the production guard stays active.
      { symbol: "AAPL", side: "short", order_type: "limit", quantity: "1", limit_price: "1" } as unknown as OrderPreviewPayload,
      { symbol: "AAPL", side: "buy", order_type: "stop", quantity: "1", limit_price: "1" } as unknown as OrderPreviewPayload,
    ];

    for (const payload of invalid) {
      await expect(previewOrder(payload)).rejects.toThrow("Invalid order preview request");
    }
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("accepts an eligible limit buy when buying power equals the reservation", async () => {
    respond(contract({ buying_power: "15.38", sell_available: "0.000000" }));
    const result = await previewOrder(LIMIT);
    expect(result.status).toBe("eligible");
    expect(result.buying_power).toBe("15.38");
    expect(result.sell_available).toBe("0.000000");
    expect(result.reason).toBeNull();
    expect(result.read_at).toBe(READ_AT);
  });

  it("accepts a market buy with zero fill, zero notional, and zero reservation", async () => {
    respond(
      contract({
        order_type: "market",
        quantity: "1.000000",
        limit_price: null,
        buying_power: "0.00",
        sell_available: "0.000000",
        initial_reservation: "0.00",
        estimated_fill_quantity: "0.000000",
        estimated_fill_notional: "0.00",
        unfilled_quantity: "1.000000",
        read_at: "2000-02-29T00:00:00.100000Z",
        quote_observed_at: "2000-02-29T00:00:00.1Z",
      }),
    );

    const result = await previewOrder({
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      quantity: "1",
    });
    expect(result.limit_price).toBeNull();
    expect(result.initial_reservation).toBe("0.00");
    expect(result.estimated_fill_quantity).toBe("0.000000");
    expect(result.estimated_fill_notional).toBe("0.00");
    expect(result.unfilled_quantity).toBe("1.000000");
    expect(result.read_at).toBe("2000-02-29T00:00:00.100000Z");
    expect(result.quote_observed_at).toBe("2000-02-29T00:00:00.1Z");
  });

  it("accepts an eligible sell with negative buying power and enough shares", async () => {
    respond(
      contract({
        side: "sell",
        step_up_required: true,
        buying_power: "-2.50",
        sell_available: "1.500000",
        initial_reservation: null,
        estimated_fill_quantity: "1.500000",
        estimated_fill_notional: "15.38",
        unfilled_quantity: "0.000000",
      }),
    );

    const result = await previewOrder({ ...LIMIT, side: "sell" });
    expect(result.initial_reservation).toBeNull();
    expect(result.buying_power).toBe("-2.50");
    expect(result.sell_available).toBe("1.500000");
    expect(result.step_up_required).toBe(true);
    expect(result.estimated_fill_notional).toBe("15.38");
  });

  it("sums twelve-digit quantities with BigInt and preserves a negative buying-power string", async () => {
    respond(
      contract({
        side: "sell",
        quantity: "123456789012.000000",
        limit_price: "1.000000",
        buying_power: "-999999999999.99",
        sell_available: "123456789012.000000",
        initial_reservation: null,
        estimated_fill_quantity: "123456789011.999999",
        estimated_fill_notional: "123456789012.00",
        unfilled_quantity: "0.000001",
      }),
    );

    const result = await previewOrder({
      symbol: "AAPL",
      side: "sell",
      order_type: "limit",
      quantity: "123456789012",
      limit_price: "1",
    });
    expect(result.quantity).toBe("123456789012.000000");
    expect(result.estimated_fill_quantity).toBe("123456789011.999999");
    expect(result.unfilled_quantity).toBe("0.000001");
    expect(result.estimated_fill_notional).toBe("123456789012.00");
    expect(result.initial_reservation).toBeNull();
    expect(result.sell_available).toBe("123456789012.000000");
    expect(result.buying_power).toBe("-999999999999.99");
  });

  it("accepts a half-cent fill notional above the limit reservation", async () => {
    respond(
      contract({
        quantity: "2.000000",
        limit_price: "0.005000",
        initial_reservation: "0.01",
        estimated_fill_quantity: "2.000000",
        estimated_fill_notional: "0.02",
        unfilled_quantity: "0.000000",
      }),
    );

    const result = await previewOrder({
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      quantity: "2",
      limit_price: "0.005",
    });
    expect(result.initial_reservation).toBe("0.01");
    expect(result.estimated_fill_notional).toBe("0.02");
  });

  it("returns blocked and unavailable previews with null estimates", async () => {
    respond(
      contract({
        status: "blocked",
        reason: "Insufficient buying power",
        buying_power: "-1.00",
        sell_available: "-0.250000",
        quote_observed_at: "2026-11-06T15:04:05.123457Z",
        initial_reservation: null,
        estimated_fill_quantity: null,
        estimated_fill_notional: null,
        unfilled_quantity: null,
      }),
    );
    const blocked = await previewOrder(LIMIT);
    expect(blocked.status).toBe("blocked");
    expect(blocked.reason).toBe("Insufficient buying power");
    expect(blocked.step_up_required).toBe(false);
    expect(blocked.initial_reservation).toBeNull();
    expect(blocked.estimated_fill_quantity).toBeNull();
    expect(blocked.estimated_fill_notional).toBeNull();
    expect(blocked.unfilled_quantity).toBeNull();
    expect(blocked.buying_power).toBe("-1.00");
    expect(blocked.sell_available).toBe("-0.250000");
    expect(blocked.quote_observed_at).toBe("2026-11-06T15:04:05.123457Z");

    respond(
      contract({
        order_type: "market",
        quantity: "1.000000",
        limit_price: null,
        status: "unavailable",
        reason: "Usable reference quote unavailable (SM-PT-02)",
        step_up_required: null,
        quote_observed_at: null,
        sell_available: null,
        initial_reservation: null,
        estimated_fill_quantity: null,
        estimated_fill_notional: null,
        unfilled_quantity: null,
      }),
    );
    const unavailable = await previewOrder({
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      quantity: "1",
    });
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.step_up_required).toBeNull();
    expect(unavailable.limit_price).toBeNull();
    expect(unavailable.estimated_fill_notional).toBeNull();
  });

  it("rejects a response whose identity does not match the normalized request", async () => {
    const mismatches = [
      { symbol: "MSFT" },
      { side: "sell" },
      { order_type: "market" },
      { quantity: "1.500001" },
      { quantity: "1.50" },
      { quantity: null },
      { limit_price: "10.250001" },
      { limit_price: null },
      { limit_price: "10.25" },
    ];
    for (const overrides of mismatches) {
      await expectRejected(contract(overrides));
    }

    await expectRejected(
      contract({
        order_type: "market",
        quantity: "1.000000",
        limit_price: "1.000000",
        initial_reservation: "0.00",
        estimated_fill_quantity: "0.000000",
        estimated_fill_notional: "0.00",
        unfilled_quantity: "1.000000",
      }),
      { symbol: "AAPL", side: "buy", order_type: "market", quantity: "1" },
    );
  });

  it("rejects non-objects", async () => {
    for (const data of [null, [], "ok", 0]) {
      await expectRejected(data);
    }
  });

  it("rejects missing or null economics", async () => {
    const missing = contract();
    delete missing.buying_power;
    await expectRejected(missing);
    await expectRejected(contract({ sell_available: undefined }));
    await expectRejected(contract({ estimated_fill_quantity: null }));
    await expectRejected(contract({ initial_reservation: null }));
    await expectRejected(contract({ buying_power: null }));
  });

  it("rejects non-finite and exponent numeric strings", async () => {
    for (const buying_power of ["NaN", "Infinity", "-Infinity", "1e2", "10", "10.555", "+1.00"]) {
      await expectRejected(contract({ buying_power }));
    }
    await expectRejected(contract({ buying_power: 10 }));
    await expectRejected(contract({ sell_available: "Infinity" }));
    await expectRejected(contract({ estimated_fill_quantity: "NaN" }));
    await expectRejected(contract({ estimated_fill_notional: "1e2" }));
  });

  it("rejects non-UTC and impossible calendar timestamps", async () => {
    for (const read_at of [
      "2026-02-29T00:00:00Z",
      "1900-02-29T12:00:00Z",
      "2026-11-06T15:04:05+00:00",
      "2026-11-06T15:04:05.1234567Z",
      "2026-13-01T00:00:00Z",
      "2026-11-06T15:04:05",
      "2026-04-31T00:00:00.123Z",
      "2026-11-06T23:59:60Z",
      "2026-11-06T15:04:05z",
      "0000-01-01T00:00:00Z",
    ]) {
      await expectRejected(contract({ read_at }));
    }
    await expectRejected(contract({ quote_observed_at: "2026-11-31T00:00:00Z" }));
    await expectRejected(contract({ quote_observed_at: "0000-01-01T00:00:00Z" }));
    await expectRejected(contract({ read_at: null }));
    await expectRejected(contract({ quote_observed_at: null }));
    await expectRejected(contract({ quote_observed_at: "2026-11-06T15:04:05.123457Z" }));
  });

  it("rejects malformed statuses and illegal reasons", async () => {
    await expectRejected(contract({ status: "filled" }));
    await expectRejected(contract({ status: "Eligible" }));
    await expectRejected(contract({ status: null }));
    await expectRejected(contract({ reason: "still working" }));
    await expectRejected(contract({ status: "blocked", reason: null }));
    await expectRejected(contract({ status: "blocked", reason: "   " }));
    await expectRejected(contract({ status: "unavailable", reason: "" }));
  });

  it("rejects null step-up on eligible orders and on every limit order", async () => {
    await expectRejected(contract({ step_up_required: null }));
    await expectRejected(contract({ step_up_required: "false" }));
    await expectRejected(
      contract({
        status: "blocked",
        reason: "Trading halted",
        step_up_required: null,
        initial_reservation: null,
        estimated_fill_quantity: null,
        estimated_fill_notional: null,
        unfilled_quantity: null,
      }),
    );
    await expectRejected(
      contract({
        order_type: "market",
        quantity: "1.000000",
        limit_price: null,
        step_up_required: null,
        initial_reservation: "0.00",
        estimated_fill_quantity: "0.000000",
        estimated_fill_notional: "0.00",
        unfilled_quantity: "1.000000",
      }),
      { symbol: "AAPL", side: "buy", order_type: "market", quantity: "1" },
    );
  });

  it("rejects estimate shapes that break the eligible or denied contract", async () => {
    await expectRejected(
      contract({
        estimated_fill_quantity: "1.500000",
        unfilled_quantity: "1.500000",
      }),
    );
    await expectRejected(contract({ estimated_fill_quantity: "-1.000000" }));
    await expectRejected(contract({ estimated_fill_notional: "0.020" }));
    await expectRejected(contract({ initial_reservation: "-0.01" }));
    await expectRejected(
      contract({
        side: "sell",
        initial_reservation: "0.00",
        estimated_fill_quantity: "1.500000",
        unfilled_quantity: "0.000000",
      }),
      { ...LIMIT, side: "sell" },
    );
    await expectRejected(
      contract({
        status: "blocked",
        reason: "Insufficient buying power",
        estimated_fill_quantity: "0.000000",
        initial_reservation: null,
        estimated_fill_notional: null,
        unfilled_quantity: null,
      }),
    );
    await expectRejected(
      contract({
        estimated_fill_quantity: "0.000000",
        estimated_fill_notional: "0.01",
        unfilled_quantity: "1.500000",
      }),
    );
    await expectRejected(
      contract({
        estimated_fill_quantity: "1.500000",
        estimated_fill_notional: "0.00",
        unfilled_quantity: "0.000000",
      }),
    );
    await expectRejected(
      contract({
        order_type: "market",
        quantity: "2.000000",
        limit_price: null,
        initial_reservation: "0.01",
        estimated_fill_quantity: "2.000000",
        estimated_fill_notional: "0.02",
        unfilled_quantity: "0.000000",
      }),
      { symbol: "AAPL", side: "buy", order_type: "market", quantity: "2" },
    );
    await expectRejected(contract({ buying_power: "15.37" }));
    await expectRejected(contract({ buying_power: "-0.01" }));
    const sellPreview: OrderPreviewPayload = { ...LIMIT, side: "sell" };
    const deniedSell = {
      side: "sell",
      initial_reservation: null,
      estimated_fill_quantity: "1.500000",
      estimated_fill_notional: "15.38",
      unfilled_quantity: "0.000000",
    };
    await expectRejected(contract({ ...deniedSell, sell_available: null }), sellPreview);
    await expectRejected(contract({ ...deniedSell, sell_available: "1.499999" }), sellPreview);
    await expectRejected(
      contract({ ...deniedSell, sell_available: "-0.250000", buying_power: "-2.50" }),
      sellPreview,
    );
  });

  it("propagates axios HTTP errors instead of inventing a preview", async () => {
    const error = new AxiosError("Request failed with status code 503", "ERR_BAD_RESPONSE");
    vi.mocked(apiClient.post).mockRejectedValueOnce(error);

    await expect(previewOrder(LIMIT)).rejects.toBe(error);
    expect(vi.mocked(apiClient.post)).toHaveBeenCalledOnce();
    expect(vi.mocked(apiClient.post).mock.calls[0]?.[0]).toBe("/orders/preview");
  });

  it("accepts precise strings and legacy numbers on CreateOrderPayload", () => {
    const precise: CreateOrderPayload = {
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      quantity: "1.200000",
      limit_price: "0.500000",
    };
    const legacy: CreateOrderPayload = {
      symbol: "AAPL",
      side: "sell",
      order_type: "market",
      quantity: 3,
      limit_price: 12.5,
    };
    const preview: OrderPreviewPayload = {
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      quantity: "1.200000",
      limit_price: "0.500000",
    };
    const confirm: CreateOrderPayload = preview;
    expect(confirm.quantity).toBe(precise.quantity);
    expect(legacy.quantity).toBe(3);
    expect(legacy.limit_price).toBe(12.5);
  });
});
