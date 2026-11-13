import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../context/ToastProvider";
import { Dashboard } from "./Dashboard";

const api = vi.hoisted(() => ({
  fetchMarketOverview: vi.fn(),
  fetchPortfolio: vi.fn(),
  fetchTrades: vi.fn(),
  fetchRisk: vi.fn(),
  fetchOrders: vi.fn(),
  createTrade: vi.fn(),
}));

vi.mock("../api/market", () => ({ fetchMarketOverview: api.fetchMarketOverview }));
vi.mock("../api/portfolio", () => ({ fetchPortfolio: api.fetchPortfolio }));
vi.mock("../api/trades", () => ({
  fetchTrades: api.fetchTrades,
  createTrade: api.createTrade,
}));
vi.mock("../api/risk", () => ({ fetchRisk: api.fetchRisk }));
vi.mock("../api/orders", () => ({ fetchOrders: api.fetchOrders }));

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <Dashboard />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("dashboard market pulse", () => {
  beforeEach(() => {
    api.fetchMarketOverview.mockRejectedValue(new Error("Unavailable"));
    api.fetchPortfolio.mockResolvedValue({
      valuation_status: "incomplete",
      snapshot_read_at: null,
      positions: [],
      summary: {
        cash_balance: 1000,
        buying_power: 1000,
        total_account_value: null,
        total_portfolio_value: null,
        total_cost_basis: 0,
        total_unrealized_pnl: null,
        total_unrealized_pnl_pct: null,
        total_realized_pnl: 0,
        total_pnl: null,
      },
    });
    api.fetchTrades.mockResolvedValue({ trades: [] });
    api.fetchRisk.mockResolvedValue({ assessments: [] });
    api.fetchOrders.mockResolvedValue({ orders: [] });
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("renders cached index proxies and colors non-negative and negative changes", async () => {
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-04T00:00:00Z",
      errors: [],
      sectors: [],
      trends: [
        { symbol: "SPX", source_symbol: "SPY", name: "S&P 500", value: 512.34, change: 4.3, change_percent: 0.85 },
        { symbol: "DJI", source_symbol: "DIA", name: "Dow Jones", value: 390, change: 0, change_percent: 0 },
        { symbol: "NDX", source_symbol: "QQQ", name: "Nasdaq 100", value: 430.1, change: -5.2, change_percent: -1.2 },
      ],
    });

    const client = renderDashboard();

    await waitFor(() => {
      const pulse = screen.getByRole("region", { name: "Market pulse" });
      expect(within(pulse).getByText("SPY")).toBeInTheDocument();
    });
    const pulse = screen.getByRole("region", { name: "Market pulse" });
    expect(within(pulse).getByText("S&P 500")).toBeInTheDocument();
    expect(within(pulse).getByText("$512.34")).toBeInTheDocument();
    expect(within(pulse).getByText("DIA")).toBeInTheDocument();
    expect(within(pulse).getByText("Dow Jones")).toBeInTheDocument();
    expect(within(pulse).getByText("$390.00")).toBeInTheDocument();
    expect(within(pulse).getByText("QQQ")).toBeInTheDocument();
    expect(within(pulse).getByText("Nasdaq 100")).toBeInTheDocument();
    expect(within(pulse).getByText("$430.10")).toBeInTheDocument();
    expect(within(pulse).queryByText("SPX")).not.toBeInTheDocument();
    expect(within(pulse).queryByText("NDX")).not.toBeInTheDocument();

    expect(within(pulse).getByText("+0.85%")).toHaveClass("text-emerald-300");
    expect(within(pulse).getByText("+0.00%")).toHaveClass("text-emerald-300");
    expect(within(pulse).getByText("-1.20%")).toHaveClass("text-rose-300");
    expect(within(pulse).getByText("-1.20%")).not.toHaveClass("text-emerald-300");

    await waitFor(() => {
      expect(client.getQueryCache().findAll({ queryKey: ["market", "overview"] })).toHaveLength(1);
    });
    expect(api.fetchMarketOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Trading & Risk Overview" })).toBeInTheDocument();
    expect(screen.getByText("Total P&L")).toBeInTheDocument();
    expect(screen.getByText("No open positions to display.")).toBeInTheDocument();
  });

  it("shows a skeleton while the overview query is loading", async () => {
    api.fetchMarketOverview.mockReturnValue(new Promise(() => {}));
    renderDashboard();

    const pulse = await screen.findByRole("region", { name: "Market pulse" });
    expect(pulse).toHaveAttribute("aria-busy", "true");
    expect(pulse.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(within(pulse).queryByText("SPY")).not.toBeInTheDocument();
    expect(screen.getByText("Total P&L")).toBeInTheDocument();
  });

  it("omits the strip when quotes fail or the cache has no trends", async () => {
    renderDashboard();

    expect(await screen.findByText("Trading & Risk Overview")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Market pulse" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Market pulse unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText(/Some dashboard data could not be loaded/)).not.toBeInTheDocument();
    expect(screen.getByText("Total P&L")).toBeInTheDocument();

    cleanup();
    api.fetchMarketOverview.mockResolvedValue({
      as_of: null,
      errors: [],
      sectors: [],
      trends: [],
    });
    renderDashboard();

    expect(await screen.findByText("Trading & Risk Overview")).toBeInTheDocument();
    await waitFor(() => {
      expect(api.fetchMarketOverview).toHaveBeenCalled();
      expect(screen.queryByRole("region", { name: "Market pulse" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/Some dashboard data could not be loaded/)).not.toBeInTheDocument();
  });
});
