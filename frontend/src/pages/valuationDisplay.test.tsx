import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AllocationResponse, AttributionResponse, OrderResponse, PortfolioResponse, RiskMetricsResponse } from "../types/schemas";
import type { TradeImpactResponse } from "../types/schemas";
import { ToastProvider } from "../context/ToastProvider";
import { Dashboard } from "./Dashboard";
import { Portfolio } from "./Portfolio";

const api = vi.hoisted(() => ({
  fetchPortfolio: vi.fn(),
  fetchPortfolioPnl: vi.fn(),
  fetchAllocation: vi.fn(),
  fetchAttribution: vi.fn(),
  fetchRiskMetrics: vi.fn(),
  fetchTrades: vi.fn(),
  fetchRisk: vi.fn(),
  fetchOrders: vi.fn(),
  createTrade: vi.fn(),
  fetchMe: vi.fn(),
  setLegalName: vi.fn(),
  createCashMovement: vi.fn(),
  previewTradeImpact: vi.fn(),
}));

vi.mock("../api/portfolio", () => ({
  fetchPortfolio: api.fetchPortfolio,
  fetchPortfolioPnl: api.fetchPortfolioPnl,
}));

vi.mock("../api/allocation", () => ({
  fetchAllocation: api.fetchAllocation,
}));

vi.mock("../api/attribution", () => ({
  fetchAttribution: api.fetchAttribution,
}));

vi.mock("../api/riskMetrics", () => ({
  fetchRiskMetrics: api.fetchRiskMetrics,
}));

vi.mock("../api/trades", () => ({
  fetchTrades: api.fetchTrades,
  createTrade: api.createTrade,
}));

vi.mock("../api/orders", () => ({
  fetchOrders: api.fetchOrders,
}));

vi.mock("../api/risk", () => ({
  fetchRisk: api.fetchRisk,
}));

vi.mock("../api/auth", () => ({
  fetchMe: api.fetchMe,
  setLegalName: api.setLegalName,
}));

vi.mock("../api/cash", () => ({
  createCashMovement: api.createCashMovement,
}));

vi.mock("../api/tradeImpact", () => ({
  previewTradeImpact: api.previewTradeImpact,
}));

function attribution(status: "complete" | "incomplete"): AttributionResponse {
  const complete = status === "complete";
  return {
    user: { id: 1, email: "trader@example.com" },
    read_at: "2026-11-05T15:00:00Z",
    status,
    total_pnl: complete ? "147.99" : null,
    securities: [
      {
        symbol: "AAPL",
        sector: "Technology",
        realized_pnl: "12.34",
        unrealized_pnl: complete ? "180.50" : null,
        total_pnl: complete ? "192.84" : null,
        pnl_contribution_pct: complete ? "130.3061" : null,
      },
      {
        symbol: "MSFT",
        sector: "Technology",
        realized_pnl: "0.00",
        unrealized_pnl: complete ? "-44.85" : null,
        total_pnl: complete ? "-44.85" : null,
        pnl_contribution_pct: complete ? "-30.3061" : null,
      },
    ],
    sectors: complete
      ? [{ sector: "Technology", total_pnl: "147.99", pnl_contribution_pct: "100.0000" }]
      : null,
  };
}

function riskMetrics(overrides: Partial<RiskMetricsResponse> = {}): RiskMetricsResponse {
  return {
    user: { id: 1, email: "trader@example.com" },
    range: "1y",
    requested_start: "2025-11-05",
    requested_end: "2026-11-05",
    read_at: "2026-11-05T15:00:00Z",
    status: "complete",
    observed_periods: 252,
    return_count: 251,
    historical_volatility_pct: null,
    max_drawdown_pct: null,
    beta_pair_count: 0,
    portfolio_beta: null,
    historical_var_95_pct: null,
    historical_var_99_pct: null,
    expected_shortfall_95_pct: null,
    expected_shortfall_99_pct: null,
    correlations: null,
    stress_scenarios: null,
    risk_contributions: null,
    ...overrides,
  };
}

function tradeImpactBuy(warnings: string[] = []): TradeImpactResponse {
  return {
    user: { id: 1, email: "trader@example.com" },
    read_at: "2026-11-05T15:00:00Z",
    status: "complete",
    symbol: "AAPL",
    side: "buy",
    quantity: "2.000000",
    reference_price: "100.000000",
    order_type: "market",
    warnings,
    before: {
      cash_balance: "1000.00",
      buying_power: "1000.00",
      total_account_value: "1600.00",
      cash_weight_pct: "62.5000",
      symbol_position_value: "300.00",
      symbol_weight_pct: "18.7500",
    },
    after: {
      cash_balance: "800.00",
      buying_power: "800.00",
      total_account_value: "1600.00",
      cash_weight_pct: "50.0000",
      symbol_position_value: "500.00",
      symbol_weight_pct: "31.2500",
    },
    changes: {
      cash_balance: "-200.00",
      total_account_value: "0.00",
      cash_weight_pct: "-12.5000",
      symbol_weight_pct: "12.5000",
    },
  };
}

function allocation(status: "complete" | "incomplete"): AllocationResponse {
  const complete = status === "complete";
  return {
    user: { id: 1, email: "trader@example.com" },
    read_at: "2026-11-05T15:00:00Z",
    status,
    cash_balance: "1000.00",
    cash_weight_pct: complete ? "62.5000" : null,
    total_account_value: complete ? "1600.00" : null,
    unavailable_symbols: complete ? [] : ["MSFT"],
    securities: [
      {
        symbol: "AAPL",
        sector: "Technology",
        position_value: complete ? "300.00" : null,
        weight_pct: complete ? "18.7500" : null,
        price_status: complete ? "available" : "unavailable",
      },
    ],
    sectors: complete
      ? [
          { sector: "Technology", value: "300.00", weight_pct: "18.7500" },
          { sector: "Financials", value: "200.00", weight_pct: "12.5000" },
        ]
      : null,
  };
}

