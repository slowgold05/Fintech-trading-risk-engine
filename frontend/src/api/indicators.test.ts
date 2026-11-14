import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { fetchDailyIndicators } from "./indicators";

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const get = vi.mocked(apiClient.get);

beforeEach(() => {
  get.mockReset();
});

describe("fetchDailyIndicators", () => {
  it("GETs the encoded daily indicator path and returns the raw body", async () => {
    const symbol = "BRK/B";
    const body = {
      symbol,
      name: "sma",
      period: 3,
      points: [{ session_date: "2026-01-02", value: null }],
    };
    get.mockResolvedValue({ data: body, status: 200, headers: {} } as never);

    const result = await fetchDailyIndicators(symbol, "fixture", "split_adjusted", "2y", "sma", 3);

    expect(get.mock.calls).toEqual([
      [
        `/market/symbols/${encodeURIComponent(symbol)}/indicators`,
        {
          params: {
            interval: "1d",
            range: "2y",
            provider: "fixture",
            adjustment_type: "split_adjusted",
            name: "sma",
            period: 3,
          },
        },
      ],
    ]);
    expect(result).toBe(body);
  });

  it("forwards an indicator request rejection", async () => {
    const failure = new Error("indicators failed");
    get.mockRejectedValue(failure);

    await expect(
      fetchDailyIndicators("BRK/B", "fixture", "raw", "2y", "ema", 20),
    ).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls).toEqual([
      [
        `/market/symbols/${encodeURIComponent("BRK/B")}/indicators`,
        {
          params: {
            interval: "1d",
            range: "2y",
            provider: "fixture",
            adjustment_type: "raw",
            name: "ema",
            period: 20,
          },
        },
      ],
    ]);
  });
});
