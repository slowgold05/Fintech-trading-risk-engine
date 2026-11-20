import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Coverage, Provenance } from "../../api";
import { Button, Field, Page, Panel, RestInstrument, SeriesInstrument, Sheet } from "../../inner";
import { useLook } from "../../looks/preferences";
import { priceMove, sourceLabel, useMarketRead } from "./marketRead";
import { readStatus } from "./marketInstrument";
import "./marketInstrument.css";
import "./compare.css";

type Series = { symbol: string; source: Provenance; returns: (string | null)[]; missing_sessions: number };
type Comparison = {
  coverage: Coverage; base_date: string | null; dates: string[]; series: Series[];
  requested_start: string | null; requested_end: string | null;
};
const x = (i: number, count: number) => 8 + 424 * i / Math.max(1, count - 1);
const y = (value: number, low: number, high: number) => 114 - 102 * (value - low) / (high - low);

function PriceTrace({ series, low, high, active, dates }: {
  series: Series; low: number; high: number; active: number; dates: string[];
}) {
  const segments = useMemo(() => {
    const segments: string[][] = [];
    let segment: string[] = [];
    series.returns.forEach((value, i) => {
      if (value === null) { segment = []; return; }
      if (segment.length === 0) segments.push(segment);
      segment.push(`${x(i, dates.length)},${y(Number(value), low, high)}`);
    });
    return segments;
  }, [series.returns, dates.length, low, high]);
  const value = series.returns[active];
  return <figure className="price-trace">
    <figcaption><strong>{series.symbol}</strong><span>{priceMove(value)}</span></figcaption>
    <p className="context">{sourceLabel(series.source)} · {series.source.coverage} coverage</p>
    <svg viewBox="0 0 440 128" preserveAspectRatio="none" role="img" aria-label={`${series.symbol} price returns from ${dates[0]} to ${dates.at(-1)}, ${series.missing_sessions} missing sessions`}>
      <line x1="8" x2="432" y1={y(0, low, high)} y2={y(0, low, high)} className="zero" />
      {segments.map((points, i) => points.length === 1 ?
        <circle key={i} cx={points[0].split(",")[0]} cy={points[0].split(",")[1]} r="2" /> :
        <polyline key={i} points={points.join(" ")} />)}
      <line className="cursor" x1={x(active, dates.length)} x2={x(active, dates.length)} y1="8" y2="116" />
      {value != null && <circle cx={x(active, dates.length)} cy={y(Number(value), low, high)} r="4" />}
    </svg>
    <p className="trace-axis"><span>{dates[0]}</span><span>{dates.at(-1)}</span></p>
    <p className="context">{series.missing_sessions} missing of {dates.length} sessions</p>
  </figure>;
}

