import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { fetchOrderDetail, type OrderDetailResponse, type OrderFill } from "./orderDetails";

vi.mock("./client", () => ({
  apiClient: { get: vi.fn() },
}));

const INVALID = "Invalid order detail response";
const CREATED = "2026-11-06T15:04:05.123456Z";
const READ = "2026-11-06T15:04:06Z";

function respond(data: unknown) {
  vi.mocked(apiClient.get).mockResolvedValueOnce({ data } as Awaited<ReturnType<typeof apiClient.get>>);
}

function fill(overrides: Partial<OrderFill> = {}): OrderFill {
  return {
    trade_id: 8,
    quantity: "1.250000",
    execution_price: "10.005000",
    notional: "12.51",
    realized_pnl: "-0.25",
    executed_at: "2026-11-06T15:04:05.500000Z",
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: 42,
    symbol: "AAPL",
    side: "buy",
    order_type: "limit",
    status: "open",
    currency: "USD",
    quantity: "2.000000",
    filled_quantity: "0.000000",
    remaining_quantity: "2.000000",
    limit_price: "10.250000",
    created_at: CREATED,
    canceled_at: null,
    read_at: READ,
    limit: 50,
    total_fill_count: 0,
    has_more: false,
    next_after_id: null,
    fills: [],
    private_note: "drop-me",
    ...overrides,
  };
}

