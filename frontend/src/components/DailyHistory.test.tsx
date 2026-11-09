import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryBar, HistoryRange, HistoryResponse, MarketDataStatus } from "../api/history";
import type { OrderResponse, TradeResponse } from "../types/schemas";
import { saveChartPreferences } from "../utils/chartPreferences";
import { DailyHistory } from "./DailyHistory";

const CHART_PREFERENCES_KEY = "sentinel.dailyHistory.chartPreferences";

const READ_AT = "2026-11-06T12:00:00Z";
const FETCHED_AT = "2026-11-06T11:00:00Z";
const PARTIAL = "Partial cached bars for the requested window. Missing sessions stay missing.";
const EMPTY = "No cached daily bars for this symbol, source, and adjustment.";
const MISMATCH = "Cached history did not match the selected symbol, source, and adjustment.";
const PLOT = "Cached daily bars could not be plotted.";
const SHOWING = "Showing TEST, source fixture, adjustment raw.";
const RAW_SERIES = JSON.stringify(["fixture", "raw"]);

const historyApi = vi.hoisted(() => ({ fetchCachedSeries: vi.fn(), fetchDailyHistory: vi.fn() }));
const indicatorApi = vi.hoisted(() => ({ fetchDailyIndicators: vi.fn() }));
const tradesApi = vi.hoisted(() => ({ fetchTrades: vi.fn() }));
const ordersApi = vi.hoisted(() => ({ fetchOrders: vi.fn() }));
const chartApi = vi.hoisted(() => ({
  createChart: vi.fn(),
  createSeriesMarkers: vi.fn(),
  ColorType: { Solid: "solid" },
  CandlestickSeries: { type: "candlestick" },
  HistogramSeries: { type: "histogram" },
  LineSeries: { type: "line" },
  AreaSeries: { type: "area" },
}));
vi.mock("../api/history", () => historyApi);
vi.mock("../api/indicators", () => indicatorApi);
vi.mock("../api/trades", () => tradesApi);
vi.mock("../api/orders", () => ordersApi);
vi.mock("lightweight-charts", () => chartApi);

type ChartMount = {
  setData: ReturnType<typeof vi.fn>;
  lineModeSetData: ReturnType<typeof vi.fn>;
  areaModeSetData: ReturnType<typeof vi.fn>;
  candleApplyOptions: ReturnType<typeof vi.fn>;
  lineModeApplyOptions: ReturnType<typeof vi.fn>;
  areaModeApplyOptions: ReturnType<typeof vi.fn>;
  volumeSetData: ReturnType<typeof vi.fn>;
  fitContent: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addSeries: ReturnType<typeof vi.fn>;
  candleSeries: { setMarkers: ReturnType<typeof vi.fn> };
  lineModeSeries: { setMarkers: ReturnType<typeof vi.fn> };
  areaModeSeries: { setMarkers: ReturnType<typeof vi.fn> };
  candleSetMarkers: ReturnType<typeof vi.fn>;
  lineModeSetMarkers: ReturnType<typeof vi.fn>;
  areaModeSetMarkers: ReturnType<typeof vi.fn>;
  candleCreatePriceLine: ReturnType<typeof vi.fn>;
  lineModeCreatePriceLine: ReturnType<typeof vi.fn>;
  areaModeCreatePriceLine: ReturnType<typeof vi.fn>;
  candleRemovePriceLine: ReturnType<typeof vi.fn>;
  lineModeRemovePriceLine: ReturnType<typeof vi.fn>;
  areaModeRemovePriceLine: ReturnType<typeof vi.fn>;
};
const mounts: ChartMount[] = [];
const clients: QueryClient[] = [];
const catalog: MarketDataStatus = {
  read_at: READ_AT,
  collection: "disabled",
  coverage_status: "not_verified",
  expected_session_count: null,
  canonical_history: {
    series: [
      { provider: "fixture", adjustment_type: "raw" },
      { provider: "fixture", adjustment_type: "split_adjusted" },
    ],
  },
};

function bar(session: string, open: string, high: string, low: string, close: string): HistoryBar {
  return {
    session_date: session, open, high, low, close, volume: "0", fetched_at: FETCHED_AT,
    provider: "fixture", adjustment_type: "raw", quality_status: "valid",
  };
}

