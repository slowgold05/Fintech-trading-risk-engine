import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  addWatchlistSymbol,
  createWatchlist,
  deleteWatchlist,
  fetchWatchlists,
  removeWatchlistSymbol,
  updateWatchlist,
  type WatchlistSymbol,
} from "./watchlists";

vi.mock("./client", () => ({
  apiClient: { request: vi.fn() },
}));

const REQUEST = "Invalid watchlist request";
const RESPONSE = "Invalid watchlist response";
const EMOJI_NAME = "😀".repeat(40);

function symbol(symbolName: string, position: number, extra: Record<string, unknown> = {}): WatchlistSymbol & Record<string, unknown> {
  return { symbol: symbolName, position, ...extra };
}

function watchlist(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4,
    name: "Core",
    symbols: [symbol("AAPL", 1)],
    user_id: 9,
    source: "db",
    ...overrides,
  };
}

function collection(lists: Record<string, unknown>[]): Record<string, unknown> {
  return { watchlists: lists, owner_id: 9 };
}

function respond(status: number, data: unknown) {
  vi.mocked(apiClient.request).mockResolvedValueOnce({ status, data } as Awaited<ReturnType<typeof apiClient.request>>);
}

describe("watchlists api", () => {
  beforeEach(() => {
    vi.mocked(apiClient.request).mockReset();
  });

  it("routes normalized CRUD with exact bodies, statuses, and the caller signal", async () => {
    const signal = new AbortController().signal;
    respond(200, collection([watchlist({ symbols: [] })]));
    respond(201, watchlist({ name: "Core", symbols: [] }));
    respond(200, watchlist({
      name: "Renamed",
      symbols: [symbol("MSFT", 4, { note: "drop" }), symbol("AAPL", 9)],
    }));
    respond(204, "");
    respond(200, watchlist({ symbols: [symbol("AAPL", 1), symbol("BRK/B", 2)] }));
    respond(201, watchlist({ symbols: [symbol("AAPL", 1), symbol("BRK/B", 8)] }));
    respond(204, null);

    await expect(fetchWatchlists(signal)).resolves.toEqual({ watchlists: [{ id: 4, name: "Core", symbols: [] }] });
    await expect(createWatchlist("  Core  ", signal)).resolves.toEqual({ id: 4, name: "Core", symbols: [] });
    await expect(updateWatchlist(4, { name: " Renamed ", symbol_order: [" msft ", "aapl"] }, signal)).resolves.toEqual({
      id: 4,
      name: "Renamed",
      symbols: [
        { symbol: "MSFT", position: 4 },
        { symbol: "AAPL", position: 9 },
      ],
    });
    await expect(deleteWatchlist(4, signal)).resolves.toBeUndefined();
    await expect(addWatchlistSymbol(4, " brk/b ", signal)).resolves.toMatchObject({ id: 4 });
    await expect(addWatchlistSymbol(4, "BRK/B", signal)).resolves.toMatchObject({
      symbols: expect.arrayContaining([expect.objectContaining({ symbol: "BRK/B" })]),
    });
    await expect(removeWatchlistSymbol(4, "brk/b", signal)).resolves.toBeUndefined();

    const calls = vi.mocked(apiClient.request).mock.calls.map((call) => call[0]);
    expect(calls).toEqual([
      { method: "get", url: "/watchlists", signal },
      { method: "post", url: "/watchlists", signal, data: { name: "Core" } },
      {
        method: "patch",
        url: "/watchlists/4",
        signal,
        data: { name: "Renamed", symbol_order: ["MSFT", "AAPL"] },
      },
      { method: "delete", url: "/watchlists/4", signal },
      { method: "post", url: "/watchlists/4/symbols", signal, data: { symbol: "BRK/B" } },
      { method: "post", url: "/watchlists/4/symbols", signal, data: { symbol: "BRK/B" } },
      { method: "delete", url: `/watchlists/4/symbols/${encodeURIComponent("BRK/B")}`, signal },
    ]);
    expect(calls[0]).not.toHaveProperty("data");
    expect(Object.keys(calls[2].data as object)).toEqual(["name", "symbol_order"]);
  });

  it("accepts a full cap, gapped positions, a 40-emoji name, and case-sensitive names", async () => {
    const members = Array.from({ length: 50 }, (_, index) => symbol(`S${index}`, index === 0 ? 2 : 1000 + index));
    const lists = Array.from({ length: 20 }, (_, index) => watchlist({
      id: index + 1,
      name: index === 1 ? "core" : index === 0 ? EMOJI_NAME : `List ${index}`,
      symbols: index === 0 ? members : [],
    }));
    respond(200, collection(lists));
    respond(201, watchlist({ id: Number.MAX_SAFE_INTEGER, name: EMOJI_NAME, symbols: [] }));
    respond(200, watchlist({ symbols: [] }));

    const loaded = await fetchWatchlists();
    expect(loaded.watchlists).toHaveLength(20);
    expect(loaded.watchlists[0]).toEqual({ id: 1, name: EMOJI_NAME, symbols: members.map(({ symbol: name, position }) => ({ symbol: name, position })) });
    expect(loaded.watchlists[1]?.name).toBe("core");
    expect(loaded).not.toHaveProperty("owner_id");
    expect(loaded.watchlists[0]).not.toHaveProperty("user_id");
    expect(Array.from(EMOJI_NAME).length).toBe(40);

    await expect(createWatchlist(EMOJI_NAME)).resolves.toMatchObject({ id: Number.MAX_SAFE_INTEGER, name: EMOJI_NAME, symbols: [] });
    await expect(updateWatchlist(4, { symbol_order: [] })).resolves.toEqual({ id: 4, name: "Core", symbols: [] });
    expect(vi.mocked(apiClient.request).mock.calls[2]?.[0]).toEqual({
      method: "patch",
      url: "/watchlists/4",
      signal: undefined,
      data: { symbol_order: [] },
    });
  });

  it("rejects malformed payloads, wrong statuses, deletion bodies, and mismatched acknowledgements", async () => {
    const cases: Array<() => Promise<unknown>> = [
      () => fetchWatchlists(),
      () => createWatchlist("Core"),
      () => updateWatchlist(4, { name: "Core" }),
      () => updateWatchlist(4, { symbol_order: ["AAPL", "MSFT"] }),
      () => deleteWatchlist(4),
      () => addWatchlistSymbol(4, "AAPL"),
      () => removeWatchlistSymbol(4, "AAPL"),
    ];
    const bodies: Array<[number, unknown]> = [
      [200, collection([watchlist({ id: "4" })])],
      [200, watchlist({ name: "Core", symbols: [] })],
      [200, watchlist({ id: 5, name: "Core" })],
      [200, watchlist({ symbols: [symbol("MSFT", 1), symbol("AAPL", 2)] })],
      [204, { deleted: true }],
      [202, watchlist()],
      [204, "gone"],
    ];
    for (let index = 0; index < cases.length; index += 1) {
      respond(bodies[index][0], bodies[index][1]);
      await expect(cases[index]()).rejects.toThrow(RESPONSE);
    }

    const rejected = [
      collection([watchlist({ symbols: [symbol("AAPL", 2), symbol("MSFT", 1)] })]),
      collection([watchlist({ symbols: [symbol("AAPL", 2), symbol("AAPL", 3)] })]),
      collection([watchlist({ symbols: [symbol("AAPL", 2), symbol("MSFT", 2)] })]),
      collection([watchlist({ symbols: [symbol("aapl", 1)] })]),
      collection([watchlist({ name: " Core " })]),
      collection([watchlist(), watchlist({ id: 5 })]),
      collection([watchlist({ id: 5, name: "Other" }), watchlist({ id: 5, name: "Third" })]),
      collection(Array.from({ length: 21 }, (_, index) => watchlist({ id: index + 1, name: `L${index}` }))),
      collection([watchlist({ symbols: Array.from({ length: 51 }, (_, index) => symbol(`S${index}`, index + 1)) })]),
      collection([watchlist({ symbols: [symbol("AAPL", 0)] })]),
      collection([watchlist({ symbols: [symbol("AAPL", Number.NaN)] })]),
      collection([watchlist({ symbols: [symbol("AAPL", Number.POSITIVE_INFINITY)] })]),
      collection([watchlist({ id: Number.MAX_SAFE_INTEGER + 1 })]),
      null,
    ];
    for (const body of rejected) {
      respond(200, body);
      await expect(fetchWatchlists()).rejects.toThrow(RESPONSE);
    }

    respond(201, watchlist({ name: "Other", symbols: [] }));
    await expect(createWatchlist("Core")).rejects.toThrow(RESPONSE);
    respond(201, watchlist({ name: "Core", symbols: [symbol("AAPL", 1)] }));
    await expect(createWatchlist("Core")).rejects.toThrow(RESPONSE);
    respond(200, watchlist({ symbols: [symbol("AAPL", 1)] }));
    await expect(addWatchlistSymbol(4, "MSFT")).rejects.toThrow(RESPONSE);
    respond(204, undefined);
    await expect(deleteWatchlist(4)).resolves.toBeUndefined();
  });

  it("rejects invalid input before any HTTP call", async () => {
    const tooLong = "😀".repeat(41);
    const attempts: Array<() => Promise<unknown>> = [
      () => createWatchlist("   "),
      () => createWatchlist(tooLong),
      () => createWatchlist(1 as never),
      () => updateWatchlist(0, { name: "Core" }),
      () => updateWatchlist(1.5, { name: "Core" }),
      () => updateWatchlist(Number.NaN, { name: "Core" }),
      () => updateWatchlist(4, {}),
      () => updateWatchlist(4, { name: null } as never),
      () => updateWatchlist(4, { name: " " }),
      () => updateWatchlist(4, { symbol_order: null } as never),
      () => updateWatchlist(4, { symbol_order: ["MSFT", "msft"] }),
      () => updateWatchlist(4, { symbol_order: Array.from({ length: 51 }, (_, index) => `S${index}`) }),
      () => updateWatchlist(4, { owner_id: 1 } as never),
      () => updateWatchlist(4, { name: "Ok", user_id: 2 } as never),
      () => addWatchlistSymbol(-1, "AAPL"),
      () => addWatchlistSymbol(4, "   "),
      () => addWatchlistSymbol(4, "X".repeat(21)),
      () => removeWatchlistSymbol(4, ""),
      () => deleteWatchlist(0),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(REQUEST);
    }
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("rejects abort before and after the request without treating Axios errors as malformed", async () => {
    const early = new AbortController();
    early.abort();
    await expect(fetchWatchlists(early.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(apiClient.request).not.toHaveBeenCalled();

    const late = new AbortController();
    vi.mocked(apiClient.request).mockImplementationOnce(() => {
      late.abort();
      return Promise.resolve({ status: 201, data: watchlist({ symbols: [] }) } as Awaited<ReturnType<typeof apiClient.request>>);
    });
    await expect(createWatchlist("Core", late.signal)).rejects.toMatchObject({ name: "AbortError" });

    const axiosError = new AxiosError("conflict");
    vi.mocked(apiClient.request).mockRejectedValueOnce(axiosError);
    await expect(deleteWatchlist(4)).rejects.toBe(axiosError);
  });
});
