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
  it("draws missing weekdays as gaps and keeps range controls reachable", async () => {
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
    expect(screen.getByText(/2 missing weekdays shown as gaps and not filled in/)).toBeInTheDocument();
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
});
