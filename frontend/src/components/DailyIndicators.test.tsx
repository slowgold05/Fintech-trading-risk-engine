import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryBar, HistoryResponse } from "../api/history";
import { DailyHistory } from "./DailyHistory";
import { indicatorOverlay } from "./historyData";

const READ_AT = "2026-11-06T12:00:00Z";
const FETCHED_AT = "2026-11-06T11:00:00Z";
const RAW_SERIES = JSON.stringify(["fixture", "raw"]);
const DATES = ["2026-01-02", "2026-01-06", "2026-01-09", "2026-01-13", "2026-01-16", "2026-01-21"] as const;
const CLOSES = ["1.000000", "4.000000", "2.000000", "8.000000", "3.000000", "9.000000"] as const;
const SMA3 = [null, null, "2.333333", "4.666667", "4.333333", "6.666667"] as const;
const RSI3 = [null, null, null, "57.915021", "40.000000", "60.000000"] as const;
const PERIOD_ERROR = "Enter a whole period from 2 to 200.";

const historyApi = vi.hoisted(() => ({ fetchCachedSeries: vi.fn(), fetchDailyHistory: vi.fn() }));
const indicatorApi = vi.hoisted(() => ({ fetchDailyIndicators: vi.fn() }));
const chartApi = vi.hoisted(() => ({
  createChart: vi.fn(),
  ColorType: { Solid: "solid" },
  CandlestickSeries: { type: "candlestick-sentinel" },
  LineSeries: { type: "line-sentinel" },
  HistogramSeries: { type: "histogram-sentinel" },
}));
vi.mock("../api/history", () => historyApi);
vi.mock("../api/indicators", () => indicatorApi);
vi.mock("lightweight-charts", () => chartApi);

type ChartMount = {
  candleSetData: ReturnType<typeof vi.fn>;
  volumeSetData: ReturnType<typeof vi.fn>;
  lineSetData: ReturnType<typeof vi.fn>;
  rsiSetData: ReturnType<typeof vi.fn>;
  fitContent: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addSeries: ReturnType<typeof vi.fn>;
};
type PointValue = string | null;

const mounts: ChartMount[] = [];
const clients: QueryClient[] = [];

function bar(session: string, close: string): HistoryBar {
  return {
    session_date: session, open: close, high: close, low: close, close, volume: "1",
    fetched_at: FETCHED_AT, provider: "fixture", adjustment_type: "raw", quality_status: "valid",
  };
}

function history(closes: readonly string[] = CLOSES): HistoryResponse {
  const bars = DATES.map((session, index) => bar(session, closes[index] ?? CLOSES[index] ?? "1.000000"));
  return {
    symbol: "TEST", interval: "1d", range: "2y", provider: "fixture", adjustment_type: "raw",
    status: "partial", coverage_status: "not_verified", expected_session_count: null, collection: "disabled",
    read_at: READ_AT, requested_start: "2024-11-06", requested_end: "2026-11-06",
    available_start: DATES[0], available_end: DATES[DATES.length - 1], excluded_row_count: 0, bars,
  };
}

function indicatorPayload(
  name: "sma" | "ema" | "rsi",
  period: number,
  values: readonly PointValue[],
  closes: readonly string[] = CLOSES,
) {
  const nested = history(closes);
  const count = nested.bars.length;
  const required = name === "rsi" ? period + 1 : period;
  const status = count < required ? "insufficient" : "partial";
  return {
    ...nested,
    name,
    period,
    source: "observed_valid_closes",
    observed_valid_closes: count,
    session_basis: "not_exchange_sessions",
    status,
    points: DATES.map((session_date, index) => ({ session_date: String(session_date), value: values[index] ?? null })),
    history: nested,
  };
}

function mountChart() {
  const candleSetData = vi.fn();
  const volumeSetData = vi.fn();
  const lineSetData = vi.fn();
  const rsiSetData = vi.fn();
  const fitContent = vi.fn();
  const remove = vi.fn();
  const addSeries = vi.fn((kind: unknown, options?: { priceScaleId?: string }) => {
    if (kind === chartApi.LineSeries && options?.priceScaleId === "daily-history-rsi") {
      return { setData: rsiSetData, priceScale: () => ({ applyOptions: vi.fn() }) };
    }
    if (kind === chartApi.LineSeries) return { setData: lineSetData };
    if (kind === chartApi.CandlestickSeries) return { setData: candleSetData };
    if (kind === chartApi.HistogramSeries) {
      return { setData: volumeSetData, priceScale: () => ({ applyOptions: vi.fn() }) };
    }
    throw new Error("Unexpected series.");
  });
  mounts.push({ candleSetData, volumeSetData, lineSetData, rsiSetData, fitContent, remove, addSeries });
  return { addSeries, timeScale: () => ({ fitContent }), remove };
}

