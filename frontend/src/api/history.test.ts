import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  fetchCachedSeries,
  fetchDailyHistory,
  type HistoryResponse,
  type MarketDataStatus,
} from "./history";

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const get = vi.mocked(apiClient.get);

beforeEach(() => {
  get.mockReset();
});

describe("fetchCachedSeries", () => {
  it("GETs /market/data-status and returns the same catalog object", async () => {
    const catalog: MarketDataStatus = {
      read_at: "2026-11-06T12:00:00Z",
      collection: "disabled",
      coverage_status: "not_verified",
      expected_session_count: null,
      canonical_history: {
        series: [
          {
            provider: "fixture",
            adjustment_type: "raw",
          },
        ],
      },
    };
    get.mockResolvedValue({ data: catalog } as never);

    const result = await fetchCachedSeries();

    expect(get.mock.calls).toEqual([["/market/data-status"]]);
    expect(result).toBe(catalog);
    expect(result.expected_session_count).toBeNull();
    expect(result.collection).toBe("disabled");
    expect(result.canonical_history.series).toBe(catalog.canonical_history.series);
    expect(result.canonical_history.series[0].provider).toBe("fixture");
    expect(result.canonical_history.series[0].adjustment_type).toBe("raw");
  });

  it("propagates a catalog request failure", async () => {
    const failure = new Error("data-status failed");
    get.mockRejectedValue(failure);

    await expect(fetchCachedSeries()).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls).toEqual([["/market/data-status"]]);
  });
});

describe("fetchDailyHistory", () => {
  it("requests the encoded daily series and returns the same decimal-string payload", async () => {
    const response: HistoryResponse = {
      symbol: "BRK.B",
      interval: "1d",
      range: "2y",
      provider: "fixture",
      adjustment_type: "split_adjusted",
      status: "partial",
      coverage_status: "not_verified",
      expected_session_count: null,
      collection: "disabled",
      read_at: "2026-11-06T12:00:00Z",
      requested_start: "2024-11-06",
      requested_end: "2026-11-06",
      available_start: "2025-08-14",
      available_end: "2025-08-14",
      excluded_row_count: 0,
      bars: [
        {
          session_date: "2025-08-14",
          open: "412.250000",
          high: "418.000000",
          low: "409.500000",
          close: "415.125000",
          volume: "0",
          fetched_at: "2026-11-06T12:00:00Z",
          provider: "fixture",
          adjustment_type: "split_adjusted",
          quality_status: "valid",
        },
      ],
    };
    const bar = response.bars[0];
    get.mockResolvedValue({ data: response } as never);

    const result = await fetchDailyHistory("BRK.B", "fixture", "split_adjusted");

    expect(get.mock.calls).toEqual([
      [
        `/market/symbols/${encodeURIComponent("BRK.B")}/history`,
        {
          params: {
            interval: "1d",
            range: "2y",
            provider: "fixture",
            adjustment_type: "split_adjusted",
          },
        },
      ],
    ]);
    expect(result).toBe(response);
    expect(result.bars[0]).toBe(bar);
    expect(result.bars[0]).toMatchObject({
      open: "412.250000",
      high: "418.000000",
      low: "409.500000",
      close: "415.125000",
      volume: "0",
    });
    expect(typeof result.bars[0].open).toBe("string");
    expect(typeof result.bars[0].high).toBe("string");
    expect(typeof result.bars[0].low).toBe("string");
    expect(typeof result.bars[0].close).toBe("string");
    expect(typeof result.bars[0].volume).toBe("string");
    expect(result.bars[0].volume).toBe("0");
  });

  it("propagates a history request failure instead of returning an empty series", async () => {
    const failure = new Error("history failed");
    get.mockRejectedValue(failure);

    await expect(fetchDailyHistory("BRK.B", "fixture", "split_adjusted")).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls).toEqual([
      [
        `/market/symbols/${encodeURIComponent("BRK.B")}/history`,
        {
          params: {
            interval: "1d",
            range: "2y",
            provider: "fixture",
            adjustment_type: "split_adjusted",
          },
        },
      ],
    ]);
  });
});
