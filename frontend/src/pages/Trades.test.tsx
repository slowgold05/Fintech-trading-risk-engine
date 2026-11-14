import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetailResponse, OrderFill } from "../api/orderDetails";
import type { OrderResponse, TradeResponse, TradeRiskAssessment } from "../types/schemas";
import { Trades } from "./Trades";

const { fetchOrders, cancelOrder, fetchOrderDetail, fetchTrades, fetchTradeRisk, showToast } = vi.hoisted(() => ({
  fetchOrders: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrderDetail: vi.fn(),
  fetchTrades: vi.fn(),
  fetchTradeRisk: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../api/orders", () => ({ fetchOrders, cancelOrder }));
vi.mock("../api/orderDetails", async () => {
  const actual = await vi.importActual<typeof import("../api/orderDetails")>("../api/orderDetails");
  return { ...actual, fetchOrderDetail };
});
vi.mock("../api/trades", () => ({ fetchTrades }));
vi.mock("../api/risk", () => ({ fetchTradeRisk }));
vi.mock("../context/useToast", () => ({ useToast: () => ({ showToast, dismissToast: vi.fn(), toasts: [] }) }));
vi.mock("../components/OrderTicket", () => ({ OrderTicket: () => <div>Order ticket stub</div> }));

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  fetchOrders.mockReset();
  cancelOrder.mockReset();
  fetchOrderDetail.mockReset();
  fetchTrades.mockReset();
  fetchTradeRisk.mockReset();
  showToast.mockReset();
});

function renderTrades() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <Trades />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

function trade(patch: Partial<TradeResponse> = {}): TradeResponse {
  return {
    id: 45,
    symbol: "AAPL",
    asset_type: "stock",
    side: "buy",
    quantity: 10,
    price_at_execution: 190.25,
    notional: 1902.5,
    realized_pnl: 0,
    realized_pnl_pct: 0,
    executed_at: "2026-11-13T00:00:00Z",
    ...patch,
  };
}

function tradeRisk(patch: Partial<TradeRiskAssessment> = {}): TradeRiskAssessment {
  return {
    assessment_id: 12,
    trade_id: 45,
    risk_score: 23,
    created_at: "2026-11-13T00:00:00",
    alerts: [
      {
        rule_code: "CONCENTRATION_LIMIT",
        severity: "medium",
        reason: "Position exceeds 20% of account value.",
        created_at: "2026-11-13T00:00:00",
      },
    ],
    ...patch,
  };
}

function order(patch: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: 7,
    symbol: "AAPL",
    side: "buy",
    order_type: "limit",
    quantity: 1,
    remaining_quantity: 1,
    limit_price: 190.25,
    status: "open",
    created_at: "2026-11-06T15:00:00Z",
    ...patch,
  };
}

function fill(patch: Partial<OrderFill> & Pick<OrderFill, "trade_id">): OrderFill {
  return {
    quantity: "0.010000",
    execution_price: "190.250000",
    notional: "1.90",
    realized_pnl: "0.00",
    executed_at: "2026-03-15T13:04:05Z",
    ...patch,
  };
}

function detail(patch: Partial<OrderDetailResponse> = {}): OrderDetailResponse {
  const fills = patch.fills ?? [fill({ trade_id: 11, realized_pnl: "-1.25" })];
  return {
    order_id: patch.order_id ?? 7,
    symbol: "AAPL",
    side: "buy",
    order_type: "limit",
    status: "open",
    currency: "USD",
    quantity: "1.000000",
    filled_quantity: "0.010000",
    remaining_quantity: "0.990000",
    limit_price: "190.250000",
    created_at: "2026-11-06T15:00:00Z",
    canceled_at: null,
    read_at: "2026-11-06T16:00:00Z",
    limit: 50,
    total_fill_count: fills.length,
    has_more: false,
    next_after_id: null,
    fills,
    ...patch,
  };
}

