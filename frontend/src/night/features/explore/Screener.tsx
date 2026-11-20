import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { companyName, SECTOR_ORDER } from "../../../pages/market/sectors";
import { formatCurrency } from "../../../utils/format";
import type { Provenance } from "../../api";
import { Button, Field, Page, Panel, Sheet, Stat, Table } from "../../inner";
import { datedWindow, priceMove, sourceLabel, useMarketRead, type SessionCoverage } from "./marketRead";
import { readStatus, stockCount } from "./marketInstrument";
import { MoveInstrument } from "./MoveInstrument";
import "./marketInstrument.css";
import "./screener.css";

type Stock = {
  symbol: string; name: string; sector: string | null; close: string; move: string;
  detail_available: boolean; source: Provenance;
};
type ScreenerData = SessionCoverage & { matched_count: number; offset: number; limit: number; items: Stock[] };
const initial = { sector:"", sort:"move_desc", minimum:"" };
const sorts: Record<string, string> = { move_desc:"Largest gain first", move_asc:"Largest loss first", symbol:"Symbol A–Z" };

function StockIdentity({ row }: { row: Stock }) {
  return row.detail_available ? <Link className="stock-link" to={`/market/${encodeURIComponent(row.symbol)}`}>{row.symbol}</Link> : <b>{row.symbol}</b>;
}

export function Screener() {
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const query = useMarketRead<ScreenerData>("screener", "/night/screener", {
    sector:filters.sector || undefined, sort:filters.sort,
    min_move:filters.minimum === "" ? undefined : Number(filters.minimum) / 100, limit:25, offset,
  });
  const data = query.isSuccess ? query.data : undefined;
  const moves = useMemo(() => data?.items.map(s => ({ name:s.symbol, mark:s.symbol, value:Number(s.move) })) ?? [], [data]);
  const status = readStatus(query, "screener results") ?? (data?.covered_count === 0 ?
    { kind:"unavailable" as const, title:"No stocks have comparable closes in this selection." } : data && !moves.length ?
      { kind:"empty" as const, title:"No stocks match these filters.", action:<p>Lower the minimum move or choose another sector.</p> } : undefined);
  function apply(event: FormEvent) {
    event.preventDefault();
    setFilters(draft);
    setOffset(0);
    setOpen(false);
  }
  const form = <form className="market-query-form" onSubmit={apply}>
    <Field id="screen-sector" label="Sector"><select value={draft.sector} onChange={e => setDraft({ ...draft, sector:e.target.value })}>
      <option value="">All sectors</option>{[...SECTOR_ORDER, "Other"].map(s => <option key={s}>{s}</option>)}
    </select></Field>
    <Field id="screen-move" label="Minimum move (%)"><input type="number" step="any" min="-100" placeholder="Any move"
      value={draft.minimum} onChange={e => setDraft({ ...draft, minimum:e.target.value })} /></Field>
    <Field id="screen-sort" label="Sort by"><select value={draft.sort} onChange={e => setDraft({ ...draft, sort:e.target.value })}>
      {Object.entries(sorts).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></Field><Button type="submit" variant="primary">Apply filters</Button>
  </form>;
  const pageRange = data && moves.length ? `Stocks ${data.offset + 1}–${data.offset + data.items.length} of ${stockCount(data.matched_count)}` : "";
  return <Page className="market-instrument-page screen-page" title="Stock screener" description="Filter listed stocks by the change between two stored closes." testId="night-screener"
    actions={<button className="nk-button market-query-open" ref={trigger} onClick={() => setOpen(true)}>Filters</button>}>
    <Page.Full className="market-results-layout" data-testid={data ? "screener-results" : undefined}>
      <Page.Main>
        <MoveInstrument title="Price moves" subtitle={`${pageRange || filters.sector || "All sectors"} · ${sorts[filters.sort]}`}
          label="Price move" inspectLabel="Inspect stock" rows={moves} status={status}
          reading={row => {
            const stock = data!.items.find(s => s.symbol === row.name)!;
            return <><h3><StockIdentity row={stock} /> <span>{companyName(stock.name)}</span></h3><dl>
              <div><dt>Price move</dt><dd>{priceMove(stock.move)}</dd></div><div><dt>Close (USD)</dt><dd>{formatCurrency(Number(stock.close))}</dd></div>
            </dl><p className="market-stamp">{data?.session_date ?? "Session unavailable"} · {stock.sector ?? "Other"} · {sourceLabel(stock.source)}</p></>;
          }} legend={<span><i />Stock move · current result page</span>} />
      </Page.Main>
      <Page.Aside>
        <Panel className="market-inline-form" title="Filters">{!open && form}</Panel>
        {data && <Panel title={filters.sector || "All sectors"}>
          <div className="market-band"><Stat label="Matching stocks" value={stockCount(data.matched_count)} />
            <Stat label="Covered / eligible stocks" value={`${stockCount(data.covered_count)} / ${stockCount(data.universe_count)}`} /></div>
          <p className="market-stamp">{datedWindow(data)} · {data.coverage} coverage</p>
          {filters.minimum !== "" && <p className="market-note">Minimum move {filters.minimum}%</p>}
        </Panel>}
      </Page.Aside>
      {data && (moves.length > 0 || data.matched_count > data.limit) && <Page.Full><Panel title="Matching stocks" actions={<small>{pageRange}</small>}>
        <Table caption="Matching stocks by applied sort" rows={data.items} rowKey={r => r.symbol} columns={[
          { key:"stock", header:"Stock", cell:r => <><StockIdentity row={r} /><span className="row-note">{companyName(r.name)} · {r.sector ?? "Other"}</span></> },
          { key:"close", header:"Close (USD)", align:"right", cell:r => <>{formatCurrency(Number(r.close))}<span className="row-note">{sourceLabel(r.source)}</span></> },
          { key:"move", header:"Price move", align:"right", cell:r => priceMove(r.move) },
        ]} />
        {data.matched_count > data.limit && <div className="market-pager"><span>{pageRange}</span>
          <Button disabled={data.offset === 0} onClick={() => setOffset(Math.max(0, data.offset - data.limit))}>Previous</Button>
          <Button disabled={data.offset + data.limit >= data.matched_count} onClick={() => setOffset(data.offset + data.limit)}>Next</Button>
        </div>}
      </Panel></Page.Full>}
    </Page.Full>
    <Sheet title="Filters" open={open} onOpenChange={setOpen} returnFocusRef={trigger}>{form}</Sheet>
  </Page>;
}