function book(status: "complete" | "incomplete"): PortfolioResponse {
  const complete = status === "complete";
  return {
    user: { id: 1, email: "trader@example.com" },
    valuation_status: status,
    snapshot_read_at: "2026-11-05T15:00:00Z",
    unavailable_symbols: complete ? [] : ["MSFT"],
    positions: [
      {
        symbol: "AAPL",
        asset_type: "stock",
        quantity: 2,
        avg_cost: 50,
        current_price: 50,
        position_value: 100,
        cost_basis: 100,
        unrealized_pnl: 0,
        unrealized_pnl_pct: 0,
        price_status: "available",
        unavailable_reason: null,
        source: "yahoo",
        quote_at: "2026-11-05T14:45:00Z",
        fetched_at: "2026-11-05T14:50:00Z",
      },
      {
        symbol: "MSFT",
        asset_type: "stock",
        quantity: 3,
        avg_cost: 20,
        current_price: complete ? 20 : null,
        position_value: complete ? 60 : null,
        cost_basis: 60,
        unrealized_pnl: complete ? 0 : null,
        unrealized_pnl_pct: complete ? 0 : null,
        price_status: complete ? "available" : "unavailable",
        unavailable_reason: complete ? null : "missing",
        source: complete ? "yahoo" : null,
        quote_at: complete ? "2026-11-05T14:00:00Z" : null,
        fetched_at: complete ? "2026-11-05T14:05:00Z" : null,
      },
    ],
    summary: {
      cash_balance: complete ? 50000 : 100000,
      buying_power: complete ? 40000 : 80000,
      total_account_value: complete ? 50160 : null,
      total_portfolio_value: complete ? 160 : null,
      total_cost_basis: 160,
      total_unrealized_pnl: complete ? 0 : null,
      total_unrealized_pnl_pct: complete ? 0 : null,
      total_realized_pnl: 0,
      total_pnl: complete ? 0 : null,
    },
  };
}