/** Fifty 0.010000 fills, whole count 51, cursor = last trade id. Page qty 0.500000. */
function hasMorePage(patch: Partial<OrderDetailResponse> = {}): OrderDetailResponse {
  const rows = Array.from({ length: 50 }, (_, index) => fill({ trade_id: index + 1, quantity: "0.010000", notional: "1.90" }));
  const { fills: patchFills, total_fill_count: count, ...rest } = patch;
  const fills = patchFills ?? rows;
  return detail({
    quantity: "1.000000",
    filled_quantity: "1.000000",
    remaining_quantity: "0.000000",
    status: "filled",
    read_at: "2026-11-06T12:00:00Z",
    ...rest,
    fills,
    has_more: true,
    next_after_id: fills[fills.length - 1].trade_id,
    total_fill_count: count ?? 51,
  });
}

function httpError(status: number, data?: unknown) {
  return new AxiosError("request failed", String(status), undefined, undefined, {
    status,
    data,
    statusText: "",
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function panel() {
  return screen.getByRole("region", { name: /order \d+ details/i });
}

function field(region: HTMLElement, term: string) {
  const label = within(region).getByText(term);
  const row = label.closest("div");
  const value = row?.querySelector("dd");
  if (!value) throw new Error(`missing value for ${term}`);
  return value;
}

async function openDetails(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

describe("Trades order details", () => {
  it("opens exact quantities, UTC fills, and canceled executions, then restores focus", async () => {
    fetchTrades.mockResolvedValue({ trades: [] satisfies TradeResponse[] });
    fetchOrders.mockResolvedValue({
      orders: [order(), order({ id: 8, symbol: "MSFT", side: "sell", status: "canceled", remaining_quantity: 0 })],
    });
    fetchOrderDetail.mockImplementation((orderId: number) =>
      Promise.resolve(
        orderId === 8
          ? detail({
              order_id: 8,
              symbol: "MSFT",
              side: "sell",
              status: "canceled",
              quantity: "123456789.123456",
              filled_quantity: "0.510000",
              remaining_quantity: "123456788.613456",
              canceled_at: "2026-11-06T17:08:09Z",
              total_fill_count: 2,
              fills: [
                fill({ trade_id: 21, quantity: "0.010000", notional: "1.90", realized_pnl: "-0.01" }),
                fill({ trade_id: 22, quantity: "0.500000", notional: "95.13", realized_pnl: "0.00", executed_at: "2026-03-15T13:04:06Z" }),
              ],
            })
          : detail(),
      ),
    );

    renderTrades();
    const trigger = await screen.findByRole("button", { name: "Details for MSFT order 8" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    fireEvent.click(trigger);
    const region = await screen.findByRole("region", { name: "Order 8 details" });
    await within(region).findByText("Recorded fills");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(field(region, "Original")).toHaveTextContent("123456789.123456");
    expect(field(region, "Filled")).toHaveTextContent("0.510000");
    expect(field(region, "Remaining")).toHaveTextContent("123456788.613456");
    expect(within(region).getByText("-0.01 USD")).toBeInTheDocument();
    expect(within(region).getByText("0.00 USD")).toBeInTheDocument();
    expect(within(region).getByText("1.90 USD")).toBeInTheDocument();
    expect(within(region).getByText("95.13 USD")).toBeInTheDocument();
    expect(within(region).getByText("0.010000")).toBeInTheDocument();
    expect(within(region).getByText("0.500000")).toBeInTheDocument();
    expect(within(region).getByText("21")).toBeInTheDocument();
    expect(within(region).getByText("22")).toBeInTheDocument();
    expect(region.textContent).toMatch(/UTC/);
    expect(region.textContent).toMatch(/13:04:05/);
    expect(within(region).getByText(/2 recorded fills/)).toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /details/i })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("distinguishes a real zero-fill order from an empty later page", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order({ id: 3 }), order({ id: 4, symbol: "IBM" })] });
    fetchOrderDetail.mockImplementation((orderId: number) =>
      Promise.resolve(
        orderId === 3
          ? detail({ order_id: 3, filled_quantity: "0.000000", remaining_quantity: "1.000000", total_fill_count: 0, fills: [] })
          : detail({
              order_id: 4,
              symbol: "IBM",
              filled_quantity: "1.000000",
              remaining_quantity: "0.000000",
              total_fill_count: 51,
              has_more: false,
              fills: [],
            }),
      ),
    );
    renderTrades();
    await openDetails("Details for AAPL order 3");
    expect(await screen.findByText("No recorded fills.")).toBeInTheDocument();
    expect(panel().textContent).not.toMatch(/This page has no recorded fills/);
    fireEvent.click(within(panel()).getByRole("button", { name: "Close" }));
    await openDetails("Details for IBM order 4");
    expect(await screen.findByText(/This page has no recorded fills/)).toBeInTheDocument();
    expect(within(panel()).getByText(/51 recorded fills/)).toBeInTheDocument();
    expect(panel().textContent).not.toMatch(/No recorded fills\./);
  });

  it("ignores a late detail for the previously selected order and resets the page cursor", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order({ id: 1, symbol: "AAA" }), order({ id: 2, symbol: "BBB" })] });
    const pending: { orderId: number; options?: { limit?: number; afterId?: number }; resolve: (value: OrderDetailResponse) => void }[] = [];
    fetchOrderDetail.mockImplementation((orderId: number, options?: { limit?: number; afterId?: number }, signal?: AbortSignal) => {
      const gate = deferred<OrderDetailResponse>();
      pending.push({ orderId, options, resolve: gate.resolve });
      signal?.addEventListener("abort", () => {
        /* Keep the promise pending so a late resolve is still delivered. */
      });
      return gate.promise;
    });
    const pageA = hasMorePage({
      order_id: 1,
      symbol: "AAA",
      status: "open",
      quantity: "8.000000",
      filled_quantity: "1.000000",
      remaining_quantity: "7.000000",
    });
    renderTrades();
    await openDetails("Details for AAA order 1");
    await waitFor(() => expect(pending.some((call) => call.orderId === 1 && call.options?.afterId == null)).toBe(true));
    const first = pending.find((call) => call.orderId === 1 && call.options?.afterId == null)!;
    expect(first.options).toEqual({ limit: 50 });
    first.resolve(pageA);
    const next = await screen.findByRole("button", { name: "Next" });
    await waitFor(() => expect(next).toBeEnabled());
    expect(within(panel()).getAllByText("0.010000")).toHaveLength(50);
    fireEvent.click(next);
    await waitFor(() => expect(pending.some((call) => call.orderId === 1 && call.options?.afterId === 50)).toBe(true));
    const late = pending.find((call) => call.orderId === 1 && call.options?.afterId === 50)!;

    fireEvent.click(screen.getByRole("button", { name: "Details for BBB order 2" }));
    await waitFor(() => expect(pending.some((call) => call.orderId === 2 && call.options?.afterId == null)).toBe(true));
    const second = pending.find((call) => call.orderId === 2 && call.options?.afterId == null)!;
    expect(second.options).toEqual({ limit: 50 });
    late.resolve(
      detail({
        order_id: 1,
        symbol: "AAA",
        quantity: "8.000000",
        filled_quantity: "1.000000",
        remaining_quantity: "7.000000",
        total_fill_count: 51,
        fills: [fill({ trade_id: 51, quantity: "0.500000", notional: "95.13" })],
      }),
    );
    second.resolve(
      detail({
        order_id: 2,
        symbol: "BBB",
        quantity: "3.000000",
        filled_quantity: "0.200000",
        remaining_quantity: "2.800000",
        total_fill_count: 1,
        fills: [fill({ trade_id: 90, quantity: "0.200000", notional: "38.05" })],
      }),
    );
    const region = await screen.findByRole("region", { name: "Order 2 details" });
    await within(region).findByText("3.000000");
    expect(field(region, "Original")).toHaveTextContent("3.000000");
    expect(field(region, "Filled")).toHaveTextContent("0.200000");
    expect(field(region, "Remaining")).toHaveTextContent("2.800000");
    expect(screen.queryByText("8.000000")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Order 1 details" })).not.toBeInTheDocument();
    expect(fetchOrderDetail.mock.calls.filter((call) => call[0] === 2).every((call) => call[1]?.afterId == null)).toBe(true);
    expect(fetchOrderDetail.mock.calls.every((call) => call[2] instanceof AbortSignal)).toBe(true);
  });

  it("hides previous figures when a later detail page fails and offers Retry", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order()] });
    fetchOrderDetail
      .mockResolvedValueOnce(
        hasMorePage({
          order_id: 7,
          status: "open",
          quantity: "4.000000",
          filled_quantity: "1.000000",
          remaining_quantity: "3.000000",
        }),
      )
      .mockRejectedValueOnce(new Error("detail down"));
    renderTrades();
    await openDetails("Details for AAPL order 7");
    await screen.findByText("4.000000");
    const next = await screen.findByRole("button", { name: "Next" });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("4.000000")).not.toBeInTheDocument();
    expect(screen.queryByText("3.000000")).not.toBeInTheDocument();
    expect(screen.queryByText("0.010000")).not.toBeInTheDocument();
  });
});

