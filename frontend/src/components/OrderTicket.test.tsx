import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import * as apiClient from "../api/client";
import {
  normalizeOrderDecimal,
  type OrderPreviewPayload,
  type OrderPreviewResponse,
} from "../api/orderPreview";
import { AuthProvider } from "../context/AuthContext";
import { useAuth } from "../context/useAuth";
import {
  readPersistedOrderAttempt,
  writePersistedOrderAttempt,
  type PersistedOrderAttempt,
} from "../utils/orderAttemptStorage";
import { OrderTicket } from "./OrderTicket";

const { createOrder, previewOrder, showToast, toast } = vi.hoisted(() => {
  const showToast = vi.fn();
  return {
    createOrder: vi.fn(),
    previewOrder: vi.fn(),
    showToast,
    toast: { toasts: [] as [], showToast, dismissToast: vi.fn() },
  };
});

vi.mock("../api/orders", () => ({ createOrder }));
vi.mock("../api/orderPreview", async () => {
  const actual = await vi.importActual<typeof import("../api/orderPreview")>("../api/orderPreview");
  return { ...actual, previewOrder };
});
vi.mock("../context/useToast", () => ({ useToast: () => toast }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clients: QueryClient[] = [];

function open(search = "") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const navigateRef: { current: ReturnType<typeof useNavigate> | null } = { current: null };
  function QueryProbe() {
    const navigate = useNavigate();
    useLayoutEffect(() => {
      navigateRef.current = navigate;
    });
    return null;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: "/trades", search }]}>
        <QueryProbe />
        <Routes>
          <Route path="/trades" element={<OrderTicket />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return Object.assign(invalidate, {
    navigate(nextSearch: string) {
      const navigate = navigateRef.current;
      if (navigate === null) throw new Error("Ticket router is not mounted.");
      act(() => {
        navigate({ pathname: "/trades", search: nextSearch });
      });
    },
    unmount: view.unmount,
  });
}

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

function echo(payload: OrderPreviewPayload, patch: Partial<OrderPreviewResponse> = {}) {
  const market = payload.order_type === "market";
  return validPreview({
    symbol: payload.symbol,
    side: payload.side,
    order_type: payload.order_type,
    quantity: payload.quantity,
    limit_price: market ? null : payload.limit_price ?? null,
    unfilled_quantity: payload.quantity,
    initial_reservation: payload.side === "sell" ? null : market ? "0.00" : "100.00",
    ...patch,
  });
}

function denied(status: "blocked" | "unavailable", reason: string, payload: OrderPreviewPayload) {
  return echo(payload, {
    status,
    reason,
    quote_observed_at: null,
    sell_available: null,
    step_up_required: false,
    initial_reservation: null,
    estimated_fill_quantity: null,
    estimated_fill_notional: null,
    unfilled_quantity: null,
  });
}

