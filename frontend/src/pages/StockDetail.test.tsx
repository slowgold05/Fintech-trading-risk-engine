import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryBar, HistoryResponse } from "../api/history";
import type { SymbolQuoteResponse } from "../types/schemas";
import { AuthContext } from "../context/authState";
import { StockDetail } from "./StockDetail";

const marketApi = vi.hoisted(() => ({
  fetchSymbolQuote: vi.fn(),
  fetchMarketResearch: vi.fn(),
}));
const historyApi = vi.hoisted(() => ({ fetchDailyHistory: vi.fn() }));
const researchApi = vi.hoisted(() => ({ fetchResearchNews: vi.fn() }));
const indicatorApi = vi.hoisted(() => ({ fetchDailyIndicators: vi.fn() }));

vi.mock("../api/market", () => marketApi);
vi.mock("../api/history", () => historyApi);
vi.mock("../api/research", () => researchApi);
vi.mock("../api/indicators", () => indicatorApi);
vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: () => ({
      setData: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
    }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
  })),
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0 },
  CandlestickSeries: { type: "candlestick" },
  AreaSeries: { type: "area" },
  HistogramSeries: { type: "histogram" },
}));

function bar(session: string, close: string, high: string, low: string, volume: string): HistoryBar {
  return {
    session_date: session,
    open: close,
    high,
    low,
    close,
    volume,
    fetched_at: "2026-11-13T21:00:00Z",
    provider: "massive",
    adjustment_type: "split_adjusted",
    quality_status: "valid",
  };
}

function history(bars: HistoryBar[], status: HistoryResponse["status"] = "partial"): HistoryResponse {
  return {
    symbol: "AAPL",
    interval: "1d",
    range: "2y",
    provider: "massive",
    adjustment_type: "split_adjusted",
    status,
    coverage_status: bars.length ? "gaps" : "not_verified",
    expected_session_count: null,
    collection: "disabled",
    read_at: "2026-11-15T00:00:00Z",
    requested_start: "2024-11-15",
    requested_end: "2026-11-15",
    available_start: bars[0]?.session_date ?? null,
    available_end: bars.at(-1)?.session_date ?? null,
    excluded_row_count: 0,
    bars,
  };
}

const quote: SymbolQuoteResponse = {
  symbol: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  exchange: "NASDAQ",
  is_etf: false,
  price: 190.5,
  change_amount: 1.25,
  change_percent: 0.66,
  volume: 1000,
  source: "massive",
  as_of: "2026-11-13T21:00:00Z",
  session_date: "2026-11-13",
};

function httpError(status: number, detail: string) {
  return Object.assign(new Error(detail), {
    isAxiosError: true,
    response: { status, data: { detail } },
  });
}

