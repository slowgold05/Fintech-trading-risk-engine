import { useState } from "react";
import { useParams } from "react-router-dom";
import type { Coverage, Provenance } from "../../api";
import { Field, Panel, State } from "../../kit";
import { sourceUrl, useMarketRead } from "./marketRead";
import { Results } from "./Results";
import "./events.css";

type Kind = "filing" | "dividend" | "split";
type EventItem = { kind: Kind; date: string; title: string; url: string; source: Provenance;
  form?: string; cash_per_share?: string; currency?: string; ratio?: string };
type EventResponse = { symbol: string; coverage: Coverage; coverage_by_kind: Record<Kind, Coverage>; items: EventItem[] };
const kinds: Record<Kind,string> = { filing: "Filings", dividend: "Dividends", split: "Splits" };

function CompanyEvents({ symbol }: { symbol: string }) {
  const [limit, setLimit] = useState(20);
  const query = useMarketRead<EventResponse>("events", `/night/events/${encodeURIComponent(symbol)}`, {limit}, {symbol, limit});
  return <Panel className="explore company-events" data-testid="night-events" title={`${symbol} company events`}
    actions={<Field id="events-limit" label="Record limit"><select value={limit} onChange={e => setLimit(Number(e.target.value))}>
      <option value={20}>20 records</option><option value={50}>50 records</option>
    </select></Field>}>
    <Results query={query} label="company events">{data => {
      const records = data.items.filter(item => sourceUrl(item.url));
      return <div data-testid="events-sources">
        <dl className="event-coverage">{(Object.keys(kinds) as Kind[]).map(kind => <div key={kind}>
          <dt>{kinds[kind]}</dt><dd>{data.coverage_by_kind[kind] === "missing" ? "No stored coverage" : `${data.coverage_by_kind[kind]} coverage`}</dd>
        </div>)}</dl>
        {records.length ? <>
          <p className="context">{records.length} sourced records · {data.coverage} overall coverage</p>
          <ol className="event-records">{records.map(item => <li key={`${item.kind}-${item.url}-${item.date}`}>
            <time dateTime={item.date}>{item.date}</time>
            <a href={sourceUrl(item.url)!} target="_blank" rel="noopener noreferrer">{item.title}</a>
            <span>{item.source.provider === "sec_edgar" ? "SEC EDGAR" : item.source.provider} · {item.source.basis} record</span>
          </li>)}</ol>
        </> : <State kind="unavailable" title={`No sourced event records for ${data.symbol}`} detail="The cache has no linked records for this company." />}
      </div>;
    }}</Results>
  </Panel>;
}

export function Events() {
  const { symbol } = useParams();
  return symbol ? <CompanyEvents symbol={symbol.toUpperCase()} key={symbol.toUpperCase()} /> :
    <State kind="unavailable" title="Choose a company to view its events." />;
}