function history(close = "108.500000"): HistoryResponse {
  return {
    symbol: "TEST", interval: "1d", range: "2y", provider: "fixture", adjustment_type: "raw",
    status: "partial", coverage_status: "not_verified", expected_session_count: null, collection: "disabled",
    read_at: READ_AT, requested_start: "2024-11-06", requested_end: "2026-11-06",
    available_start: "2026-11-04", available_end: "2026-11-05", excluded_row_count: 0,
    bars: [
      bar("2026-11-04", "101.250000", "105.500000", "99.500000", "103.750000"),
      bar("2026-11-05", "103.750000", "110.000000", "100.000000", close),
    ],
  };
}

function withOverlays<T extends object>(series: T) {
  return {
    setMarkers: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    ...series,
  };
}

function mountChart() {
  const setData = vi.fn();
  const lineModeSetData = vi.fn();
  const areaModeSetData = vi.fn();
  const candleApplyOptions = vi.fn();
  const lineModeApplyOptions = vi.fn();
  const areaModeApplyOptions = vi.fn();
  const volumeSetData = vi.fn();
  const fitContent = vi.fn();
  const remove = vi.fn();
  const candleSetMarkers = vi.fn();
  const lineModeSetMarkers = vi.fn();
  const areaModeSetMarkers = vi.fn();
  const candleCreatePriceLine = vi.fn((options: unknown) => ({ options }));
  const lineModeCreatePriceLine = vi.fn((options: unknown) => ({ options }));
  const areaModeCreatePriceLine = vi.fn((options: unknown) => ({ options }));
  const candleRemovePriceLine = vi.fn();
  const lineModeRemovePriceLine = vi.fn();
  const areaModeRemovePriceLine = vi.fn();
  const candleSeries = withOverlays({
    setData,
    applyOptions: candleApplyOptions,
    setMarkers: candleSetMarkers,
    createPriceLine: candleCreatePriceLine,
    removePriceLine: candleRemovePriceLine,
  });
  const lineModeSeries = withOverlays({
    setData: lineModeSetData,
    applyOptions: lineModeApplyOptions,
    setMarkers: lineModeSetMarkers,
    createPriceLine: lineModeCreatePriceLine,
    removePriceLine: lineModeRemovePriceLine,
  });
  const areaModeSeries = withOverlays({
    setData: areaModeSetData,
    applyOptions: areaModeApplyOptions,
    setMarkers: areaModeSetMarkers,
    createPriceLine: areaModeCreatePriceLine,
    removePriceLine: areaModeRemovePriceLine,
  });
  const addSeries = vi.fn((kind: unknown, options?: { priceScaleId?: string; color?: string }) => {
    if (options?.priceScaleId === "daily-history-volume") {
      return withOverlays({ setData: volumeSetData, applyOptions: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) });
    }
    if (options?.priceScaleId === "daily-history-rsi") {
      return withOverlays({ setData: vi.fn(), applyOptions: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) });
    }
    if (options?.priceScaleId === "daily-history-macd") {
      return withOverlays({ setData: vi.fn(), applyOptions: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) });
    }
    if (kind === chartApi.AreaSeries) {
      return areaModeSeries;
    }
    if (kind === chartApi.LineSeries && options?.color === "#34d399") {
      return lineModeSeries;
    }
    if (kind === chartApi.CandlestickSeries) {
      return candleSeries;
    }
    return withOverlays({ setData: vi.fn(), applyOptions: vi.fn() });
  });
  mounts.push({
    setData,
    lineModeSetData,
    areaModeSetData,
    candleApplyOptions,
    lineModeApplyOptions,
    areaModeApplyOptions,
    volumeSetData,
    fitContent,
    remove,
    addSeries,
    candleSeries,
    lineModeSeries,
    areaModeSeries,
    candleSetMarkers,
    lineModeSetMarkers,
    areaModeSetMarkers,
    candleCreatePriceLine,
    lineModeCreatePriceLine,
    areaModeCreatePriceLine,
    candleRemovePriceLine,
    lineModeRemovePriceLine,
    areaModeRemovePriceLine,
  });
  return { addSeries, timeScale: () => ({ fitContent }), remove };
}

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DailyHistory />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ticketHrefs() {
  return screen.queryAllByRole("link")
    .map((link) => link.getAttribute("href"))
    .filter((href): href is string => href !== null && href.startsWith("/trades"));
}

