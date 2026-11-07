import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { createOrder } from "./orders";

vi.mock("./client", () => ({
  apiClient: { post: vi.fn() },
}));

const KEY = "order-retry-1";
const UNVERIFIED = "Order result could not be verified";

type OrderRequest = Parameters<typeof createOrder>[0];

const LIMIT_REQUEST = {
  idempotencyKey: KEY,
  symbol: " aapl ",
  side: "buy",
  order_type: "limit",
  quantity: "1.500000",
  limit_price: "10.250000",
} as const satisfies OrderRequest;

const MARKET_REQUEST = {
  idempotencyKey: KEY,
  symbol: "MSFT",
  side: "sell",
  order_type: "market",
  quantity: "2.000000",
} as const satisfies OrderRequest;

function respond(data: unknown) {
  vi.mocked(apiClient.post).mockResolvedValueOnce({
    data,
  } as Awaited<ReturnType<typeof apiClient.post>>);
}

function limitAck(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    symbol: "AAPL",
    side: "buy",
    order_type: "limit",
    quantity: 1.5,
    remaining_quantity: 0.25,
    limit_price: 10.25,
    status: "open",
    created_at: "2026-11-06T15:04:05",
    trade_ids: [7, 8],
    exchange_order_id: "SIM-42",
    ...overrides,
  };
}

function marketAck(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    symbol: "MSFT",
    side: "sell",
    order_type: "market",
    quantity: 2,
    remaining_quantity: 2,
    limit_price: null,
    status: "canceled",
    created_at: "2026-11-06 15:04:05",
    trade_ids: [],
    ...overrides,
  };
}

describe("createOrder", () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it("posts exact decimal strings and returns a matching acknowledgement as-is", async () => {
    const ack = limitAck();
    respond(ack);

    const result = await createOrder(LIMIT_REQUEST);

    expect(result).toBe(ack);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/orders/",
      {
        symbol: " aapl ",
        side: "buy",
        order_type: "limit",
        quantity: "1.500000",
        limit_price: "10.250000",
      },
      { headers: { "Idempotency-Key": KEY } },
    );
  });

  it("accepts a canceled market acknowledgement with no fills and a naive timestamp", async () => {
    const ack = marketAck();
    respond(ack);

    const result = await createOrder(MARKET_REQUEST);

    expect(result).toBe(ack);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/orders/",
      {
        symbol: "MSFT",
        side: "sell",
        order_type: "market",
        quantity: "2.000000",
      },
      { headers: { "Idempotency-Key": KEY } },
    );
  });

  it("sends an optional step-up code as a header and not in the body", async () => {
    const ack = limitAck();
    respond(ack);

    const result = await createOrder({ ...LIMIT_REQUEST, stepUpCode: "246810" });

    expect(result).toBe(ack);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/orders/",
      {
        symbol: " aapl ",
        side: "buy",
        order_type: "limit",
        quantity: "1.500000",
        limit_price: "10.250000",
      },
      { headers: { "Idempotency-Key": KEY, "X-Step-Up-Code": "246810" } },
    );
  });

  it("rejects a malformed 200 with a plain unverified error", async () => {
    const cases: Array<[string, unknown, OrderRequest?]> = [
      ["non-object", null],
      ["array", []],
      ["missing fields", { nope: true }],
      ["id", limitAck({ id: 1.5 })],
      ["status", limitAck({ status: "cancelled" })],
      ["symbol", limitAck({ symbol: "aapl" })],
      ["side", limitAck({ side: "sell" })],
      ["type", limitAck({ order_type: "market" })],
      ["created_at", limitAck({ created_at: "" })],
      ["quantity", limitAck({ quantity: Number.POSITIVE_INFINITY })],
      ["remaining", limitAck({ remaining_quantity: 2 })],
      ["remaining nan", limitAck({ remaining_quantity: Number.NaN })],
      ["limit price", limitAck({ limit_price: null })],
      ["limit coerced", limitAck({ limit_price: "10.25" })],
      ["market limit", marketAck({ limit_price: 5 }), MARKET_REQUEST],
      ["trade_ids length", limitAck({ trade_ids: [7] })],
      ["trade_ids values", limitAck({ trade_ids: [0, 8] })],
    ];

    for (const [label, data, request] of cases) {
      vi.mocked(apiClient.post).mockReset();
      respond(data);
      const caught = await createOrder(request ?? LIMIT_REQUEST).then(
        (order) => order,
        (error: unknown) => error,
      );
      expect(caught, label).toBeInstanceOf(Error);
      if (!(caught instanceof Error)) continue;
      expect(caught.constructor, label).toBe(Error);
      expect(caught.message, label).toBe(UNVERIFIED);
    }
  });

  it("propagates the original Axios error unchanged", async () => {
    const axiosError = new AxiosError("Request failed with status code 409");
    vi.mocked(apiClient.post).mockRejectedValueOnce(axiosError);

    await expect(createOrder(LIMIT_REQUEST)).rejects.toBe(axiosError);
  });
});
