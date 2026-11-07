import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { fetchMe } from "../api/auth";
import {
  addWatchlistSymbol,
  createWatchlist,
  deleteWatchlist,
  fetchWatchlists,
  removeWatchlistSymbol,
  updateWatchlist,
  type WatchlistSymbol,
} from "../api/watchlists";
import { useAuth } from "../context/useAuth";

const LIST_CAP = 20;
const MEMBER_CAP = 50;
const NAME_POINTS = 40;
const SYMBOL_POINTS = 20;
const FIELD_UNITS = 80;

type WatchlistsProps = {
  onUseInResearch: (symbol: string) => void;
  onUseInChart: (symbol: string) => void;
};

function codePoints(value: string) {
  return Array.from(value).length;
}

function readOwnerId(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return null;
  }
  const id = value.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function orderedSymbols(symbols: WatchlistSymbol[]) {
  return [...symbols].sort((left, right) => left.position - right.position || left.symbol.localeCompare(right.symbol));
}

function isAbortError(error: unknown) {
  return isAxiosError(error) && (error.code === "ERR_CANCELED" || error.name === "CanceledError");
}

function actionMessage(error: unknown) {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 400) return "That change was rejected. Check the entry and try again.";
  if (status === 404) return "That watchlist or symbol is no longer available.";
  if (status === 409) return "Limit reached or name already in use. A session can keep 20 watchlists, with 50 symbols on each.";
  if (status === 422) return "That entry could not be saved. Check it and try again.";
  return "Could not confirm the change. Check the refreshed lists before trying again.";
}

function WatchlistCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="watchlists-title" className="dashboard-card min-w-0">
      <div className="dashboard-card-header">
        <div>
          <h2 className="text-sm font-semibold text-slate-100" id="watchlists-title">
            {title}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{detail}</p>
        </div>
      </div>
      <div className="dashboard-card-body space-y-4">{children}</div>
    </section>
  );
}