function placedOrder(patch: Record<string, unknown> = {}) {
  return {
    id: 7,
    symbol: "AAPL",
    side: "buy" as const,
    order_type: "limit" as const,
    quantity: 1,
    remaining_quantity: 1,
    limit_price: 100 as number | null,
    status: "open" as const,
    created_at: "2026-11-06T15:06:00Z",
    trade_ids: [] as number[],
    ...patch,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function leafText(expected: string | RegExp) {
  return (_content: string, element?: Element | null) => {
    if (!element || element.children.length > 0) return false;
    const text = element.textContent ?? "";
    return typeof expected === "string" ? text === expected : expected.test(text);
  };
}

function textIsAmount(value: string) {
  const negative = value.startsWith("-");
  const absolute = negative ? value.slice(1) : value;
  const escaped = absolute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\d.])\\$?${escaped}(?![\\d.])`, "g");
  return (_content: string, element?: Element | null) => {
    if (!element || element.children.length > 0) return false;
    const text = (element.textContent ?? "").replace(/,/g, "");
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const signed = text.slice(Math.max(0, index - 2), index).includes("-");
      if (signed === negative) return true;
    }
    return false;
  };
}

function expectAmount(value: string) {
  expect(screen.queryAllByText(textIsAmount(value)).length).toBeGreaterThan(0);
}

function expectMoney(value: string) {
  const nodes = screen.queryAllByText(textIsAmount(value));
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.every((node) => (node.textContent ?? "").includes("$"))).toBe(true);
}

function expectNoAmount(value: string) {
  expect(screen.queryAllByText(textIsAmount(value))).toHaveLength(0);
}

function setValue(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function clickButton(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function draft(quantity = "1", price = "100", symbol = "aapl") {
  clickButton("Buy");
  setValue("Trade symbol", symbol);
  setValue("Trade quantity", quantity);
  setValue("Limit price", price);
}

async function previewDraft() {
  previewOrder.mockImplementationOnce((payload: OrderPreviewPayload) => Promise.resolve(echo(payload)));
  clickButton("Preview order");
  await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Order preview" })).toBeInTheDocument();
  expectMoney("100000.00");
  expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
}

function expectPreviewCleared() {
  expect(screen.queryByText(leafText("Preview ready"))).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();
  expectNoAmount("100000.00");
}

function networkFailure() {
  return new AxiosError("Network Error", AxiosError.ERR_NETWORK);
}

function httpRejection(status: number, detail?: string) {
  const error = new AxiosError(`Request failed with status code ${status}`);
  error.response = {
    data: detail === undefined ? {} : { detail },
    status,
    statusText: "Error",
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  };
  return error;
}

function businessRejection(detail: string) {
  return httpRejection(422, detail);
}

describe("OrderTicket", () => {
  beforeEach(() => {
    previewOrder.mockReset();
    createOrder.mockReset();
    showToast.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
  });

  it("previews a normalized string payload and does not create an order", async () => {
    const invalidate = open();
    expect(screen.queryByRole("heading", { name: "Order preview" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Order type")).toHaveValue("limit");
    expect(screen.queryByText(leafText("Preview ready"))).not.toBeInTheDocument();
    draft();
    expect(previewOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();

    previewOrder.mockResolvedValueOnce(validPreview());
    clickButton("Preview order");

    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Order preview" })).toBeInTheDocument();
    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(previewOrder).toHaveBeenCalledWith({
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      quantity: normalizeOrderDecimal("1"),
      limit_price: normalizeOrderDecimal("100"),
    });
    expect(createOrder).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Authenticator code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
  });

  it("confirms captured strings with a UUID key and refreshes orders, trades, portfolio, and risk", async () => {
    const invalidate = open();
    draft();
    previewOrder.mockResolvedValueOnce(validPreview());
    clickButton("Preview order");
    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
    expect(invalidate).not.toHaveBeenCalled();

    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Confirm paper order");

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    const submitted = createOrder.mock.calls[0][0];
    const previewed = previewOrder.mock.calls[0][0];
    expect(submitted).toEqual({
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      quantity: "1.000000",
      limit_price: "100.000000",
      idempotencyKey: expect.stringMatching(UUID),
    });
    expect(submitted.quantity).toBe(previewed.quantity);
    expect(submitted.limit_price).toBe(previewed.limit_price);
    expect(typeof submitted.quantity).toBe("string");
    expect(typeof submitted.limit_price).toBe("string");
    expect(submitted).not.toHaveProperty("stepUpCode");
    expect(Object.keys(submitted).sort()).toEqual([
      "idempotencyKey",
      "limit_price",
      "order_type",
      "quantity",
      "side",
      "symbol",
    ]);

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) =>
        JSON.stringify((call[0] as { queryKey?: unknown }).queryKey),
      );
      expect(keys).toEqual(expect.arrayContaining([
        JSON.stringify(["orders"]),
        JSON.stringify(["trades"]),
        JSON.stringify(["portfolio"]),
        JSON.stringify(["risk"]),
      ]));
    });
  });

  it("sends a 12-digit quantity through unchanged when the desk blocks it", async () => {
    open();
    const exact = "123456789012.123456";
    draft(exact, exact);
    previewOrder.mockImplementationOnce((payload: OrderPreviewPayload) =>
      Promise.resolve(denied("blocked", "Quantity exceeds the paper desk limit", payload)),
    );
    clickButton("Preview order");

    await waitFor(() => expect(screen.getByText(leafText("Quantity exceeds the paper desk limit"))).toBeInTheDocument());
    const payload = previewOrder.mock.calls[0][0];
    expect(payload.quantity).toBe(normalizeOrderDecimal(exact));
    expect(payload.limit_price).toBe(normalizeOrderDecimal(exact));
    expect(payload.quantity).toBe(exact);
    expect(typeof payload.quantity).toBe("string");
    expect(typeof payload.limit_price).toBe("string");
    expect(screen.getByLabelText("Trade quantity")).toHaveValue(exact);
    expect(screen.getByLabelText("Limit price")).toHaveValue(exact);
    expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("renders eligible zero estimates as zeros", async () => {
    open();
    draft();
    previewOrder.mockResolvedValueOnce(validPreview());
    clickButton("Preview order");

    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
    expectMoney("0.00");
    expectAmount("0.000000");
    expectMoney("100.00");
    expect(screen.queryByText(leafText(/unavailable/i))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("shows a half-cent limit reservation beside a larger fill notional", async () => {
    open();
    draft();
    previewOrder.mockResolvedValueOnce(validPreview({
      initial_reservation: "0.01",
      estimated_fill_quantity: "1.000000",
      estimated_fill_notional: "0.02",
      unfilled_quantity: "0.000000",
    }));
    clickButton("Preview order");

    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
    expectMoney("0.01");
    expectMoney("0.02");
    expect(screen.queryByText(leafText(/invalid order preview/i))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("omits the limit price on a market preview and shows a zero-fill cancel as canceled", async () => {
    open();
    clickButton("Buy");
    setValue("Trade symbol", "aapl");
    setValue("Trade quantity", "1");
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "market" } });
    previewOrder.mockImplementationOnce((payload: OrderPreviewPayload) => Promise.resolve(echo(payload)));
    clickButton("Preview order");

    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(previewOrder.mock.calls[0][0]).toEqual({
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      quantity: "1.000000",
    });
    expect(screen.getAllByText(leafText(/Unfilled market quantity is canceled\./)).length).toBeGreaterThan(0);
    expect(createOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Order preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();

    createOrder.mockResolvedValueOnce(placedOrder({
      order_type: "market",
      limit_price: null,
      status: "canceled",
      quantity: 1,
      remaining_quantity: 1,
      trade_ids: [],
    }));
    clickButton("Confirm paper order");

    await waitFor(() => expect(screen.getByText(leafText("Order canceled."))).toBeInTheDocument());
    expect(screen.queryByText(leafText("Filled"))).not.toBeInTheDocument();
    expect(screen.queryByText(leafText("Order filled."))).not.toBeInTheDocument();
    const submitted = createOrder.mock.calls[0][0];
    expect(submitted.order_type).toBe("market");
    expect(submitted.quantity).toBe("1.000000");
    expect(submitted.limit_price).toBeUndefined();
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("withholds confirm for blocked and unavailable previews without inventing zeros", async () => {
    const cases = [
      ["blocked", "Buying power is fully reserved"],
      ["unavailable", "Quote feed unavailable"],
    ] as const;

    for (const [status, reason] of cases) {
      open();
      draft();
      previewOrder.mockImplementationOnce((payload: OrderPreviewPayload) =>
        Promise.resolve(denied(status, reason, payload)),
      );
      clickButton("Preview order");
      await waitFor(() => expect(screen.getByText(leafText(reason))).toBeInTheDocument());
      expect(screen.queryByText(leafText("Preview ready"))).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();
      expectNoAmount("0.00");
      expectNoAmount("0.000000");
      expect(createOrder).not.toHaveBeenCalled();
      cleanup();
      clients.splice(0).forEach((client) => client.clear());
    }
  });

  it("does not post while editing and ignores a duplicate preview or confirm", async () => {
    open();
    draft();
    clickButton("Sell");
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "market" } });
    expect(previewOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();

    clickButton("Buy");
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "limit" } });
    setValue("Limit price", "100");

    const previewGate = deferred<OrderPreviewResponse>();
    previewOrder.mockImplementationOnce(() => previewGate.promise);
    const previewButton = screen.getByRole("button", { name: "Preview order" });
    fireEvent.click(previewButton);
    fireEvent.click(previewButton);
    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(previewButton).toBeDisabled();
    expect(screen.getByLabelText("Trade symbol")).toBeEnabled();
    expect(createOrder).not.toHaveBeenCalled();

    await act(async () => {
      previewGate.resolve(echo(previewOrder.mock.calls[0][0]));
      await previewGate.promise;
    });
    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());

    const confirmGate = deferred<ReturnType<typeof placedOrder>>();
    createOrder.mockImplementationOnce(() => confirmGate.promise);
    const confirmButton = screen.getByRole("button", { name: "Confirm paper order" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeDisabled();
    expect(previewOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirmGate.resolve(placedOrder());
      await confirmGate.promise;
    });
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  });

  it("drops the ready preview when side, type, symbol, quantity, or price changes", async () => {
    open();
    draft();

    async function readyThen(edit: () => void) {
      await previewDraft();
      edit();
      expectPreviewCleared();
    }

    await readyThen(() => clickButton("Sell"));
    await readyThen(() => {
      fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "market" } });
    });
    await readyThen(() => setValue("Trade symbol", "MSFT"));
    await readyThen(() => setValue("Trade quantity", "2"));
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "limit" } });
    setValue("Limit price", "100");
    await readyThen(() => setValue("Limit price", "101"));
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("keeps the newest preview when an older request resolves last", async () => {
    open();
    const first = deferred<OrderPreviewResponse>();
    const second = deferred<OrderPreviewResponse>();
    const third = deferred<OrderPreviewResponse>();
    previewOrder
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    draft();
    clickButton("Preview order");
    setValue("Trade symbol", "MSFT");
    // A changed draft may preview again while the previous request is still outstanding.
    expect(screen.getByRole("button", { name: "Preview order" })).toBeEnabled();
    clickButton("Preview order");
    setValue("Trade symbol", "AAPL");
    clickButton("Preview order");
    expect(previewOrder).toHaveBeenCalledTimes(3);

    await act(async () => {
      second.resolve(echo(previewOrder.mock.calls[1][0], {
        buying_power: "202.00",
        initial_reservation: "202.00",
      }));
      await second.promise;
    });
    expectNoAmount("202.00");
    expect(screen.queryByText(leafText("MSFT"))).not.toBeInTheDocument();
    expect(screen.queryByText(leafText("Preview ready"))).not.toBeInTheDocument();

    await act(async () => {
      third.resolve(echo(previewOrder.mock.calls[2][0], {
        buying_power: "303.00",
        initial_reservation: "303.00",
      }));
      await third.promise;
    });
    await waitFor(() => expectMoney("303.00"));
    expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument();

    await act(async () => {
      first.resolve(echo(previewOrder.mock.calls[0][0], {
        buying_power: "101.00",
        initial_reservation: "101.00",
      }));
      await first.promise;
    });
    expectMoney("303.00");
    expectNoAmount("101.00");
    expectNoAmount("202.00");
    expect(screen.queryByText(leafText("MSFT"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("hides a ready preview when refresh fails and can preview again", async () => {
    open();
    draft();
    await previewDraft();
    expectMoney("100.00");

    previewOrder.mockRejectedValueOnce(new Error("Invalid order preview response"));
    clickButton("Preview order");
    await waitFor(() => {
      expect(screen.getByText(leafText(
        "The preview response could not be read. Earlier figures are hidden. Preview the order again.",
      ))).toBeInTheDocument();
    });
    expectPreviewCleared();
    expectNoAmount("100.00");
    expect(createOrder).not.toHaveBeenCalled();

    await previewDraft();
    expect(previewOrder).toHaveBeenCalledTimes(3);
  });

  it("sends a six-digit authenticator code only on confirm after step-up", async () => {
    open();
    draft();
    previewOrder.mockImplementationOnce((payload: OrderPreviewPayload) =>
      Promise.resolve(echo(payload, { step_up_required: true })),
    );
    clickButton("Preview order");
    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());

    const code = screen.getByLabelText("Authenticator code");
    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(previewOrder.mock.calls[0][0]).not.toHaveProperty("stepUpCode");
    clickButton("Confirm paper order");
    expect(createOrder).not.toHaveBeenCalled();
    expect(code).toHaveAttribute("aria-describedby", "order-step-up-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the current six-digit authenticator code.");

    fireEvent.change(code, { target: { value: "12345" } });
    clickButton("Confirm paper order");
    expect(createOrder).not.toHaveBeenCalled();
    expect(code).toHaveAttribute("aria-describedby", "order-step-up-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the current six-digit authenticator code.");

    fireEvent.change(code, { target: { value: "123456" } });
    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Confirm paper order");

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    const submitted = createOrder.mock.calls[0][0];
    expect(submitted.stepUpCode).toBe("123456");
    expect(Object.keys(submitted).sort()).toEqual([
      "idempotencyKey",
      "limit_price",
      "order_type",
      "quantity",
      "side",
      "stepUpCode",
      "symbol",
    ]);
    expect(previewOrder).toHaveBeenCalledTimes(1);
  });

  it("keeps the financial preview when only the authenticator code changes", async () => {
    open();
    draft();
    previewOrder.mockImplementationOnce((payload: OrderPreviewPayload) =>
      Promise.resolve(echo(payload, { step_up_required: true })),
    );
    clickButton("Preview order");
    await waitFor(() => expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument());
    expectMoney("100.00");

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "654321" } });
    expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument();
    expectMoney("100.00");
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("retries an unknown confirmation with the same key, then uses a new key", async () => {
    open();
    draft();
    await previewDraft();
    createOrder.mockRejectedValueOnce(networkFailure());
    clickButton("Confirm paper order");

    await waitFor(() => expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument());
    expect(createOrder).toHaveBeenCalledTimes(1);
    const first = createOrder.mock.calls[0][0];
    expect(first.idempotencyKey).toMatch(UUID);
    expect(first).not.toHaveProperty("stepUpCode");
    for (const label of ["Trade symbol", "Trade quantity", "Limit price", "Order type"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();

    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Retry same order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0]).toEqual(first);
    await waitFor(() => {
      expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("Trade symbol")).toBeEnabled();

    setValue("Trade quantity", "3");
    await previewDraft();
    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Confirm paper order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(3));
    const next = createOrder.mock.calls[2][0];
    expect(next.idempotencyKey).toMatch(UUID);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(next.quantity).toBe("3.000000");
  });

  it("shows a business rejection, blocks the old confirm, and allows another preview", async () => {
    open();
    draft();
    await previewDraft();
    const detail = "Price is outside the allowed band";
    createOrder.mockRejectedValueOnce(businessRejection(detail));
    clickButton("Confirm paper order");

    await waitFor(() => {
      expect(screen.getByText(leafText(new RegExp(detail)))).toBeInTheDocument();
    });
    expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    expect(screen.queryByText(leafText("Preview ready"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Trade symbol")).toBeEnabled();
    expect(screen.getByLabelText("Limit price")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled();

    setValue("Limit price", "101");
    await previewDraft();
    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Confirm paper order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0].limit_price).toBe(normalizeOrderDecimal("101"));
  });

  it("keeps a network attempt unknown when retry is rejected before idempotency lookup", async () => {
    open();
    draft();
    await previewDraft();
    createOrder.mockRejectedValueOnce(networkFailure());
    clickButton("Confirm paper order");
    await waitFor(() => {
      expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument();
    });
    const first = createOrder.mock.calls[0][0];
    expect(first.idempotencyKey).toMatch(UUID);

    createOrder.mockRejectedValueOnce(httpRejection(429, "Too many order attempts"));
    clickButton("Retry same order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0]).toEqual(first);
    expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument();
    expect(screen.queryByText(leafText("Too many order attempts"))).not.toBeInTheDocument();
    for (const label of ["Trade symbol", "Trade quantity", "Limit price", "Order type"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();

    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Retry same order");
    await waitFor(() => expect(screen.getByText(leafText("Order open."))).toBeInTheDocument());
    expect(createOrder).toHaveBeenCalledTimes(3);
    expect(createOrder.mock.calls.map((call) => call[0])).toEqual([first, first, first]);
    expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
  });

  it("keeps a known open order when list refresh fails", async () => {
    const invalidate = open();
    invalidate.mockRejectedValue(new Error("list refresh failed"));
    draft();
    await previewDraft();
    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Confirm paper order");

    await waitFor(() => expect(screen.getByText(leafText("Order open."))).toBeInTheDocument());
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(screen.getByText(leafText("Order open."))).toBeInTheDocument();
    expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();
  });

  it("seeds one trimmed symbol and does not fill quantity, price, or call order APIs", () => {
    open("?symbol=%20aapl%20");
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("AAPL");
    expect(screen.getByLabelText("Trade quantity")).toHaveValue("");
    expect(screen.getByLabelText("Limit price")).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "Order preview" })).not.toBeInTheDocument();
    expect(previewOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", ""],
    ["empty", "?symbol="],
    ["blank", "?symbol=%20%20"],
    ["too long", `?symbol=${"A".repeat(21)}`],
    ["duplicate", "?symbol=AAPL&symbol=MSFT"],
  ])("leaves the symbol blank for a %s query", (_label, search) => {
    open(search);
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("");
    expect(screen.getByLabelText("Trade quantity")).toHaveValue("");
    expect(screen.getByLabelText("Limit price")).toHaveValue("");
    expect(previewOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("keeps an edited draft when the mounted query changes", () => {
    const ticket = open("?symbol=AAPL");
    setValue("Trade symbol", "MSFT");
    setValue("Trade quantity", "2");
    setValue("Limit price", "50");
    ticket.navigate("?symbol=IBM");
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("MSFT");
    expect(screen.getByLabelText("Trade quantity")).toHaveValue("2");
    expect(screen.getByLabelText("Limit price")).toHaveValue("50");
    expect(previewOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("keeps a ready preview when the mounted query changes", async () => {
    const ticket = open("?symbol=AAPL");
    draft("1", "100", "AAPL");
    await previewDraft();
    ticket.navigate("?symbol=MSFT");
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("AAPL");
    expect(screen.getByLabelText("Trade quantity")).toHaveValue("1");
    expect(screen.getByLabelText("Limit price")).toHaveValue("100");
    expect(screen.getByText(leafText("Preview ready"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeEnabled();
    expect(previewOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("keeps a pending confirm across a query change and retries that same request", async () => {
    const ticket = open("?symbol=AAPL");
    draft("1", "100", "AAPL");
    await previewDraft();
    let rejectOrder: (reason: unknown) => void = () => undefined;
    createOrder.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectOrder = reject;
    }));
    clickButton("Confirm paper order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    const first = createOrder.mock.calls[0][0];
    expect(first.idempotencyKey).toMatch(UUID);
    expect(screen.getByRole("button", { name: "Confirm paper order" })).toBeDisabled();
    ticket.navigate("?symbol=MSFT");
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("AAPL");
    expect(screen.getByRole("heading", { name: "Order preview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    expect(createOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectOrder(networkFailure());
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry same order" })).toBeEnabled());
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("AAPL");
    expect(screen.getByRole("heading", { name: "Order preview" })).toBeInTheDocument();
    ticket.navigate("?symbol=IBM");
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("AAPL");
    expect(screen.getByRole("button", { name: "Retry same order" })).toBeEnabled();

    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Retry same order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0]).toEqual(first);
  });

  it("restores an unknown attempt across unmount and retries with the same key", async () => {
    const ticket = open();
    draft();
    await previewDraft();
    createOrder.mockRejectedValueOnce(networkFailure());
    clickButton("Confirm paper order");

    await waitFor(() => expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument());
    expect(createOrder).toHaveBeenCalledTimes(1);
    const first = createOrder.mock.calls[0][0];
    expect(first.idempotencyKey).toMatch(UUID);
    for (const label of ["Trade symbol", "Trade quantity", "Limit price", "Order type"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();

    ticket.unmount();
    open();

    expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry same order" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirm paper order" })).not.toBeInTheDocument();
    for (const label of ["Trade symbol", "Trade quantity", "Limit price", "Order type"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();
    expect(createOrder).toHaveBeenCalledTimes(1);

    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Retry same order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0]).toEqual(first);
  });

  it("clears a restored attempt after it resolves so a reload starts empty", async () => {
    const firstTicket = open();
    draft();
    await previewDraft();
    createOrder.mockRejectedValueOnce(networkFailure());
    clickButton("Confirm paper order");
    await waitFor(() => expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument());
    const first = createOrder.mock.calls[0][0];

    firstTicket.unmount();
    const restored = open();
    expect(createOrder).toHaveBeenCalledTimes(1);
    createOrder.mockResolvedValueOnce(placedOrder());
    clickButton("Retry same order");
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0]).toEqual(first);
    await waitFor(() => {
      expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    });

    restored.unmount();
    open();
    expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Order preview" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("");
    expect(screen.getByLabelText("Trade quantity")).toHaveValue("");
    expect(screen.getByLabelText("Limit price")).toHaveValue("");
    expect(screen.getByLabelText("Trade symbol")).toBeEnabled();
    expect(createOrder).toHaveBeenCalledTimes(2);
  });

  it("clears a persisted attempt after a definitive rejection on retry", async () => {
    const firstTicket = open();
    draft();
    await previewDraft();
    createOrder.mockRejectedValueOnce(networkFailure());
    clickButton("Confirm paper order");
    await waitFor(() => expect(screen.getByText(leafText(/The outcome of this order is unknown/))).toBeInTheDocument());
    const first = createOrder.mock.calls[0][0];
    const detail = "Price is outside the allowed band";
    createOrder.mockRejectedValueOnce(httpRejection(400, detail));
    clickButton("Retry same order");
    await waitFor(() => {
      expect(screen.getByText(leafText(new RegExp(detail)))).toBeInTheDocument();
    });
    expect(createOrder.mock.calls[1][0]).toEqual(first);
    expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();

    firstTicket.unmount();
    open();
    expect(screen.queryByText(leafText(/The outcome of this order is unknown/))).not.toBeInTheDocument();
    expect(screen.queryByText(leafText(new RegExp(detail)))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Order preview" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Trade symbol")).toHaveValue("");
    expect(screen.getByLabelText("Trade symbol")).toBeEnabled();
    expect(createOrder).toHaveBeenCalledTimes(2);
  });
});

function samplePersistedAttempt(): PersistedOrderAttempt {
  const preview = validPreview();
  return {
    attempt: {
      fingerprint: JSON.stringify({
        symbol: preview.symbol,
        side: preview.side,
        order_type: preview.order_type,
        quantity: preview.quantity,
        limit_price: preview.limit_price,
      }),
      payload: {
        symbol: preview.symbol,
        side: preview.side,
        order_type: preview.order_type,
        quantity: preview.quantity,
        ...(preview.limit_price !== null ? { limit_price: preview.limit_price } : {}),
      },
      key: "sample-persisted-attempt-fixture",
    },
    preview,
  };
}

function SignOutProbe() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={signOut}>
      Sign out
    </button>
  );
}

describe("AuthProvider pending-attempt cleanup", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(authApi, "logout").mockResolvedValue(undefined);
    vi.spyOn(authApi, "refreshSession").mockRejectedValue(new Error("no session"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("clears a persisted attempt on sign-out", () => {
    writePersistedOrderAttempt(samplePersistedAttempt());
    expect(readPersistedOrderAttempt()).not.toBeNull();

    render(
      <AuthProvider>
        <SignOutProbe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(readPersistedOrderAttempt()).toBeNull();
  });

  it("clears a persisted attempt when the session is unauthorized", async () => {
    let onUnauthorized: (() => void) | null = null;
    vi.spyOn(apiClient, "setUnauthorizedHandler").mockImplementation((handler) => {
      onUnauthorized = handler;
    });
    writePersistedOrderAttempt(samplePersistedAttempt());
    expect(readPersistedOrderAttempt()).not.toBeNull();

    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>,
    );
    await waitFor(() => expect(onUnauthorized).toEqual(expect.any(Function)));
    act(() => {
      onUnauthorized?.();
    });
    expect(readPersistedOrderAttempt()).toBeNull();
  });
});

