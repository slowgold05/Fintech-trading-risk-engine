import { useState, type ReactNode } from "react";
import { SECTOR_ORDER } from "../../../pages/market/sectors";
import type { Coverage, Provenance } from "../../api";
import { Field, Page, Panel, Stat } from "../../kit";
import { datedWindow, sourceLabel, useMarketRead, type SessionCoverage } from "./marketRead";
import { Results } from "./Results";
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
const count = (value: number) => value.toLocaleString("en-US");

function Scope({ data }: { data: Participation }) {
  const sources = [...new Set(data.items.map(item => sourceLabel(item.source)))];
  return <>
    <div className="result-summary">
      <Stat label="Covered / eligible stocks" value={`${count(data.covered_count)} / ${count(data.universe_count)}`} />
      <Stat label="Excluded stocks" value={count(data.excluded_count)} />
    </div>
    <p className="context">{datedWindow(data)} · {data.coverage} coverage{sources.length > 0 && " · " + sources.join(", ")}</p>
    <p className="context">Eligible stocks are active non-test listings, excluding ETFs. A stock needs compatible closes on both sessions to count.</p>
  </>;
}

export function ParticipationPage({ title, description, id, marker, children }: {
  title: string; description: string; id: string; marker: string;
  children: (data: Participation, select: (sector: string) => void) => ReactNode;
}) {
  const [sector, setSector] = useState("");
  const query = useMarketRead<Participation>("breadth", "/night/breadth", {sector: sector || undefined});
  return <Page className="explore" title={title} description={description} testId={id}>
    <Panel title="Universe" className="filters"><Field id="participation-sector" label="Sector"><select value={sector} onChange={e => setSector(e.target.value)}>
      <option value="">All sectors</option>{[...SECTOR_ORDER, "Other"].map(s => <option key={s}>{s}</option>)}
    </select></Field></Panel>
    <Panel title={sector || "All sectors"}><Results query={query} label={title.toLowerCase()}>{data =>
      <div data-testid={marker}><Scope data={data} />
        {children(data, setSector)}
      </div>}</Results></Panel>
  </Page>;
}