function renderPage(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>{node}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function order(
  overrides: Partial<OrderResponse> & Pick<OrderResponse, "id" | "symbol">,
): OrderResponse {
  return {
    side: "buy",
    order_type: "limit",
    quantity: 1,
    remaining_quantity: 1,
    limit_price: 1,
    status: "open",
    created_at: "2026-11-05T15:00:00Z",
    ...overrides,
  };
}

function assessment(score: number) {
  return {
    assessment_id: 1,
    trade_id: 9,
    risk_score: score,
    created_at: "2026-11-05T15:00:00Z",
    trade: null,
    alerts: [],
  };
}

function fill(realizedPnl = 0) {
  return {
    id: 4,
    symbol: "IBM",
    asset_type: "stock" as const,
    side: "sell" as const,
    quantity: 1,
    price_at_execution: 10,
    notional: 10,
    realized_pnl: realizedPnl,
    realized_pnl_pct: 0,
    executed_at: "2026-11-05T14:30:00Z",
  };
}

function riskTile() {
  return screen.getByText("Latest assessment").parentElement as HTMLElement;
}

function riskCard() {
  return screen.getByRole("heading", { name: "Risk Score" }).closest("section") as HTMLElement;
}

function ordersCard() {
  return screen.getByRole("heading", { name: "Recent Orders" }).closest("section") as HTMLElement;
}

function valueCard() {
  return screen.getByRole("heading", { name: "Portfolio Value" }).closest("section") as HTMLElement;
}

describe("valuation display", () => {
  beforeEach(() => {
    api.fetchOrders.mockResolvedValue({ orders: [] });
    api.fetchAllocation.mockResolvedValue(allocation("incomplete"));
    api.fetchAttribution.mockResolvedValue(attribution("incomplete"));
    api.fetchRiskMetrics.mockResolvedValue(riskMetrics());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps an incomplete dashboard from showing a cash total, a curve, or a zero day return", async () => {
    api.fetchPortfolio.mockResolvedValue(book("incomplete"));
    api.fetchPortfolioPnl.mockResolvedValue({
      points: [
        { label: "Mon", value: 1 },
        { label: "Tue", value: 2 },
        { label: "Wed", value: 3 },
        { label: "Thu", value: 4 },
        { label: "Fri", value: 5 },
      ],
      daily_pnl: 0,
      daily_pnl_pct: 0,
      total_pnl: 0,
    });
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });

    renderPage(<Dashboard />);

    expect(await screen.findByText("Valuation incomplete")).toBeInTheDocument();
    const valueCard = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section");
    expect(valueCard).not.toBeNull();
    const value = within(valueCard as HTMLElement);
    expect(value.getByText("Valuation incomplete")).toBeInTheDocument();
    expect(value.getByText("Unavailable")).toBeInTheDocument();
    expect(value.queryByText("$100,000")).not.toBeInTheDocument();
    expect(value.getByText("$80,000")).toBeInTheDocument();
    expect(value.queryByText("Real 1D")).not.toBeInTheDocument();
    expect(screen.queryByText("Mon")).not.toBeInTheDocument();

    const dayPnl = screen.getByText("Total P&L").parentElement as HTMLElement;
    expect(within(dayPnl).getByText("Unavailable")).toBeInTheDocument();
    expect(within(dayPnl).queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");

    const apple = screen.getByText("AAPL").closest("tr") as HTMLElement;
    expect(within(apple).queryByText(/Low risk/)).not.toBeInTheDocument();
    expect(within(apple).getByText(/0\.00%/)).toBeInTheDocument();
    const microsoft = screen.getByText("MSFT").closest("tr") as HTMLElement;
    expect(within(microsoft).getByText("Quote missing")).toBeInTheDocument();
    expect(within(microsoft).queryByText(/Low risk/)).not.toBeInTheDocument();
    expect(within(microsoft).queryByText(/0\.00%/)).not.toBeInTheDocument();
  });

  it("shows a formatted zero for a complete dashboard", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchPortfolioPnl.mockResolvedValue({ daily_pnl: 0, daily_pnl_pct: 0, total_pnl: 0 });
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });

    renderPage(<Dashboard />);

    expect(await screen.findByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    const valueCard = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section") as HTMLElement;
    expect(within(valueCard).queryByText("Real 1D")).not.toBeInTheDocument();
    expect(within(valueCard).getByText("Performance history unavailable")).toBeInTheDocument();
    expect(within(valueCard).queryByLabelText("Intraday portfolio value chart")).not.toBeInTheDocument();
    expect(valueCard.querySelector(".text-4xl")?.textContent).toBe("$50,160");
    expect(within(valueCard).queryByText("Valuation incomplete")).not.toBeInTheDocument();
    const dayTile = screen.getByText("Total P&L").parentElement as HTMLElement;
    expect(within(dayTile).getByLabelText("gain: $0.00")).toBeInTheDocument();
    expect(screen.queryByText("Day change")).not.toBeInTheDocument();
    expect(screen.queryByText("Day P&L")).not.toBeInTheDocument();
    expect(screen.getByText("Unrealized P&L %")).toBeInTheDocument();
    expect(api.fetchPortfolioPnl).not.toHaveBeenCalled();
  });

  it("shows total and unrealized figures without inventing daily performance", async () => {
    const priced = book("complete");
    Object.assign(priced.positions[0], { current_price: 75, position_value: 150, unrealized_pnl: 50, unrealized_pnl_pct: 50 });
    priced.summary.total_account_value = 50210;
    priced.summary.total_portfolio_value = 210;
    priced.summary.total_realized_pnl = 75;
    priced.summary.total_unrealized_pnl = 50;
    priced.summary.total_pnl = 125;
    priced.summary.total_unrealized_pnl_pct = 31.25;
    api.fetchPortfolio.mockResolvedValue(priced);
    api.fetchPortfolioPnl.mockResolvedValue({ daily_pnl: 999, daily_pnl_pct: 999 });
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    renderPage(<Dashboard />);
    expect(await screen.findByLabelText("gain: $125.00")).toBeInTheDocument();
    const percent = screen.getByText("Unrealized P&L %").parentElement as HTMLElement;
    expect(within(percent).getByText("+31.25%")).toBeInTheDocument();
    expect(screen.queryByText("Real 1D")).not.toBeInTheDocument();
    expect(api.fetchPortfolioPnl).not.toHaveBeenCalled();
  });

  it("keeps missing account data from becoming zero cash or an enabled trade ticket", async () => {
    api.fetchPortfolio.mockRejectedValue(new Error("Account read unavailable"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    renderPage(<Dashboard />);
    expect(await screen.findByText(/Some dashboard data could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText("Account data unavailable")).toBeInTheDocument();
    const cash = screen.getByText("Cash").parentElement as HTMLElement;
    expect(within(cash).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByLabelText("Trade symbol")).not.toBeInTheDocument();
  });

  it("keeps incomplete portfolio totals unavailable and leaves known figures visible", async () => {
    api.fetchPortfolio.mockResolvedValue(book("incomplete"));
    api.fetchPortfolioPnl.mockResolvedValue({
      points: [{ label: "Mon", value: 1 }],
      daily_pnl: 0,
      total_pnl: 0,
    });
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });

    renderPage(<Portfolio />);

    expect(await screen.findByText("Valuation incomplete")).toBeInTheDocument();
    const portfolioValue = screen.getByText("Portfolio value").parentElement as HTMLElement;
    expect(within(portfolioValue).getByText("Unavailable")).toBeInTheDocument();
    expect(within(portfolioValue).queryByText("$100,000")).not.toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");

    const totalPnl = screen.getByText("Total P&L").parentElement as HTMLElement;
    expect(within(totalPnl).getByText("Unavailable")).toBeInTheDocument();
    expect(within(totalPnl).queryByLabelText("gain: $0.00")).not.toBeInTheDocument();

    const exposure = screen.getByRole("heading", { name: "Exposure by asset" }).closest("section") as HTMLElement;
    expect(within(exposure).getByText("Valuation incomplete")).toBeInTheDocument();
    expect(exposure.textContent).not.toMatch(/%/);

    const fifo = screen.getByRole("heading", { name: "FIFO P&L" }).closest("section") as HTMLElement;
    expect(within(fifo).getByText("$160")).toBeInTheDocument();
    expect(within(fifo).getByLabelText("gain: $0.00")).toBeInTheDocument();

    const apple = screen.getByText("AAPL").closest("tr") as HTMLElement;
    expect(within(apple).getAllByText("$50.00")).toHaveLength(2);
    expect(within(apple).getByLabelText("gain: $0.00")).toBeInTheDocument();
    expect(within(apple).getByText("2")).toBeInTheDocument();
    const microsoft = screen.getByText("MSFT").closest("tr") as HTMLElement;
    expect(within(microsoft).getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(within(microsoft).getByText("Quote missing")).toBeInTheDocument();
    expect(within(microsoft).queryByLabelText("gain: $0.00")).not.toBeInTheDocument();
    expect(within(microsoft).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/Showing portfolio summary P&L/)).not.toBeInTheDocument();
  });

  it("shows a failed risk request, then a positive score after retry, without hiding cash or account value", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockRejectedValue(new Error("risk down"));
    renderPage(<Dashboard />);

    expect(await screen.findByText("Risk assessment unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No assessments")).not.toBeInTheDocument();
    expect(screen.queryByText("No activity")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
    expect(within(riskTile()).getByText("Unavailable")).toBeInTheDocument();
    expect(within(riskTile()).queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");

    api.fetchRisk.mockResolvedValue({ assessments: [assessment(91)] });
    fireEvent.click(screen.getByRole("button", { name: "Retry risk assessment" }));

    expect(await within(riskTile()).findByText("91")).toBeInTheDocument();
    expect(screen.queryByText("Risk assessment unavailable.")).not.toBeInTheDocument();
    expect(within(riskTile()).getByText("High")).toBeInTheDocument();
    expect(within(riskCard()).getAllByText("High").length).toBeGreaterThan(0);
    expect(within(riskCard()).getByRole("img", { name: "Risk score 91 of 100, High" })).toBeInTheDocument();
    expect(within(riskCard()).getByText("91")).toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("shows a successful empty assessment list without a fabricated zero score", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    renderPage(<Dashboard />);

    expect(await screen.findByText("No executed trades")).toBeInTheDocument();
    expect(screen.queryByText(/executed today/i)).not.toBeInTheDocument();
    expect(within(riskCard()).getByText("No assessments")).toBeInTheDocument();
    expect(within(riskTile()).getByText("No assessments")).toBeInTheDocument();
    expect(within(riskTile()).getByText("--")).toBeInTheDocument();
    expect(within(riskTile()).queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("No activity")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Risk assessment unavailable.")).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("labels an actual zero assessment as Low and keeps a zero realized trade P&L", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [fill(0)] });
    api.fetchRisk.mockResolvedValue({ assessments: [assessment(0)] });
    renderPage(<Dashboard />);

    expect(await screen.findByText("TRD-4")).toBeInTheDocument();
    expect(within(riskTile()).getByText("Low")).toBeInTheDocument();
    expect(within(riskTile()).getByText("0")).toBeInTheDocument();
    expect(within(riskCard()).getAllByText("Low").length).toBeGreaterThan(0);
    expect(within(riskCard()).getByText("0")).toBeInTheDocument();
    expect(within(riskCard()).getByRole("img", { name: "Risk score 0 of 100, Low" })).toBeInTheDocument();
    expect(screen.queryByText("No activity")).not.toBeInTheDocument();
    expect(screen.queryByText("No assessments")).not.toBeInTheDocument();
    const row = screen.getByText("TRD-4").closest("tr") as HTMLElement;
    expect(within(row).getByLabelText("gain: $0.00")).toBeInTheDocument();
    expect(screen.queryByText("No executed trades")).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("does not present a cached risk score as current when the refresh fails", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [assessment(73)] });
    const { client } = renderPage(<Dashboard />);

    expect(await within(riskTile()).findByText("73")).toBeInTheDocument();
    api.fetchRisk.mockRejectedValue(new Error("risk refresh failed"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["risk"] }).catch(() => undefined);
    });

    expect(await screen.findByText(/not shown as current/)).toBeInTheDocument();
    expect(screen.getByText("Risk assessment unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("73")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
    expect(within(riskTile()).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("shows a trades failure, then an empty success after retry, and keeps an incomplete valuation", async () => {
    api.fetchPortfolio.mockResolvedValue(book("incomplete"));
    api.fetchTrades.mockRejectedValue(new Error("trades down"));
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    renderPage(<Dashboard />);

    expect(await screen.findByText("Trades could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No executed trades")).not.toBeInTheDocument();
    expect(screen.queryByText(/executed today/i)).not.toBeInTheDocument();
    expect(screen.getByText("Valuation incomplete")).toBeInTheDocument();
    const valueCard = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section") as HTMLElement;
    expect(within(valueCard).getByText("Unavailable")).toBeInTheDocument();
    expect(within(valueCard).queryByText("$100,000")).not.toBeInTheDocument();
    expect(within(valueCard).getByText("$80,000")).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");
    expect(within(riskCard()).getByText("No assessments")).toBeInTheDocument();

    api.fetchTrades.mockResolvedValue({ trades: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry trades" }));

    expect(await screen.findByText("No executed trades")).toBeInTheDocument();
    expect(screen.queryByText("Trades could not be loaded.")).not.toBeInTheDocument();
    expect(screen.queryByText(/executed today/i)).not.toBeInTheDocument();
    expect(screen.getByText("Valuation incomplete")).toBeInTheDocument();
    expect(within(valueCard).queryByText("$100,000")).not.toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");
  });

  it("does not treat a pending orders response as an empty list", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    api.fetchOrders.mockReturnValue(new Promise(() => {}));

    renderPage(<Dashboard />);

    expect(await screen.findByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    const orders = within(ordersCard());
    expect(orders.queryByText("No orders")).not.toBeInTheDocument();
    expect(orders.queryByText("Orders could not be loaded.")).not.toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("shows a successful empty order list as No orders", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    api.fetchOrders.mockResolvedValue({ orders: [] });

    renderPage(<Dashboard />);

    expect(await within(ordersCard()).findByText("No orders")).toBeInTheDocument();
    expect(within(ordersCard()).queryByText("Orders could not be loaded.")).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("shows only the first five newest orders, with limit, status, and remaining", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    api.fetchOrders.mockResolvedValue({
      orders: [
        order({
          id: 6,
          symbol: "AMD",
          quantity: 10,
          remaining_quantity: 4,
          limit_price: 0.000001,
          status: "open",
        }),
        order({
          id: 5,
          symbol: "INTC",
          side: "sell",
          quantity: 5,
          remaining_quantity: 0,
          limit_price: 12.5,
          status: "filled",
        }),
        order({
          id: 4,
          symbol: "ORCL",
          order_type: "market",
          quantity: 3,
          remaining_quantity: 3,
          limit_price: null,
          status: "open",
        }),
        order({
          id: 3,
          symbol: "CRM",
          side: "sell",
          quantity: 8,
          remaining_quantity: 2,
          limit_price: 20,
          status: "canceled",
        }),
        order({
          id: 2,
          symbol: "NOW",
          quantity: 1,
          remaining_quantity: 1,
          limit_price: 100,
          status: "open",
        }),
        order({
          id: 1,
          symbol: "DROP",
          quantity: 99,
          remaining_quantity: 99,
          limit_price: 1,
          status: "open",
        }),
      ],
    });

    renderPage(<Dashboard />);

    expect(await within(ordersCard()).findByText("AMD")).toBeInTheDocument();
    const orders = within(ordersCard());
    expect(orders.getAllByRole("row")).toHaveLength(6);
    expect(orders.queryByText("DROP")).not.toBeInTheDocument();
    expect(orders.queryByText(/15:00:00/)).not.toBeInTheDocument();

    const amd = orders.getByText("AMD").closest("tr") as HTMLElement;
    expect(within(amd).getByText("BUY")).toBeInTheDocument();
    expect(within(amd).getByText("limit")).toBeInTheDocument();
    expect(within(amd).getByText("10")).toBeInTheDocument();
    expect(within(amd).getByText("4")).toBeInTheDocument();
    expect(within(amd).getByText("open")).toBeInTheDocument();
    expect(within(amd).getByText("$0.000001")).toBeInTheDocument();
    expect(within(amd).queryByText("$0.00")).not.toBeInTheDocument();

    const intel = orders.getByText("INTC").closest("tr") as HTMLElement;
    expect(within(intel).getByText("filled")).toBeInTheDocument();
    expect(within(intel).getByText("SELL")).toBeInTheDocument();

    const oracle = orders.getByText("ORCL").closest("tr") as HTMLElement;
    expect(within(oracle).getByText("Market")).toBeInTheDocument();
    expect(within(oracle).getByText("market")).toBeInTheDocument();
    expect(within(oracle).queryByText("$0.00")).not.toBeInTheDocument();

    const crm = orders.getByText("CRM").closest("tr") as HTMLElement;
    expect(within(crm).getByText("canceled")).toBeInTheDocument();
    expect(within(crm).getByText("2")).toBeInTheDocument();

    expect(orders.getByText("NOW")).toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("shows an orders failure, then an empty success after retry, and keeps cash and account value", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    api.fetchOrders.mockRejectedValue(new Error("orders down"));

    renderPage(<Dashboard />);

    expect(await within(ordersCard()).findByText("Orders could not be loaded.")).toBeInTheDocument();
    expect(within(ordersCard()).queryByText("No orders")).not.toBeInTheDocument();
    expect(screen.queryByText(/Some dashboard data could not be loaded/)).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
    expect(within(riskCard()).getByText("No assessments")).toBeInTheDocument();

    api.fetchOrders.mockResolvedValue({ orders: [] });
    fireEvent.click(within(ordersCard()).getByRole("button", { name: "Retry orders" }));

    expect(await within(ordersCard()).findByText("No orders")).toBeInTheDocument();
    expect(within(ordersCard()).queryByText("Orders could not be loaded.")).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
  });

  it("does not present cached orders as current when the refresh fails", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    api.fetchOrders.mockResolvedValue({
      orders: [
        order({
          id: 11,
          symbol: "AMD",
          quantity: 10,
          remaining_quantity: 4,
          limit_price: 1.25,
          status: "open",
        }),
      ],
    });
    const { client } = renderPage(<Dashboard />);

    expect(await within(ordersCard()).findByText("AMD")).toBeInTheDocument();
    api.fetchOrders.mockRejectedValue(new Error("orders refresh failed"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["orders"] }).catch(() => undefined);
    });

    expect(await within(ordersCard()).findByText(/not shown as current/)).toBeInTheDocument();
    expect(within(ordersCard()).getByText("Orders could not be loaded.")).toBeInTheDocument();
    expect(within(ordersCard()).queryByText("AMD")).not.toBeInTheDocument();
    expect(within(ordersCard()).queryByText("No orders")).not.toBeInTheDocument();
    expect(within(ordersCard()).queryByText("$1.25")).not.toBeInTheDocument();
    expect(screen.getByText("$50,160", { selector: ".text-4xl" })).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$50,000");
    expect(within(riskCard()).getByText("No assessments")).toBeInTheDocument();
  });

  it("shows the valuation read and quote time, not the fetch time, on an incomplete book", async () => {
    api.fetchPortfolio.mockResolvedValue(book("incomplete"));
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });

    renderPage(<Dashboard />);

    const valuation = await within(valueCard()).findByText(/Valuation read/);
    expect(valuation).toHaveTextContent("15:00:00");
    expect(valuation).toHaveTextContent("2026");
    expect(valuation).toHaveTextContent("UTC");
    expect(valuation).not.toHaveTextContent("14:45");
    expect(valuation).not.toHaveTextContent("14:50");
    expect(within(valueCard()).getByText("Unavailable")).toBeInTheDocument();
    expect(within(valueCard()).getByText("Valuation incomplete")).toBeInTheDocument();
    expect(within(valueCard()).queryByText("$100,000")).not.toBeInTheDocument();
    expect(within(valueCard()).getByText("$80,000")).toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");
    const totalPnl = screen.getByText("Total P&L").parentElement as HTMLElement;
    expect(within(totalPnl).getByText("Unavailable")).toBeInTheDocument();
    expect(within(totalPnl).queryByText("$0.00")).not.toBeInTheDocument();

    const apple = screen.getByText("AAPL").closest("tr") as HTMLElement;
    const quote = within(apple).getByText(/Quote observed/);
    expect(quote).toHaveTextContent("14:45:00");
    expect(quote).toHaveTextContent("UTC");
    expect(quote).not.toHaveTextContent("14:50");
    expect(quote).not.toHaveTextContent("15:00:00");
  });

  it("shows an unavailable valuation read for a missing or invalid snapshot time", async () => {
    const invalid = book("incomplete");
    invalid.snapshot_read_at = "2026-11-05T15:00:00";
    api.fetchPortfolio.mockResolvedValue(invalid);
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });

    const first = renderPage(<Dashboard />);

    expect(await within(valueCard()).findByText(/Valuation read/)).toHaveTextContent("Unavailable");
    expect(within(valueCard()).getByText(/Valuation read/)).not.toHaveTextContent("15:00");
    expect(within(valueCard()).queryByText("$100,000")).not.toBeInTheDocument();
    expect(valueCard().querySelector(".text-4xl")?.textContent).toBe("Unavailable");
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");
    const totalPnl = screen.getByText("Total P&L").parentElement as HTMLElement;
    expect(within(totalPnl).getByText("Unavailable")).toBeInTheDocument();
    expect(within(totalPnl).queryByText("$0.00")).not.toBeInTheDocument();
    const apple = screen.getByText("AAPL").closest("tr") as HTMLElement;
    expect(within(apple).getByText(/Quote observed/)).toHaveTextContent("14:45:00");

    cleanup();
    first.client.clear();
    const missing = book("incomplete");
    missing.snapshot_read_at = null as unknown as string;
    api.fetchPortfolio.mockResolvedValue(missing);
    renderPage(<Dashboard />);

    expect(await within(valueCard()).findByText(/Valuation read/)).toHaveTextContent("Unavailable");
    expect(within(valueCard()).getByText(/Valuation read/)).not.toHaveTextContent("15:00");
    expect(within(valueCard()).queryByText("$100,000")).not.toBeInTheDocument();
    expect(screen.getByText("Cash").parentElement).toHaveTextContent("$100,000");
    expect(within(screen.getByText("Total P&L").parentElement as HTMLElement).getByText("Unavailable")).toBeInTheDocument();
  });

  it("renders cash and sector rows on the sector allocation card", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchAllocation.mockResolvedValue(allocation("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Sector allocation" })).closest("section") as HTMLElement;
    expect(await within(card).findByText("$1,000")).toBeInTheDocument();
    expect(within(card).getByText("Cash")).toBeInTheDocument();
    expect(within(card).getByText("62.50%")).toBeInTheDocument();
    expect(within(card).getByText("Technology")).toBeInTheDocument();
    expect(within(card).getByText("$300")).toBeInTheDocument();
    expect(within(card).getByText("18.75%")).toBeInTheDocument();
    expect(within(card).getByText("Financials")).toBeInTheDocument();
    expect(within(card).getByText("$200")).toBeInTheDocument();
    expect(within(card).getByText("12.50%")).toBeInTheDocument();
    expect(within(card).queryByText("Sector allocation unavailable")).not.toBeInTheDocument();
  });

  it("shows the sector allocation card as unavailable when allocation is incomplete", async () => {
    api.fetchPortfolio.mockResolvedValue(book("incomplete"));
    api.fetchAllocation.mockResolvedValue(allocation("incomplete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Sector allocation" })).closest("section") as HTMLElement;
    expect(await within(card).findByText("Sector allocation unavailable")).toBeInTheDocument();
    expect(within(card).getByText(/holding is unpriced/i)).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/%/);
    expect(within(card).queryByText("$1,000")).not.toBeInTheDocument();
    expect(within(card).queryByText("62.50%")).not.toBeInTheDocument();
    expect(within(card).queryByText("Technology")).not.toBeInTheDocument();
  });

  it("renders securities and a negative contribution on the P&L attribution card", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchAttribution.mockResolvedValue(attribution("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "P&L attribution" })).closest("section") as HTMLElement;
    expect(await within(card).findByText("+130.31%")).toBeInTheDocument();
    expect(within(card).getByText("-30.31%")).toBeInTheDocument();
    expect(within(card).getByText("+100.00%")).toBeInTheDocument();
    expect(within(card).getByText("Total P&L")).toBeInTheDocument();
    expect(within(card).getAllByText("$148").length).toBeGreaterThan(0);

    const apple = within(card).getByText("AAPL").closest("tr") as HTMLElement;
    expect(within(apple).getByText("+130.31%")).toBeInTheDocument();
    expect(within(apple).getByText("Technology")).toBeInTheDocument();
    expect(within(apple).getByText("$193")).toBeInTheDocument();

    const microsoft = within(card).getByText("MSFT").closest("tr") as HTMLElement;
    expect(within(microsoft).getByText("-30.31%")).toBeInTheDocument();
    expect(within(microsoft).getAllByText("-$45").length).toBeGreaterThan(0);
    expect(within(card).queryByText("P&L attribution unavailable")).not.toBeInTheDocument();
  });

  it("shows the P&L attribution card as unavailable when attribution is incomplete", async () => {
    api.fetchPortfolio.mockResolvedValue(book("incomplete"));
    api.fetchAttribution.mockResolvedValue(attribution("incomplete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "P&L attribution" })).closest("section") as HTMLElement;
    expect(await within(card).findByText("P&L attribution unavailable")).toBeInTheDocument();
    expect(within(card).getByText(/holding is unpriced/i)).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/%/);
    expect(within(card).queryByText("+130.31%")).not.toBeInTheDocument();
    expect(within(card).queryByText("-30.31%")).not.toBeInTheDocument();
    expect(within(card).queryByText("AAPL")).not.toBeInTheDocument();
  });

  it("test_risk_metrics_card_renders_available_and_unavailable_fields_independently", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(
      riskMetrics({
        status: "complete",
        historical_volatility_pct: "5.8847",
        max_drawdown_pct: "8.1200",
        portfolio_beta: "1.2500",
        historical_var_95_pct: "2.2300",
        historical_var_99_pct: null,
        expected_shortfall_95_pct: "3.4500",
        expected_shortfall_99_pct: null,
      }),
    );

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);
    expect(await scoped.findByText("5.88%")).toBeInTheDocument();

    expect(scoped.getByText("Historical volatility").parentElement).toHaveTextContent("5.88%");
    expect(scoped.getByText("Max drawdown").parentElement).toHaveTextContent("8.12%");
    expect(scoped.getByText("Beta").parentElement).toHaveTextContent("1.2500");
    expect(scoped.getByText("95% VaR").parentElement).toHaveTextContent("2.23%");
    expect(scoped.getByText("99% VaR").parentElement).toHaveTextContent("Unavailable");
    expect(scoped.getByText("95% Expected Shortfall").parentElement).toHaveTextContent("3.45%");
    expect(scoped.getByText("99% Expected Shortfall").parentElement).toHaveTextContent("Unavailable");
    expect(scoped.queryByText("1.25%")).not.toBeInTheDocument();
  });

  it("test_risk_metrics_card_renders_beta_as_a_plain_ratio_not_a_percent", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(
      riskMetrics({
        status: "complete",
        historical_volatility_pct: "5.8847",
        portfolio_beta: "1.2500",
        historical_var_95_pct: "2.2300",
        historical_var_99_pct: null,
        expected_shortfall_99_pct: null,
      }),
    );

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    expect(await within(card).findByText("1.2500")).toBeInTheDocument();
    const betaRow = within(card).getByText("Beta").parentElement as HTMLElement;
    expect(within(betaRow).getByText("1.2500")).toBeInTheDocument();
    expect(within(betaRow).queryByText(/%/)).not.toBeInTheDocument();
    expect(betaRow.textContent ?? "").not.toMatch(/%/);
  });

  it("test_stress_scenario_table_renders_three_fixed_scenarios", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(
      riskMetrics({
        stress_scenarios: [
          {
            scenario: "broad_market_selloff",
            shock_pct: "-10.0000",
            loss: "60.00",
            loss_pct: "3.7500",
          },
          {
            scenario: "technology_sector_selloff",
            shock_pct: "-25.0000",
            loss: "75.00",
            loss_pct: "4.6875",
          },
          {
            scenario: "single_security_worst_holding",
            shock_pct: "-30.0000",
            affected_symbol: "AAPL",
            loss: "90.00",
            loss_pct: "5.6250",
          },
        ],
      }),
    );

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);

    expect(await scoped.findByText("Broad market selloff")).toBeInTheDocument();
    expect(scoped.getByText("Technology sector selloff")).toBeInTheDocument();
    expect(scoped.getByText("Largest holding shock")).toBeInTheDocument();
    expect(scoped.queryByText("Stress scenarios unavailable")).not.toBeInTheDocument();

    const broad = scoped.getByText("Broad market selloff").closest("tr") as HTMLElement;
    expect(within(broad).getByText("-10.00%")).toBeInTheDocument();
    expect(within(broad).getByText("$60")).toBeInTheDocument();
    expect(within(broad).getByText("3.75%")).toBeInTheDocument();
    expect(within(broad).queryByText("AAPL")).not.toBeInTheDocument();

    const technology = scoped.getByText("Technology sector selloff").closest("tr") as HTMLElement;
    expect(within(technology).getByText("-25.00%")).toBeInTheDocument();
    expect(within(technology).getByText("$75")).toBeInTheDocument();
    expect(within(technology).getByText("4.69%")).toBeInTheDocument();
    expect(within(technology).queryByText("AAPL")).not.toBeInTheDocument();

    const worst = scoped.getByText("Largest holding shock").closest("tr") as HTMLElement;
    expect(within(worst).getByText("-30.00%")).toBeInTheDocument();
    expect(within(worst).getByText("$90")).toBeInTheDocument();
    expect(within(worst).getByText("5.63%")).toBeInTheDocument();
    expect(within(worst).getByText("AAPL")).toBeInTheDocument();
  });

  it("test_stress_scenario_table_shows_unavailable_when_null", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);
    expect(await scoped.findByText("Stress scenarios unavailable")).toBeInTheDocument();
    expect(scoped.queryByText("Broad market selloff")).not.toBeInTheDocument();
    expect(scoped.queryByText("Technology sector selloff")).not.toBeInTheDocument();
    expect(scoped.queryByText("Largest holding shock")).not.toBeInTheDocument();
    expect(scoped.queryByText("$60")).not.toBeInTheDocument();
    expect(scoped.queryByText("$75")).not.toBeInTheDocument();
    expect(scoped.queryByText("$90")).not.toBeInTheDocument();
    expect(card.textContent ?? "").not.toMatch(/\$/);
  });

  it("test_correlation_table_renders_pairs_with_a_null_entry", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(
      riskMetrics({
        correlations: [
          { symbols: ["AAPL", "JPM"], return_count: 45, correlation: "0.6123" },
          { symbols: ["AAPL", "XOM"], return_count: 1, correlation: null },
        ],
      }),
    );

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);

    expect(await scoped.findByText("AAPL / JPM")).toBeInTheDocument();
    expect(scoped.getByText("AAPL / XOM")).toBeInTheDocument();
    expect(scoped.queryByText("Correlations unavailable")).not.toBeInTheDocument();

    const definedPair = scoped.getByText("AAPL / JPM").closest("tr") as HTMLElement;
    expect(within(definedPair).getByText("45")).toBeInTheDocument();
    expect(within(definedPair).getByText("0.6123")).toBeInTheDocument();
    expect(definedPair.textContent ?? "").not.toMatch(/%/);

    const missingPair = scoped.getByText("AAPL / XOM").closest("tr") as HTMLElement;
    expect(within(missingPair).getByText("1")).toBeInTheDocument();
    expect(within(missingPair).getByText("Unavailable")).toBeInTheDocument();
    expect(missingPair.textContent ?? "").not.toMatch(/%/);
  });

  it("test_correlation_table_shows_unavailable_when_null", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(riskMetrics({ correlations: null }));

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);
    expect(await scoped.findByText("Correlations unavailable")).toBeInTheDocument();
    expect(scoped.queryByText("AAPL / JPM")).not.toBeInTheDocument();
    expect(scoped.queryByText("AAPL / XOM")).not.toBeInTheDocument();
    expect(scoped.queryByRole("columnheader", { name: "Pair" })).not.toBeInTheDocument();
    expect(scoped.queryByRole("columnheader", { name: "Correlation" })).not.toBeInTheDocument();
  });

  it("test_risk_contribution_table_renders_rows_and_sums_to_one_hundred_percent", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(
      riskMetrics({
        risk_contributions: [
          { symbol: "AAA", weight_pct: "60.0000", risk_contribution_pct: "38.7968" },
          { symbol: "BBB", weight_pct: "40.0000", risk_contribution_pct: "61.2032" },
        ],
      }),
    );

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);

    expect(await scoped.findByText("AAA")).toBeInTheDocument();
    expect(scoped.getByText("BBB")).toBeInTheDocument();
    expect(scoped.queryByText("Risk contributions unavailable")).not.toBeInTheDocument();

    const aaa = scoped.getByText("AAA").closest("tr") as HTMLElement;
    expect(within(aaa).getByText("60.00%")).toBeInTheDocument();
    expect(within(aaa).getByText("38.80%")).toBeInTheDocument();

    const bbb = scoped.getByText("BBB").closest("tr") as HTMLElement;
    expect(within(bbb).getByText("40.00%")).toBeInTheDocument();
    expect(within(bbb).getByText("61.20%")).toBeInTheDocument();
  });

  it("test_risk_contribution_table_shows_unavailable_when_null", async () => {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    api.fetchRiskMetrics.mockResolvedValue(riskMetrics({ risk_contributions: null }));

    renderPage(<Portfolio />);

    const card = (await screen.findByRole("heading", { name: "Risk metrics (1y)" })).closest(
      "section",
    ) as HTMLElement;
    const scoped = within(card);
    expect(await scoped.findByText("Risk contributions unavailable")).toBeInTheDocument();
    expect(scoped.queryByText("AAA")).not.toBeInTheDocument();
    expect(scoped.queryByText("BBB")).not.toBeInTheDocument();
    expect(scoped.queryByRole("columnheader", { name: "Weight" })).not.toBeInTheDocument();
    expect(scoped.queryByRole("columnheader", { name: "Risk contribution" })).not.toBeInTheDocument();
  });

  async function renderSettledPortfolio() {
    api.fetchPortfolio.mockResolvedValue(book("complete"));
    api.fetchMe.mockResolvedValue({ role: "analyst", email: "trader@example.com" });
    renderPage(<Portfolio />);
    expect(await screen.findByRole("heading", { name: "Trade impact preview" })).toBeInTheDocument();
    expect(await screen.findByText("$50,000")).toBeInTheDocument();
    expect(await screen.findByText(/Paper deposits and withdrawals are available/)).toBeInTheDocument();
    expect(await screen.findByText("Sector allocation unavailable")).toBeInTheDocument();
    expect(await screen.findByText("P&L attribution unavailable")).toBeInTheDocument();
    expect(await screen.findByText("Stress scenarios unavailable")).toBeInTheDocument();
  }

  function tradeImpactCard() {
    return screen.getByRole("heading", { name: "Trade impact preview" }).closest("section") as HTMLElement;
  }

  function submitTradeImpact(card: HTMLElement) {
    const view = within(card);
    fireEvent.change(view.getByLabelText("Symbol"), { target: { value: "AAPL" } });
    fireEvent.click(view.getByRole("button", { name: "Buy" }));
    fireEvent.change(view.getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.change(view.getByLabelText("Reference price"), { target: { value: "100" } });
    fireEvent.change(view.getByLabelText("Order type"), { target: { value: "market" } });
    fireEvent.click(view.getByRole("button", { name: "Preview impact" }));
  }

  it("test_trade_impact_preview_form_submits_and_renders_the_result", async () => {
    api.previewTradeImpact.mockReset();
    await renderSettledPortfolio();
    expect(api.previewTradeImpact).not.toHaveBeenCalled();

    const card = tradeImpactCard();
    expect(within(card).getByRole("button", { name: "Preview impact" })).toBeEnabled();
    api.previewTradeImpact.mockResolvedValue(tradeImpactBuy());
    const reads = {
      portfolio: api.fetchPortfolio.mock.calls.length,
      allocation: api.fetchAllocation.mock.calls.length,
      attribution: api.fetchAttribution.mock.calls.length,
      riskMetrics: api.fetchRiskMetrics.mock.calls.length,
      me: api.fetchMe.mock.calls.length,
    };

    submitTradeImpact(card);

    const cash = (await within(card).findByText("Cash balance")).closest("tr") as HTMLElement;
    expect(within(cash).getByText("$1,000.00")).toBeInTheDocument();
    expect(within(cash).getByText("$800.00")).toBeInTheDocument();
    expect(within(cash).getByText("-$200.00")).toBeInTheDocument();

    const total = within(card).getByText("Total account value").closest("tr") as HTMLElement;
    expect(within(total).getAllByText("$1,600.00")).toHaveLength(2);
    expect(within(total).getByText("$0.00")).toBeInTheDocument();

    const cashWeight = within(card).getByText("Cash weight").closest("tr") as HTMLElement;
    expect(within(cashWeight).getByText("62.50%")).toBeInTheDocument();
    expect(within(cashWeight).getByText("50.00%")).toBeInTheDocument();
    expect(within(cashWeight).getByText("-12.50%")).toBeInTheDocument();

    const position = within(card).getByText("AAPL position value").closest("tr") as HTMLElement;
    expect(within(position).getByText("$300.00")).toBeInTheDocument();
    expect(within(position).getByText("$500.00")).toBeInTheDocument();
    expect(within(position).getByText("$200.00")).toBeInTheDocument();

    const weight = within(card).getByText("AAPL weight").closest("tr") as HTMLElement;
    expect(within(weight).getByText("18.75%")).toBeInTheDocument();
    expect(within(weight).getByText("31.25%")).toBeInTheDocument();
    expect(within(weight).getByText("+12.50%")).toBeInTheDocument();

    expect(api.previewTradeImpact).toHaveBeenCalledTimes(1);
    expect(api.previewTradeImpact).toHaveBeenCalledWith({
      symbol: "AAPL",
      side: "buy",
      quantity: "2",
      reference_price: "100",
      order_type: "market",
    });
    expect(within(card).getByLabelText("Symbol")).toHaveValue("AAPL");
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    expect(api.fetchPortfolio).toHaveBeenCalledTimes(reads.portfolio);
    expect(api.fetchAllocation).toHaveBeenCalledTimes(reads.allocation);
    expect(api.fetchAttribution).toHaveBeenCalledTimes(reads.attribution);
    expect(api.fetchRiskMetrics).toHaveBeenCalledTimes(reads.riskMetrics);
    expect(api.fetchMe).toHaveBeenCalledTimes(reads.me);
    expect(api.createTrade).not.toHaveBeenCalled();
    expect(api.createCashMovement).not.toHaveBeenCalled();
    expect(api.setLegalName).not.toHaveBeenCalled();
    expect(api.fetchOrders).not.toHaveBeenCalled();
    expect(api.fetchTrades).not.toHaveBeenCalled();
    expect(api.fetchRisk).not.toHaveBeenCalled();
    expect(api.fetchPortfolioPnl).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Holdings" })).toBeInTheDocument();
  });

  it("test_trade_impact_preview_shows_a_warning_without_blocking_the_result", async () => {
    api.previewTradeImpact.mockReset();
    const baseline = tradeImpactBuy(["insufficient_buying_power"]);
    api.previewTradeImpact.mockResolvedValue({
      ...baseline,
      after: {
        ...baseline.after,
        cash_balance: "-400.00",
        buying_power: "-400.00",
        cash_weight_pct: "-25.0000",
        symbol_position_value: "1700.00",
        symbol_weight_pct: "106.2500",
      },
      changes: {
        cash_balance: "-1400.00",
        total_account_value: "0.00",
        cash_weight_pct: "-87.5000",
        symbol_weight_pct: "87.5000",
      },
    });
    await renderSettledPortfolio();
    const card = tradeImpactCard();
    submitTradeImpact(card);

    expect(await within(card).findByText("Insufficient buying power")).toBeInTheDocument();
    expect(within(card).getByRole("status")).toBeInTheDocument();
    const cash = within(card).getByText("Cash balance").closest("tr") as HTMLElement;
    expect(within(cash).getByText("$1,000.00")).toBeInTheDocument();
    expect(within(cash).getByText("-$400.00")).toBeInTheDocument();
    expect(within(cash).getByText("-$1,400.00")).toBeInTheDocument();
    const weight = within(card).getByText("AAPL weight").closest("tr") as HTMLElement;
    expect(within(weight).getByText("+87.50%")).toBeInTheDocument();
    expect(within(card).getByText("$1,700.00")).toBeInTheDocument();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    expect(api.createTrade).not.toHaveBeenCalled();
  });

  it("test_trade_impact_preview_shows_an_error_message_on_failure", async () => {
    api.previewTradeImpact.mockReset();
    api.previewTradeImpact.mockRejectedValue(new Error("preview failed"));
    await renderSettledPortfolio();
    const card = tradeImpactCard();
    submitTradeImpact(card);

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Trade impact could not be previewed.",
    );
    expect(within(card).queryByRole("columnheader", { name: "Before" })).not.toBeInTheDocument();
    expect(within(card).queryByText("null")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trade impact preview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Risk metrics (1y)" })).toBeInTheDocument();
    expect(api.previewTradeImpact).toHaveBeenCalledTimes(1);
    expect(api.createTrade).not.toHaveBeenCalled();
    expect(api.createCashMovement).not.toHaveBeenCalled();
  });
});
