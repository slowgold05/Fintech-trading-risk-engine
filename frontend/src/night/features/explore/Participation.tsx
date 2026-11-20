import { useState, type ReactNode } from "react";
import { SECTOR_ORDER } from "../../../pages/market/sectors";
import type { Coverage, Provenance } from "../../api";
import { Page, Panel, RestInstrument, Stat, type InstrumentStatus } from "../../inner";
import { sourceLabel, useMarketRead, type SessionCoverage } from "./marketRead";
import { readStatus, stockCount } from "./marketInstrument";
import "./marketInstrument.css";
import "./participation.css";

type Observation = { symbol: string; move: string; source: Provenance };
type Sector = {
  sector: string; covered: number; median_move: string | null;
  proxy_symbol: string | null; proxy_coverage: Coverage; proxy: Observation | null;
};
export type Participation = SessionCoverage & {
  excluded_count: number; advancing: number; declining: number; flat: number;
  sectors: Sector[]; items: Observation[];
};

function Scope({ data }: { data: Participation }) {
  const sources = [...new Set(data.items.map(item => sourceLabel(item.source)))];
  return <Panel title="Coverage" subtitle="Active stock listings · ETFs and test listings excluded">
    <div className="market-band">
      <Stat label="Covered / eligible stocks" value={`${stockCount(data.covered_count)} / ${stockCount(data.universe_count)}`} />
      <Stat label="Excluded stocks" value={stockCount(data.excluded_count)} />
    </div>
    <dl className="market-ledger">
      <div><dt>Previous close</dt><dd>{data.previous_session_date ?? "Unavailable"}</dd></div>
      <div><dt>Session close</dt><dd>{data.session_date ?? "Unavailable"}</dd></div>
      <div><dt>Coverage</dt><dd>{data.coverage}</dd></div>
      <div><dt>Price source</dt><dd>{sources.join(", ") || "No priced observations"}</dd></div>
    </dl>
    <p className="market-note">A stock needs compatible closes on both sessions to count.</p>
  </Panel>;
}

export function ParticipationPage({ title, description, id, marker, children, rest, ledger }: {
  title: string; description: string; id: string; marker: string;
  children: (data: Participation, select: (sector: string) => void) => ReactNode;
  rest?: (status: InstrumentStatus) => ReactNode;
  ledger?: (data: Participation, select: (sector: string) => void) => ReactNode;
}) {
  const [sector, setSector] = useState("");
  const query = useMarketRead<Participation>("breadth", "/night/breadth", { sector: sector || undefined });
  const status = readStatus(query, title.toLowerCase());
  const data = query.isSuccess ? query.data : undefined;
  return <Page className="market-instrument-page participation-page" title={title} description={description} testId={id}
    actions={<select aria-label="Sector" id="participation-sector" value={sector} onChange={e => setSector(e.target.value)}>
      <option value="">All sectors</option>{[...SECTOR_ORDER, "Other"].map(s => <option key={s}>{s}</option>)}
    </select>}>
    <Page.Main data-testid={data ? marker : undefined}>
      {status ? rest?.(status) ?? <RestInstrument label={title} status={status} /> : data && children(data, setSector)}
    </Page.Main>
    {data && <Page.Aside><Scope data={data} /></Page.Aside>}
    {data && ledger && <Page.Full>{ledger(data, setSector)}</Page.Full>}
  </Page>;
}
