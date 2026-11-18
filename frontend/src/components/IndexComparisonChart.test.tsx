import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

// Load the chart module during test collection, outside the render timeout.
import "./TerrainComparisonPlot";
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

function renderChart(quotes?: { symbol: string; value: number; changePercent: number }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IndexComparisonChart quotes={quotes} range="1m" />
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
      subscribeCrosshairMove: (listener: (param: { time?: string; point?: { x: number; y: number } }) => void) => {
        listener({ time: "2026-11-04", point: { x: 30, y: 40 } });
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

    renderChart([{ symbol: "DIA", value: 123.45, changePercent: -1.5 }]);

    const list = await screen.findByRole("list", { name: "End-of-day percent change for the index proxies" });
    await waitFor(() => expect(list).toHaveTextContent("+10.00%"));
    expect(list).toHaveTextContent("IWM");
    expect(list).toHaveTextContent("-20.00%");
    expect(list).toHaveTextContent("DIA");
    fireEvent.click(screen.getByText("Series & coverage"));
    const details = screen.getByRole("list", { name: "Proxy quote details" });
    const dia = within(details).getByText("DIA · Dow Jones").closest("li");
    const spy = within(details).getByText("SPY · S&P 500").closest("li");
    expect(dia).toHaveTextContent("Range unavailable");
    expect(dia).toHaveTextContent("Provider change -1.50%");
    expect(dia).toHaveTextContent("$123.45");
    expect(spy).toHaveTextContent("$110.00");
    expect(spy).not.toHaveTextContent("Provider change");
    const swatches: Record<string, string> = {
      SPY: "rgb(235, 235, 230)",
      QQQ: "rgb(173, 172, 185)",
      DIA: "rgb(133, 137, 138)",
      IWM: "rgb(195, 180, 165)",
    };
    for (const [symbol, color] of Object.entries(swatches)) {
      const item = within(list).getByRole("listitem", { name: new RegExp(symbol) });
      expect(item.querySelector("[aria-hidden='true']")).toHaveStyle({ backgroundColor: color });
    }
    expect(screen.getByText(/End-of-day as of 2026-11-09/)).toBeInTheDocument();
    expect(screen.getByText(/Missing sessions stay open for IWM/)).toBeInTheDocument();
    expect(screen.getByText(/End-of-day history unavailable for DIA/)).toBeInTheDocument();
    expect(screen.getByText(/Horizontal axis: session date/)).toBeInTheDocument();
    expect(await screen.findByText("Nov 4, 2026: SPY +10.00%, QQQ +10.00%")).toBeInTheDocument();
    expect(within(list).getByRole("listitem", { name: "SPY S&P 500" })).toBeInTheDocument();
    await waitFor(() => expect(setData).toHaveBeenCalled());
    const options = chartApi.createChart.mock.calls.at(-1)?.[1] as {
      localization: { priceFormatter: (price: number) => string };
    };
    expect(options.localization.priceFormatter(1.5)).toBe("+1.50%");
    expect(options.localization.priceFormatter(-1.1)).toBe("-1.10%");
    expect(setData.mock.calls.some((call) => (
      Array.isArray(call[0]) && call[0].some((point: { time: string; value?: number }) => point.time === "2026-11-03" && point.value == null)
    ))).toBe(true);
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("SPY", "massive", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("QQQ", "massive", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("DIA", "massive", "split_adjusted", "1m");
    expect(historyApi.fetchDailyHistory).toHaveBeenCalledWith("IWM", "massive", "split_adjusted", "1m");
    expect(screen.queryByRole("button", { name: "Separate" })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("application", { name: "Index proxy percent change chart" }), { key: "ArrowRight" });
    expect(screen.getByText("Nov 2, 2026: IWM +0.00%")).toBeInTheDocument();
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

  it("does not plot a history response for a different symbol", async () => {
    const setData = vi.fn();
    chartApi.createChart.mockImplementation(() => ({
      addSeries: () => ({ setData }),
      subscribeCrosshairMove: vi.fn(),
      timeScale: () => ({ fitContent: vi.fn() }),
      remove: vi.fn(),
    }));
    historyApi.fetchDailyHistory.mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return history("QQQ", ["100.000000", "110.000000"], ["2026-11-03", "2026-11-04"]);
      }
      return history(symbol, [], [], "unavailable");
    });

    renderChart();

    const list = await screen.findByRole("list", { name: "End-of-day percent change for the index proxies" });
    await screen.findByText("No stored closes in this range");
    expect(within(list).getByRole("listitem", { name: /SPY/ })).toHaveTextContent("Unavailable");
    expect(within(list).getByRole("listitem", { name: /SPY/ })).not.toHaveTextContent("+10.00%");
    expect(screen.getByText(/End-of-day history unavailable for .*SPY/)).toBeInTheDocument();
    expect(setData).not.toHaveBeenCalled();
  });
});