function renderHistory(ui: ReactNode = <DailyHistory />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function submitForm() {
  const form = screen.getByRole("button", { name: "View history" }).closest("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Missing history form.");
  fireEvent.submit(form);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function chooseSeries(symbol = "test") {
  fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: symbol } });
  fireEvent.change(screen.getByRole("combobox", { name: "Cached series" }), { target: { value: RAW_SERIES } });
}

function chooseIndicator(name: "sma" | "ema" | "rsi" | "none", period?: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Indicator" }), { target: { value: name } });
  if (period !== undefined) {
    fireEvent.change(screen.getByRole("spinbutton", { name: "Period" }), { target: { value: period } });
  }
}

function chooseRange(range: "1y" | "2y") {
  fireEvent.change(screen.getByRole("combobox", { name: "Range" }), { target: { value: range } });
}

async function ready() {
  historyApi.fetchCachedSeries.mockResolvedValue({
    read_at: READ_AT, collection: "disabled", coverage_status: "not_verified", expected_session_count: null,
    canonical_history: { series: [{ provider: "fixture", adjustment_type: "raw" }] },
  });
  renderHistory(
    <ControlledHistory />,
  );
  expect(await screen.findByRole("textbox", { name: "Symbol" })).toHaveAttribute("id", "daily-history-symbol");
  expect(screen.getByRole("combobox", { name: "Cached series" })).toHaveAttribute("id", "daily-history-series");
  expect(screen.getByRole("combobox", { name: "Indicator" })).toHaveAttribute("id", "daily-history-indicator");
}

function ControlledHistory() {
  const [value, setValue] = useState("");
  return <DailyHistory onValueChange={setValue} value={value} />;
}

function linePoints(chart: ChartMount) {
  const points = chart.lineSetData.mock.calls.at(-1)?.[0];
  if (!Array.isArray(points)) throw new Error("Missing line data.");
  return points as { time: string; value?: number }[];
}

function rsiPoints(chart: ChartMount) {
  const points = chart.rsiSetData.mock.calls.at(-1)?.[0];
  if (!Array.isArray(points)) throw new Error("Missing RSI data.");
  return points as { time: string; value?: number }[];
}

function openSessionPrices() {
  const prices = screen.getByText("Session prices").closest("details");
  if (prices instanceof HTMLDetailsElement && !prices.open) fireEvent.click(screen.getByText("Session prices"));
}

function cachedBundle(name: "sma" | "ema" | "rsi", period: number, values: readonly PointValue[]) {
  const payload = indicatorPayload(name, period, values);
  const overlay = indicatorOverlay(payload, {
    symbol: "TEST",
    provider: "fixture",
    adjustment_type: "raw",
    name,
    period,
  });
  return { history: overlay.history, overlay };
}

