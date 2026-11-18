import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Home } from "./Home";

const api = vi.hoisted(() => ({
  fetchMarketOverview: vi.fn(), fetchMarketHeatmap: vi.fn(),
  fetchMarketTrending: vi.fn(), fetchMarketResearch: vi.fn(),
  fetchMarketNews: vi.fn(),
}));
const demoAuth = vi.hoisted(() => ({ startDemo: vi.fn(), signIn: vi.fn() }));
const historyApi = vi.hoisted(() => ({
  fetchCachedSeries: vi.fn(),
  fetchDailyHistory: vi.fn(),
}));
vi.mock("../api/market", () => api);
vi.mock("../api/auth", () => ({ startDemo: demoAuth.startDemo }));
vi.mock("../api/history", () => historyApi);
vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  LineSeries: { type: "line" },
  CandlestickSeries: { type: "candlestick" },
  HistogramSeries: { type: "histogram" },
  AreaSeries: { type: "area" },
  createSeriesMarkers: () => ({ setMarkers: () => undefined }),
  createChart: () => ({
    addSeries: () => ({
      setData: () => undefined,
      applyOptions: () => undefined,
      setMarkers: () => undefined,
      createPriceLine: () => ({}),
      removePriceLine: () => undefined,
    }),
    subscribeCrosshairMove: () => undefined,
    timeScale: () => ({ fitContent: () => undefined }),
    priceScale: () => ({ applyOptions: () => undefined }),
    remove: () => undefined,
    applyOptions: () => undefined,
  }),
}));
vi.mock("../context/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false, signIn: demoAuth.signIn }) }));
vi.mock("../components/Watchlists", () => ({
  Watchlists: ({
    onUseInResearch,
    onUseInChart,
  }: {
    onUseInResearch: (symbol: string) => void;
    onUseInChart: (symbol: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onUseInResearch("MSFT")}>Use MSFT in research</button>
      <button type="button" onClick={() => onUseInChart("MSFT")}>Use MSFT in chart</button>
    </div>
  ),
}));

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Home /></MemoryRouter></QueryClientProvider>);
  return client;
}

