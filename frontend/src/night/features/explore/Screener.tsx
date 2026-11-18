import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { companyName, SECTOR_ORDER } from "../../../pages/market/sectors";
import { formatCurrency } from "../../../utils/format";
import type { Provenance } from "../../api";
import { Button, Field, Page, Panel, Stat, State, Table } from "../../kit";
import { datedWindow, priceMove, sourceLabel, useMarketRead, type SessionCoverage } from "./marketRead";
import { Results } from "./Results";

type Stock = {
  symbol: string; name: string; sector: string | null; close: string; move: string;
  detail_available: boolean; source: Provenance;
};
type ScreenerData = SessionCoverage & { matched_count: number; offset: number; limit: number; items: Stock[] };
const initial = { sector: "", sort: "move_desc", minimum: "" };

export function Screener() {
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [offset, setOffset] = useState(0);
  const query = useMarketRead<ScreenerData>("screener", "/night/screener", {
    sector: filters.sector || undefined, sort: filters.sort,
    min_move: filters.minimum === "" ? undefined : Number(filters.minimum) / 100, limit: 25, offset,
  });
  function apply(event: FormEvent) {
    event.preventDefault();
    setFilters(draft);
    setOffset(0);
  }
  return <Page className="explore" title="Stock screener" description="Filter listed stocks by the change between two stored closing prices." testId="night-screener">
    <Panel className="filters" title="Filters"><form onSubmit={apply}>
      <Field id="screen-sector" label="Sector"><select value={draft.sector} onChange={e => setDraft({ ...draft, sector: e.target.value })}>
        <option value="">All sectors</option>{[...SECTOR_ORDER, "Other"].map(s => <option key={s}>{s}</option>)}
      </select></Field>
      <Field id="screen-move" label="Minimum move (%)"><input type="number" step="any" min="-100" placeholder="Any move"
        value={draft.minimum} onChange={e => setDraft({ ...draft, minimum: e.target.value })} /></Field>
      <Field id="screen-sort" label="Sort by"><select value={draft.sort} onChange={e => setDraft({ ...draft, sort: e.target.value })}>
        <option value="move_desc">Largest gain first</option><option value="move_asc">Largest loss first</option><option value="symbol">Symbol A–Z</option>
      </select></Field>
      <Button type="submit" variant="primary">Apply filters</Button>
    </form></Panel>
    <Panel title={filters.sector || "All sectors"}><Results query={query} label="screener results">{data =>
      <div data-testid="screener-results">
        <div className="result-summary"><Stat label="Matching stocks" value={data.matched_count.toLocaleString("en-US")} />
          <Stat label="Covered / eligible stocks" value={`${data.covered_count.toLocaleString("en-US")} / ${data.universe_count.toLocaleString("en-US")}`} /></div>
        <p className="context">{datedWindow(data)} · {data.coverage} coverage</p>
        {data.covered_count === 0 ? <State kind="unavailable" title="No stocks have comparable closes in this selection." /> :
          data.items.length === 0 ? <State kind="empty" title="No stocks match these filters." detail="Lower the minimum move or choose another sector." /> :
            <Table caption="Matching stocks by applied sort" rows={data.items} rowKey={r => r.symbol} columns={[
              { key: "stock", header: "Stock", cell: r => <>{r.detail_available ? <Link className="ticker" to={`/market/${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link> :
                <span>{r.symbol}</span>}<span className="row-note">{companyName(r.name)} · {r.sector ?? "Other"}</span></> },
              { key: "close", header: "Close (USD)", align: "right", cell: r => <>{formatCurrency(Number(r.close))}<span className="row-note">{sourceLabel(r.source)}</span></> },
              { key: "move", header: "Price move", align: "right", cell: r => <span data-tone={Number(r.move) > 0 ? "up" : Number(r.move) < 0 ? "down" : undefined}>{priceMove(r.move)}</span> },
            ]} />}
        {data.matched_count > data.limit && <div className="pager">
          <span>Stocks {data.offset + 1}–{data.offset + data.items.length} of {data.matched_count}</span>
          <Button disabled={data.offset === 0} onClick={() => setOffset(Math.max(0, data.offset - data.limit))}>Previous</Button>
          <Button disabled={data.offset + data.limit >= data.matched_count} onClick={() => setOffset(data.offset + data.limit)}>Next</Button>
        </div>}
      </div>}</Results></Panel>
  </Page>;
}