describe("DailyIndicators", () => {
  beforeEach(() => {
    mounts.length = 0;
    historyApi.fetchCachedSeries.mockReset();
    historyApi.fetchDailyHistory.mockReset();
    indicatorApi.fetchDailyIndicators.mockReset();
    chartApi.createChart.mockReset();
    chartApi.createChart.mockImplementation(mountChart);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    for (const client of clients) client.clear();
    clients.length = 0;
  });

  it("submits one explicit SMA request and plots warmup whitespace from the real helper", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma");
    const period = screen.getByRole("spinbutton", { name: "Period" });
    expect(period).toHaveAttribute("id", "daily-history-period");
    expect(period).toHaveValue(20);
    fireEvent.change(period, { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "msft" } });
    expect(indicatorApi.fetchDailyIndicators).not.toHaveBeenCalled();
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "test" } });
    indicatorApi.fetchDailyIndicators.mockResolvedValue(indicatorPayload("sma", 3, SMA3));
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = mounts[0];
    if (chart === undefined) throw new Error("Missing chart.");
    expect(indicatorApi.fetchDailyIndicators.mock.calls).toEqual([["TEST", "fixture", "raw", "2y", "sma", 3]]);
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    expect(chart.addSeries.mock.calls.map((call) => call[0])).toEqual([
      chartApi.CandlestickSeries,
      chartApi.HistogramSeries,
      chartApi.LineSeries,
      chartApi.LineSeries,
    ]);
    const line = linePoints(chart);
    expect(line.slice(0, 2)).toEqual([{ time: DATES[0] }, { time: DATES[1] }]);
    expect(line[0]).not.toHaveProperty("value");
    expect(line[1]).not.toHaveProperty("value");
    expect(line.slice(2).map((point) => point.value)).toEqual(SMA3.slice(2).map(Number));
    fireEvent.click(screen.getByText("Session prices"));
    expect(screen.getByRole("columnheader", { name: "SMA (3)" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Warm-up" })).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "2.333333" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trade this symbol" })).toHaveAttribute("href", "/trades?symbol=TEST");
    expect(screen.getByText(/TradingView Lightweight Charts™, Copyright \(\u0441\) 2025 TradingView, Inc\./)).toBeInTheDocument();
  });

  it("refetches the captured SMA fields on the same chart and ignores later drafts", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma", "3");
    const pending = deferred<unknown>();
    indicatorApi.fetchDailyIndicators.mockImplementationOnce(() => pending.promise);
    submitForm();
    expect(await screen.findByText("Loading cached daily history.")).toBeInTheDocument();
    pending.resolve(indicatorPayload("sma", 3, SMA3));
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = mounts[0];
    if (chart === undefined) throw new Error("Missing chart.");
    fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "MSFT" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Period" }), { target: { value: "8" } });
    await act(async () => { await Promise.resolve(); });
    expect(indicatorApi.fetchDailyIndicators).toHaveBeenCalledTimes(1);
    expect(screen.getByText("The form has unsent changes. Prices below stay on the last viewed series.")).toBeInTheDocument();
    chooseSeries();
    chooseIndicator("sma", "3");
    const refresh = deferred<unknown>();
    indicatorApi.fetchDailyIndicators.mockImplementationOnce(() => refresh.promise);
    submitForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "MSFT" } });
    const nextCloses = ["1.000000", "4.000000", "2.000000", "8.000000", "3.000000", "7.000000"];
    const nextSma = [null, null, "2.333333", "4.666667", "4.333333", "6.000000"] as const;
    refresh.resolve(indicatorPayload("sma", 3, nextSma, nextCloses));
    const prices = screen.getByText("Session prices").closest("details");
    if (prices instanceof HTMLDetailsElement && !prices.open) fireEvent.click(screen.getByText("Session prices"));
    await waitFor(() => expect(screen.getAllByRole("cell", { name: "7.000000" })).toHaveLength(4));
    expect(indicatorApi.fetchDailyIndicators.mock.calls).toEqual([
      ["TEST", "fixture", "raw", "2y", "sma", 3],
      ["TEST", "fixture", "raw", "2y", "sma", 3],
    ]);
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
    expect(chart.addSeries).toHaveBeenCalledTimes(4);
    expect(chart.candleSetData).toHaveBeenLastCalledWith(expect.arrayContaining([{ time: DATES[5], open: 7, high: 7, low: 7, close: 7 }]));
    expect(linePoints(chart).at(-1)).toEqual({ time: DATES[5], value: 6 });
    expect(chart.remove).not.toHaveBeenCalled();
  });

  it("draws candles and warmup whitespace when period 20 exceeds the stored closes", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma", "20");
    indicatorApi.fetchDailyIndicators.mockResolvedValue(indicatorPayload("sma", 20, DATES.map(() => null)));
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = mounts[0];
    if (chart === undefined) throw new Error("Missing chart.");
    expect(await screen.findByText("Insufficient stored closes for this period. No indicator curve is drawn.")).toBeInTheDocument();
    expect(screen.getByText("Warm-up: the first 19 observed stored closes have no indicator value.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Session prices"));
    expect(screen.getAllByRole("cell", { name: "Warm-up" })).toHaveLength(DATES.length);
    const line = linePoints(chart);
    expect(line).toHaveLength(DATES.length);
    expect(line.every((point) => !Object.hasOwn(point, "value"))).toBe(true);
    const candles = chart.candleSetData.mock.calls[0]?.[0] as { open: number; high: number; low: number; close: number }[];
    expect(candles).toHaveLength(DATES.length);
    expect(candles.every((point) => point.open > 0 && point.high > 0 && point.low > 0 && point.close > 0)).toBe(true);
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
  });

  it("rejects a malformed indicator body, drops the chart on a later error, and retries once", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma", "3");
    const malformed = indicatorPayload("sma", 3, SMA3);
    malformed.points[2] = { session_date: "2026-01-08", value: "2.333333" };
    indicatorApi.fetchDailyIndicators
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(indicatorPayload("sma", 3, SMA3))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(indicatorPayload("sma", 3, SMA3));
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Cached daily history could not be loaded.");
    await act(async () => { await Promise.resolve(); });
    expect(chartApi.createChart).not.toHaveBeenCalled();
    expect(mounts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = mounts[0];
    if (chart === undefined) throw new Error("Missing chart.");
    expect(chart.candleSetData).toHaveBeenCalledTimes(1);
    expect(chart.lineSetData).toHaveBeenCalledTimes(1);
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe("Cached daily history could not be loaded.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "SMA (3)" })).not.toBeInTheDocument();
    await waitFor(() => expect(chart.remove).toHaveBeenCalledTimes(1));
    expect(chart.candleSetData).toHaveBeenCalledTimes(1);
    expect(chart.lineSetData).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(chartApi.createChart).toHaveBeenCalledTimes(2));
    expect(indicatorApi.fetchDailyIndicators).toHaveBeenCalledTimes(4);
    expect(indicatorApi.fetchDailyIndicators.mock.calls[3]).toEqual(["TEST", "fixture", "raw", "2y", "sma", 3]);
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
    const prices = screen.getByText("Session prices").closest("details");
    if (prices instanceof HTMLDetailsElement && !prices.open) fireEvent.click(screen.getByText("Session prices"));
    expect(screen.getAllByRole("cell", { name: "9.000000" })).toHaveLength(4);
  });

  it("returns to legacy history, drops the previous line, and removes every chart on unmount", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma", "7");
    indicatorApi.fetchDailyIndicators.mockResolvedValue(indicatorPayload("sma", 7, DATES.map(() => null)));
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    historyApi.fetchDailyHistory.mockResolvedValue(history());
    chooseIndicator("none");
    expect(screen.queryByRole("spinbutton", { name: "Period" })).not.toBeInTheDocument();
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(historyApi.fetchDailyHistory.mock.calls).toEqual([["TEST", "fixture", "raw", "2y"]]);
    expect(indicatorApi.fetchDailyIndicators.mock.calls).toEqual([["TEST", "fixture", "raw", "2y", "sma", 7]]);
    const [previous, current] = mounts;
    if (previous === undefined || current === undefined) throw new Error("Missing charts.");
    expect(previous.remove).toHaveBeenCalledTimes(1);
    expect(current.addSeries.mock.calls.map((call) => call[0])).toEqual([
      chartApi.CandlestickSeries,
      chartApi.HistogramSeries,
      chartApi.LineSeries,
    ]);
    expect(current.addSeries.mock.calls[2]?.[1]).toMatchObject({ priceScaleId: "daily-history-rsi" });
    expect(current.lineSetData).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const prices = screen.getByText("Session prices").closest("details");
    if (prices instanceof HTMLDetailsElement && !prices.open) fireEvent.click(screen.getByText("Session prices"));
    expect(screen.getAllByRole("cell", { name: "9.000000" })).toHaveLength(4);
    expect(screen.queryByRole("columnheader", { name: /SMA|EMA/ })).not.toBeInTheDocument();
    const view = screen.getByRole("heading", { name: "Daily price history" });
    expect(view).toBeInTheDocument();
    cleanup();
    expect(previous.remove).toHaveBeenCalledTimes(1);
    expect(current.remove).toHaveBeenCalledTimes(1);
  });

  it("blocks empty, low, high, and fractional periods before either history request", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma");
    const period = screen.getByRole("spinbutton", { name: "Period" });
    for (const value of ["", "1", "201", "3.5"]) {
      fireEvent.change(period, { target: { value } });
      submitForm();
      expect(await screen.findByRole("alert")).toHaveTextContent(PERIOD_ERROR);
      expect(period).toHaveAttribute("aria-invalid", "true");
      expect(indicatorApi.fetchDailyIndicators).not.toHaveBeenCalled();
      expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
      expect(chartApi.createChart).not.toHaveBeenCalled();
    }
  });

  it("plots RSI on its own price scale and labels the session column", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("rsi", "3");
    indicatorApi.fetchDailyIndicators.mockResolvedValue(indicatorPayload("rsi", 3, RSI3));
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = mounts[0];
    if (chart === undefined) throw new Error("Missing chart.");
    const rsiSeries = chart.addSeries.mock.calls.filter((call) => call[1]?.priceScaleId === "daily-history-rsi");
    expect(rsiSeries).toHaveLength(1);
    expect(rsiSeries[0]?.[0]).toBe(chartApi.LineSeries);
    expect(chart.lineSetData).not.toHaveBeenCalled();
    const line = rsiPoints(chart);
    expect(line.slice(0, 3)).toEqual(DATES.slice(0, 3).map((time) => ({ time })));
    expect(line.slice(0, 3).every((point) => !Object.hasOwn(point, "value"))).toBe(true);
    expect(line.slice(3).map((point) => point.value)).toEqual(RSI3.slice(3).map(Number));
    expect(screen.getByText("Warm-up: the first 3 observed stored closes have no indicator value.")).toBeInTheDocument();
    openSessionPrices();
    expect(screen.getByRole("columnheader", { name: "RSI (3)" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Warm-up" })).toHaveLength(3);
    expect(screen.getByRole("cell", { name: "57.915021" })).toBeInTheDocument();
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
  });

  it("clears the inactive series when SMA and RSI swap on the same chart", async () => {
    await ready();
    chooseSeries();
    chooseIndicator("sma", "3");
    indicatorApi.fetchDailyIndicators.mockImplementation((_symbol: unknown, _provider: unknown, _adjustment: unknown, _range: unknown, name: unknown) => {
      if (name === "rsi") return Promise.resolve(indicatorPayload("rsi", 3, RSI3));
      return Promise.resolve(indicatorPayload("sma", 3, SMA3));
    });
    submitForm();
    await waitFor(() => expect(mounts).toHaveLength(1));
    const chart = mounts[0];
    if (chart === undefined) throw new Error("Missing chart.");
    expect(linePoints(chart).slice(2).map((point) => point.value)).toEqual(SMA3.slice(2).map(Number));
    expect(rsiPoints(chart)).toEqual([]);
    const client = clients[0];
    if (client === undefined) throw new Error("Missing query client.");
    // The next indicator is already cached, so the chart stays mounted instead of
    // unmounting while a cold query is pending. That is the in-place swap.
    client.setQueryData(
      ["market", "history", "TEST", "fixture", "raw", "1d", "2y", "rsi", 3],
      cachedBundle("rsi", 3, RSI3),
    );
    chooseIndicator("rsi", "3");
    submitForm();
    openSessionPrices();
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "RSI (3)" })).toBeInTheDocument());
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
    expect(mounts).toHaveLength(1);
    expect(chart.lineSetData).toHaveBeenLastCalledWith([]);
    const rsiLine = rsiPoints(chart);
    expect(rsiLine.slice(3).map((point) => point.value)).toEqual(RSI3.slice(3).map(Number));
    expect(screen.queryByRole("columnheader", { name: "SMA (3)" })).not.toBeInTheDocument();
    client.setQueryData(
      ["market", "history", "TEST", "fixture", "raw", "1d", "2y", "sma", 3],
      cachedBundle("sma", 3, SMA3),
    );
    chooseIndicator("sma", "3");
    submitForm();
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "SMA (3)" })).toBeInTheDocument());
    expect(chartApi.createChart).toHaveBeenCalledTimes(1);
    expect(mounts).toHaveLength(1);
    expect(chart.rsiSetData).toHaveBeenLastCalledWith([]);
    expect(linePoints(chart).slice(2).map((point) => point.value)).toEqual(SMA3.slice(2).map(Number));
    expect(chart.remove).not.toHaveBeenCalled();
  });

  it("requests a one-year window when that range is selected with an indicator", async () => {
    await ready();
    chooseSeries();
    chooseRange("1y");
    chooseIndicator("sma", "3");
    expect(screen.getByRole("combobox", { name: "Range" })).toHaveAttribute("id", "daily-history-range");
    indicatorApi.fetchDailyIndicators.mockResolvedValue(indicatorPayload("sma", 3, SMA3));
    submitForm();
    await waitFor(() => expect(indicatorApi.fetchDailyIndicators).toHaveBeenCalledTimes(1));
    expect(indicatorApi.fetchDailyIndicators.mock.calls).toEqual([["TEST", "fixture", "raw", "1y", "sma", 3]]);
    expect(historyApi.fetchDailyHistory).not.toHaveBeenCalled();
  });
});