function historyResponse(
  symbol: string,
  range: string,
  closes: string[],
  provider = "massive",
  adjustment = "split_adjusted",
  status: "partial" | "unavailable" = "partial",
) {
  return {
    symbol,
    interval: "1d",
    range,
    provider,
    adjustment_type: adjustment,
    status,
    coverage_status: "gaps",
    expected_session_count: closes.length,
    collection: "disabled",
    read_at: "2026-11-13T00:00:00Z",
    requested_start: "2026-10-13",
    requested_end: "2026-11-13",
    available_start: status === "unavailable" ? null : "2026-10-13",
    available_end: status === "unavailable" ? null : "2026-11-13",
    excluded_row_count: 0,
    bars: closes.map((close, index) => ({
      session_date: `2026-10-${String(13 + index).padStart(2, "0")}`,
      open: close,
      high: close,
      low: close,
      close,
      volume: "100",
      fetched_at: "2026-11-13T00:00:00Z",
      provider,
      adjustment_type: adjustment,
      quality_status: "valid",
    })),
  };
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

  it("starts a demo directly from the public market", async () => {
    demoAuth.startDemo.mockResolvedValue({ access_token: "demo-token" });
    open();

    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));

    await waitFor(() => expect(demoAuth.signIn).toHaveBeenCalledWith("demo-token"));
    expect(demoAuth.startDemo).toHaveBeenCalledTimes(1);
  });

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
    expect(screen.queryByRole("img", { name: /closing prices/i })).not.toBeInTheDocument();
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
    expect(await screen.findByText("$123.45")).toBeInTheDocument();
    expect(screen.getAllByText("SPY").length).toBeGreaterThan(0);
    expect(screen.getByText("Provider change -1.50%")).toBeInTheDocument();
    expect(screen.queryByText("SPX")).not.toBeInTheDocument();
    expect(screen.queryByText("VIX")).not.toBeInTheDocument();
    expect(screen.queryByText("XLF")).not.toBeInTheDocument();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(within(heatmap).getByText("ONLY")).toBeInTheDocument();
    expect(within(heatmap).queryByRole("link", { name: /ONLY/ })).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("AAPL")).not.toBeInTheDocument();
    expect(within(heatmap).getByText("+0.00%")).toBeInTheDocument();
    expect(screen.getByText("MOVE")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "MOVE" })).not.toBeInTheDocument();
    expect(screen.getByText(/-0.50%/)).toBeInTheDocument();
    expect(screen.queryByText(/\+0.50%/)).not.toBeInTheDocument();
  });

  it("links heatmap tiles, movers, and research only to symbols the detail page can read", async () => {
    const tile = { company: "Fixture", sector: "Technology", price: 10, change_percent: 1, volume: 100, size: "large",
      refresh_tier: "daily", data_status: "delayed", source: "fixture", age_seconds: 60, as_of: "2026-11-04T00:00:00Z" };
    api.fetchMarketHeatmap.mockResolvedValue({
      items: [
        { ...tile, symbol: "AAPL", detail_available: true },
        { ...tile, symbol: "OUTX", detail_available: false },
        { ...tile, symbol: "OLDAPI" },
      ],
    });
    const mover = { price: 12.3, change_amount: 1, change_percent: 0.5, volume: 1000 };
    api.fetchMarketTrending.mockResolvedValue({
      most_active: [
        { ...mover, symbol: "MSFT", detail_available: true },
        { ...mover, symbol: "PENNY", detail_available: false },
      ],
    });
    api.fetchMarketResearch.mockImplementation(async (symbol: string) => ({
      symbol, detail_available: symbol === "MSFT", market_cap: 1000000, errors: [],
    }));
    open();

    const heatmap = (await screen.findByRole("heading", { name: "Stock heatmap" })).closest(".dashboard-card") as HTMLElement;
    expect(await within(heatmap).findByRole("link", { name: /AAPL/ })).toHaveAttribute("href", "/market/AAPL");
    for (const symbol of ["OUTX", "OLDAPI"]) {
      const plain = within(heatmap).getByText(symbol).closest("[title]") as HTMLElement;
      expect(plain.tagName).toBe("DIV");
      expect(plain).toHaveAttribute("title", expect.stringContaining("Fixture"));
    }
    expect(within(heatmap).getAllByRole("link")).toHaveLength(1);

    expect(screen.getByRole("link", { name: "MSFT" })).toHaveAttribute("href", "/market/MSFT");
    expect(screen.getByText("PENNY")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PENNY" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Research symbol"), { target: { value: "PENNY" } });
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    await waitFor(() => expect(api.fetchMarketResearch).toHaveBeenCalledWith("PENNY"));
    await waitFor(() => expect(screen.getAllByText("PENNY").length).toBeGreaterThan(1));
    expect(screen.queryByRole("link", { name: "View PENNY" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Research symbol"), { target: { value: "MSFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(await screen.findByRole("link", { name: "View MSFT" })).toHaveAttribute("href", "/market/MSFT");
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
    api.fetchMarketResearch.mockImplementation(async (symbol: string) => ({ symbol, detail_available: true, market_cap: 1000000, errors: [], research_risk_label: "Medium", research_risk_score: 50 }));
    open();
    fireEvent.change(screen.getByLabelText("Research symbol"), { target: { value: "MSFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(await screen.findByText("MSFT")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "View MSFT" })).toHaveAttribute("href", "/market/MSFT");
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

  it("prefills research and history from a watchlist without submitting either request", async () => {
    const scrollIntoView = vi.fn();
    const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      historyApi.fetchCachedSeries.mockResolvedValue({
        read_at: "2026-11-06T12:00:00Z", collection: "disabled",
        coverage_status: "not_verified", expected_session_count: null,
        canonical_history: { series: [{ provider: "fixture", adjustment_type: "raw" }] },
      });
      open();
      expect(await screen.findByText("Market quotes unavailable")).toBeInTheDocument();
      expect(api.fetchMarketResearch).toHaveBeenCalledTimes(1);
      expect(api.fetchMarketResearch).toHaveBeenCalledWith("NVDA");
      fireEvent.click(screen.getByRole("button", { name: "Use MSFT in research" }));
      const research = document.getElementById("research-symbol");
      expect(research).toHaveValue("MSFT");
      expect(research).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(api.fetchMarketResearch).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Use MSFT in chart" }));
      const history = document.getElementById("daily-history-symbol");
      expect(history).toHaveValue("MSFT");
      expect(history).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(historyApi.fetchDailyHistory).not.toHaveBeenCalledWith("MSFT", "fixture", "raw", "2y");
      const series = JSON.stringify(["fixture", "raw"]);
      fireEvent.change(screen.getByRole("combobox", { name: "Cached series" }), { target: { value: series } });
      fireEvent.click(screen.getByRole("button", { name: "Use MSFT in chart" }));
      expect(document.getElementById("daily-history-symbol")).toHaveValue("MSFT");
      expect(screen.getByRole("combobox", { name: "Cached series" })).toHaveValue(series);
      expect(scrollIntoView).toHaveBeenCalledTimes(3);
      expect(historyApi.fetchDailyHistory).not.toHaveBeenCalledWith("MSFT", "fixture", "raw", "2y");
      const form = screen.getByRole("button", { name: "View history" }).closest("form");
      if (!(form instanceof HTMLFormElement)) throw new Error("Missing history form.");
      fireEvent.submit(form);
      await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("MSFT", "fixture", "raw", "2y"));
      expect(historyApi.fetchDailyHistory.mock.calls.filter((call) => call[0] === "MSFT")).toHaveLength(1);
    } finally {
      if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("opens the section menu from the hamburger button and closes it again", () => {
    open();
    const menuButton = screen.getByRole("button", { name: "Open menu" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveClass("min-h-11", "min-w-11");
    expect(screen.queryByRole("navigation", { name: "Page sections" })).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("navigation", { name: "Page sections" });
    const links: Array<[string, string, string]> = [
      ["Trending movers", "#trending-movers", "Trending movers"],
      ["Market pulse", "#market-pulse", "Market pulse"],
      ["Sector ETF performance", "#sector-etf-heatmap", "Sector ETF performance"],
      ["Company research", "#company-research", "Company research"],
      ["Stock heatmap", "#stock-heatmap", "Stock heatmap"],
      ["Market news", "#market-news", "Market news"],
      ["Daily history chart", "#daily-price-history-title", "Daily price history"],
    ];
    for (const [name, href, heading] of links) {
      expect(within(menu).getByRole("link", { name })).toHaveAttribute("href", href);
      expect(document.getElementById(href.slice(1))).toHaveTextContent(heading);
    }
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href")).slice(0, links.length)).toEqual(
      links.map(([, href]) => href),
    );
    expect(menuButton).not.toHaveClass("sm:hidden");
    expect(menu).not.toHaveClass("sm:hidden");
    expect(menuButton.compareDocumentPosition(screen.getByText("getrichyesterday")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menuButton.compareDocumentPosition(document.getElementById("trending-movers") as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(menu).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    const closeMenu = within(menu).getByRole("button", { name: "Close menu" });
    expect(closeMenu).toHaveClass("min-h-11");
    expect(closeMenu).toHaveFocus();
    const overlay = menu.parentElement as HTMLElement;
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("inset-0");
    expect(menu.className).toContain("inset-y-0");
    expect(menu.className).toContain("left-0");
    expect(menu.className).toContain("w-[min(18rem,calc(100%-3rem))]");
    expect(menu.className).toContain("motion-safe:animate-[drawer-in_200ms_ease-out_both]");
    expect(document.body.style.overflow).toBe("hidden");

    const loginLink = within(menu).getByRole("link", { name: "Log in" });
    loginLink.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeMenu).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(loginLink).toHaveFocus();

    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Page sections" })).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    const reopened = screen.getByRole("navigation", { name: "Page sections" });
    fireEvent.click(reopened.parentElement?.firstElementChild as HTMLElement);
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveFocus();
    expect(screen.queryByRole("navigation", { name: "Page sections" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(menuButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveFocus();
    expect(screen.queryByRole("navigation", { name: "Page sections" })).not.toBeInTheDocument();
  });

  it("toggles the shared market-pulse range and lists every index proxy", async () => {
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-13T00:00:00Z", errors: [],
      trends: [
        { symbol: "SPX", source_symbol: "SPY", name: "S&P 500", value: 123.45, change: 1, change_percent: 1.2 },
        { symbol: "NDX", source_symbol: "QQQ", name: "Nasdaq 100", value: 50, change: -1, change_percent: -0.4 },
      ],
      sectors: [],
    });
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string, provider: string, adjustment: string, range: string) => (
      historyResponse(
        symbol,
        range,
        symbol === "QQQ" ? ["12.000000", "9.000000"] : ["10.000000", "12.000000"],
        provider === "auto" ? "yahoo" : provider,
        adjustment,
      )
    ));
    open();
    const oneMonth = screen.getByRole("button", { name: "Market pulse range 1M" });
    const threeMonth = screen.getByRole("button", { name: "Market pulse range 3M" });
    expect(oneMonth).toHaveAttribute("aria-pressed", "true");
    expect(threeMonth).toHaveAttribute("aria-pressed", "false");
    const pulse = screen.getByRole("heading", { name: "Market pulse" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(pulse).findByText("Provider change +1.20%")).toBeInTheDocument();
    expect(within(pulse).getByText("$123.45")).toBeInTheDocument();
    expect(within(pulse).queryByRole("img", { name: /closing prices/i })).not.toBeInTheDocument();
    const comparison = await within(pulse).findByRole("list", { name: "End-of-day percent change for the index proxies" });
    await waitFor(() => expect(comparison).toHaveTextContent("+20.00%"));
    expect(within(comparison).getByText("DIA")).toBeInTheDocument();
    expect(within(comparison).getByText("IWM")).toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("SPY", "auto", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("QQQ", "auto", "split_adjusted", "1m");

    fireEvent.click(threeMonth);
    expect(threeMonth).toHaveAttribute("aria-pressed", "true");
    expect(oneMonth).toHaveAttribute("aria-pressed", "false");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("SPY", "auto", "split_adjusted", "3m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("QQQ", "auto", "split_adjusted", "3m");
    fireEvent.click(screen.getByRole("button", { name: "Market pulse range 2Y" }));
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("SPY", "auto", "split_adjusted", "2y"));
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("DIA", "auto", "split_adjusted", "2y");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("IWM", "auto", "split_adjusted", "2y");
  });

  it("keeps market-pulse tiles text-only when history is unavailable", async () => {
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-13T00:00:00Z", errors: [],
      trends: [{ symbol: "SPX", source_symbol: "SPY", name: "S&P 500", value: 123.45, change: -1, change_percent: -1.5 }],
      sectors: [],
    });
    historyApi.fetchDailyHistory.mockResolvedValue(
      historyResponse("SPY", "1m", [], "massive", "split_adjusted", "unavailable"),
    );
    open();
    const pulse = screen.getByRole("heading", { name: "Market pulse" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(pulse).findByText("Provider change -1.50%")).toBeInTheDocument();
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("SPY", "auto", "split_adjusted", "1m"));
    expect(within(pulse).getByText("$123.45")).toBeInTheDocument();
    expect(within(pulse).queryByRole("img", { name: /closing prices/i })).not.toBeInTheDocument();
  });

  it("draws a mover sparkline and leaves the cell empty when that history is unavailable", async () => {
    api.fetchMarketTrending.mockResolvedValue({ most_active: [
      { symbol: "UP", price: 10, change_amount: 1, change_percent: 1, volume: 5 },
      { symbol: "NOPE", price: 8, change_amount: -1, change_percent: -1, volume: 4 },
    ] });
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string, provider: string, adjustment: string, range: string) => (
      symbol === "NOPE"
        ? historyResponse(symbol, range, [], provider, adjustment, "unavailable")
        : historyResponse(symbol, range, ["8.000000", "11.000000"], provider, adjustment)
    ));
    open();
    const up = (await screen.findByText("UP")).closest("tr") as HTMLElement;
    expect(await within(up).findByRole("img", { name: "UP closing prices over 1M, up" })).toBeInTheDocument();
    expect(within(up.closest("table") as HTMLElement).getByRole("columnheader", { name: "Trend" })).toBeInTheDocument();
    const nope = screen.getByText("NOPE").closest("tr") as HTMLElement;
    expect(await within(nope).findByText("—")).toBeInTheDocument();
    expect(within(nope).queryByRole("img", { name: /closing prices/i })).not.toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("NOPE", "auto", "split_adjusted", "1m");
  });

  it("shows the company research chart only after research inputs load", async () => {
    let resolveResearch: (value: unknown) => void = () => {};
    api.fetchMarketResearch.mockReturnValue(new Promise((resolve) => {
      resolveResearch = resolve;
    }));
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string, provider: string, adjustment: string, range: string) => (
      historyResponse(symbol, range, ["10.000000", "14.000000"], provider, adjustment)
    ));
    open();
    const researchCard = screen.getByRole("heading", { name: "Company research" }).closest(".dashboard-card") as HTMLElement;
    expect(within(researchCard).queryByRole("img", { name: /closing prices/i })).not.toBeInTheDocument();
    expect(within(researchCard).queryByRole("button", { name: /Company research range/i })).not.toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalledWith("NVDA", "auto", "split_adjusted", "1m");

    resolveResearch({ symbol: "NVDA", name: "NVIDIA Corporation", pe_ratio: 28, price: 100, errors: [] });
    expect(await within(researchCard).findByRole("img", { name: "NVDA closing prices over 1M, up" })).toBeInTheDocument();
    const oneMonth = within(researchCard).getByRole("button", { name: "Company research range 1M" });
    const sixMonth = within(researchCard).getByRole("button", { name: "Company research range 6M" });
    expect(oneMonth).toHaveAttribute("aria-pressed", "true");
    expect(sixMonth).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Market pulse range 1M" })).toHaveAttribute("aria-pressed", "true");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("NVDA", "auto", "split_adjusted", "1m");

    fireEvent.click(sixMonth);
    expect(sixMonth).toHaveAttribute("aria-pressed", "true");
    expect(oneMonth).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Market pulse range 1M" })).toHaveAttribute("aria-pressed", "true");
    expect(await within(researchCard).findByRole("img", { name: "NVDA closing prices over 6M, up" })).toBeInTheDocument();
  });

  it("shows the SEC period for a matched margin and does not scale the ratio twice", async () => {
    api.fetchMarketResearch.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      profit_margin: 0.25,
      profit_margin_period: {
        form: "10-K",
        start: "2024-01-01",
        end: "2024-12-31",
        fp: "FY",
        fy: 2024,
      },
      errors: [],
    });
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string, provider: string, adjustment: string, range: string) => (
      historyResponse(symbol, range, ["10.000000", "14.000000"], provider, adjustment)
    ));
    open();
    const researchCard = screen.getByRole("heading", { name: "Company research" }).closest(".dashboard-card") as HTMLElement;
    const margin = (await within(researchCard).findByText("Margin")).parentElement as HTMLElement;
    expect(await within(margin).findByText("25.00%")).toBeInTheDocument();
    expect(within(margin).getByText("10-K · 2024-01-01 to 2024-12-31")).toBeInTheDocument();
    expect(within(margin).queryByText("2500.00%")).not.toBeInTheDocument();
  });

  it("leaves the margin blank when the SEC ratio has no period", async () => {
    api.fetchMarketResearch.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      profit_margin: null,
      profit_margin_period: null,
      errors: [],
    });
    open();
    const researchCard = screen.getByRole("heading", { name: "Company research" }).closest(".dashboard-card") as HTMLElement;
    const margin = (await within(researchCard).findByText("Margin")).parentElement as HTMLElement;
    expect(within(margin).getByText("--")).toBeInTheDocument();
    expect(within(margin).queryByText(/10-K/)).not.toBeInTheDocument();
  });

  it("labels end-of-day research price, market cap, and P/E with the quote date", async () => {
    api.fetchMarketResearch.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      price: 100,
      price_basis: "end_of_day_previous_close",
      price_as_of: "2026-11-13",
      market_cap: 1000000,
      market_cap_basis: "end_of_day_price_times_shares",
      pe_ratio: 25,
      pe_basis: "sec_ttm_diluted_eps",
      errors: [],
    });
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string, provider: string, adjustment: string, range: string) => (
      historyResponse(symbol, range, ["10.000000", "14.000000"], provider, adjustment)
    ));
    open();
    const researchCard = screen.getByRole("heading", { name: "Company research" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(researchCard).findAllByText("End of day 2026-11-13")).toHaveLength(3);
    const pe = within(researchCard).getByText("P/E").parentElement as HTMLElement;
    expect(within(pe).getByText("25.00")).toBeInTheDocument();
  });

  it("shows a research P/E with two decimal places", async () => {
    api.fetchMarketResearch.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      price: 100,
      pe_ratio: 31.47619047619048,
      pe_basis: "sec_ttm_diluted_eps",
      errors: [],
    });
    open();
    const researchCard = screen.getByRole("heading", { name: "Company research" }).closest(".dashboard-card") as HTMLElement;
    const value = await within(researchCard).findByText("31.48");
    expect(value.closest(".metric-tile")).toHaveTextContent("P/E");
  });

  it("does not label an Alpha Vantage research quote as end of day", async () => {
    api.fetchMarketResearch.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      price: 100,
      price_basis: "alpha_vantage",
      market_cap: 1000000,
      market_cap_basis: "alpha_vantage",
      pe_ratio: 10,
      pe_basis: "alpha_vantage",
      errors: [],
    });
    open();
    const researchCard = screen.getByRole("heading", { name: "Company research" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(researchCard).findByText("$100.00")).toBeInTheDocument();
    expect(within(researchCard).queryByText(/End of day/)).not.toBeInTheDocument();
  });

  it("renders market headlines from the news endpoint", async () => {
    api.fetchMarketNews.mockResolvedValue({
      as_of: "2026-11-13T15:04:00Z",
      articles: [{
        headline: "Chip rally lifts the Nasdaq",
        summary: "Index ETFs rose after a chip rally.",
        source: "Example Wire",
        url: "https://example.com/chip",
        published_at: "2026-11-13T15:04:00Z",
      }],
    });
    open();
    const newsCard = screen.getByRole("heading", { name: "Market news" }).closest(".dashboard-card") as HTMLElement;
    const headline = await within(newsCard).findByRole("link", { name: "Chip rally lifts the Nasdaq" });
    expect(headline).toHaveAttribute("href", "https://example.com/chip");
    expect(headline).toHaveAttribute("target", "_blank");
    expect(headline).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(newsCard).getByText("Example Wire")).toBeInTheDocument();
    expect(within(newsCard).getByText("Index ETFs rose after a chip rally.")).toBeInTheDocument();
    const time = newsCard.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-11-13T15:04:00Z");
    expect(time?.textContent).toContain("2026");
    expect(time?.textContent).toContain("15:04:00");
    expect(time?.textContent).toContain("UTC");
  });

  it("shows an empty market news state when no headlines are returned", async () => {
    api.fetchMarketNews.mockResolvedValue({ articles: [], as_of: null });
    open();
    const newsCard = screen.getByRole("heading", { name: "Market news" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(newsCard).findByText("No market headlines")).toBeInTheDocument();
    expect(within(newsCard).queryByRole("link")).not.toBeInTheDocument();
  });

  it("stacks desktop columns independently and keeps one mobile copy of each panel", () => {
    open();
    const columns = [
      ["trending-movers", "company-research"],
      ["market-pulse", "stock-heatmap"],
      ["sector-etf-heatmap", "market-news"],
    ];
    const mobileOrder = [
      "trending-movers",
      "market-pulse",
      "sector-etf-heatmap",
      "company-research",
      "stock-heatmap",
      "market-news",
    ];
    const cards = mobileOrder.map((id, index) => {
      const matches = document.querySelectorAll(`#${id}`);
      expect(matches).toHaveLength(1);
      const card = matches[0].closest(".dashboard-card") as HTMLElement;
      expect(card.className).toContain(`max-[1199px]:order-${index + 1}`);
      return card;
    });
    const grid = cards[0].parentElement?.parentElement;
    expect(grid?.className).toContain("gap-6");
    expect(grid?.className).toContain("items-start");
    expect(grid?.className).toContain("min-[1200px]:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)_minmax(260px,1fr)]");
    expect(grid?.className).not.toContain("xl:grid-cols");
    const stacks = Array.from(grid?.children ?? []);
    expect(stacks).toHaveLength(3);
    stacks.forEach((stack, index) => {
      expect(stack.className).toContain("contents");
      expect(stack.className).toContain("min-[1200px]:flex-col");
      expect(stack.className).toContain("min-[1200px]:gap-6");
      expect(columns[index].map((id) => stack.querySelector(`#${id}`)?.id)).toEqual(columns[index]);
    });
    const heatmap = document.getElementById("stock-heatmap")?.closest(".dashboard-card") as HTMLElement;
    const heatmapBody = within(heatmap).getByRole("region", { name: "Stock heatmap" });
    expect(heatmapBody.className).toContain("max-h-[max(24rem,calc(100vh-16rem))]");
    expect(heatmapBody.className).toContain("overflow-y-auto");
    expect(heatmapBody.className).toContain("focus:ring-2");
    expect(heatmapBody).toHaveAttribute("tabindex", "0");
    expect(heatmapBody).toHaveAttribute("aria-labelledby", "stock-heatmap");
    expect(within(heatmap).getByRole("button", { name: "Set heatmap size to standard" })).toHaveClass("min-h-11");
    const section = grid?.closest("section");
    expect(section?.className).toContain("px-4");
    expect(section?.className).toContain("sm:px-6");
    expect(section?.className).toContain("lg:px-10");
    const watchlist = screen.getByRole("button", { name: "Use MSFT in research" });
    const historyTitle = document.getElementById("daily-price-history-title");
    expect(historyTitle).not.toBeNull();
    const newsCard = document.getElementById("market-news")?.closest(".dashboard-card") as HTMLElement;
    const newsBody = within(newsCard).getByRole("region", { name: "Market news" });
    expect(newsBody.className).toContain("max-h-[max(24rem,calc(100vh-16rem))]");
    expect(newsBody.className).toContain("overflow-y-auto");
    expect(newsBody.className).toContain("focus:ring-2");
    expect(newsBody).toHaveAttribute("tabindex", "0");
    expect(newsBody).toHaveAttribute("aria-labelledby", "market-news");
    expect(newsCard.compareDocumentPosition(watchlist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(watchlist.compareDocumentPosition(historyTitle as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open menu" })).toHaveLength(1);
  });

  it("switches the heatmap between returned stocks and returned sector proxies", async () => {
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-04T00:00:00Z",
      errors: [],
      trends: [],
      sectors: [{ symbol: "XLK", sector: "Technology", change_percent: 1.25, weight: "large", leaders: ["AAPL"] }],
    });
    api.fetchMarketHeatmap.mockResolvedValue({
      items: [{
        symbol: "ONLY", company: "Fixture", sector: "Technology", price: 10, change_percent: 0,
        volume: 100, size: "large", refresh_tier: "daily", data_status: "delayed", source: "fixture",
        age_seconds: 60, as_of: "2026-11-04T00:00:00Z",
      }],
    });
    open();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    const stocks = within(heatmap).getByRole("button", { name: "Stocks" });
    const sectors = within(heatmap).getByRole("button", { name: "Sectors" });
    expect(stocks).toHaveAttribute("aria-pressed", "true");
    expect(sectors).toHaveAttribute("aria-pressed", "false");
    expect(await within(heatmap).findByText("ONLY")).toBeInTheDocument();
    expect(within(heatmap).getByText("1 returned quote")).toBeInTheDocument();
    expect(within(heatmap).queryByText("XLK")).not.toBeInTheDocument();
    expect(within(heatmap).getByRole("button", { name: "Set heatmap size to standard" })).toHaveAttribute("aria-pressed", "true");
    expect(within(heatmap).getByRole("group", { name: "Heatmap size" }).className).toContain("max-w-full");
    expect(within(heatmap).getByRole("group", { name: "Heatmap size" }).className).toContain("flex-wrap");

    fireEvent.click(within(heatmap).getByRole("button", { name: "Set heatmap size to compact" }));
    expect(stocks).toHaveAttribute("aria-pressed", "true");
    expect(within(heatmap).getByText("ONLY")).toBeInTheDocument();

    fireEvent.click(sectors);
    expect(sectors).toHaveAttribute("aria-pressed", "true");
    expect(stocks).toHaveAttribute("aria-pressed", "false");
    expect(within(heatmap).getByText("XLK")).toBeInTheDocument();
    expect(within(heatmap).getByText("AAPL")).toBeInTheDocument();
    expect(within(heatmap).getByText("UP +1.25%")).toBeInTheDocument();
    expect(within(heatmap).queryByText("ONLY")).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("No cached quotes")).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("Loading cache")).not.toBeInTheDocument();
    expect(within(heatmap).getByText("1 returned sector proxy")).toBeInTheDocument();
    expect(within(heatmap).queryByText("XLF")).not.toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Sector ETF performance" }).closest(".dashboard-card") as HTMLElement).getByRole("listitem", { name: /XLK/ })).toBeInTheDocument();
  });

  it("shows the sector proxy count when stock items are empty", async () => {
    api.fetchMarketHeatmap.mockResolvedValue({ items: [] });
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-04T00:00:00Z",
      errors: [],
      trends: [],
      sectors: [{ symbol: "XLK", sector: "Technology", change_percent: 1.25, weight: "large", leaders: ["AAPL"] }],
    });
    open();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(heatmap).findByText("No cached quotes")).toBeInTheDocument();
    fireEvent.click(within(heatmap).getByRole("button", { name: "Sectors" }));
    await waitFor(() => {
      expect(within(heatmap).getByRole("status")).toHaveTextContent("1 returned sector proxy");
    });
    expect(within(heatmap).getByRole("status")).not.toHaveTextContent("No cached quotes");
    expect(within(heatmap).getByRole("status")).not.toHaveTextContent("Loading cache");
    expect(within(heatmap).getByText("XLK")).toBeInTheDocument();
    expect(within(heatmap).queryByText("ONLY")).not.toBeInTheDocument();
  });

  it("shows the overview error in the heatmap header when sectors are selected", async () => {
    api.fetchMarketOverview.mockRejectedValue(new Error("overview down"));
    api.fetchMarketHeatmap.mockResolvedValue({ items: [] });
    open();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(heatmap).findByText("No cached quotes")).toBeInTheDocument();
    fireEvent.click(within(heatmap).getByRole("button", { name: "Sectors" }));
    await waitFor(() => {
      expect(within(heatmap).getByRole("status")).toHaveTextContent("Sector quotes unavailable");
    });
    expect(within(heatmap).getByRole("status")).not.toHaveTextContent("No cached quotes");
    expect(within(heatmap).getByRole("status")).not.toHaveTextContent("Loading cache");
  });

  it("keeps the sector proxy count when a later overview refetch fails", async () => {
    api.fetchMarketOverview.mockResolvedValueOnce({
      as_of: "2026-11-04T00:00:00Z",
      errors: [],
      trends: [],
      sectors: [{ symbol: "XLK", sector: "Technology", change_percent: 1.25, weight: "large", leaders: ["AAPL"] }],
    });
    api.fetchMarketHeatmap.mockResolvedValue({ items: [] });
    const client = open();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(heatmap).findByText("No cached quotes")).toBeInTheDocument();
    fireEvent.click(within(heatmap).getByRole("button", { name: "Sectors" }));
    expect(await within(heatmap).findByText("1 returned sector proxy")).toBeInTheDocument();
    expect(within(heatmap).getByText("XLK")).toBeInTheDocument();

    await client.refetchQueries({ queryKey: ["market", "overview"] }).catch(() => undefined);

    await waitFor(() => {
      expect(within(heatmap).getByRole("status")).toHaveTextContent("1 returned sector proxy");
    });
    expect(within(heatmap).getByRole("status")).not.toHaveTextContent("Sector quotes unavailable");
    expect(within(heatmap).getByText("XLK")).toBeInTheDocument();
    expect(within(heatmap).queryByText("No cached sector proxies")).not.toBeInTheDocument();
  });

  it("keeps the heatmap header on the sector query while stocks are still loading", async () => {
    let resolveHeatmap: (value: { items: [] }) => void = () => undefined;
    api.fetchMarketHeatmap.mockReturnValue(new Promise((resolve) => {
      resolveHeatmap = resolve;
    }));
    api.fetchMarketOverview.mockResolvedValue({
      as_of: "2026-11-04T00:00:00Z",
      errors: [],
      trends: [],
      sectors: [{ symbol: "XLK", sector: "Technology", change_percent: 1.25, weight: "large", leaders: ["AAPL"] }],
    });
    open();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(within(heatmap).getByText("Loading cache")).toBeInTheDocument();
    fireEvent.click(within(heatmap).getByRole("button", { name: "Sectors" }));
    expect(within(heatmap).queryByText("Loading cache")).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("No cached quotes")).not.toBeInTheDocument();
    expect(await within(heatmap).findByText("1 returned sector proxy")).toBeInTheDocument();
    expect(within(heatmap).getByText("XLK")).toBeInTheDocument();
    resolveHeatmap({ items: [] });
    await waitFor(() => {
      expect(within(heatmap).queryByText("Loading cache")).not.toBeInTheDocument();
    });
    expect(within(heatmap).getByText("1 returned sector proxy")).toBeInTheDocument();
    expect(within(heatmap).queryByText("No cached quotes")).not.toBeInTheDocument();
  });

  it("shows no invented sector tiles when the sector view has no returned proxies", async () => {
    api.fetchMarketOverview.mockResolvedValue({ as_of: null, errors: [], trends: [], sectors: [] });
    api.fetchMarketHeatmap.mockResolvedValue({
      items: [{
        symbol: "ONLY", company: "Fixture", sector: "Technology", price: 10, change_percent: 0,
        volume: 100, size: "small", refresh_tier: "daily", data_status: "delayed", source: "fixture",
        age_seconds: 60, as_of: "2026-11-04T00:00:00Z",
      }],
    });
    open();
    const heatmap = screen.getByRole("heading", { name: "Stock heatmap" }).closest(".dashboard-card") as HTMLElement;
    expect(await within(heatmap).findByText("ONLY")).toBeInTheDocument();
    fireEvent.click(within(heatmap).getByRole("button", { name: "Sectors" }));
    expect(within(heatmap).getByRole("button", { name: "Sectors" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(within(heatmap).getByRole("status")).toHaveTextContent("Sector quotes unavailable");
    });
    expect(within(heatmap).getAllByText("Sector quotes unavailable")).toHaveLength(2);
    expect(within(heatmap).queryByText("No cached sector proxies")).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("ONLY")).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("XLK")).not.toBeInTheDocument();
    expect(within(heatmap).queryByText("XLF")).not.toBeInTheDocument();
    expect(within(heatmap).queryByRole("img")).not.toBeInTheDocument();
    const sectorCard = screen.getByRole("heading", { name: "Sector ETF performance" }).closest(".dashboard-card") as HTMLElement;
    expect(within(sectorCard).getByText("No sector ETF proxies.")).toBeInTheDocument();
    expect(within(sectorCard).queryByText("XLK")).not.toBeInTheDocument();
  });
});
