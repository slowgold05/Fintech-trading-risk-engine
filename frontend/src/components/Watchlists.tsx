import { Button, Field, Panel, RestInstrument, State } from "../night/inner";
import { keys } from "../night/api";
import { fetchMarketUniverse } from "../api/market";
import { hasCompanyDetail } from "../night/features/discover/companyLookup";
import "./Watchlists.css";
import { WatchlistComposition } from "../night/features/discover/WatchlistComposition";
import { Select } from "../design/Select";
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
  standalone?: boolean;
  initialSymbol?: string;
  designed?: boolean;
  onUseInResearch?: (symbol: string) => void;
  onUseInChart?: (symbol: string) => void;
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
    <Panel id="watchlists-title" data-testid="market-watchlists" className="watch-editor" title={title} subtitle={detail}>
      {children}
    </Panel>
  );
}

function WatchlistEditor({
  designed = false,
  standalone = false,
  initialSymbol = "",
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
  const [symbolDraft, setSymbolDraft] = useState(initialSymbol);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const watchlistsQuery = useQuery({
    queryKey: keys.account(ownerId, "watchlists"),
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
      void queryClient.cancelQueries({ queryKey: keys.account(ownerId, "watchlists") });
      queryClient.removeQueries({ queryKey: keys.account(ownerId, "watchlists") });
    };
  }, [ownerId, queryClient]);

  function alive(stamp: number) {
    return stamp === generation.current;
  }

  const lists = watchlistsQuery.isSuccess ? watchlistsQuery.data.watchlists : [];
  const selected = (selectedId === null && standalone
    ? lists[0]
    : lists.find((list) => list.id === selectedId)) ?? null;
  const members = selected ? orderedSymbols(selected.symbols) : [];
  const catalog = useQuery({
    queryKey: keys.universe(ownerId, "", 1000),
    queryFn: () => fetchMarketUniverse("", 1000),
    enabled: members.length > 0,
    select: (data) => new Map(data.items.map(item => [item.symbol, item])),
    retry: false,
    staleTime: 300000,
  });
  const listsFull = lists.length >= LIST_CAP;
  const membersFull = members.length >= MEMBER_CAP;

  async function refresh(stamp: number) {
    try {
      await queryClient.cancelQueries({ queryKey: keys.account(ownerId, "watchlists") });
      if (!alive(stamp)) return;
      await queryClient.invalidateQueries({ queryKey: ["watchlists", ownerId], refetchType: "active" });
      await queryClient.fetchQuery({
        queryKey: keys.account(ownerId, "watchlists"),
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
    setSymbolDraft(initialSymbol);
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
        setConfirmDelete(false);
        setRename("");
        setSymbolDraft(initialSymbol);
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

  function saveSymbol(value: string) {
    if (pending || selected === null || membersFull) return;
    const symbol = value.trim().toUpperCase();
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

  const manage = selected && <>
    <form className="watch-form" onSubmit={submitRename}>
      <Field id="watchlist-rename" label="Rename">
        <input autoComplete="off" disabled={pending} maxLength={FIELD_UNITS}
          onChange={(event) => setRename(event.target.value)} value={rename} />
      </Field>
      <Button disabled={pending} type="submit">Save name</Button>
    </form>
    {confirmDelete ? <div className="watch-actions" role="group" aria-label="Confirm watchlist delete">
      <p>Delete this watchlist?</p>
      <Button variant="danger" disabled={pending} onClick={removeList}>Delete watchlist</Button>
      <Button disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</Button>
    </div> : <Button disabled={pending} onClick={() => setConfirmDelete(true)}>Delete</Button>}
  </>;

  const addSymbolForm = <>
          <form className="watch-form" onSubmit={(event) => { event.preventDefault(); saveSymbol(symbolDraft); }}>
            <Field id="watchlist-symbol" label="Add symbol">
              <input autoCapitalize="characters" autoComplete="off" disabled={pending || membersFull}
                maxLength={FIELD_UNITS} placeholder="Ticker" onChange={(event) => setSymbolDraft(event.target.value)}
                spellCheck={false} value={symbolDraft} />
            </Field>
            <Button variant="primary" disabled={pending || membersFull} type="submit">Add symbol</Button>
          </form>
          {membersFull && <p>This watchlist already has 50 symbols. Remove one to add another.</p>}
  </>;

  const chooseWatchlist = lists.length > 0 && <Field id="watchlist-select" label="Watchlist">
    <Select designed={designed} id="watchlist-select" disabled={pending}
      className="field-control" onValueChange={value => chooseList(Number(value))} value={selected?.id ?? ""}>
      <option value="">Choose a watchlist</option>
      {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
    </Select>
  </Field>;
  const refreshError = notice ? "The saved change stands, but the latest watchlists could not be refreshed." : "Watchlists could not be refreshed.";
  const retryLists = <Button disabled={watchlistsQuery.isFetching} onClick={() => void refresh(generation.current)}>Retry</Button>;

  return (
    <section className="watch-editor" aria-label="Watchlist editor">
      {!standalone && <h2 id="watchlists-title">Watchlists</h2>}
      {watchlistsQuery.isPending && (standalone ? <RestInstrument label="Sector mix" status={{kind:"loading",title:"Loading watchlists."}}/> : <State kind="loading" title="Loading watchlists." />)}
      {standalone && watchlistsQuery.isError && <RestInstrument label="Sector mix" status={{kind:"error",title:refreshError,role:"alert",action:retryLists}}/>}
      {watchlistsQuery.isSuccess && <div className="watch-layout">
        {standalone && <WatchlistComposition members={members} name={selected?.name} catalog={catalog.data} selector={chooseWatchlist}
          status={members.length && catalog.isPending ? {kind:"loading",title:"Loading sector classifications…"} :
            members.length && catalog.isError ? {kind:"error",title:"Sector classifications unavailable",action:<Button onClick={() => void catalog.refetch()}>Retry sectors</Button>} : undefined} />}
        <Panel id={standalone ? "watchlist-tools" : undefined} className="watch-library" title="Saved lists" subtitle={`${lists.length} of ${LIST_CAP} lists`}>
          {lists.length === 0 && <State kind="empty" title="No watchlists yet." />}
          {standalone && selected && <div className="watch-add"><h3>{selected.name}</h3>{addSymbolForm}</div>}
          {!standalone && chooseWatchlist}
          <form className="watch-form" onSubmit={submitCreate}>
            <Field id="watchlist-create-name" label="New watchlist">
              <input autoComplete="off" data-testid="watchlist-name" disabled={pending || listsFull}
                maxLength={FIELD_UNITS} onChange={(event) => setCreateName(event.target.value)} value={createName} />
            </Field>
            <Button data-testid="watchlist-create" disabled={pending || listsFull} type="submit">Create watchlist</Button>
          </form>
          {listsFull && <p>You can keep up to 20 watchlists.</p>}
          {standalone && selected && <details className="watch-manage"><summary>Manage list</summary>{manage}</details>}
        </Panel>
        {selected && <Panel className="watch-members" title={selected.name}
          subtitle={`${members.length} of ${MEMBER_CAP} symbols`}>
          {!standalone && addSymbolForm}
          {members.length === 0 ? <State kind="empty" title="No symbols on this watchlist."
            action={standalone && <Button data-testid="watchlist-add-AAPL" disabled={pending}
              onClick={() => saveSymbol("AAPL")}>Add AAPL</Button>} /> :
            <ol className="watch-rows" aria-label="Symbols in saved order">
              {members.map((member, index) => {
                const item = catalog.data?.get(member.symbol);
                const company = item && hasCompanyDetail(item) ? item.company_name : undefined;
                return <li data-testid={`watchlist-item-${member.symbol}`} key={member.symbol}>
                  <div className="watch-identity"><span className="watch-position">{index + 1}</span>
                    <div>{company !== undefined ?
                      <Link className="watch-symbol" to={`/market/${encodeURIComponent(member.symbol)}`}>{member.symbol}</Link> :
                      <strong className="watch-symbol">{member.symbol}</strong>}
                      {standalone && <small>{company ?? (catalog.isPending ? "Checking coverage…" : "Company detail unavailable")}</small>}
                    </div>
                  </div>
                  <div className="watch-actions">
                    <Button aria-label={`Move ${member.symbol} up`} disabled={pending || index === 0} onClick={() => move(index, -1)}>{standalone ? <span aria-hidden="true">↑</span> : "Move up"}</Button>
                    <Button aria-label={`Move ${member.symbol} down`} disabled={pending || index === members.length - 1} onClick={() => move(index, 1)}>{standalone ? <span aria-hidden="true">↓</span> : "Move down"}</Button>
                    <Button aria-label={`Remove ${member.symbol}`} disabled={pending} onClick={() => removeMember(member.symbol)}>Remove</Button>
                    {onUseInResearch && <Button disabled={pending} onClick={() => onUseInResearch(member.symbol)}>Use in research</Button>}
                    {onUseInChart && <Button disabled={pending} onClick={() => onUseInChart(member.symbol)}>Use in chart</Button>}
                    {!standalone && <Link aria-label={`Trade ${member.symbol}`} className="nk-button" to={`/trades?symbol=${encodeURIComponent(member.symbol)}`}>Trade</Link>}
                  </div>
                </li>;
              })}
            </ol>}
          {catalog.isError && <State kind="error" title="Company links could not be loaded."
            action={<Button onClick={() => void catalog.refetch()}>Retry company lookup</Button>} />}
          {!standalone && manage}
        </Panel>}
      </div>}
      {fieldError && <p role="alert">{fieldError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {notice && <p role="status" data-testid={notice === "Watchlist created." && selected ? "watchlist-created" : undefined}>{notice}</p>}
      {(watchlistsQuery.isError ? !standalone : refreshFailed) && <State kind="error" role="alert" title={refreshError} action={retryLists} />}
    </section>
  );
}

// AuthProvider supplies one context object per session. Preview and editor share
// an opaque cache partition, including across access-token rotation.
const sessionIds = new WeakMap<object, number>();
let nextSessionId = 1;
function useWatchlistOwner() {
  const auth = useAuth();
  const { token, isAuthenticated, isInitializing } = auth;
  let sessionId = sessionIds.get(auth);
  if (sessionId === undefined) {
    sessionId = nextSessionId++;
    sessionIds.set(auth, sessionId);
  }
  const me = useQuery({
    queryKey: [...keys.me, "watchlist-session", sessionId],
    queryFn: fetchMe,
    enabled: isAuthenticated && Boolean(token) && !isInitializing,
    retry: false,
  });
  const ownerId = Boolean(token) && me.isSuccess ? readOwnerId(me.data) : null;

  return { token, isAuthenticated, isInitializing, me, ownerId, sessionId };
}

export function WatchlistPreview() {
  const { ownerId, me } = useWatchlistOwner();
  const collection = useQuery({
    queryKey: keys.account(ownerId ?? 0, "watchlists"),
    queryFn: ({ signal }) => fetchWatchlists(signal),
    enabled: ownerId !== null,
    retry: false,
    staleTime: 300000,
  });
  const lists = ownerId !== null ? collection.data?.watchlists : undefined;
  const unavailable = me.isError || collection.isError || (me.isSuccess && ownerId === null);
  return (
    <span className="fold-preview">
      <em>{lists ? lists.length : unavailable ? "Unavailable" : "Loading"}</em>
      <small>Saved lists</small>
    </span>
  );
}

export function Watchlists({ standalone, initialSymbol, designed, onUseInChart, onUseInResearch }: WatchlistsProps) {
  const { token, isAuthenticated, isInitializing, me, ownerId, sessionId } = useWatchlistOwner();

  if (standalone && (isInitializing || (isAuthenticated && token && (me.isPending || me.isError || ownerId === null)))) {
    const loading = isInitializing || me.isPending;
    return <RestInstrument label="Sector mix" status={loading ? {kind:"loading",title:isInitializing ? "Checking your session." : "Loading your account."} :
      {kind:"error",role:"alert",title:"Watchlists are unavailable for this session.",action:<Button onClick={()=>void me.refetch()}>Retry</Button>}} />;
  }
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

  return <WatchlistEditor initialSymbol={initialSymbol} standalone={standalone} designed={designed} key={sessionId} onUseInChart={onUseInChart} onUseInResearch={onUseInResearch} ownerId={ownerId} />;
}