function fact(label: string) {
  const value = screen.getByText(label, { selector: "dt" }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`Missing ${label}.`);
  return value.textContent;
}

function fillTest(symbol = "TEST") {
  fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: symbol } });
  fireEvent.change(screen.getByRole("combobox", { name: "Cached series" }), { target: { value: RAW_SERIES } });
}

function chooseRange(range: HistoryRange) {
  fireEvent.change(screen.getByRole("combobox", { name: "Range" }), { target: { value: range } });
}

function submitForm() {
  const form = screen.getByRole("button", { name: "View history" }).closest("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Missing history form.");
  fireEvent.submit(form);
}

function onlyChart() {
  const chart = mounts[0];
  if (chart === undefined || mounts.length !== 1) throw new Error("Expected one chart.");
  return chart;
}

function trade(patch: Partial<TradeResponse> = {}): TradeResponse {
  return {
    id: 1,
    symbol: "TEST",
    asset_type: "stock",
    side: "buy",
    quantity: 5,
    price_at_execution: 103.75,
    notional: 518.75,
    realized_pnl: 0,
    realized_pnl_pct: 0,
    executed_at: "2026-11-04T14:30:00Z",
    ...patch,
  };
}

function order(patch: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: 1,
    symbol: "TEST",
    side: "buy",
    order_type: "limit",
    quantity: 4,
    remaining_quantity: 4,
    limit_price: 190.25,
    status: "open",
    created_at: "2026-11-05T15:00:00Z",
    ...patch,
  };
}

