import { State, Table } from "../../kit";
import { priceMove, sourceLabel } from "./marketRead";
import { ParticipationPage, type Participation } from "./Participation";

function SectorTable({ data, select }: { data: Participation; select: (sector: string) => void }) {
  return <>
    {data.covered_count === 0 && <State kind="unavailable" title="No covered stock moves in this selection." />}
    {data.sectors.length > 0 && <Table caption="Median stock moves and separate ETF proxies" rows={data.sectors} rowKey={r => r.sector} columns={[
      { key: "sector", header: "Sector", cell: r => <button className="sector-select" type="button" aria-label={`Show ${r.sector} coverage`} onClick={() => select(r.sector)}>{r.sector}</button> },
      { key: "count", header: "Covered stocks", align: "right", cell: r => r.covered.toLocaleString("en-US") },
      { key: "median", header: "Median move", align: "right", cell: r => priceMove(r.median_move) },
      { key: "proxy", header: "ETF proxy", align: "right", cell: r => r.proxy ?
        <>{r.proxy.symbol} {priceMove(r.proxy.move)}<span className="row-note">{sourceLabel(r.proxy.source)} · {r.proxy_coverage}</span></> :
        <>{r.proxy_symbol ?? "No proxy"}<span className="row-note">Move unavailable</span></> },
    ]} />}
  </>;
}

export function Sectors() {
  return <ParticipationPage title="Sector performance" description="Compare the median covered stock with its sector ETF proxy."
    id="night-sectors" marker="sector-results">{(data, select) => <SectorTable data={data} select={select} />}</ParticipationPage>;
}
