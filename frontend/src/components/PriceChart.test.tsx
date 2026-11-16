import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryBar } from "../api/history";
import { PriceChart } from "./PriceChart";

const chartApi = vi.hoisted(() => {
  const mounted: {
    type: string;
    setData: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    mounted,
    createChart: vi.fn(() => ({
      addSeries: (definition: { type: string }) => {
        const row = {
          type: definition.type,
          setData: vi.fn(),
          applyOptions: vi.fn(),
          priceScale: () => ({ applyOptions: vi.fn() }),
        };
        mounted.push(row);
        return row;
      },
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
  };
});

vi.mock("lightweight-charts", () => chartApi);

function bar(session: string, close: string): HistoryBar {
  return {
    session_date: session,
    open: close,
    high: close,
    low: close,
    close,
    volume: "100",
    fetched_at: "2026-11-13T21:00:00Z",
    provider: "massive",
    adjustment_type: "split_adjusted",
    quality_status: "valid",
  };
}

afterEach(() => {
  cleanup();
  chartApi.mounted.length = 0;
  vi.clearAllMocks();
});

describe("PriceChart", () => {
  it("draws weekdays without a bar as gaps and keeps range controls reachable", async () => {
    const user = userEvent.setup();
    render(
      <PriceChart
        bars={[bar("2026-11-09", "10"), bar("2026-11-12", "14")]}
        endDate="2026-11-13"
        symbol="AAPL"
      />,
    );

    expect(screen.getByRole("button", { name: "1 year" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1 year" })).toHaveClass("min-h-11");
    expect(screen.getByText(/2 weekdays without a bar are shown as gaps and not filled in\. That count includes market holidays\./)).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "2026-11-09" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "2026-11-10" })).not.toBeInTheDocument();

    await waitFor(() => {
      const line = chartApi.mounted.find((series) => series.type === "area");
      expect(line?.setData).toHaveBeenCalled();
    });
    const line = chartApi.mounted.find((series) => series.type === "area");
    const points = line?.setData.mock.calls.at(-1)?.[0] as { time: string; value?: number }[];
    expect(points.find((point) => point.time === "2026-11-10")).toEqual({ time: "2026-11-10" });
    expect(points.find((point) => point.time === "2026-11-10")).not.toHaveProperty("value");

    await user.click(screen.getByRole("button", { name: "Candlestick" }));
    expect(screen.getByRole("button", { name: "Candlestick" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not draw a holiday as a gap when the history coverage is complete", async () => {
    render(
      <PriceChart
        bars={[bar("2025-11-26", "10"), bar("2025-11-28", "11")]}
        coverageStatus="complete"
        endDate="2025-11-28"
        symbol="AAPL"
      />,
    );

    const summary = /2 sessions\. No trading sessions are missing against the NYSE calendar\./;
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: summary })).toBeInTheDocument();
    expect(screen.queryByText(/without a bar/)).not.toBeInTheDocument();

    await waitFor(() => {
      const line = chartApi.mounted.find((series) => series.type === "area");
      expect(line?.setData).toHaveBeenCalled();
    });
    for (const series of chartApi.mounted) {
      const points = series.setData.mock.calls.at(-1)?.[0] as { time: string }[];
      expect(points.map((point) => point.time)).toEqual(["2025-11-26", "2025-11-28"]);
    }
  });

  it("removes a chart that fails after it was created", async () => {
    const remove = vi.fn();
    chartApi.createChart.mockImplementationOnce(() => ({
      addSeries: () => {
        throw new Error("series failed");
      },
      remove,
      priceScale: () => ({ applyOptions: vi.fn() }),
      timeScale: () => ({ fitContent: vi.fn() }),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
    }));
    render(
      <PriceChart
        bars={[bar("2026-11-12", "10"), bar("2026-11-13", "11")]}
        endDate="2026-11-13"
        symbol="AAPL"
      />,
    );

    expect(await screen.findByText(/The price chart could not be drawn/)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
