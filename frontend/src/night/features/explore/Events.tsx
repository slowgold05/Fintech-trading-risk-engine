import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { Coverage, Provenance } from "../../api";
import { Button, Field, Panel, RestInstrument, type InstrumentStatus } from "../../inner";
import { errorDetail, sourceUrl, useMarketRead } from "./marketRead";
import { EventTimeline } from "./EventTimeline";
import "./events.css";

type Kind = "filing" | "dividend" | "split";
type EventItem = { kind: Kind; date: string; title: string; url: string; source: Provenance;
  form?: string; cash_per_share?: string; currency?: string; ratio?: string };
type EventResponse = { symbol: string; coverage: Coverage; coverage_by_kind: Record<Kind, Coverage>; items: EventItem[] };
const kinds: Record<Kind,string> = { filing: "Filings", dividend: "Dividends", split: "Splits" };

function CompanyEvents({ symbol }: { symbol: string }) {
  const [limit, setLimit] = useState(20);
  const query = useMarketRead<EventResponse>("events", `/night/events/${encodeURIComponent(symbol)}`, {limit}, {symbol, limit});
  const data = query.isSuccess ? query.data : undefined;
  const records = useMemo(() => (data?.items ?? []).flatMap(item => {
    const url = sourceUrl(item.url);
    return url ? [{ ...item, url }] : [];
  }), [data]);
  const status: InstrumentStatus | undefined = query.isError ? {
    kind:"error", role:"alert", title:"Could not load company events",
    action:<><p>{errorDetail(query.error)}</p><Button onClick={() => void query.refetch()}>Retry</Button></>,
  } : query.isPending ? { kind:"loading", title:"Loading company events…" } : !records.length ? {
    kind:"unavailable", title:`No sourced event records for ${symbol}`, action:<p>The cache has no linked records for this company.</p>,
  } : undefined;

  return <div className="company-events" data-testid="night-events"><div className="event-layout" data-testid={data ? "events-sources" : undefined}>
    <Panel title={`${symbol} company events`} className="event-chart"
      actions={<Field id="events-limit" label="Record limit"><select value={limit} onChange={e => setLimit(Number(e.target.value))}>
        <option value={20}>20 records</option><option value={50}>50 records</option>
      </select></Field>}>
      {status ? <RestInstrument label="Event timeline" status={status}/> : <EventTimeline records={records}/>}
    </Panel>
    {data && <Panel className="event-evidence" title="Event coverage">
      <p className="event-total"><b>{records.length}</b> sourced records</p>
      <p className="event-note">{data.coverage} overall coverage</p>
      <dl>{(Object.keys(kinds) as Kind[]).map(kind => <div key={kind}>
        <dt>{kinds[kind]}</dt><dd>{data.coverage_by_kind[kind] === "missing" ? "No stored coverage" : `${data.coverage_by_kind[kind]} coverage`}</dd>
      </div>)}</dl>
      {records.length > 0 && <div className="event-source-summary">
        <small>Record sources</small>
        <p>{[...new Set(records.map(item => item.source.provider === "sec_edgar" ? "SEC EDGAR" : item.source.provider))].join(" · ")}</p>
        <small>Latest linked date · {records[0].date}</small>
      </div>}
    </Panel>}
    {records.length > 0 && <Panel title="Event records" className="event-ledger">
      <ol>{records.map(item => <li key={`${item.kind}-${item.url}-${item.date}`}>
        <time dateTime={item.date}>{item.date}</time>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
        <span>{item.source.provider === "sec_edgar" ? "SEC EDGAR" : item.source.provider} · {item.source.basis} record</span>
      </li>)}</ol>
    </Panel>}
  </div></div>;
}

export function Events() {
  const { symbol } = useParams();
  return symbol ? <CompanyEvents symbol={symbol.toUpperCase()} key={symbol.toUpperCase()} /> :
    <RestInstrument label="Event timeline" status={{kind:"unavailable", title:"Choose a company to view its events."}}/>;
}