export function Compare() {
  const { prefs } = useLook();
  const [symbols, setSymbols] = useState("AAPL, SPY");
  const [range, setRange] = useState("3m");
  const [provider, setProvider] = useState<string>(prefs.historyProvider);
  const [error, setError] = useState("");
  const [inspection, setInspection] = useState("");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [params, setParams] = useState({ symbols: "AAPL,SPY", range, provider });
  const query = useMarketRead<Comparison>("compare", "/night/compare", params);
  const data = query.isSuccess ? query.data : undefined;
  const samples = useMemo(() => data?.dates.map((label, i) => ({
    label, values:data.series.map(row => row.returns[i] == null ? null : Number(row.returns[i])),
  })) ?? [], [data]);
  const names = useMemo(() => data?.series.map(row => row.symbol) ?? [], [data]);
  const rangeBounds = useMemo(() => {
    const values = samples.flatMap(s => s.values.filter((v): v is number => v !== null));
    const low = Math.min(0, ...values), high = Math.max(0, ...values);
    return low === high ? { low:-.01, high:.01 } : { low, high };
  }, [samples]);
  const inspected = data?.dates.indexOf(inspection) ?? -1;
  const lastPriced = samples.reduce((latest, sample, i) => sample.values[0] != null ? i : latest, -1);
  const active = inspected >= 0 ? inspected : Math.max(0, lastPriced);
  const status = readStatus(query, "price comparisons") ?? (!data?.base_date || !samples.length ?
    { kind:"unavailable" as const, title:"No shared closing session", action:<p>These symbols have no common split-adjusted close for the requested provider and range.</p> } : undefined);

  function apply(event: FormEvent) {
    event.preventDefault();
    const names = symbols.split(",").map(name => name.trim().toUpperCase());
    if (names.length < 2 || names.length > 4 || new Set(names).size !== names.length || names.some(s => !s || s.length > 20)) {
      setError("Enter two to four distinct symbols, separated by commas.");
      return;
    }
    setError("");
    setParams({ symbols:names.join(","), range, provider });
    setInspection("");
    setOpen(false);
  }
  const form = <form className="market-query-form" onSubmit={apply}>
      <Field id="compare-symbols" label="Symbols (2–4)" error={error}><input value={symbols} onChange={e => setSymbols(e.target.value)} /></Field>
      <Field id="compare-range" label="Window"><select value={range} onChange={e => setRange(e.target.value)}>
        <option value="1m">1 month</option><option value="3m">3 months</option><option value="1y">1 year</option>
      </select></Field>
      <Field id="compare-provider" label="Provider"><select value={provider} onChange={e => setProvider(e.target.value)}>
        <option value="auto">Automatic</option><option value="yahoo">Yahoo</option><option value="massive">Massive</option>
      </select></Field>
      <Button type="submit" variant="primary">Compare</Button>
  </form>;
  return <Page className="market-instrument-page compare-page" title="Compare prices" description="End-of-day price returns from a shared close. Dividends are excluded." testId="night-compare"
    actions={<button className="nk-button market-query-open" ref={trigger} onClick={() => setOpen(true)}>Edit symbols</button>}>
    <Page.Full className="market-results-layout" data-testid={data ? "compare-series" : undefined}>
      <Page.Main>
        <Panel title={params.symbols.split(",").join(" / ")} subtitle={data?.base_date ? `Price return from ${data.base_date} · ${data.coverage} coverage` : "End-of-day price returns"}
          actions={!status && data && <Field id="compare-session" label="Inspect session"><select value={data.dates[active]} onChange={e => setInspection(e.target.value)}>
            {data.dates.map(date => <option key={date}>{date}</option>)}
          </select></Field>}>
          {status ? <RestInstrument label="Price returns" status={status} /> :
            <SeriesInstrument samples={samples} names={names} format={priceMove} label="Inspect comparison session" reference={0}
              selected={active} onSelect={i => setInspection(samples[i].label)} />}
        </Panel>
        {data && !status && <Panel title="Individual returns" subtitle={`Shared scale ${priceMove(rangeBounds.low)} to ${priceMove(rangeBounds.high)} · inspected close ${data.dates[active]}`}>
          <div className="matched-charts">{data.series.map(s => <PriceTrace key={s.symbol} series={s} dates={data.dates}
            active={active} low={rangeBounds.low} high={rangeBounds.high} />)}</div>
        </Panel>}
      </Page.Main>
      <Page.Aside>
        <Panel title="Comparison" className="market-inline-form">{!open && form}</Panel>
        {data && <Panel title="Session coverage"><dl className="market-ledger">
          <div><dt>Requested window</dt><dd>{data.requested_start ?? "Unavailable"}<br />{data.requested_end ?? "Unavailable"}</dd></div>
          <div><dt>Shared base close</dt><dd>{data.base_date ?? "Unavailable"}</dd></div>
          <div><dt>Dated sessions</dt><dd>{data.dates.length}</dd></div>
          {data.series.map(s => <div key={s.symbol}><dt>{s.symbol}</dt><dd>{sourceLabel(s.source)}<br />{s.source.coverage} coverage</dd></div>)}
        </dl></Panel>}
      </Page.Aside>
    </Page.Full>
    <Sheet title="Comparison" open={open} onOpenChange={setOpen} returnFocusRef={trigger}>{form}</Sheet>
  </Page>;
}
