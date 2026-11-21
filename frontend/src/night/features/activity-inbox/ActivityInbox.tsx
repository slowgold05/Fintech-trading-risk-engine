import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { useAuth } from "../../../context/useAuth";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Page, Panel, RestInstrument, ShareInstrument, State } from "../../inner";
import { DataStamp } from "../../kit";
import { features } from "../../registry";
import { markInboxRead, pageSize, readInbox, type InboxEvent, type InboxFilter } from "./inbox";
import "./inbox.css";

const labels = {fill:"Paper fill", alert_triggered:"Alert triggered", demo_started:"Demo started", demo_reset:"Demo reset"};
function EventDetail({ event }: { event: InboxEvent }) {
  if (event.kind === "demo_reset" || event.kind === "demo_started")
    return <Link to="/portfolio">Open portfolio</Link>;
  const alert = event.kind === "alert_triggered";
  const alertRoute = alert && features.find(route => route.id === "alerts" && route.path === "/activity/alerts");
  return <>
    {alert ? <p>Trigger close · {event.price ?? "Unavailable"} USD<br />Target · {event.target ?? "Unavailable"} USD</p> :
      <p>{event.side === "buy" ? "Bought" : event.side === "sell" ? "Sold" : "Filled"} {event.quantity ?? "Unavailable"} shares
        {event.price !== null && <> at <strong>{event.price} USD</strong></>}</p>}
    <p>{alert ? "Evaluation session" : "Observation session"} · {event.session_date ?? "Unavailable"}</p>
    <DataStamp source={event.source} />
    {!alert && event.order_id !== null && <Link to={'/trades?order=' + event.order_id}>Open receipt #{event.order_id}</Link>}
    {alertRoute && <Link to={alertRoute.path}>Open alerts</Link>}
  </>;
}

function OwnedInbox({ owner }: { owner: number }) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const client = useQueryClient();
  const filterControl = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: keys.account(owner, "activity-inbox", filter, cursor, pageSize),
    queryFn: ({ signal }) => readInbox(filter, cursor, signal), retry: false,
  });
  const mark = useMutation({
    mutationFn: markInboxRead,
    onSuccess: () => client.invalidateQueries({queryKey: keys.account(owner, "activity-inbox")}),
    retry: false,
  });
  function selectFilter(next: InboxFilter) {
    if (filter === next) return;
    setFilter(next); setCursors([null]); mark.reset();
  }
  function paginate(next: (string | null)[]) {
    setCursors(next); mark.reset(); listHeading.current?.focus();
  }
  function markEvent(id: string) {
    mark.mutate(id, { onSuccess: () => {
      if (filter === "unread") filterControl.current?.focus();
      else listHeading.current?.focus();
    } });
  }
  const data = query.isError ? undefined : query.data;
  const status = isAxiosError(query.error) ? query.error.response?.status : undefined;
  const markStatus = isAxiosError(mark.error) ? mark.error.response?.status : undefined;
  const parts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.items ?? []) {
      const name = item.symbol ?? (item.kind === "demo_reset" || item.kind === "demo_started" ? "Paper book" : "No ticker");
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name,value]) => ({name,value})).sort((a,b) => b.value - a.value);
  }, [data]);
  const denied = status === 401 || status === 403;
  return <Page title="Activity inbox" className="inbox-page" testId="night-activity-inbox" eyebrow="Paper activity"
    actions={<Button busy={query.isFetching} onClick={() => void query.refetch()}>Refresh inbox</Button>}>
    <Page.Main><Panel title="Activity by ticker" subtitle={`${filter === "all" ? "All activity" : "Unread activity"} · page ${cursors.length}${data ? ` · ${data.items.length} ${data.items.length === 1 ? "entry" : "entries"}` : ""}`}>
      <div className="inbox-instrument">
        <ShareInstrument parts={parts} centrepiece={parts.length > 0} format={String} label="Entries on this page by ticker"
          status={query.isError ? {kind:denied ? "unavailable" : "error", title:denied ? "Trader access required" : "Inbox could not be loaded",
            action:<Button onClick={() => void query.refetch()}>Retry inbox</Button>} :
            !data ? {kind:"loading", title:"Reading activity…"} :
            !data.items.length ? {kind:"empty", title:filter === "unread" ? "No unread entries on this page" : "No activity on this page",
              action:<p>{cursor ? "Return to the previous page to see newer entries." : "New activity in your current book will appear here."}</p>} : undefined}/>
      </div>
      <div className="inbox-controls">
        <div className="inbox-total" data-testid="inbox-unread-count" aria-live="polite"><strong>{data?.unread_count ?? "—"}</strong> unread <small>across the book</small></div>
        <div className="inbox-filters" role="group" aria-label="Filter entries">
          <Button aria-pressed={filter === "all"} onClick={() => selectFilter("all")}>All activity</Button>
          <button ref={filterControl} type="button" className="nk-button" aria-pressed={filter === "unread"} onClick={() => selectFilter("unread")}>Unread only</button>
        </div>
      </div>
    </Panel></Page.Main>
    {data && <Page.Aside><Panel title="Feed coverage">
      <p>Last <strong>{data.history_days} days</strong> in the current paper book. Resetting the book removes its earlier fills from this feed.</p>
      <dl className="inbox-sources">{([["Posted fills", data.sources.fills],["Demo activity", data.sources.demo],["Alert triggers", data.sources.alerts]] as const)
        .map(([label, included]) => <div key={label}><dt>{label}</dt><dd>{included ? "Included" : "Unavailable"}</dd></div>)}</dl>
      <small>Feed read {formatUtcDateTime(data.read_at)}</small>
    </Panel></Page.Aside>}
    <Page.Full><Panel>
      <h2 ref={listHeading} tabIndex={-1}>{filter === "all" ? "Recent entries" : "Unread entries"}</h2>
      {mark.isError && <State kind="error"
        title={markStatus === 404 ? "This entry is no longer available" : markStatus === 401 || markStatus === 403 ? "Read access denied" : "Could not mark this entry read"}
        action={markStatus === 404 || markStatus === 403 || markStatus === 401 ?
          <Button onClick={() => { mark.reset(); void query.refetch(); }}>Refresh entries</Button> :
          <Button onClick={() => markEvent(mark.variables)}>Retry mark read</Button>} />}
      {data && data.items.length > 0 && <ol className="inbox-events">{data.items.map(event => <li key={event.id} data-event-id={event.id}>
              <div className="inbox-event-head"><h3>{labels[event.kind]}{event.symbol && ' · ' + event.symbol}</h3>
                <span className="inbox-read-state" data-unread={event.read_at === null}>{event.read_at === null ? "Unread" : "Read"}</span></div>
              <p className="inbox-time">{event.kind === "fill" ? "Executed" : event.kind === "alert_triggered" ? "Triggered" : "Posted"} · {formatUtcDateTime(event.occurred_at)}</p>
              <EventDetail event={event} />
              {event.read_at === null && <Button data-testid="inbox-mark-read" disabled={mark.isPending}
                onClick={() => markEvent(event.id)}>Mark read</Button>}
            </li>)}</ol>}
      {(cursor || data?.next_cursor) && <nav className="inbox-paging" aria-label="Inbox pages">
        <Button disabled={!cursor} onClick={() => paginate(cursors.slice(0,-1))}>Newer entries</Button>
        <span>Page {cursors.length}</span>
        <Button disabled={!data?.next_cursor} onClick={() => { if (data?.next_cursor) paginate([...cursors, data.next_cursor]); }}>Older entries</Button>
      </nav>}
    </Panel></Page.Full>
  </Page>;
}

export function ActivityInbox() {
  const { isAuthenticated, isInitializing } = useAuth();
  const identity = useQuery({ queryKey: keys.me, queryFn: fetchMe, enabled: isAuthenticated, retry: false });
  if (isAuthenticated && identity.data?.role === "trader" && !identity.isError)
    return <OwnedInbox key={identity.data.id} owner={identity.data.id} />;
  return <Page title="Activity inbox" className="inbox-page" testId="night-activity-inbox"><Page.Full>
    <RestInstrument label="Inbox activity" status={isInitializing || (isAuthenticated && identity.isPending) ? {kind:"loading", title:"Checking trader access…"} :
      isAuthenticated && identity.isError ? {kind:"error", title:"Account access could not be checked", action:<Button onClick={() => void identity.refetch()}>Retry access check</Button>} :
        {kind:"unavailable", title:"Trader access required"}}/>
  </Page.Full></Page>;
}
