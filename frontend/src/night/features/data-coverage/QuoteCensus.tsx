import { useId, useState } from "react";
import { Panel, RankedRow, RestInstrument, type InstrumentStatus } from "../../inner";
import { useLook } from "../../looks/preferences";
import type { CoverageReport } from "./coverage";

const states = [
  ["present", "Stored quotes"], ["fresh_eod", "Fresh close"], ["stale", "Stale"],
  ["invalid", "Invalid"], ["unconfirmed_or_other", "Unconfirmed or other"], ["missing", "Missing"],
] as const;
type QuoteState = typeof states[number][0];
const count = (value: number) => value.toLocaleString("en-US");

// Fill consecutive whole columns, then the occupied cells of the final column.
function cells(amount: number, height: number) {
  const columns = Math.floor(amount / height), tail = amount % height;
  return `M0 0h${columns}v${height}H0Z M${columns} 0h1v${tail}h-1Z`;
}

function CensusField({ value, total, caption }: { value: number; total: number; caption: string }) {
  const pattern = useId();
  const rows = Math.max(1, Math.ceil(Math.sqrt(total / 3.3)));
  const cols = Math.ceil(total / rows);
  const width = cols + rows * .38;
  const height = rows + cols * .09;
  return <svg viewBox={`-3 -3 ${width + 6} ${height + 7}`} role="img" aria-label={caption}>
    <defs>{["field","selected"].map(kind => <pattern id={pattern + kind} key={kind} width="1" height="1" patternUnits="userSpaceOnUse">
      <rect width=".72" height=".74" rx=".05" fill={kind === "field" ? "#5a605c" : "var(--accent)"}/>
    </pattern>)}</defs>
    <g transform={`matrix(1,-.09,.38,1,0,${cols * .09})`}>
      <path d={cells(total, rows)} fill={`url(#${pattern}field)`}/>
      <path d={cells(value, rows)} fill={`url(#${pattern}selected)`}/>
    </g>
  </svg>;
}

function CensusDial({ value, total, label, caption }: { value: number; total: number; label: string; caption: string }) {
  const fraction = value / total;
  return <svg viewBox="0 0 248 248" role="img" aria-label={caption}>
    <circle cx="124" cy="124" r="116" fill="#191c18" stroke="#60645c"/>
    {Array.from({ length: 100 }, (_, i) => <path key={i} d={i % 5 ? "M124 9v4" : "M124 9v9"}
      transform={`rotate(${i * 3.6} 124 124)`} stroke="#a2a79a"/>)}
    <circle cx="124" cy="124" r="90" fill="none" stroke="#4b5049" strokeWidth="24"/>
    {value > 0 && <circle cx="124" cy="124" r="90" fill="none" stroke="var(--accent)" strokeWidth="24" pathLength="100"
      strokeDasharray={`${fraction * 100} 100`} transform="rotate(-90 124 124)"/>}
    {Array.from({ length: 100 }, (_, i) => <path key={i} d="M124 22v7" transform={`rotate(${i * 3.6} 124 124)`} stroke="#1c201b"/>)}
    <circle cx="124" cy="124" r="74" fill="#111310" stroke="#60645b"/>
    <text x="124" y="121" textAnchor="middle" className="census-percent">{(fraction * 100).toFixed(2)}%</text>
    <text x="124" y="143" textAnchor="middle" className="census-label">{label}</text>
  </svg>;
}

export function QuoteCensus({ report, status }: { report?: CoverageReport; status?: InstrumentStatus }) {
  const [selected, setSelected] = useState<QuoteState>("present");
  const { prefs } = useLook();
  const total = report?.universe.eligible ?? 0;
  const value = report?.quotes[selected] ?? 0;
  const label = states.find(([key]) => key === selected)![1];
  const caption = `${label}: ${count(value)} of ${count(total)} eligible listings`;
  return <Panel title="Quote census" subtitle="Active US equity listings, excluding test issues and ETFs."
    data-testid="data-coverage-census" className="quote-census">
    {status || !report || !total ? <RestInstrument label="Quote census" status={status ?? { kind:"empty", title:"No eligible listings in the quote census" }}/>
      : <div className="census-body">
        <figure className="census-figure"><div data-centrepiece="true" className="census-plot">
          {prefs.look === "dial" ? <CensusDial {...{value, total, label, caption}}/> : <CensusField {...{value, total, caption}}/>}
        </div>
          <figcaption>{prefs.look === "dial" ? "Ring scale · 100% of eligible listings" : "Each cell represents one eligible listing"}</figcaption>
        </figure>
        <div className="census-register">
          <div className="census-reading"><span>{label}</span><strong>{count(value)} <small>/ {count(total)}</small></strong></div>
          {states.map(([key, name]) => <RankedRow key={key} name={name} value={report.quotes[key]} max={total}
            display={count(report.quotes[key])} selected={key === selected} onSelect={() => setSelected(key)}/>)}
        </div>
      </div>}
    {report && total === 0 && <dl className="coverage-states" aria-label="Quote counts">
      {states.map(([key, name]) => <div key={key}><dt>{name}</dt><dd>{count(report.quotes[key])}</dd></div>)}
    </dl>}
    {report && <p className="coverage-note">A fresh confirmed close can supply the ticket reference. Preview and risk checks still apply.</p>}
  </Panel>;
}
