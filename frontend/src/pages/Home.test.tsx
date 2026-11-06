import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Home } from "./Home";

const api = vi.hoisted(() => ({
  fetchMarketOverview: vi.fn(), fetchMarketHeatmap: vi.fn(),
  fetchMarketTrending: vi.fn(), fetchMarketResearch: vi.fn(),
}));
const historyApi = vi.hoisted(() => ({
  fetchCachedSeries: vi.fn(),
  fetchDailyHistory: vi.fn(),
}));
vi.mock("../api/market", () => api);
vi.mock("../api/history", () => historyApi);
vi.mock("../context/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false }) }));

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Home /></MemoryRouter></QueryClientProvider>);
}

describe("public market data truth", () => {
  beforeEach(() => {
    for (const call of Object.values(api)) call.mockRejectedValue(new Error("Unavailable"));
    historyApi.fetchCachedSeries.mockResolvedValue({
      read_at: "2026-11-06T12:00:00Z", collection: "disabled",
      coverage_status: "not_verified", expected_session_count: null,
      canonical_history: { row_count: 0, series: [] },
    });
    historyApi.fetchDailyHistory.mockRejectedValue(new Error("No series selected"));
  });
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("shows unavailable sections without fabricated prices, history or research", async () => {
    open();
    expect(await screen.findByText("Market quotes unavailable")).toBeInTheDocument();
    expect(await screen.findByText("Stock heatmap unavailable")).toBeInTheDocument();
    expect(await screen.findByText("Sector quotes unavailable")).toBeInTheDocument();
    expect(await screen.findByText("Most-active data unavailable")).toBeInTheDocument();
    expect(screen.getByText("Research assessment unavailable")).toBeInTheDocument();
    expect(screen.queryByText("5,487.03")).not.toBeInTheDocument();
    expect(screen.queryByText("NVIDIA Corporation")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /trend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /market pulse trend/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it("uses only returned symbols and quote units, and preserves zero and negative changes", async () => {
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-04T00:00:00Z", errors: [],
      trends: [{ symbol: "SPX", source_symbol: "SPY", name: "S&P 500", value: 123.45, change: -1, change_percent: -1.5 }],
      sectors: [{ symbol: "XLK", sector: "Technology", change_percent: 0, weight: "small", leaders: [] }],
    });
    api.fetchMarketHeatmap.mockResolvedValue({
      items: [{ symbol: "ONLY", company: "Fixture", sector: "Technology", price: 10, change_percent: 0,
        volume: 100, size: "large", refresh_tier: "daily", data_status: "delayed", source: "fixture", age_seconds: 60, as_of: "2026-11-04T00:00:00Z" }],
    });
    api.fetchMarketTrending.mockResolvedValue({ most_active: [{ symbol: "MOVE", price: 12.3, change_amount: -1, change_percent: -0.5, volume: 1000 }] });
    open();
    expect(await screen.findByText("SPY")).toBeInTheDocument();
    expect(screen.getByText("$123.45")).toBeInTheDocument();
    expect(screen.getByText("Provider change -1.50%")).toBeInTheDocument();
    expect(screen.queryByText("SPX")).not.toBeInTheDocument();
    expect(screen.queryByText("VIX")).not.toBeInTheDocument();
    expect(screen.queryByText("XLF")).not.toBeInTheDocument();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(within(heatmap).getByText("ONLY")).toBeInTheDocument();
    expect(within(heatmap).queryByText("AAPL")).not.toBeInTheDocument();
    expect(within(heatmap).getByText("+0.00%")).toBeInTheDocument();
    expect(screen.getByText(/-0.50%/)).toBeInTheDocument();
    expect(screen.queryByText(/\+0.50%/)).not.toBeInTheDocument();
  });

  it("keeps stale heatmap changes from looking current", async () => {
    api.fetchMarketHeatmap.mockResolvedValue({ items: [{ symbol: "OLD", company: "Fixture", sector: "Technology", price: 10,
      change_percent: 99, volume: 100, size: "small", refresh_tier: "daily", data_status: "stale", source: "fixture", age_seconds: 900000, as_of: "2026-10-01T00:00:00Z" }] });
    open();
    expect(await screen.findByText("OLD")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.queryByText("+99.00%")).not.toBeInTheDocument();
  });

  it("does not replace a failed requested company with NVIDIA reference data", async () => {
    api.fetchMarketResearch.mockImplementation(async (symbol: string) => ({ symbol, market_cap: 1000000, errors: [], research_risk_label: "Medium", research_risk_score: 50 }));
    open();
    fireEvent.change(screen.getByLabelText("Research symbol"), { target: { value: "MSFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(await screen.findByText("MSFT")).toBeInTheDocument();
    expect(screen.queryByText("NVDA")).not.toBeInTheDocument();
    expect(screen.getByText("Research assessment unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Medium / 50")).not.toBeInTheDocument();
  });

  it("shows missing mover fields as unavailable while keeping actual zeros", async () => {
    api.fetchMarketTrending.mockResolvedValue({ most_active: [
      { symbol: "MISSING", price: null, change_amount: null, change_percent: null, volume: null },
      { symbol: "ZERO", price: 10, change_amount: 0, change_percent: 0, volume: 0 },
    ] });
    open();
    const missing = (await screen.findByText("MISSING")).closest("tr") as HTMLElement;
    expect(within(missing).getAllByText("Unavailable")).toHaveLength(3);
    expect(within(missing).queryByText("$0.00")).not.toBeInTheDocument();
    const zero = screen.getByText("ZERO").closest("tr") as HTMLElement;
    expect(within(zero).getByText("$10.00")).toBeInTheDocument();
    expect(within(zero).getByText("+0.00%")).toBeInTheDocument();
    expect(within(zero).getByText("0")).toBeInTheDocument();
  });
});