describe("fill pagination", () => {
  it("requests limit 50, replaces the page, and keeps the whole-order count", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order({ id: 9 })] });
    const pageOne = hasMorePage({ order_id: 9, read_at: "2026-11-06T12:00:00Z" });
    const pageTwo = detail({
      order_id: 9,
      quantity: "1.000000",
      filled_quantity: "1.000000",
      remaining_quantity: "0.000000",
      status: "filled",
      read_at: "2026-11-06T12:05:09Z",
      total_fill_count: 51,
      has_more: false,
      next_after_id: null,
      fills: [fill({ trade_id: 51, quantity: "0.500000", notional: "95.13", realized_pnl: "1.00", executed_at: "2026-11-06T12:04:00Z" })],
    });
    fetchOrderDetail.mockResolvedValueOnce(pageOne).mockResolvedValueOnce(pageTwo).mockResolvedValue(pageOne);
    renderTrades();
    await openDetails("Details for AAPL order 9");
    await screen.findByText(/51 recorded fills/);
    expect(fetchOrderDetail).toHaveBeenCalledWith(9, { limit: 50 }, expect.any(AbortSignal));
    expect(within(panel()).getAllByText("0.010000")).toHaveLength(50);
    expect(within(panel()).queryByText("0.500000")).not.toBeInTheDocument();
    expect(panel().textContent).not.toMatch(/VWAP/i);

    const next = screen.getByRole("button", { name: "Next" });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() => expect(fetchOrderDetail).toHaveBeenCalledWith(9, { limit: 50, afterId: 50 }, expect.any(AbortSignal)));
    await screen.findByText("0.500000");
    expect(within(panel()).queryByText("0.010000")).not.toBeInTheDocument();
    expect(within(panel()).getByText(/51 recorded fills/)).toBeInTheDocument();
    expect(panel().textContent).toMatch(/12:05:09/);
    expect(panel().textContent).not.toMatch(/12:00:00/);

    fireEvent.click(within(panel()).getByRole("button", { name: "First page" }));
    await screen.findByText(/51 recorded fills/);
    await waitFor(() => expect(within(panel()).getAllByText("0.010000")).toHaveLength(50));
    expect(fetchOrderDetail).toHaveBeenLastCalledWith(9, { limit: 50 }, expect.any(AbortSignal));
  });
});

