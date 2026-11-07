import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserResponse } from "../types/schemas";
import type { Watchlist, WatchlistCollection } from "../api/watchlists";
import { Watchlists } from "./Watchlists";

const TOKEN_A = "mock-a";
const TOKEN_B = "mock-b";
const TOKEN_NEXT = "mock-next";
const EMOJI = "😀";

const auth = vi.hoisted(() => ({
  state: {
    token: null as string | null,
    isAuthenticated: false,
    isInitializing: false,
  },
}));
const meApi = vi.hoisted(() => ({ fetchMe: vi.fn() }));
const listsApi = vi.hoisted(() => ({
  fetchWatchlists: vi.fn(),
  createWatchlist: vi.fn(),
  updateWatchlist: vi.fn(),
  deleteWatchlist: vi.fn(),
  addWatchlistSymbol: vi.fn(),
  removeWatchlistSymbol: vi.fn(),
}));
vi.mock("../context/useAuth", () => ({ useAuth: () => auth.state }));
vi.mock("../api/auth", () => meApi);
vi.mock("../api/watchlists", () => listsApi);

const onResearch = vi.fn();
const onChart = vi.fn();

function user(id: number, email = "owner@example.com"): UserResponse {
  return { id, email, role: "trader" };
}

function book(id: number, name: string, symbols: Watchlist["symbols"] = []): Watchlist {
  return { id, name, symbols };
}

function collection(watchlists: Watchlist[]): WatchlistCollection {
  return { watchlists };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function http(status: number) {
  return new AxiosError(`HTTP ${status}`, AxiosError.ERR_BAD_REQUEST, undefined, undefined, { status, data: {} } as AxiosResponse);
}

function sign(next: Partial<typeof auth.state>) {
  auth.state = { ...auth.state, ...next };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Watchlists onUseInChart={onChart} onUseInResearch={onResearch} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    client,
    rerender() {
      view.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Watchlists onUseInChart={onChart} onUseInResearch={onResearch} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    },
  };
}

async function choose(name: string) {
  await screen.findByRole("option", { name });
  fireEvent.change(screen.getByLabelText("Watchlist"), { target: { value: screen.getByRole("option", { name }).getAttribute("value") } });
}