function WatchlistEditor({
  ownerId,
  onUseInChart,
  onUseInResearch,
}: WatchlistsProps & { ownerId: number }) {
  const queryClient = useQueryClient();
  const generation = useRef(0);
  const busy = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createName, setCreateName] = useState("");
  const [rename, setRename] = useState("");
  const [symbolDraft, setSymbolDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const watchlistsQuery = useQuery({
    queryKey: ["watchlists", ownerId],
    queryFn: ({ signal }) => fetchWatchlists(signal),
    retry: false,
  });

  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
      busy.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      void queryClient.cancelQueries({ queryKey: ["watchlists", ownerId] });
      queryClient.removeQueries({ queryKey: ["watchlists", ownerId] });
    };
  }, [ownerId, queryClient]);

  function alive(stamp: number) {
    return stamp === generation.current;
  }

  const lists = watchlistsQuery.isSuccess ? watchlistsQuery.data.watchlists : [];
  const selected = lists.find((list) => list.id === selectedId) ?? null;
  const members = selected ? orderedSymbols(selected.symbols) : [];
  const listsFull = lists.length >= LIST_CAP;
  const membersFull = members.length >= MEMBER_CAP;

  async function refresh(stamp: number) {
    try {
      await queryClient.fetchQuery({
        queryKey: ["watchlists", ownerId],
        queryFn: ({ signal }) => fetchWatchlists(signal),
        staleTime: 0,
      });
      if (!alive(stamp)) return;
      setRefreshFailed(false);
    } catch (error) {
      if (!alive(stamp) || isAbortError(error)) return;
      setRefreshFailed(true);
    }
  }

  async function run(work: (signal: AbortSignal) => Promise<void>, success: string) {
    if (busy.current) return;
    busy.current = true;
    const stamp = generation.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPending(true);
    setActionError(null);
    setFieldError(null);
    setNotice(null);
    setRefreshFailed(false);
    try {
      await work(controller.signal);
      if (!alive(stamp) || controller.signal.aborted) return;
      setNotice(success);
      await refresh(stamp);
    } catch (error) {
      if (!alive(stamp) || controller.signal.aborted || isAbortError(error)) return;
      setNotice(null);
      setActionError(actionMessage(error));
      await refresh(stamp);
    } finally {
      if (alive(stamp)) {
        busy.current = false;
        setPending(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  }

  function chooseList(id: number) {
    if (pending) return;
    setSelectedId(id);
    setConfirmDelete(false);
    setRename("");
    setSymbolDraft("");
    setFieldError(null);
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || listsFull) return;
    const name = createName.trim();
    if (name.length === 0 || codePoints(name) > NAME_POINTS) {
      setFieldError(name.length === 0 ? "Enter a watchlist name." : "Use a name of 40 characters or fewer.");
      return;
    }
    void run(async (signal) => {
      const created = await createWatchlist(name, signal);
      if (!signal.aborted) {
        setCreateName("");
        setSelectedId(created.id);
      }
    }, "Watchlist created.");
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || selected === null) return;
    const name = rename.trim();
    if (name.length === 0 || codePoints(name) > NAME_POINTS) {
      setFieldError(name.length === 0 ? "Enter a watchlist name." : "Use a name of 40 characters or fewer.");
      return;
    }
    const id = selected.id;
    void run(async (signal) => {
      await updateWatchlist(id, { name }, signal);
      if (!signal.aborted) setRename("");
    }, "Watchlist renamed.");
  }

  function submitSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || selected === null || membersFull) return;
    const symbol = symbolDraft.trim().toUpperCase();
    if (symbol.length === 0 || codePoints(symbol) > SYMBOL_POINTS) {
      setFieldError(symbol.length === 0 ? "Enter a symbol." : "Use a symbol of 20 characters or fewer.");
      return;
    }
    const id = selected.id;
    void run(async (signal) => {
      await addWatchlistSymbol(id, symbol, signal);
      if (!signal.aborted) setSymbolDraft("");
    }, "Symbol saved.");
  }

  function move(index: number, direction: -1 | 1) {
    if (pending || selected === null) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= members.length) return;
    const order = members.map((member) => member.symbol);
    const swapped = [...order];
    const current = swapped[index];
    const neighbor = swapped[nextIndex];
    if (current === undefined || neighbor === undefined) return;
    swapped[index] = neighbor;
    swapped[nextIndex] = current;
    const id = selected.id;
    void run((signal) => updateWatchlist(id, { symbol_order: swapped }, signal).then(() => undefined), "Symbol order saved.");
  }

  function removeMember(symbol: string) {
    if (pending || selected === null) return;
    const id = selected.id;
    void run((signal) => removeWatchlistSymbol(id, symbol, signal), "Symbol removed.");
  }

  function removeList() {
    if (pending || selected === null) return;
    const id = selected.id;
    void run(async (signal) => {
      await deleteWatchlist(id, signal);
      if (!signal.aborted) {
        setSelectedId(null);
        setConfirmDelete(false);
        setRename("");
      }
    }, "Watchlist deleted.");
  }

  const control = "field-control disabled:cursor-not-allowed disabled:opacity-50";
  const quietButton =
    "rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 disabled:cursor-not-allowed disabled:opacity-50";
  const primaryButton =
    "rounded-xl bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <WatchlistCard detail="Saved to your account." title="Watchlists">
      {watchlistsQuery.isPending ? (
        <p className="text-sm text-slate-300" role="status">Loading watchlists.</p>
      ) : null}
      {watchlistsQuery.isSuccess && lists.length === 0 ? (
        <p className="text-sm text-slate-300" role="status">No watchlists yet.</p>
      ) : null}
      {watchlistsQuery.isSuccess ? (
        <div className="space-y-4">
          {lists.length > 0 ? (
            <div className="min-w-0">
              <label className="text-xs font-semibold text-slate-300" htmlFor="watchlist-select">Watchlist</label>
              <select
                className={control}
                disabled={pending}
                id="watchlist-select"
                onChange={(event) => chooseList(Number(event.target.value))}
                value={selected?.id ?? ""}
              >
                <option value="">Choose a watchlist</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submitCreate}>
            <div className="min-w-0 flex-1">
              <label className="text-xs font-semibold text-slate-300" htmlFor="watchlist-create-name">New watchlist</label>
              <input
                autoComplete="off"
                className={control}
                disabled={pending || listsFull}
                id="watchlist-create-name"
                maxLength={FIELD_UNITS}
                onChange={(event) => setCreateName(event.target.value)}
                value={createName}
              />
            </div>
            <button className={primaryButton} disabled={pending || listsFull} type="submit">Create watchlist</button>
          </form>
          {listsFull ? <p className="text-xs text-slate-400">You can keep up to 20 watchlists.</p> : null}

          {selected ? (
            <div className="space-y-4 border-t border-slate-800 pt-4">
              <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submitRename}>
                <div className="min-w-0 flex-1">
                  <label className="text-xs font-semibold text-slate-300" htmlFor="watchlist-rename">Rename</label>
                  <input
                    autoComplete="off"
                    className={control}
                    disabled={pending}
                    id="watchlist-rename"
                    maxLength={FIELD_UNITS}
                    onChange={(event) => setRename(event.target.value)}
                    value={rename}
                  />
                </div>
                <button className={quietButton} disabled={pending} type="submit">Save name</button>
              </form>

              {confirmDelete ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center" role="group" aria-label="Confirm watchlist delete">
                  <p className="text-sm text-slate-200">Delete this watchlist?</p>
                  <button className="rounded-xl border border-rose-400/50 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300/50 disabled:opacity-50" disabled={pending} onClick={removeList} type="button">Delete watchlist</button>
                  <button className={quietButton} disabled={pending} onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
                </div>
              ) : (
                <button className={quietButton} disabled={pending} onClick={() => setConfirmDelete(true)} type="button">Delete</button>
              )}

              <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submitSymbol}>
                <div className="min-w-0 flex-1">
                  <label className="text-xs font-semibold text-slate-300" htmlFor="watchlist-symbol">Add symbol</label>
                  <input
                    autoCapitalize="characters"
                    autoComplete="off"
                    className={control}
                    disabled={pending || membersFull}
                    id="watchlist-symbol"
                    maxLength={FIELD_UNITS}
                    onChange={(event) => setSymbolDraft(event.target.value)}
                    spellCheck={false}
                    value={symbolDraft}
                  />
                </div>
                <button className={primaryButton} disabled={pending || membersFull} type="submit">Add symbol</button>
              </form>
              {membersFull ? <p className="text-xs text-slate-400">This watchlist already has 50 symbols. Remove one to add another.</p> : null}

              {members.length === 0 ? (
                <p className="text-sm text-slate-300" role="status">No symbols on this watchlist.</p>
              ) : (
                <ul className="max-h-96 min-w-0 divide-y divide-slate-800 overflow-auto overscroll-contain border-y border-slate-800">
                  {members.map((member, index) => (
                    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" key={`${member.position}-${member.symbol}`}>
                      <span className="font-mono text-sm font-semibold text-slate-100">{member.symbol}</span>
                      <div className="flex flex-wrap gap-2">
                        <button aria-label={`Move ${member.symbol} up`} className={quietButton} disabled={pending || index === 0} onClick={() => move(index, -1)} type="button">Move up</button>
                        <button aria-label={`Move ${member.symbol} down`} className={quietButton} disabled={pending || index === members.length - 1} onClick={() => move(index, 1)} type="button">Move down</button>
                        <button aria-label={`Remove ${member.symbol}`} className={quietButton} disabled={pending} onClick={() => removeMember(member.symbol)} type="button">Remove</button>
                        <button className={quietButton} disabled={pending} onClick={() => onUseInResearch(member.symbol)} type="button">Use in research</button>
                        <button className={quietButton} disabled={pending} onClick={() => onUseInChart(member.symbol)} type="button">Use in chart</button>
                        <Link aria-label={`Trade ${member.symbol}`} className={`${quietButton} inline-flex items-center`} to={`/trades?symbol=${encodeURIComponent(member.symbol)}`}>Trade</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-400">
                Research fills the company symbol only. Chart fills the history symbol only — choose a cached series and select View history to plot it.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {fieldError ? <p className="text-sm text-rose-200" role="alert">{fieldError}</p> : null}
      {actionError ? <p className="text-sm text-rose-200" role="alert">{actionError}</p> : null}
      {notice ? <p className="text-sm text-emerald-200" role="status">{notice}</p> : null}
      {watchlistsQuery.isError || refreshFailed ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-200" role="alert">
            {notice
              ? "The saved change stands, but the latest watchlists could not be refreshed."
              : "Watchlists could not be refreshed."}
          </p>
          <button
            className={quietButton}
            disabled={watchlistsQuery.isFetching}
            onClick={() => void refresh(generation.current)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
    </WatchlistCard>
  );
}

export function Watchlists({ onUseInChart, onUseInResearch }: WatchlistsProps) {
  const { token, isAuthenticated, isInitializing } = useAuth();
  const me = useQuery({
    queryKey: ["me", token],
    queryFn: fetchMe,
    enabled: isAuthenticated && Boolean(token) && !isInitializing,
    retry: false,
  });
  const ownerId = Boolean(token) && me.isSuccess ? readOwnerId(me.data) : null;

  if (isInitializing) {
    return (
      <WatchlistCard detail="Private lists stay on this account." title="Watchlists">
        <p className="text-sm text-slate-300" role="status">Checking your session.</p>
      </WatchlistCard>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <WatchlistCard detail="Private lists stay on this account." title="Watchlists">
        <Link
          className="text-sm font-semibold text-emerald-300 underline decoration-emerald-400/40 underline-offset-4 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
          state={{ from: { pathname: "/market", search: "" } }}
          to="/login"
        >
          Sign in to keep watchlists
        </Link>
      </WatchlistCard>
    );
  }

  if (me.isPending || me.isError || ownerId === null) {
    return (
      <WatchlistCard detail="Saved to your account." title="Watchlists">
        {me.isPending ? <p className="text-sm text-slate-300" role="status">Loading your account.</p> : null}
        {me.isError || (me.isSuccess && ownerId === null) ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-200" role="alert">Watchlists are unavailable for this session.</p>
            <button
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
              onClick={() => void me.refetch()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}
      </WatchlistCard>
    );
  }

  return <WatchlistEditor key={`${ownerId}:${token}`} onUseInChart={onUseInChart} onUseInResearch={onUseInResearch} ownerId={ownerId} />;
}
