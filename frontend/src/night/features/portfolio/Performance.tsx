import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPerformanceRange, type PerformanceRange, type PortfolioPerformance } from "../../../api/portfolio";
import { formatCurrency, formatSignedPercent } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Panel, State } from "../../kit";
import { performanceSeries } from "./valuation";

function money(value: number | null) {
  return value === null ? "Unavailable" : formatCurrency(value);
}
function percent(value: number | null) {
  return value === null ? "Unavailable" : formatSignedPercent(value);
}

function PerformanceChart({ data }: { data: PortfolioPerformance }) {
  const [selected, setSelected] = useState<string>();
  const { start, points } = performanceSeries(data.series);
  if (!points.length) return <State kind="empty" title="No recorded sessions in this range" />;
  const lastPriced = points.reduce((last, point, i) => point.account !== null ? i : last, -1);
  const inspected = points.findIndex(point => point.date === selected);
  const index = inspected >= 0 ? inspected : lastPriced >= 0 ? lastPriced : points.length - 1;
  const point = points[index];
  const chartValues = points.flatMap(p => [p.account, p.spy]).filter((v): v is number => v !== null);
  const low = Math.min(0, ...chartValues), high = Math.max(0, ...chartValues);
  const x = (i: number) => 1000 * i / Math.max(1, points.length - 1);
  const y = (v: number) => low === high ? 75 : 145 - 140 * (v - low) / (high - low);
  function path(key: "account" | "spy") {
    return points.map((p, i) => p[key] === null ? "" :
      `${points[i - 1]?.[key] == null ? "M" : "L"}${x(i).toFixed(2)},${y(p[key]).toFixed(2)}`).join(" ");
  }
  const spySource = data.demo_price_series?.SPY;
  const adjusted = data.split_adjusted_history_sources?.SPY;
  const source = spySource ? `${spySource.provider} · ${spySource.adjustment.replace("_", " ")}`
    : adjusted ? `${adjusted} · split adjusted` : "Provider unavailable";
  const missingAccount = points.filter(p => p.account === null).length;
  const missingSpy = points.filter(p => p.account !== null && p.spy === null).length;

  return <figure className="return-figure">
    <figcaption><div><small>Selected session</small><strong>{point.date}</strong></div>
      <div className="return-readings"><div><small className="return-key">Account TWR</small><b>{percent(point.account)}</b></div>
        <div><small className="return-key spy-key">SPY price</small><b>{percent(point.spy)}</b></div></div>
    </figcaption>
    {lastPriced > start && start >= 0 ? <div className="return-plot">
      <div className="return-axis" aria-hidden="true"><span>{percent(high)}</span>{low !== high && <span>{percent(low)}</span>}</div>
      <svg role="img" aria-label={`Time-weighted account and SPY price returns since ${points[start].date}. Selected session ${point.date}.`} viewBox="0 0 1000 150" preserveAspectRatio="none">
        {[5, 75, 145].map(h => <path key={h} className="perf-rule" d={`M0,${h}H1000`} />)}
        <path className="spy-series" d={path("spy")} /><path className="perf-series" d={path("account")} />
        <path className="perf-cursor" d={`M${x(index)},0V150`} />
      </svg>
    </div> : <State kind="unavailable" title="The chart needs two funded, priced sessions" />}
    {points.length > 1 && <input type="range" aria-label="Inspect performance session" aria-valuetext={point.date}
      min="0" max={points.length - 1} value={index} onChange={event => setSelected(points[Number(event.target.value)].date)} />}
    <div className="performance-dates"><small>{points[0].date}</small><small>{points.at(-1)?.date}</small></div>
    <dl className="flow-readings"><div><dt>Session P&amp;L</dt><dd>{money(point.daily)}</dd></div>
      <div><dt>Range P&amp;L through session</dt><dd>{money(point.cumulative)}</dd></div></dl>
    <p className="portfolio-note">Dollar P&amp;L excludes deposits and withdrawals. Session P&amp;L measures change since the previous priced session.</p>
    <p className="portfolio-note">SPY end-of-day price return · {source}. {start >= 0 && `Both returns use ${points[start].date} as their base.`}</p>
    {(missingAccount > 0 || missingSpy > 0) && <p className="coverage-note">Coverage gaps · {missingAccount} account sessions unavailable · {missingSpy} priced account sessions without a matching SPY return.{point.missing.length > 0 && ` Missing marks for ${point.missing.join(", ")}.`}</p>}
  </figure>;
}

export function Performance({ owner }: { owner: number }) {
  const [range, setRange] = useState<PerformanceRange>("1y");
  const query = useQuery({ queryKey: keys.account(owner, "performance", range), queryFn: () => fetchPerformanceRange(range), retry: false });
  return <Panel className="performance-panel" title="Performance" actions={<select className="field-control" aria-label="Performance date range" value={range}
    onChange={event => setRange(event.target.value as PerformanceRange)}><option value="1y">1 year</option><option value="2y">2 years</option></select>}>
    {query.isError ? <State kind="error" title="Performance history unavailable" action={<Button onClick={() => void query.refetch()}>Retry performance</Button>} /> :
      query.isPending ? <State kind="loading" title="Loading portfolio sessions…" /> : <PerformanceChart key={range} data={query.data} />}
  </Panel>;
}