describe("cancel", () => {
  it("cancels once on a double click and keeps success if refresh or toast fails", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order()] });
    fetchOrderDetail.mockResolvedValue(detail());
    const gate = deferred<OrderResponse>();
    cancelOrder.mockImplementation(() => gate.promise);
    showToast.mockImplementation(() => {
      throw new Error("toast unavailable");
    });
    const { invalidate } = renderTrades();
    invalidate.mockRejectedValue(new Error("refresh failed"));
    const cancel = await screen.findByRole("button", { name: "Cancel AAPL order 7" });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(cancelOrder).toHaveBeenCalledTimes(1));
    expect(cancelOrder.mock.calls[0]?.[0]).toBe(7);
    gate.resolve(order({ status: "canceled", remaining_quantity: 0 }));
    expect(await screen.findByText(/order 7 was canceled/i)).toBeInTheDocument();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be confirmed|cancellation failed|unknown outcome/i)).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] }, { throwOnError: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["portfolio"] }, { throwOnError: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["order-detail", 7] }, { throwOnError: true });
  });

  it("treats HTTP 409 as a conflict and shows the refreshed status", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders
      .mockResolvedValueOnce({ orders: [order()] })
      .mockResolvedValue({ orders: [order({ status: "filled", remaining_quantity: 0 })] });
    fetchOrderDetail.mockResolvedValue(detail({ status: "filled", filled_quantity: "1.000000", remaining_quantity: "0.000000" }));
    cancelOrder.mockRejectedValue(httpError(409, { detail: "status changed" }));
    const { invalidate } = renderTrades();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel AAPL order 7" }));
    await waitFor(() => expect(screen.getByText(/conflict/i)).toBeInTheDocument());
    expect(screen.queryByText(/was canceled/i)).not.toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] }, { throwOnError: true }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["portfolio"] }, { throwOnError: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["order-detail", 7] }, { throwOnError: true });
    expect(await screen.findByText("filled")).toBeInTheDocument();
    expect(cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfirmed cancel for network, plain, and boundary errors and still refreshes", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order()] });
    fetchOrderDetail.mockResolvedValue(detail());
    const { invalidate } = renderTrades();
    for (const error of [new AxiosError("Network Error"), new Error("socket reset"), new Error("Cancellation result could not be verified")]) {
      cancelOrder.mockRejectedValueOnce(error);
      fireEvent.click(await screen.findByRole("button", { name: "Cancel AAPL order 7" }));
      await waitFor(() => expect(screen.getByText(/could not be confirmed/i)).toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole("button", { name: "Cancel AAPL order 7" })).not.toBeDisabled());
    }
    expect(cancelOrder).toHaveBeenCalledTimes(3);
    expect(invalidate.mock.calls.filter((call) => Array.isArray(call[0]?.queryKey) && call[0].queryKey[0] === "orders").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the server business rejection and does not send another cancel", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order()] });
    fetchOrderDetail.mockResolvedValue(detail());
    cancelOrder.mockRejectedValue(httpError(400, { detail: "Order is past the cancel cutoff." }));
    renderTrades();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel AAPL order 7" }));
    expect(await screen.findByText(/past the cancel cutoff/i)).toBeInTheDocument();
    await waitFor(() => expect(fetchOrders.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel AAPL order 7" })).not.toBeDisabled());
    expect(cancelOrder).toHaveBeenCalledTimes(1);
  });
});

