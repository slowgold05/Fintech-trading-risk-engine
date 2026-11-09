import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { fetchCachedSeries, fetchDailyHistory } from "../api/history";
import { DailyHistory } from "./DailyHistory";

const { gate, releaseGate, loaderEntered, createChart } = vi.hoisted(() => {
  let resolveGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return {
    gate,
    releaseGate: () => resolveGate(),
    loaderEntered: { current: false },
    createChart: vi.fn(),
  };
});

vi.mock("lightweight-charts", async () => {
  loaderEntered.current = true;
  await gate;
  return {
    createChart,
    CandlestickSeries: function CandlestickSeries() {},
    ColorType: { Solid: "solid" },
  };
});

vi.mock("../api/history", () => ({
  fetchCachedSeries: vi.fn(),
  fetchDailyHistory: vi.fn(),
}));

const READ_AT = "2026-11-06T00:00:00.000Z";
const SERIES_KEY = JSON.stringify(["fixture", "raw"]);

function bar(sessionDate: string, open: string, high: string, low: string, close: string) {
  return {
    session_date: sessionDate,
    open,
    high,
    low,
    close,
    volume: "0",
    fetched_at: READ_AT,
    provider: "fixture",
    adjustment_type: "raw" as const,
    quality_status: "valid" as const,
  };
}

it("never constructs a chart when unmounted before the chart import resolves", async () => {
  vi.mocked(fetchCachedSeries).mockResolvedValue({
    read_at: READ_AT,
    collection: "disabled",
    coverage_status: "not_verified",
    expected_session_count: null,
    canonical_history: {
      series: [{ provider: "fixture", adjustment_type: "raw" }],
    },
  });
  vi.mocked(fetchDailyHistory).mockResolvedValue({
    symbol: "TEST",
    interval: "1d",
    range: "2y",
    provider: "fixture",
    adjustment_type: "raw",
    status: "partial",
    coverage_status: "not_verified",
    expected_session_count: null,
    collection: "disabled",
    read_at: READ_AT,
    requested_start: "2024-11-06",
    requested_end: "2026-11-06",
    available_start: "2024-11-06",
    available_end: "2026-11-06",
    excluded_row_count: 0,
    bars: [
      bar("2024-11-06", "10.000000", "12.000000", "9.000000", "11.000000"),
      bar("2026-11-06", "11.000000", "13.000000", "10.000000", "12.000000"),
    ],
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DailyHistory />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  try {
    await user.type(await screen.findByLabelText("Symbol"), "TEST");
    await user.selectOptions(screen.getByLabelText("Cached series"), SERIES_KEY);
    await user.click(screen.getByRole("button", { name: "View history" }));
    await waitFor(() => {
      expect(loaderEntered.current).toBe(true);
    });
    view.unmount();
    releaseGate();
    await act(async () => {
      await import("lightweight-charts");
    });
    expect(createChart).not.toHaveBeenCalled();
  } finally {
    cleanup();
    releaseGate();
    client.clear();
  }
});