describe("fetchOrderDetail", () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it("returns open, partial, and canceled pages with exact strings", async () => {
    const open = detail();
    const partial = detail({
      status: "open",
      filled_quantity: "1.250000",
      remaining_quantity: "0.750000",
      total_fill_count: 1,
      fills: [fill()],
    });
    const canceled = detail({
      status: "canceled",
      order_type: "market",
      limit_price: null,
      filled_quantity: "1.250000",
      remaining_quantity: "0.750000",
      canceled_at: CREATED,
      total_fill_count: 1,
      fills: [fill({ realized_pnl: "-123456789.25", quantity: "1.250000" })],
    });

    for (const body of [open, partial, canceled]) {
      respond(body);
      const result = await fetchOrderDetail(42);
      expect(result.quantity).toBe(body.quantity);
      expect(result.fills[0]?.realized_pnl ?? "0.00").toBe(
        (body.fills as OrderFill[])[0]?.realized_pnl ?? "0.00",
      );
      expect(result.created_at).toBe(CREATED);
      expect(result).not.toHaveProperty("private_note");
    }

    const page = detail({
      limit: 1,
      has_more: true,
      next_after_id: 9,
      total_fill_count: 3,
      filled_quantity: "2.000000",
      remaining_quantity: "0.000000",
      status: "filled",
      fills: [fill({ trade_id: 9, quantity: "0.500000", realized_pnl: "0.00" })],
    });
    const signal = new AbortController().signal;
    respond(page);
    const paged = await fetchOrderDetail(42, { limit: 1, afterId: 8 }, signal);
    expect(paged.next_after_id).toBe(9);
    expect(paged.fills.map((row) => row.quantity)).toEqual(["0.500000"]);
    expect(apiClient.get).toHaveBeenNthCalledWith(1, "/orders/42", {
      params: { limit: 50 },
      signal: undefined,
    });
    expect(apiClient.get).toHaveBeenLastCalledWith("/orders/42", {
      params: { limit: 1, after_id: 8 },
      signal,
    });
  });

  it("keeps a full Numeric(18,6) payload as exact strings", async () => {
    const quantity = "123456789012.345678";
    const remaining = "0.000001";
    const filledQty = "123456789012.345677";
    const limitPrice = "999999999999.999999";
    const notional = "123456789012.35";
    const pnl = "-1234567890123456.78";
    respond(detail({
      symbol: "BRK.B",
      quantity,
      remaining_quantity: remaining,
      filled_quantity: filledQty,
      limit_price: limitPrice,
      created_at: "2024-02-29T00:00:00Z",
      total_fill_count: 1,
      fills: [fill({
        quantity: filledQty,
        execution_price: "1.000000",
        notional,
        realized_pnl: pnl,
        counterparty_id: 99,
      } as OrderFill & { counterparty_id: number })],
    }));

    const result = await fetchOrderDetail(42);
    expect(result.symbol).toBe("BRK.B");
    expect(result.created_at).toBe("2024-02-29T00:00:00Z");
    expect(result.quantity).toBe("123456789012.345678");
    expect(result.remaining_quantity).toBe("0.000001");
    expect(result.filled_quantity).toBe("123456789012.345677");
    expect(result.limit_price).toBe("999999999999.999999");
    expect(result.fills[0]).toEqual({
      trade_id: 8,
      quantity: "123456789012.345677",
      execution_price: "1.000000",
      notional: "123456789012.35",
      realized_pnl: "-1234567890123456.78",
      executed_at: "2026-11-06T15:04:05.500000Z",
    });
  });

  it("rejects malformed identity, decimals, status, time, and page metadata", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["order id", detail({ order_id: 7 })],
      ["status", detail({ status: "partial" })],
      ["quantity", detail({ quantity: "2" })],
      ["numeric quantity", detail({ quantity: 2 })],
      ["exponent", detail({ quantity: "2.000000e0" })],
      ["nan", detail({ filled_quantity: "NaN" })],
      ["null quantity", detail({ quantity: null })],
      ["missing quantity", (() => {
        const body = detail();
        delete body.quantity;
        return body;
      })()],
      ["calendar", detail({ read_at: "2026-02-30T00:00:00Z" })],
      ["signed money", detail({
        total_fill_count: 1,
        filled_quantity: "1.250000",
        remaining_quantity: "0.750000",
        fills: [fill({ realized_pnl: "+0.25" })],
      })],
      ["notional", detail({
        total_fill_count: 1,
        filled_quantity: "1.250000",
        remaining_quantity: "0.750000",
        fills: [fill({ notional: "-12.51" })],
      })],
      ["blank symbol", detail({ symbol: " " })],
      ["padded symbol", detail({ symbol: " AAPL" })],
      ["long symbol", detail({ symbol: "ABCDEFGHIJKLMNOPQRSTU" })],
      ["sum", detail({ filled_quantity: "1.000000", remaining_quantity: "1.500000" })],
      ["filled remaining", detail({ status: "filled", filled_quantity: "1.000000", remaining_quantity: "1.000000" })],
      ["time", detail({ read_at: "2026-11-06T15:04:06" })],
      ["offset", detail({ created_at: "2026-11-06T15:04:05+00:00" })],
      ["page overflow", detail({
        filled_quantity: "1.250000",
        remaining_quantity: "0.750000",
        total_fill_count: 1,
        fills: [fill({ quantity: "2.000000" })],
      })],
      ["cursor", detail({
        limit: 1,
        has_more: true,
        next_after_id: 4,
        total_fill_count: 2,
        filled_quantity: "1.250000",
        remaining_quantity: "0.750000",
        fills: [fill({ trade_id: 8 })],
      })],
      ["short has_more", detail({ has_more: true, next_after_id: 8, total_fill_count: 2, fills: [fill()] })],
      ["duplicate", detail({
        limit: 2,
        total_fill_count: 2,
        filled_quantity: "2.000000",
        remaining_quantity: "0.000000",
        fills: [fill({ trade_id: 8, quantity: "1.000000" }), fill({ trade_id: 8, quantity: "1.000000" })],
      })],
    ];

    for (const [label, body] of cases) {
      vi.mocked(apiClient.get).mockReset();
      respond(body);
      const caught = await fetchOrderDetail(42, label === "cursor" || label === "duplicate" ? { limit: label === "cursor" ? 1 : 2 } : undefined).then(
        (order: OrderDetailResponse) => order,
        (error: unknown) => error,
      );
      expect(caught, label).toBeInstanceOf(Error);
      if (!(caught instanceof Error)) continue;
      expect(caught.constructor, label).toBe(Error);
      expect(caught.message, label).toBe(INVALID);
    }
  });

  it("propagates HTTP errors and rejects a bad request before calling", async () => {
    const axiosError = new AxiosError("Request failed with status code 404");
    vi.mocked(apiClient.get).mockRejectedValueOnce(axiosError);
    await expect(fetchOrderDetail(42)).rejects.toBe(axiosError);

    await expect(fetchOrderDetail(0)).rejects.toThrow("Invalid order detail request");
    await expect(fetchOrderDetail(42, { limit: 0 })).rejects.toThrow("Invalid order detail request");
    await expect(fetchOrderDetail(42, { limit: 101 })).rejects.toThrow("Invalid order detail request");
    await expect(fetchOrderDetail(42, { afterId: 0 })).rejects.toThrow("Invalid order detail request");
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