describe("orders list states", () => {
  it("shows loading, empty, retryable list failure, and drops an order missing from the next list", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    const pendingOrders = deferred<{ orders: OrderResponse[] }>();
    fetchOrders.mockImplementationOnce(() => pendingOrders.promise);
    fetchOrderDetail.mockResolvedValue(detail({ order_id: 7 }));
    const { client } = renderTrades();
    expect(screen.queryByRole("button", { name: /Details for/ })).not.toBeInTheDocument();
    expect(screen.queryByText("No orders yet.")).not.toBeInTheDocument();
    pendingOrders.resolve({ orders: [] });
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();

    fetchOrders.mockRejectedValueOnce(new Error("orders down"));
    await client.invalidateQueries({ queryKey: ["orders"] });
    const retry = await screen.findByRole("button", { name: "Retry orders" });
    const again = deferred<{ orders: OrderResponse[] }>();
    fetchOrders.mockImplementationOnce(() => again.promise);
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toBeDisabled());
    again.resolve({ orders: [order(), order({ id: 8, symbol: "MSFT" })] });
    await screen.findByRole("button", { name: "Details for AAPL order 7" });
    fireEvent.click(screen.getByRole("button", { name: "Details for AAPL order 7" }));
    await screen.findByText("Recorded fills");

    fetchOrders.mockResolvedValue({ orders: [order({ id: 8, symbol: "MSFT" })] });
    await client.invalidateQueries({ queryKey: ["orders"] });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Order 7 details" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Details for MSFT order 8" })).toBeInTheDocument();
  });

  it("disables detail Retry while the refetch is in flight", async () => {
    fetchTrades.mockResolvedValue({ trades: [] });
    fetchOrders.mockResolvedValue({ orders: [order()] });
    fetchOrderDetail.mockRejectedValueOnce(new Error("detail down"));
    renderTrades();
    await openDetails("Details for AAPL order 7");
    const retry = await screen.findByRole("button", { name: "Retry" });
    const gate = deferred<OrderDetailResponse>();
    const callsBefore = fetchOrderDetail.mock.calls.length;
    fetchOrderDetail.mockImplementationOnce(() => gate.promise);
    fireEvent.click(retry);
    await waitFor(() => {
      const retryNow = screen.queryByRole("button", { name: "Retry" });
      const busy = panel().getAttribute("aria-busy") === "true" || panel().querySelector("[aria-busy='true']") != null;
      const heldDisabled = retryNow != null && (retryNow as HTMLButtonElement).disabled;
      expect(heldDisabled || (retryNow == null && busy)).toBe(true);
    });
    expect(fetchOrderDetail).toHaveBeenCalledTimes(callsBefore + 1);
    gate.resolve(detail({ quantity: "1.000000", filled_quantity: "0.000000", remaining_quantity: "1.000000", total_fill_count: 0, fills: [] }));
    expect(await screen.findByText("No recorded fills.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("trade risk detail", () => {
  it("expands a row, fetches risk, and shows the score and alerts", async () => {
    fetchTrades.mockResolvedValue({ trades: [trade()] });
    fetchOrders.mockResolvedValue({ orders: [] });
    fetchTradeRisk.mockResolvedValue(tradeRisk());
    renderTrades();
    const trigger = await screen.findByRole("button", { name: "Risk for AAPL trade 45" });
    expect(fetchTradeRisk).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    await waitFor(() => expect(fetchTradeRisk).toHaveBeenCalledWith(45));
    const region = await screen.findByRole("region", { name: "Risk for AAPL trade 45" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await within(region).findByText("23")).toBeInTheDocument();
    expect(within(region).getByText("CONCENTRATION_LIMIT")).toBeInTheDocument();
    expect(within(region).getByText("medium")).toBeInTheDocument();
    expect(within(region).getByText("Position exceeds 20% of account value.")).toBeInTheDocument();
  });

  it("shows the no-assessment message", async () => {
    fetchTrades.mockResolvedValue({ trades: [trade()] });
    fetchOrders.mockResolvedValue({ orders: [] });
    fetchTradeRisk.mockResolvedValue({ message: "No risk assessment found for this trade." });
    renderTrades();
    fireEvent.click(await screen.findByRole("button", { name: "Risk for AAPL trade 45" }));
    expect(await screen.findByText("No risk assessment found for this trade.")).toBeInTheDocument();
    expect(screen.queryByText("No alerts triggered.")).not.toBeInTheDocument();
  });

  it("shows No alerts triggered when the assessment has zero alerts", async () => {
    fetchTrades.mockResolvedValue({ trades: [trade()] });
    fetchOrders.mockResolvedValue({ orders: [] });
    fetchTradeRisk.mockResolvedValue(tradeRisk({ alerts: [] }));
    renderTrades();
    fireEvent.click(await screen.findByRole("button", { name: "Risk for AAPL trade 45" }));
    const region = await screen.findByRole("region", { name: "Risk for AAPL trade 45" });
    expect(await within(region).findByText("23")).toBeInTheDocument();
    expect(within(region).getByText("No alerts triggered.")).toBeInTheDocument();
    expect(within(region).queryByText("CONCENTRATION_LIMIT")).not.toBeInTheDocument();
  });

  it("collapses the detail and re-expands from the cached query", async () => {
    fetchTrades.mockResolvedValue({ trades: [trade()] });
    fetchOrders.mockResolvedValue({ orders: [] });
    fetchTradeRisk.mockResolvedValue(tradeRisk());
    renderTrades();
    const trigger = await screen.findByRole("button", { name: "Risk for AAPL trade 45" });
    fireEvent.click(trigger);
    expect(await screen.findByText("CONCENTRATION_LIMIT")).toBeInTheDocument();
    expect(fetchTradeRisk).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Risk for AAPL trade 45" })).not.toBeInTheDocument();
    expect(screen.queryByText("CONCENTRATION_LIMIT")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByText("CONCENTRATION_LIMIT")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("shows loading while the per-trade query is in flight", async () => {
    fetchTrades.mockResolvedValue({ trades: [trade()] });
    fetchOrders.mockResolvedValue({ orders: [] });
    const gate = deferred<ReturnType<typeof tradeRisk>>();
    fetchTradeRisk.mockImplementation(() => gate.promise);
    renderTrades();
    fireEvent.click(await screen.findByRole("button", { name: "Risk for AAPL trade 45" }));
    expect(await screen.findByText("Loading...")).toBeInTheDocument();
    gate.resolve(tradeRisk());
    expect(await screen.findByText("CONCENTRATION_LIMIT")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
});
