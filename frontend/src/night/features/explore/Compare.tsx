import { useState, type FormEvent } from "react";
import type { Coverage, Provenance } from "../../api";
import { Button, Field, Page, Panel, State } from "../../kit";
import { useLook } from "../../looks/preferences";
import { priceMove, sourceLabel, useMarketRead } from "./marketRead";
import { Results } from "./Results";
import "./compare.css";

type Series = { symbol: string; source: Provenance; returns: (string | null)[]; missing_sessions: number };
type Comparison = {
  coverage: Coverage; base_date: string | null; dates: string[]; series: Series[];
  requested_start: string | null; requested_end: string | null;
};
const x = (i: number, count: number) => 8 + 424 * i / Math.max(1, count - 1);

function PriceTrace({ series, low, high, active, dates }: {
  series: Series; low: number; high: number; active: number; dates: string[];
}) {
  const y = (value: number) => 114 - 102 * (value - low) / (high - low);
  const segments: string[][] = [];
  let segment: string[] = [];
  series.returns.forEach((value, i) => {
    if (value === null) { segment = []; return; }
    if (segment.length === 0) segments.push(segment);
    segment.push(`${x(i, dates.length)},${y(Number(value))}`);
  });
  const value = series.returns[active];
  return <figure className="price-trace">
    <figcaption><strong>{series.symbol}</strong><span>{priceMove(value)}</span></figcaption>
    <p className="context">{sourceLabel(series.source)} · {series.source.coverage} coverage</p>
    <svg viewBox="0 0 440 128" role="img" aria-label={`${series.symbol} price returns from ${dates[0]} to ${dates.at(-1)}, ${series.missing_sessions} missing sessions`}>
      <line x1="8" x2="432" y1={y(0)} y2={y(0)} className="zero" />
      {segments.map((points, i) => points.length === 1 ?
        <circle key={i} cx={points[0].split(",")[0]} cy={points[0].split(",")[1]} r="2" /> :
        <polyline key={i} points={points.join(" ")} />)}
      <line className="cursor" x1={x(active, dates.length)} x2={x(active, dates.length)} y1="8" y2="116" />
      {value != null && <circle cx={x(active, dates.length)} cy={y(Number(value))} r="4" />}
    </svg>
    <p className="trace-axis"><span>{dates[0]}</span><span>{dates.at(-1)}</span></p>
    <p className="context">{series.missing_sessions} missing of {dates.length} sessions</p>
  </figure>;
}

function MatchedCharts({ data }: { data: Comparison }) {
  const [selected, setSelected] = useState("");
  const active = data.dates.includes(selected) ? data.dates.indexOf(selected) : data.dates.length - 1;
  const values = data.series.flatMap(row => row.returns.filter(v => v !== null).map(Number));
  const low = Math.min(0, ...values), max = Math.max(0, ...values);
  // Keep identical scales even when every observed price is unchanged.
  const floor = max === low ? -0.01 : low, ceiling = max === low ? 0.01 : max;
  return <div data-testid="compare-series">
    {data.base_date && data.dates.length ? <>
      <p>Price return from the shared close on <strong>{data.base_date}</strong> · {data.coverage} coverage</p>
      <p className="context">Requested window {data.requested_start} to {data.requested_end}. Shared scale {priceMove(floor)} to {priceMove(ceiling)}.</p>
      <Field id="compare-session" label="Inspect session"><select value={data.dates[active]} onChange={e => setSelected(e.target.value)}>
        {data.dates.map(date => <option key={date}>{date}</option>)}
      </select></Field>
      <div className="matched-charts">{data.series.map(s => <PriceTrace key={s.symbol} series={s} dates={data.dates} active={active} low={floor} high={ceiling} />)}</div>
    </> : <State kind="unavailable" title="No shared closing session" detail="These symbols have no common split-adjusted close for the requested provider and range." />}
  </div>;
}

export function Compare() {
  const { prefs } = useLook();
  const [symbols, setSymbols] = useState("AAPL, SPY");
  const [range, setRange] = useState("3m");
  const [provider, setProvider] = useState<string>(prefs.historyProvider);
  const [error, setError] = useState("");
  const [params, setParams] = useState({ symbols: "AAPL,SPY", range, provider });
  const query = useMarketRead<Comparison>("compare", "/night/compare", params);
  function apply(event: FormEvent) {
    event.preventDefault();
    const names = symbols.split(",").map(name => name.trim().toUpperCase());
    if (names.length < 2 || names.length > 4 || new Set(names).size !== names.length || names.some(s => !s || s.length > 20)) {
      setError("Enter two to four distinct symbols, separated by commas.");
      return;
    }
    setError("");
    setParams({ symbols: names.join(","), range, provider });
  }
  return <Page className="explore" title="Compare prices" description="Compare end-of-day price returns on the same dated sessions. Dividends are excluded." testId="night-compare">
    <Panel title="Comparison" className="filters compare-filters"><form onSubmit={apply}>
      <Field id="compare-symbols" label="Symbols (2–4)" error={error}><input value={symbols} onChange={e => setSymbols(e.target.value)} /></Field>
      <Field id="compare-range" label="Window"><select value={range} onChange={e => setRange(e.target.value)}>
        <option value="1m">1 month</option><option value="3m">3 months</option><option value="1y">1 year</option>
      </select></Field>
      <Field id="compare-provider" label="Provider"><select value={provider} onChange={e => setProvider(e.target.value)}>
        <option value="auto">Automatic</option><option value="yahoo">Yahoo</option><option value="massive">Massive</option>
      </select></Field>
      <Button type="submit" variant="primary">Compare</Button>
    </form></Panel>
    <Panel title={params.symbols.split(",").join(" / ")}><Results query={query} label="price comparisons">{data => <MatchedCharts data={data} />}</Results></Panel>
  </Page>;
}
