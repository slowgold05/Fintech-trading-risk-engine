import { useMemo } from "react";
import { Panel, Table, type InstrumentStatus } from "../../inner";
import { priceMove, sourceLabel } from "./marketRead";
import { MoveInstrument, type MoveReading } from "./MoveInstrument";
import { ParticipationPage, type Participation } from "./Participation";

function SectorInstrument({ data, status }: { data?: Participation; status?: InstrumentStatus }) {
  const rows = useMemo(() => (data?.sectors ?? []).map(s => ({
    name:s.sector, mark:s.proxy_symbol ?? s.sector, value:s.median_move == null ? null : Number(s.median_move),
    proxy:s.proxy ? Number(s.proxy.move) : null,
  })).sort((a,b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)), [data]);
  const paired = rows.filter(row => row.value !== null && row.proxy !== null);
  const widest = paired.reduce<typeof paired[number] | undefined>((best, row) =>
    !best || Math.abs(row.value! - row.proxy!) > Math.abs(best.value! - best.proxy!) ? row : best, undefined);
  const rest = status ?? (!rows.some(row => row.value !== null || row.proxy !== null) ? {
    kind:"unavailable" as const, title:data?.covered_count ? "No sector median or ETF move is available." : "No covered stock moves in this selection.",
  } : undefined);
  function reading(row: MoveReading) {
    const spread = row.proxy != null && row.value !== null ? (row.value-row.proxy)*100 : null;
    return <><h3>{row.name}</h3><dl>
      <div><dt>Stock median</dt><dd>{priceMove(row.value)}</dd></div>
      <div><dt>{row.mark === row.name ? "ETF proxy" : row.mark}</dt><dd>{priceMove(row.proxy ?? null)}</dd></div>
      <div><dt>Median − proxy</dt><dd>{spread === null ? "Unavailable" : `${spread > 0 ? "+" : ""}${spread.toFixed(2)} pp`}</dd></div>
    </dl></>;
  }
  return <MoveInstrument title="Sector moves" subtitle={data?.session_date ? `Ranked by stock median · ${data.session_date}` : "Ranked by stock median"}
    label="Stock median" inspectLabel="Inspect sector" rows={rows} initial={widest?.name} status={rest} reading={reading}
    legend={<><span><i />Stock median</span><span><i className="proxy" />ETF proxy</span>
      {data?.covered_count === 0 && <span>No covered stock moves in this selection.</span>}</>} />;
}

function SectorTable({ data, select }: { data: Participation; select: (sector: string) => void }) {
  if (!data.sectors.length) return null;
  return <Panel title="Sector coverage">
    <Table caption="Median stock moves and separate ETF proxies" rows={data.sectors} rowKey={r => r.sector} columns={[
      { key:"sector", header:"Sector", cell:r => <button className="sector-select" type="button" aria-label={`Show ${r.sector} coverage`} onClick={() => select(r.sector)}>{r.sector}</button> },
      { key:"count", header:"Covered stocks", align:"right", cell:r => r.covered.toLocaleString("en-US") },
      { key:"median", header:"Median move", align:"right", cell:r => priceMove(r.median_move) },
      { key:"proxy", header:"ETF proxy", align:"right", cell:r => r.proxy ?
        <>{r.proxy.symbol} {priceMove(r.proxy.move)}<span className="row-note">{sourceLabel(r.proxy.source)} · {r.proxy_coverage}</span></> :
        <>{r.proxy_symbol ?? "No proxy"}<span className="row-note">Move unavailable</span></> },
    ]} />
  </Panel>;
}

export function Sectors() {
  return <ParticipationPage title="Sector performance" description="Median stock moves against their sector ETF on the same closes."
    id="night-sectors" marker="sector-results" rest={status => <SectorInstrument status={status} />}
    ledger={(data, select) => <SectorTable data={data} select={select} />}>{data => <SectorInstrument data={data} />}</ParticipationPage>;
}