describe("Watchlists", () => {
  beforeEach(() => {
    sign({ token: null, isAuthenticated: false, isInitializing: false });
    meApi.fetchMe.mockReset();
    for (const call of Object.values(listsApi)) call.mockReset();
    onResearch.mockReset();
    onChart.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("stays public while signed out, including a token that is still initializing", () => {
    sign({ token: TOKEN_A, isAuthenticated: false, isInitializing: true });
    const view = mount();
    expect(screen.getByRole("status").textContent).toBe("Checking your session.");
    expect(meApi.fetchMe).not.toHaveBeenCalled();
    expect(listsApi.fetchWatchlists).not.toHaveBeenCalled();
    sign({ token: TOKEN_A, isAuthenticated: false, isInitializing: false });
    view.rerender();
    expect(screen.getByRole("link", { name: "Sign in to keep watchlists" })).toHaveAttribute("href", "/login");
    expect(meApi.fetchMe).not.toHaveBeenCalled();
    expect(listsApi.fetchWatchlists).not.toHaveBeenCalled();
    expect(screen.queryByText(TOKEN_A)).not.toBeInTheDocument();
  });

  it("does not read lists or show cached names for a pending, failed, or invalid profile", async () => {
    const pending = deferred<UserResponse>();
    meApi.fetchMe.mockReturnValue(pending.promise);
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    const view = mount();
    view.client.setQueryData(["watchlists", 4], collection([book(1, "Cached Secret")]));
    expect(await screen.findByText("Loading your account.")).toBeInTheDocument();
    expect(listsApi.fetchWatchlists).not.toHaveBeenCalled();
    expect(screen.queryByText("Cached Secret")).not.toBeInTheDocument();
    pending.reject(new Error("profile down"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Watchlists are unavailable for this session.");
    expect(listsApi.fetchWatchlists).not.toHaveBeenCalled();
    meApi.fetchMe.mockResolvedValue({ id: 0, email: "owner@example.com", role: "trader" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(meApi.fetchMe).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("Watchlists are unavailable for this session.");
    expect(listsApi.fetchWatchlists).not.toHaveBeenCalled();
    expect(screen.queryByText("Cached Secret")).not.toBeInTheDocument();
    expect(screen.queryByText("No watchlists yet.")).not.toBeInTheDocument();
  });

  it("loads owner A by id and drops a pending refetch when the session becomes owner B", async () => {
    const signals: AbortSignal[] = [];
    const loaded = deferred<WatchlistCollection>();
    const refreshA = deferred<WatchlistCollection>();
    const fetchB = deferred<WatchlistCollection>();
    const alpha = collection([book(1, "Alpha Book")]);
    const beta = collection([book(2, "Beta Book")]);
    meApi.fetchMe.mockImplementation(async () => (auth.state.token === TOKEN_B ? user(22, "b@example.com") : user(11, "a@example.com")));
    listsApi.fetchWatchlists
      .mockImplementationOnce((signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return loaded.promise;
      })
      .mockImplementationOnce((signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return refreshA.promise;
      })
      .mockImplementationOnce((signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return fetchB.promise;
      });
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    const view = mount();
    loaded.resolve(alpha);
    expect(await screen.findByRole("option", { name: "Alpha Book" })).toBeInTheDocument();
    expect(view.client.getQueryData(["watchlists", 11])).toEqual(alpha);
    expect(signals[0]?.aborted).toBe(false);
    void view.client.refetchQueries({ queryKey: ["watchlists", 11] }).catch(() => undefined);
    await waitFor(() => expect(listsApi.fetchWatchlists).toHaveBeenCalledTimes(2));
    const pendingRefresh = signals[1];
    expect(pendingRefresh?.aborted).toBe(false);
    sign({ token: TOKEN_B, isAuthenticated: true, isInitializing: false });
    view.rerender();
    await waitFor(() => expect(pendingRefresh?.aborted).toBe(true));
    await waitFor(() => expect(view.client.getQueryState(["watchlists", 11])).toBeUndefined());
    expect(screen.queryByText("Alpha Book")).not.toBeInTheDocument();
    expect(signals[0]?.aborted).toBe(false);
    await waitFor(() => expect(listsApi.fetchWatchlists).toHaveBeenCalledTimes(3));
    fetchB.resolve(beta);
    expect(await screen.findByRole("option", { name: "Beta Book" })).toBeInTheDocument();
    refreshA.resolve(collection([book(9, "Late Alpha")]));
    await waitFor(() => expect(view.client.getQueryData(["watchlists", 22])).toEqual(beta));
    expect(screen.getByRole("option", { name: "Beta Book" })).toBeInTheDocument();
    expect(screen.queryByText("Late Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Alpha Book")).not.toBeInTheDocument();
    expect(view.client.getQueryState(["watchlists", 11])).toBeUndefined();
    expect(signals[0]?.aborted).toBe(false);
    expect(document.body.textContent).not.toContain(TOKEN_A);
    expect(document.body.textContent).not.toContain(TOKEN_B);
  });

  it("does not paint or refetch owner B from owner A's late create acknowledgement", async () => {
    const created = deferred<Watchlist>();
    let createSignal: AbortSignal | undefined;
    meApi.fetchMe.mockImplementation(async () => user(auth.state.token === TOKEN_B ? 22 : 11));
    listsApi.fetchWatchlists.mockResolvedValue(collection([book(1, "Alpha Book")]));
    listsApi.createWatchlist.mockImplementation((_name: string, signal?: AbortSignal) => {
      createSignal = signal;
      return created.promise;
    });
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    const view = mount();
    await choose("Alpha Book");
    fireEvent.change(screen.getByLabelText("New watchlist"), { target: { value: "Pending Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    await waitFor(() => expect(listsApi.createWatchlist).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Watchlist")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create watchlist" })).toBeDisabled();
    const readsBeforeSwap = listsApi.fetchWatchlists.mock.calls.length;
    sign({ token: TOKEN_B, isAuthenticated: true, isInitializing: false });
    listsApi.fetchWatchlists.mockResolvedValue(collection([]));
    view.rerender();
    await waitFor(() => expect(createSignal?.aborted).toBe(true));
    created.resolve(book(8, "Pending Alpha"));
    expect(await screen.findByText("No watchlists yet.")).toBeInTheDocument();
    expect(screen.queryByText("Watchlist created.")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Alpha")).not.toBeInTheDocument();
    expect(listsApi.createWatchlist).toHaveBeenCalledTimes(1);
    expect(listsApi.fetchWatchlists.mock.calls.length).toBe(readsBeforeSwap + 1);
    expect(view.client.getQueryData(["watchlists", 22])).toEqual(collection([]));
    expect(view.client.getQueryState(["watchlists", 11])).toBeUndefined();
  });

  it("aborts the previous session mutation when the same owner presents a new token", async () => {
    const created = deferred<Watchlist>();
    const meHold = deferred<UserResponse>();
    let createSignal: AbortSignal | undefined;
    meApi.fetchMe.mockImplementation(() => (auth.state.token === TOKEN_NEXT ? meHold.promise : Promise.resolve(user(5))));
    listsApi.fetchWatchlists.mockResolvedValue(collection([book(3, "Core")]));
    listsApi.createWatchlist.mockImplementation((_name: string, signal?: AbortSignal) => {
      createSignal = signal;
      return created.promise;
    });
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    const view = mount();
    await choose("Core");
    fireEvent.change(screen.getByLabelText("New watchlist"), { target: { value: "Session draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    await waitFor(() => expect(createSignal).toBeDefined());
    view.client.setQueryData(["me", TOKEN_NEXT], user(5));
    const readsBefore = listsApi.fetchWatchlists.mock.calls.length;
    sign({ token: TOKEN_NEXT, isAuthenticated: true, isInitializing: false });
    view.rerender();
    await waitFor(() => expect(createSignal?.aborted).toBe(true));
    expect(screen.queryByText("Loading your account.")).not.toBeInTheDocument();
    created.resolve(book(9, "Session draft"));
    await waitFor(() => expect(listsApi.fetchWatchlists.mock.calls.length).toBe(readsBefore + 1));
    expect(screen.queryByText("Watchlist created.")).not.toBeInTheDocument();
    expect(listsApi.createWatchlist).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(TOKEN_A);
    expect(document.body.textContent).not.toContain(TOKEN_NEXT);
    meHold.resolve(user(5));
  });

  it("keeps raw session tokens out of the document and the console", async () => {
    const spies = (["log", "info", "debug", "warn", "error"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockResolvedValue(collection([book(3, "Core")]));
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    mount();
    expect(await screen.findByRole("option", { name: "Core" })).toBeInTheDocument();
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(" ");
    expect(document.body.textContent).not.toContain(TOKEN_A);
    expect(logged).not.toContain(TOKEN_A);
    for (const spy of spies) spy.mockRestore();
  });

  it("accepts a 40-code-point name once, keeps that notice when refresh fails, and retries the read", async () => {
    const name = EMOJI.repeat(40);
    const created = deferred<Watchlist>();
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Core")]));
    listsApi.createWatchlist.mockImplementation((_name: string, signal?: AbortSignal) => {
      void signal;
      return created.promise;
    });
    const view = mount();
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    view.rerender();
    await choose("Core");
    fireEvent.change(screen.getByLabelText("New watchlist"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a watchlist name.");
    fireEvent.change(screen.getByLabelText("New watchlist"), { target: { value: EMOJI.repeat(41) } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use a name of 40 characters or fewer.");
    expect(listsApi.createWatchlist).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New watchlist"), { target: { value: `  ${name}  ` } });
    const button = screen.getByRole("button", { name: "Create watchlist" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(listsApi.createWatchlist).toHaveBeenCalledTimes(1));
    expect(listsApi.createWatchlist).toHaveBeenCalledWith(name, expect.any(AbortSignal));
    expect(screen.getByLabelText("Rename")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    listsApi.fetchWatchlists.mockRejectedValueOnce(new Error("refresh down"));
    created.resolve(book(4, name));
    expect(await screen.findByText("Watchlist created.")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("The saved change stands, but the latest watchlists could not be refreshed.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("No watchlists yet.")).not.toBeInTheDocument();
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Core"), book(4, name)]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("Watchlist created.")).toBeInTheDocument();
  });

  it("never calls a rejected change saved, and a failed read is not an empty current list", async () => {
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockRejectedValueOnce(new Error("offline"));
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("Watchlists could not be refreshed.");
    expect(screen.queryByText("No watchlists yet.")).not.toBeInTheDocument();
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Stale Book", [{ symbol: "AAPL", position: 1 }])]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await choose("Stale Book");
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    listsApi.updateWatchlist.mockRejectedValueOnce(new AxiosError("offline", AxiosError.ERR_NETWORK));
    listsApi.fetchWatchlists.mockRejectedValueOnce(new Error("refresh down"));
    fireEvent.change(screen.getByLabelText("Rename"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Could not confirm the change. Check the refreshed lists before trying again.")).toBeInTheDocument();
    expect(await screen.findByText("Watchlists could not be refreshed.")).toBeInTheDocument();
    expect(screen.queryByText(/saved change/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Watchlist renamed.")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale Book")).not.toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
    expect(screen.queryByText("No watchlists yet.")).not.toBeInTheDocument();
  });

  it("shows 400, 404, 409, and 422 as recoverable inline errors", async () => {
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockResolvedValue(collection([book(3, "Core")]));
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    mount();
    await choose("Core");
    const messages: Record<number, string> = {
      400: "That change was rejected. Check the entry and try again.",
      404: "That watchlist or symbol is no longer available.",
      409: "Limit reached or name already in use. A session can keep 20 watchlists, with 50 symbols on each.",
      422: "That entry could not be saved. Check it and try again.",
    };
    for (const status of [400, 404, 409, 422]) {
      listsApi.updateWatchlist.mockRejectedValueOnce(http(status));
      fireEvent.change(screen.getByLabelText("Rename"), { target: { value: `Name ${status}` } });
      fireEvent.click(screen.getByRole("button", { name: "Save name" }));
      expect(await screen.findByText(messages[status] ?? "")).toBeInTheDocument();
      expect(screen.queryByText(/saved change/i)).not.toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Core" })).toBeInTheDocument();
    }
  });

  it("stops new lists at 20 and new symbols at 50 while rename and delete stay available", async () => {
    const symbols = Array.from({ length: 50 }, (_, index) => ({ symbol: `S${index + 1}`, position: index + 1 }));
    const lists = Array.from({ length: 20 }, (_, index) => book(index + 1, `List ${index + 1}`, index === 0 ? symbols : []));
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockResolvedValue(collection(lists));
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    mount();
    expect(await screen.findByText("You can keep up to 20 watchlists.")).toBeInTheDocument();
    expect(screen.getByLabelText("New watchlist")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create watchlist" })).toBeDisabled();
    await choose("List 1");
    expect(screen.getByText("This watchlist already has 50 symbols. Remove one to add another.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add symbol")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add symbol" })).toBeDisabled();
    expect(screen.getByLabelText("Rename")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.queryByText(/already in use/)).not.toBeInTheDocument();
  });

  it("shows gapped server order and posts the full order only after Move succeeds", async () => {
    const initial = [
      { symbol: "AAA", position: 2 },
      { symbol: "MMM", position: 5 },
      { symbol: "ZZZ", position: 9 },
    ];
    const moved = deferred<Watchlist>();
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockResolvedValue(collection([book(3, "Core", initial)]));
    listsApi.updateWatchlist.mockImplementation((_id: number, _patch: unknown, signal?: AbortSignal) => {
      void signal;
      return moved.promise;
    });
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    mount();
    await choose("Core");
    const symbols = () => screen.getAllByText(/^(AAA|MMM|ZZZ)$/).map((node) => node.textContent);
    expect(symbols()).toEqual(["AAA", "MMM", "ZZZ"]);
    expect(screen.getByRole("button", { name: "Move AAA up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move ZZZ down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move MMM down" }));
    expect(listsApi.updateWatchlist).toHaveBeenCalledWith(3, { symbol_order: ["AAA", "ZZZ", "MMM"] }, expect.any(AbortSignal));
    expect(symbols()).toEqual(["AAA", "MMM", "ZZZ"]);
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Core", [
      { symbol: "AAA", position: 1 },
      { symbol: "ZZZ", position: 4 },
      { symbol: "MMM", position: 8 },
    ])]));
    moved.resolve(book(3, "Core", initial));
    expect(await screen.findByText("Symbol order saved.")).toBeInTheDocument();
    await waitFor(() => expect(symbols()).toEqual(["AAA", "ZZZ", "MMM"]));
  });

  it("adds, renames, removes, and cancels delete using the canonical symbol only", async () => {
    const members = [{ symbol: "BRK.B", position: 4 }, { symbol: "MSFT", position: 7 }];
    meApi.fetchMe.mockResolvedValue(user(5));
    listsApi.fetchWatchlists.mockResolvedValue(collection([book(3, "Core", members)]));
    listsApi.addWatchlistSymbol.mockResolvedValue(book(3, "Core", members));
    listsApi.removeWatchlistSymbol.mockResolvedValue(undefined);
    listsApi.updateWatchlist.mockResolvedValue(book(3, "Renamed", members));
    listsApi.deleteWatchlist.mockResolvedValue(undefined);
    sign({ token: TOKEN_A, isAuthenticated: true, isInitializing: false });
    mount();
    expect(screen.queryByText("No symbols on this watchlist.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove BRK.B" })).not.toBeInTheDocument();
    await choose("Core");
    expect(screen.queryByText("No symbols on this watchlist.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add symbol"), { target: { value: " brk.b " } });
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Core", members)]));
    fireEvent.click(screen.getByRole("button", { name: "Add symbol" }));
    expect(await screen.findByText("Symbol saved.")).toBeInTheDocument();
    expect(listsApi.addWatchlistSymbol).toHaveBeenCalledWith(3, "BRK.B", expect.any(AbortSignal));
    expect(screen.getByRole("link", { name: "Trade BRK.B" })).toHaveAttribute("href", "/trades?symbol=BRK.B");
    expect(screen.getByRole("link", { name: "Trade BRK.B" }).getAttribute("href")).not.toMatch(/qty|amount|quantity/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Use in research" })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "Use in chart" })[0] as HTMLElement);
    expect(onResearch).toHaveBeenCalledTimes(1);
    expect(onResearch).toHaveBeenCalledWith("BRK.B");
    expect(onResearch.mock.calls[0]).toHaveLength(1);
    expect(onChart).toHaveBeenCalledWith("BRK.B");
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Core", [{ symbol: "MSFT", position: 7 }])]));
    fireEvent.click(screen.getByRole("button", { name: "Remove BRK.B" }));
    expect(await screen.findByText("Symbol removed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("BRK.B")).not.toBeInTheDocument());
    expect(listsApi.removeWatchlistSymbol).toHaveBeenCalledWith(3, "BRK.B", expect.any(AbortSignal));
    fireEvent.change(screen.getByLabelText("Rename"), { target: { value: "  Renamed  " } });
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([book(3, "Renamed", [{ symbol: "MSFT", position: 7 }])]));
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Watchlist renamed.")).toBeInTheDocument();
    expect(listsApi.updateWatchlist).toHaveBeenCalledWith(3, { name: "Renamed" }, expect.any(AbortSignal));
    expect(await screen.findByRole("option", { name: "Renamed" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("group", { name: "Confirm watchlist delete" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(listsApi.deleteWatchlist).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    listsApi.fetchWatchlists.mockResolvedValueOnce(collection([]));
    fireEvent.click(screen.getByRole("button", { name: "Delete watchlist" }));
    expect(await screen.findByText("Watchlist deleted.")).toBeInTheDocument();
    expect(listsApi.deleteWatchlist).toHaveBeenCalledTimes(1);
    expect(listsApi.deleteWatchlist).toHaveBeenCalledWith(3, expect.any(AbortSignal));
    expect(await screen.findByText("No watchlists yet.")).toBeInTheDocument();
  });
});