const BUY_MARKER = {
  time: "2026-11-04",
  position: "belowBar",
  shape: "arrowUp",
  color: "#34d399",
  text: "BUY 5",
};
const SELL_MARKER = {
  time: "2026-11-05",
  position: "aboveBar",
  shape: "arrowDown",
  color: "#fb7185",
  text: "SELL 3",
};
const BUY_LINE = {
  price: 190.25,
  color: "#34d399",
  lineStyle: 2,
  lineWidth: 1,
  axisLabelVisible: true,
  title: "BUY limit",
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("DailyHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mounts.length = 0;
    historyApi.fetchCachedSeries.mockReset();
    historyApi.fetchDailyHistory.mockReset();
    indicatorApi.fetchDailyIndicators.mockReset();
    tradesApi.fetchTrades.mockReset();
    tradesApi.fetchTrades.mockResolvedValue({ trades: [] });
    ordersApi.fetchOrders.mockReset();
    ordersApi.fetchOrders.mockResolvedValue({ orders: [] });
    chartApi.createChart.mockReset();
    chartApi.createChart.mockImplementation(mountChart);
    chartApi.createSeriesMarkers.mockReset();
    chartApi.createSeriesMarkers.mockImplementation((series: { setMarkers?: ReturnType<typeof vi.fn> }) => ({
      setMarkers: series?.setMarkers ?? vi.fn(),
      markers: () => [],
      detach: vi.fn(),
    }));
  });
  afterEach(() => {
    cleanup();
    for (const client of clients) client.clear();
    clients.length = 0;
    window.localStorage.clear();
  });

  it("retries a failed catalog into an empty list without history or a chart", async () => {
    historyApi.fetchCachedSeries
      .mockRejectedValueOnce(new Error("catalog down"))
      .mockResolvedValueOnce({ ...catalog, canonical_history: { series: [] } });
    renderHistory();
    expect((await screen.findByRole("alert")).textContent).toBe("Cached series could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No canonical daily series available.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    expect(chartApi.createChart).not.toHaveBeenCalled();
    expect(ticketHrefs()).toEqual([]);
  });

  it("views one explicit series, ignores unsent edits, refreshes in place, and removes on unmount", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValueOnce(history()).mockResolvedValueOnce(history("107.250000"));
    const view = renderHistory();
    expect(await screen.findByRole("textbox", { name: "Symbol" })).toHaveAttribute("id", "daily-history-symbol");
    expect(screen.getByRole("combobox", { name: "Cached series" })).toHaveAttribute("id", "daily-history-series");
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    fillTest();
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    expect(historyApi.fetchDailyHistory.mock.calls).toEqual([["TEST", "fixture", "raw", "2y"]]);
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
    expect(screen.getByText(SHOWING)).toBeInTheDocument();
    expect([fact("Status"), fact("Source"), fact("Coverage"), fact("Expected sessions"), fact("Collection")]).toEqual([
      "Partial", "fixture", "Not verified", "Not verified", "Disabled",
    ]);
    expect(screen.getByText("Session prices")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "101.250000" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "108.500000" })).toBeInTheDocument();
    expect(screen.getByText(/TradingView Lightweight Charts™, Copyright \(\u0441\) 2025 TradingView, Inc\./)).toBeInTheDocument();
    for (const [name, href] of [
      ["https://www.tradingview.com/", "https://www.tradingview.com/"],
      ["lightweight-charts license", "/licenses/lightweight-charts-LICENSE.txt"],
      ["lightweight-charts notice", "/licenses/lightweight-charts-NOTICE.txt"],
      ["fancy-canvas license", "/licenses/fancy-canvas-LICENSE.txt"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(chartApi.createChart.mock.calls[0]?.[1]).toMatchObject({
      autoSize: true,
      layout: { attributionLogo: true, background: { type: chartApi.ColorType.Solid } },
    });
    expect(chart.addSeries.mock.calls[0]?.[0]).toBe(chartApi.CandlestickSeries);
    expect(chart.addSeries.mock.calls[0]?.[1]).toMatchObject({ priceFormat: { precision: 6 } });
    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.addSeries.mock.calls[3]?.[0]).toBe(chartApi.HistogramSeries);
    expect(chart.addSeries.mock.calls[3]?.[1]).toMatchObject({ priceFormat: { type: "volume" } });
    expect(chart.volumeSetData).toHaveBeenCalledWith([
      { time: "2026-11-04", value: 0, color: "rgba(52, 211, 153, 0.5)" },
      { time: "2026-11-05", value: 0, color: "rgba(52, 211, 153, 0.5)" },
    ]);
    expect(screen.getByRole("columnheader", { name: "Volume" })).toBeInTheDocument();
    expect(chart.fitContent).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "MSFT" } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(SHOWING)).toBeInTheDocument();
    expect(screen.getByText("The form has unsent changes. Prices below stay on the last viewed series.")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "108.500000" })).toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1);
    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.fitContent).toHaveBeenCalledTimes(1);
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
    fillTest("TEST");
    submitForm();
    await waitFor(() => expect(screen.getByRole("cell", { name: "107.250000" })).toBeInTheDocument());
    expect(screen.queryByRole("cell", { name: "108.500000" })).not.toBeInTheDocument();
    expect(historyApi.fetchDailyHistory.mock.calls).toEqual([
      ["TEST", "fixture", "raw", "2y"],
      ["TEST", "fixture", "raw", "2y"],
    ]);
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
    expect(chart.volumeSetData).toHaveBeenLastCalledWith([
      { time: "2026-11-04", value: 0, color: "rgba(52, 211, 153, 0.5)" },
      { time: "2026-11-05", value: 0, color: "rgba(52, 211, 153, 0.5)" },
    ]);
    expect(chart.setData).toHaveBeenLastCalledWith([
      { time: "2026-11-04", open: 101.25, high: 105.5, low: 99.5, close: 103.75 },
      { time: "2026-11-05", open: 103.75, high: 110, low: 100, close: 107.25 },
    ]);
    expect(chart.fitContent).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(chart.remove).toHaveBeenCalledTimes(1);
  });

  it("shows the real reviewed-calendar coverage status and expected session count", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValueOnce({
      ...history(),
      coverage_status: "gaps_and_unexpected_sessions",
      expected_session_count: 504,
    });
    renderHistory();
    await screen.findByRole("textbox", { name: "Symbol" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0));
    expect([fact("Coverage"), fact("Expected sessions")]).toEqual([
      "Gaps and unexpected sessions", "504",
    ]);
  });

  it("hides a failed refresh and restores the chart on retry", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory
      .mockResolvedValueOnce(history())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(history());
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Cached daily history could not be loaded.");
    expect(screen.queryByText(PARTIAL)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(ticketHrefs()).toEqual([]);
    await waitFor(() => expect(chart.remove).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(chartApi.createChart).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
  });

  it.each<{ name: string; body: HistoryResponse; alert?: string; status?: string }>([
    { name: "valid unavailable bars", body: { ...history(), status: "unavailable", available_start: null, available_end: null, bars: [] }, status: EMPTY },
    { name: "wrong provider", body: { ...history(), provider: "other" }, alert: MISMATCH },
    { name: "wrong symbol", body: { ...history(), symbol: "MSFT" }, alert: MISMATCH },
    {
      name: "invalid bar",
      body: { ...history(), bars: history().bars.map((entry, index) => (index === 0 ? { ...entry, open: "101.25" } : entry)) },
      alert: PLOT,
    },
  ])("$name does not construct a chart", async ({ body, alert, status }) => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(body);
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    if (alert) expect((await screen.findByRole("alert")).textContent).toBe(alert);
    else {
      expect(await screen.findByText(status ?? "")).toBeInTheDocument();
      expect(fact("Status")).toBe("Unavailable");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
    await act(async () => { await Promise.resolve(); });
    expect(chartApi.createChart).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(PARTIAL)).not.toBeInTheDocument();
    expect(ticketHrefs()).toEqual([]);
  });

  it("links only the viewed canonical symbol after a settled matching history", async () => {
    const symbol = "AT&T";
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    const pending = deferred<HistoryResponse>();
    historyApi.fetchDailyHistory.mockImplementationOnce(() => pending.promise);
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest(symbol);
    submitForm();
    expect(await screen.findByText("Loading cached daily history.")).toBeInTheDocument();
    expect(ticketHrefs()).toEqual([]);
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1);

    const refresh = deferred<HistoryResponse>();
    historyApi.fetchDailyHistory.mockImplementationOnce(() => refresh.promise);
    pending.resolve({ ...history(), symbol });
    await waitFor(() => expect(ticketHrefs()).toEqual([`/trades?symbol=${encodeURIComponent(symbol)}`]));
    expect(screen.getByText(`Showing ${symbol}, source fixture, adjustment raw.`)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "MSFT" } });
    expect(screen.getByText("The form has unsent changes. Prices below stay on the last viewed series.")).toBeInTheDocument();
    expect(ticketHrefs()).toEqual([`/trades?symbol=${encodeURIComponent(symbol)}`]);
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1);

    fillTest(symbol);
    submitForm();
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(2));
    expect(ticketHrefs()).toEqual([]);
    refresh.resolve({ ...history(), symbol });
    await waitFor(() => expect(ticketHrefs()).toEqual([`/trades?symbol=${encodeURIComponent(symbol)}`]));
  });

  it("submits the visible controlled symbol and keeps the accepted series until the next view", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue({ ...history(), symbol: "AAPL" });
    function ControlledHistory() {
      const [value, setValue] = useState("");
      return (
        <>
          <button type="button" onClick={() => setValue("AAPL")}>Prefill AAPL</button>
          <button type="button" onClick={() => setValue("MSFT")}>Prefill MSFT</button>
          <DailyHistory onValueChange={setValue} value={value} />
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <MemoryRouter>
          <ControlledHistory />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = await screen.findByRole("textbox", { name: "Symbol" });
    fireEvent.change(input, { target: { value: "OLD" } });
    fireEvent.click(screen.getByRole("button", { name: "Prefill AAPL" }));
    expect(input).toHaveValue("AAPL");
    fireEvent.change(input, { target: { value: "EDITED" } });
    fireEvent.click(screen.getByRole("button", { name: "Prefill AAPL" }));
    expect(input).toHaveValue("AAPL");
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Cached series" }), { target: { value: RAW_SERIES } });
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    submitForm();
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1));
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("AAPL", "fixture", "raw", "2y");
    expect(await screen.findByText("Showing AAPL, source fixture, adjustment raw.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Cached series" })).toHaveValue(RAW_SERIES);
    expect(ticketHrefs()).toEqual(["/trades?symbol=AAPL"]);
    fireEvent.change(input, { target: { value: "EDITED" } });
    fireEvent.click(screen.getByRole("button", { name: "Prefill MSFT" }));
    fireEvent.click(screen.getByRole("button", { name: "Prefill MSFT" }));
    expect(input).toHaveValue("MSFT");
    expect(screen.getByRole("combobox", { name: "Cached series" })).toHaveValue(RAW_SERIES);
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Showing AAPL, source fixture, adjustment raw.")).toBeInTheDocument();
    expect(fact("Source")).toBe("fixture");
    expect(ticketHrefs()).toEqual(["/trades?symbol=AAPL"]);
    expect(screen.queryByText(/order preview|trade preview/i)).not.toBeInTheDocument();
  });

  it("requests one year of daily history when that range is selected", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    renderHistory();
    expect(await screen.findByRole("combobox", { name: "Range" })).toHaveAttribute("id", "daily-history-range");
    expect(screen.getByRole("combobox", { name: "Range" })).toHaveValue("2y");
    fillTest();
    chooseRange("1y");
    submitForm();
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1));
    expect(historyApi.fetchDailyHistory.mock.calls).toEqual([["TEST", "fixture", "raw", "1y"]]);
  });

  it.each([
    ["1m", "1 month"],
    ["3m", "3 months"],
    ["6m", "6 months"],
    ["all", "All"],
  ] as const)("requests daily history for the %s range when that option is selected", async (range, label) => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    renderHistory();
    expect(await screen.findByRole("combobox", { name: "Range" })).toHaveAttribute("id", "daily-history-range");
    expect(screen.getByRole("combobox", { name: "Range" })).toHaveValue("2y");
    expect(screen.getByRole("option", { name: label })).toHaveValue(range);
    fillTest();
    chooseRange(range);
    submitForm();
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1));
    expect(historyApi.fetchDailyHistory.mock.calls).toEqual([["TEST", "fixture", "raw", range]]);
  });

  it("defaults to candlestick and leaves that price series visible", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    renderHistory();
    const chartType = await screen.findByRole("combobox", { name: "Chart type" });
    expect(chartType).toHaveValue("candlestick");
    expect(chartType.closest("form")).toBeNull();
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    expect(chart.addSeries.mock.calls[0]?.[0]).toBe(chartApi.CandlestickSeries);
    expect(chart.setData).toHaveBeenCalledWith([
      { time: "2026-11-04", open: 101.25, high: 105.5, low: 99.5, close: 103.75 },
      { time: "2026-11-05", open: 103.75, high: 110, low: 100, close: 108.5 },
    ]);
    expect(chart.candleApplyOptions).toHaveBeenLastCalledWith({ visible: true });
    expect(chart.lineModeApplyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(chart.areaModeApplyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(screen.getByRole("combobox", { name: "Chart type" })).toHaveValue("candlestick");
  });

  it("plots close prices on the line series and hides candlesticks", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    fireEvent.change(screen.getByRole("combobox", { name: "Chart type" }), { target: { value: "line" } });
    expect(chart.lineModeSetData).toHaveBeenCalledWith([
      { time: "2026-11-04", value: 103.75 },
      { time: "2026-11-05", value: 108.5 },
    ]);
    expect(chart.lineModeApplyOptions).toHaveBeenLastCalledWith({ visible: true });
    expect(chart.candleApplyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(chart.areaModeApplyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
    expect(chart.volumeSetData).toHaveBeenLastCalledWith([
      { time: "2026-11-04", value: 0, color: "rgba(52, 211, 153, 0.5)" },
      { time: "2026-11-05", value: 0, color: "rgba(52, 211, 153, 0.5)" },
    ]);
  });

  it("plots close prices on the area series and hides the other price series", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    fireEvent.change(screen.getByRole("combobox", { name: "Chart type" }), { target: { value: "area" } });
    expect(chart.areaModeSetData).toHaveBeenCalledWith([
      { time: "2026-11-04", value: 103.75 },
      { time: "2026-11-05", value: 108.5 },
    ]);
    expect(chart.areaModeApplyOptions).toHaveBeenLastCalledWith({ visible: true });
    expect(chart.candleApplyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(chart.lineModeApplyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(chart.addSeries.mock.calls.some((call) => call[0] === chartApi.AreaSeries)).toBe(true);
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
  });

  it("does not refetch history when the chart type changes", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mounts).toHaveLength(1));
    const callsBefore = historyApi.fetchDailyHistory.mock.calls.length;
    fireEvent.change(screen.getByRole("combobox", { name: "Chart type" }), { target: { value: "line" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Chart type" }), { target: { value: "area" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Chart type" }), { target: { value: "candlestick" } });
    await act(async () => { await Promise.resolve(); });
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledTimes(callsBefore);
    expect(historyApi.fetchDailyHistory.mock.calls).toEqual([["TEST", "fixture", "raw", "2y"]]);
    expect(indicatorApi.fetchDailyIndicators).not.toHaveBeenCalled();
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
  });

  it("initializes range, indicator, period, and chart type from stored preferences", async () => {
    saveChartPreferences({ range: "6m", indicator: "ema", period: "50", chartType: "area" });
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    renderHistory();
    expect(await screen.findByRole("combobox", { name: "Range" })).toHaveValue("6m");
    expect(screen.getByRole("combobox", { name: "Indicator" })).toHaveValue("ema");
    expect(screen.getByRole("spinbutton", { name: "Period" })).toHaveValue(50);
    expect(screen.getByRole("combobox", { name: "Chart type" })).toHaveValue("area");
    expect(screen.getByRole("textbox", { name: "Symbol" })).toHaveValue("");
  });

  it("saves a range change under the chart preferences key", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    renderHistory();
    const range = await screen.findByRole("combobox", { name: "Range" });
    expect(range).toHaveValue("2y");
    fireEvent.change(range, { target: { value: "1y" } });
    const raw = window.localStorage.getItem(CHART_PREFERENCES_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "")).toEqual({
      range: "1y",
      indicator: "none",
      period: "20",
      chartType: "candlestick",
    });
  });

  it("marks buy and sell executions on the loaded session dates for every price series", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    tradesApi.fetchTrades.mockResolvedValue({
      trades: [
        trade({ id: 1, side: "buy", quantity: 5, executed_at: "2026-11-04T14:30:00Z" }),
        trade({ id: 2, side: "sell", quantity: 3, executed_at: "2026-11-05T20:15:00Z" }),
        trade({ id: 3, symbol: "MSFT", side: "buy", quantity: 9, executed_at: "2026-11-04T14:30:00Z" }),
      ],
    });
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    const markers = [BUY_MARKER, SELL_MARKER];
    await waitFor(() => expect(chart.candleSetMarkers).toHaveBeenLastCalledWith(markers));
    expect(chart.lineModeSetMarkers).toHaveBeenLastCalledWith(markers);
    expect(chart.areaModeSetMarkers).toHaveBeenLastCalledWith(markers);
    expect(chartApi.createSeriesMarkers).toHaveBeenCalledWith(chart.candleSeries, []);
    expect(chartApi.createSeriesMarkers).toHaveBeenCalledWith(chart.lineModeSeries, []);
    expect(chartApi.createSeriesMarkers).toHaveBeenCalledWith(chart.areaModeSeries, []);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily price chart unavailable.")).not.toBeInTheDocument();
  });

  it("skips a trade whose session date has no loaded candle", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    tradesApi.fetchTrades.mockResolvedValue({
      trades: [trade({ id: 8, executed_at: "2020-01-01T00:00:00Z", quantity: 7 })],
    });
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    await waitFor(() => expect(tradesApi.fetchTrades).toHaveBeenCalled());
    await act(async () => {
      await tradesApi.fetchTrades.mock.results[0]?.value;
    });
    await waitFor(() => expect(chart.candleSetMarkers).toHaveBeenLastCalledWith([]));
    expect(chart.lineModeSetMarkers).toHaveBeenLastCalledWith([]);
    expect(chart.areaModeSetMarkers).toHaveBeenLastCalledWith([]);
    for (const call of chart.candleSetMarkers.mock.calls) {
      expect(call[0]).not.toEqual(expect.arrayContaining([expect.objectContaining({ time: "2020-01-01", text: "BUY 7" })]));
    }
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily price chart unavailable.")).not.toBeInTheDocument();
  });

  it("draws one dashed price line per open limit order on every price series", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    ordersApi.fetchOrders.mockResolvedValue({ orders: [order()] });
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    await waitFor(() => expect(chart.candleCreatePriceLine).toHaveBeenCalledWith(BUY_LINE));
    expect(chart.lineModeCreatePriceLine).toHaveBeenCalledWith(BUY_LINE);
    expect(chart.areaModeCreatePriceLine).toHaveBeenCalledWith(BUY_LINE);
  });

  it("removes the previous open-order price line before drawing the replacement", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    ordersApi.fetchOrders.mockResolvedValue({ orders: [order()] });
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = onlyChart();
    await waitFor(() => expect(chart.candleCreatePriceLine).toHaveBeenCalledWith(BUY_LINE));
    const firstLine = chart.candleCreatePriceLine.mock.results[0]?.value;
    const firstLineModeLine = chart.lineModeCreatePriceLine.mock.results[0]?.value;
    const firstAreaLine = chart.areaModeCreatePriceLine.mock.results[0]?.value;
    const sellLine = {
      price: 210,
      color: "#fb7185",
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: "SELL limit",
    };
    ordersApi.fetchOrders.mockResolvedValue({
      orders: [order({ id: 2, side: "sell", limit_price: 210 })],
    });
    submitForm();
    await waitFor(() => expect(chart.candleRemovePriceLine).toHaveBeenCalledWith(firstLine));
    expect(chart.lineModeRemovePriceLine).toHaveBeenCalledWith(firstLineModeLine);
    expect(chart.areaModeRemovePriceLine).toHaveBeenCalledWith(firstAreaLine);
    await waitFor(() => expect(chart.candleCreatePriceLine).toHaveBeenCalledWith(sellLine));
    expect(chart.lineModeCreatePriceLine).toHaveBeenCalledWith(sellLine);
    expect(chart.areaModeCreatePriceLine).toHaveBeenCalledWith(sellLine);
    const candleRemoveAt = chart.candleRemovePriceLine.mock.invocationCallOrder[0];
    const candleCreateAt = chart.candleCreatePriceLine.mock.invocationCallOrder.at(-1);
    expect(candleRemoveAt).toBeLessThan(candleCreateAt ?? 0);
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);

    ordersApi.fetchOrders.mockResolvedValue({ orders: [] });
    const createsBeforeClear = chart.candleCreatePriceLine.mock.calls.length;
    submitForm();
    await waitFor(() => expect(chart.candleCreatePriceLine.mock.results.at(-1)?.value).toBeDefined());
    const replacement = chart.candleCreatePriceLine.mock.results.at(-1)?.value;
    await waitFor(() => expect(chart.candleRemovePriceLine).toHaveBeenCalledWith(replacement));
    expect(chart.candleCreatePriceLine).toHaveBeenCalledTimes(createsBeforeClear);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily price chart unavailable.")).not.toBeInTheDocument();
  });

  it("ignores orders that are not open limits for the shown symbol", async () => {
    historyApi.fetchCachedSeries.mockResolvedValue(catalog);
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    ordersApi.fetchOrders.mockResolvedValue({
      orders: [
        order({ id: 1, symbol: "MSFT", limit_price: 10 }),
        order({ id: 2, symbol: "TEST", order_type: "market", limit_price: null, status: "open" }),
        order({ id: 3, symbol: "TEST", status: "filled", limit_price: 20 }),
        order({ id: 4, symbol: "TEST", status: "canceled", limit_price: 30 }),
      ],
    });
    renderHistory();
    await screen.findByRole("button", { name: "View history" });
    fillTest();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    await waitFor(() => expect(ordersApi.fetchOrders).toHaveBeenCalled());
    await act(async () => {
      await ordersApi.fetchOrders.mock.results[0]?.value;
    });
    const chart = onlyChart();
    expect(chart.candleCreatePriceLine).not.toHaveBeenCalled();
    expect(chart.lineModeCreatePriceLine).not.toHaveBeenCalled();
    expect(chart.areaModeCreatePriceLine).not.toHaveBeenCalled();
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily price chart unavailable.")).not.toBeInTheDocument();
  });
});