function renderDetail(path = "/market/AAPL", authenticated = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={{
          token: authenticated ? "token" : null,
          isAuthenticated: authenticated,
          isInitializing: false,
          signIn: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/market/:symbol" element={<StockDetail />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("stock detail", () => {
  beforeEach(() => {
    marketApi.fetchSymbolQuote.mockResolvedValue(quote);
    marketApi.fetchMarketResearch.mockResolvedValue({
      symbol: "AAPL",
      market_cap: 2_500_000_000_000,
      pe_ratio: 28.5,
      profit_margin: 0.25,
      profit_margin_period: { form: "10-K", start: "2025-01-01", end: "2025-12-31" },
      errors: [],
    });
    historyApi.fetchDailyHistory.mockResolvedValue(history([
      bar("2026-11-09", "180", "181", "179", "1000"),
      bar("2026-11-12", "190", "192", "188", "3000"),
    ]));
    researchApi.fetchResearchNews.mockResolvedValue({
      symbol: "AAPL",
      articles: [{
        headline: "Apple updates the line",
        summary: "A cached headline.",
        source: "Finnhub",
        url: "https://example.com/apple",
        published_at: "2026-11-13T15:00:00Z",
      }],
      error: null,
    });
    indicatorApi.fetchDailyIndicators.mockRejectedValue(new Error("Indicator cache unavailable"));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a loading state and then the cached quote, bars, fundamentals, and paper ticket", async () => {
    let resolveQuote: (value: SymbolQuoteResponse) => void = () => undefined;
    marketApi.fetchSymbolQuote.mockReturnValue(new Promise((resolve) => {
      resolveQuote = resolve;
    }));
    renderDetail();
    expect(screen.getByRole("status")).toHaveTextContent("Loading AAPL");

    resolveQuote(quote);
    expect(await screen.findByRole("heading", { name: "AAPL" })).toBeInTheDocument();
    expect(screen.getByText("Cached end-of-day data")).toBeInTheDocument();
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
    expect(screen.getByText(/Technology/)).toBeInTheDocument();
    expect(screen.getByText("$190.50")).toBeInTheDocument();
    expect(screen.getByText("Raw last close")).toBeInTheDocument();
    expect(screen.getAllByText("Up +$1.25 (+0.66%)")).toHaveLength(2);
    expect(screen.getByText("Session date 2026-11-13")).toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("AAPL", "auto", "split_adjusted", "2y");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1);

    expect(await screen.findByText("Massive split-adjusted prices.")).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "Market metrics" });
    expect(within(stats).getByText("52-week range").parentElement).toHaveTextContent("$179.00 — $192.00");
    expect(within(stats).queryByText("Raw prices, not split-adjusted")).not.toBeInTheDocument();
    expect(within(stats).getByText("Last volume").parentElement).toHaveTextContent("1Y avg 2,000");
    expect(within(stats).getByText("Market cap").parentElement).toHaveTextContent("$2,500,000,000,000");
    expect(within(stats).getByText("P/E").parentElement).toHaveTextContent("28.5");
    expect(within(stats).getByText("SEC margin").parentElement).toHaveTextContent("25.00%");
    expect(within(stats).getByText("SEC margin").parentElement).toHaveTextContent("10-K · 2025-01-01 to 2025-12-31");
    expect(screen.getByRole("link", { name: "Paper trade AAPL" })).toHaveAttribute("href", "/trades?symbol=AAPL");
    expect(screen.getByText("Sign in to read company headlines.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Technical scorecard" })).toBeInTheDocument();
    expect(screen.getByText("AI forecast")).toBeInTheDocument();
    expect(screen.getByText(/Sentiment scoring is unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Strategy backtest")).toBeInTheDocument();
    expect(await screen.findByText(/2 weekdays without a bar are shown as gaps and not filled in/)).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "2026-11-09" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "2026-11-10" })).not.toBeInTheDocument();
  });

  it("passes complete coverage to the chart so a holiday is not reported as a gap", async () => {
    historyApi.fetchDailyHistory.mockResolvedValue({
      ...history([
        bar("2025-11-26", "180", "181", "179", "1000"),
        bar("2025-11-28", "190", "192", "188", "3000"),
      ]),
      coverage_status: "complete",
    });
    renderDetail();

    expect(
      await screen.findByText(/2 sessions\. No trading sessions are missing against the NYSE calendar\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/without a bar/)).not.toBeInTheDocument();
  });

  it("shows company headlines after sign-in", async () => {
    renderDetail("/market/AAPL", true);
    expect(await screen.findByRole("link", { name: "Apple updates the line" })).toHaveAttribute(
      "href",
      "https://example.com/apple",
    );
    expect(researchApi.fetchResearchNews).toHaveBeenCalledWith("AAPL");
  });

  it("uses the Yahoo series selected by the API for history and indicators", async () => {
    historyApi.fetchDailyHistory.mockResolvedValue({
      ...history([{ ...bar("2026-11-12", "190", "192", "188", "3000"), provider: "yahoo" }]),
      provider: "yahoo",
    });
    renderDetail();
    expect(await screen.findByText("Yahoo Finance split-adjusted prices.")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "2026-11-12" })).toBeInTheDocument();
    expect(indicatorApi.fetchDailyIndicators).toHaveBeenCalledWith("AAPL", "yahoo", "split_adjusted", "1y", "rsi", 14);
  });

  it("labels raw bars when the API selects a raw series", async () => {
    historyApi.fetchDailyHistory.mockResolvedValue({
      ...history([{ ...bar("2026-11-12", "190", "192", "188", "3000"), adjustment_type: "raw" }]),
      adjustment_type: "raw",
    });
    renderDetail();
    expect(await screen.findByText("Massive raw prices.")).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "Market metrics" });
    expect(within(stats).getByText("52-week range").parentElement).toHaveTextContent("Raw prices, not split-adjusted");
  });

  it("shows fractional adjusted volume without switching to raw history", async () => {
    historyApi.fetchDailyHistory.mockResolvedValue(history([
      bar("2026-11-12", "50", "52", "49", "100.25"),
    ]));
    renderDetail();
    expect(await screen.findByText("Massive split-adjusted prices.")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "2026-11-12" }).closest("tr")).toHaveTextContent("100.25");
    expect(within(screen.getByRole("region", { name: "Market metrics" })).getByText("Last volume").parentElement).toHaveTextContent("1Y avg 100");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1);
  });

  it("calculates labeled one-year volatility and drawdown without older cached prices", async () => {
    const oneYearFlatBars = Array.from({ length: 31 }, (_, index) => {
      const session = new Date(Date.UTC(2025, 10, 16 + index)).toISOString().slice(0, 10);
      return bar(session, "100", "100", "100", "1000");
    });
    historyApi.fetchDailyHistory.mockResolvedValue(history([
      bar("2024-10-01", "1000", "1000", "1000", "1000"),
      ...oneYearFlatBars,
    ]));
    renderDetail();

    const stats = await screen.findByRole("region", { name: "Market metrics" });
    await waitFor(() => {
      expect(within(stats).getByText("Volatility (1Y)").parentElement).toHaveTextContent("0.00%");
      expect(within(stats).getByText("Max drawdown (1Y)").parentElement).toHaveTextContent("0.00%");
    });
  });

  it("shows an empty chart when the cache has no bars", async () => {
    historyApi.fetchDailyHistory.mockResolvedValue(history([], "unavailable"));
    renderDetail();
    expect(await screen.findByText("No cached daily bars for AAPL in the 1 year range.")).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "Market metrics" });
    expect(within(stats).getByText("52-week range").parentElement).toHaveTextContent("unavailable");
  });

  it("shows a quote error and does not request history for an unsupported symbol", async () => {
    marketApi.fetchSymbolQuote.mockRejectedValue(
      httpError(404, "Symbol is outside the supported universe."),
    );
    renderDetail("/market/ZZZZ");
    expect(await screen.findByRole("alert")).toHaveTextContent("Symbol is outside the supported universe.");
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    expect(screen.queryByText("End-of-day data")).not.toBeInTheDocument();
  });

  it("shows a history error and retries the daily bars", async () => {
    const user = userEvent.setup();
    historyApi.fetchDailyHistory.mockRejectedValue(new Error("offline"));
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily prices could not be loaded.");
    await user.click(screen.getByRole("button", { name: "Retry daily prices" }));
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(2));
  });

  it("says market cap and P/E are unavailable when research has neither", async () => {
    marketApi.fetchMarketResearch.mockResolvedValue({
      symbol: "AAPL",
      market_cap: null,
      pe_ratio: null,
      profit_margin: null,
      profit_margin_period: null,
      errors: [],
    });
    renderDetail();
    const stats = await screen.findByRole("region", { name: "Market metrics" });
    await waitFor(() => {
      expect(within(stats).getByText("Market cap").parentElement).toHaveTextContent("unavailable");
    });
    expect(within(stats).getByText("P/E").parentElement).toHaveTextContent("unavailable");
    expect(within(stats).getByText("Profit margin").parentElement).toHaveTextContent("unavailable");
  });

  it("rejects a malformed symbol before calling the API", () => {
    renderDetail("/market/bad_symbol");
    expect(screen.getByRole("alert")).toHaveTextContent("This symbol is not in the supported format.");
    expect(marketApi.fetchSymbolQuote).not.toHaveBeenCalled();
  });
});
