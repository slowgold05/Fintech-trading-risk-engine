import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexComparisonChart } from "./IndexComparisonChart";

const historyApi = vi.hoisted(() => ({ fetchDailyHistory: vi.fn() }));
const chartApi = vi.hoisted(() => ({
  createChart: vi.fn(),
  ColorType: { Solid: "solid" },
  LineSeries: { type: "line" },
}));
vi.mock("../api/history", () => historyApi);
vi.mock("lightweight-charts", () => chartApi);

function history(
  symbol: string,
  closes: string[],
  dates: string[],
  status: "partial" | "unavailable" = "partial",
  coverage?: "complete" | "gaps" | "gaps_and_unexpected_sessions",
) {
  return {
    symbol,
    interval: "1d",
    range: "1m",
    provider: "massive",
    adjustment_type: "split_adjusted",
    status,
    coverage_status: coverage ?? (dates.length > 1 && dates[1] === "2026-11-09" ? "gaps" : "complete"),
    expected_session_count: closes.length,
    collection: "disabled",
    read_at: "2026-11-13T00:00:00Z",
    requested_start: "2026-10-13",
    requested_end: "2026-11-13",
    available_start: status === "unavailable" ? null : dates[0] ?? null,
    available_end: status === "unavailable" ? null : dates[dates.length - 1] ?? null,
    excluded_row_count: 0,
    bars: closes.map((close, index) => ({
      session_date: dates[index],
      open: close,
      high: close,
      low: close,
      close,
      volume: "100",
      fetched_at: "2026-11-13T00:00:00Z",
      provider: "massive",
      adjustment_type: "split_adjusted",
      quality_status: "valid",
    })),
  };
}

function renderChart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IndexComparisonChart range="1m" />
    </QueryClientProvider>,
  );
}

describe("IndexComparisonChart", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("plots normalized closes, names gaps, and lists an unavailable proxy", async () => {
    const setData = vi.fn();
    chartApi.createChart.mockImplementation(() => ({
      addSeries: () => ({ setData }),
      subscribeCrosshairMove: (listener: (param: { time?: string; seriesData: Map<unknown, { value?: number }> }) => void) => {
        listener({ time: "2026-11-04", seriesData: new Map([[{}, { value: 10 }]]) });
      },
      timeScale: () => ({ fitContent: vi.fn() }),
      remove: vi.fn(),
    }));
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string) => {
      if (symbol === "DIA") {
        return history(symbol, [], [], "unavailable");
      }
      if (symbol === "IWM") {
        return history(symbol, ["50.000000", "40.000000"], ["2026-11-02", "2026-11-09"]);
      }
      return history(symbol, ["100.000000", "110.000000"], ["2026-11-03", "2026-11-04"]);
    });

    renderChart();

    const table = await screen.findByRole("table", { name: "End-of-day percent change for the index proxies" });
    await waitFor(() => expect(table).toHaveTextContent("+10.00%"));
    expect(table).toHaveTextContent("IWM");
    expect(table).toHaveTextContent("-20.00%");
    expect(table).toHaveTextContent("DIA");
    expect(table).toHaveTextContent("Unavailable");
    const swatches: Record<string, string> = {
      SPY: "rgb(52, 211, 153)",
      QQQ: "rgb(56, 189, 248)",
      IWM: "rgb(192, 132, 252)",
    };
    for (const [symbol, color] of Object.entries(swatches)) {
      const header = within(table).getByRole("rowheader", { name: new RegExp(symbol) });
      const swatch = header.querySelector("[aria-hidden='true']");
      expect(swatch).toHaveStyle({ backgroundColor: color });
    }
    expect(within(table).getByRole("rowheader", { name: /DIA/ }).querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText(/End-of-day as of 2026-11-09/)).toBeInTheDocument();
    expect(screen.getByText(/Missing sessions stay open for IWM/)).toBeInTheDocument();
    expect(screen.getByText(/End-of-day history unavailable for DIA/)).toBeInTheDocument();
    expect(screen.getByText(/Horizontal axis: session date/)).toBeInTheDocument();
    await waitFor(() => expect(setData).toHaveBeenCalled());
    expect(setData.mock.calls.some((call) => (
      Array.isArray(call[0]) && call[0].some((point: { time: string; value?: number }) => point.time === "2026-11-03" && point.value == null)
    ))).toBe(true);
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("SPY", "massive", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("QQQ", "massive", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("DIA", "massive", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("IWM", "massive", "split_adjusted", "1m");

    fireEvent.click(screen.getByRole("button", { name: "Separate" }));
    expect(screen.getByRole("button", { name: "Separate" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "false");
  });

  it("says the line spans a single missing session", async () => {
    chartApi.createChart.mockImplementation(() => ({
      addSeries: () => ({ setData: vi.fn() }),
      subscribeCrosshairMove: vi.fn(),
      timeScale: () => ({ fitContent: vi.fn() }),
      remove: vi.fn(),
    }));
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return history(symbol, ["100.000000", "101.000000"], ["2026-11-02", "2026-11-04"], "partial", "gaps");
      }
      return history(symbol, [], [], "unavailable");
    });

    renderChart();

    expect(await screen.findByText(/Sessions are missing for SPY\. The line spans those sessions/)).toBeInTheDocument();
    expect(screen.queryByText(/does not connect/)).not.toBeInTheDocument();
  });
});
