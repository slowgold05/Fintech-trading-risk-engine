import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyHistory } from "../../../api/history";
import { keys } from "../../api";
import { State } from "../../kit";
import { matchingPrices, priceReturn, type PricePoint, type Request, type Simulation } from "./simulation";

function Plot({ points, request, partial }: { points: PricePoint[]; request: Request; partial: boolean }) {
  const [index, setIndex] = useState(points.length - 1);
  const selected = points[Math.min(index, points.length - 1)];
  const values = points.map(point => point.ratio);
  const bottom = Math.min(...values, 0);
  const top = Math.max(...values, 0);
  const start = Date.parse(request.start);
  const span = Date.parse(request.end) - start;
  const x = (date: string) => 2 + 596 * (Date.parse(date) - start) / span;
  const y = (ratio: number) => top === bottom ? 80 : 150 - 140 * (ratio - bottom) / (top - bottom);
  const path = points.map((point, i) => {
    // On partial coverage only consecutive calendar dates establish an unbroken segment.
    const connect = i > 0 && (!partial || Date.parse(point.date) - Date.parse(points[i - 1].date) === 86400000);
    return (connect ? "L" : "M") + x(point.date) + "," + y(point.ratio);
  }).join(" ");
  return <>
    <div className="sim-plot">
      <div className="sim-scale"><span>{priceReturn(top)}</span>{top !== bottom && <span>{priceReturn(bottom)}</span>}</div>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="Underlying price return over the requested window">
        <line className="sim-zero" x1="0" y1={y(0)} x2="600" y2={y(0)} />
        <path className="sim-line" d={path} />
        {partial && points.map(p => <circle className="sim-mark" key={p.date} cx={x(p.date)} cy={y(p.ratio)} r="1.6" />)}
        <line className="sim-cursor" x1={x(selected.date)} x2={x(selected.date)} y1="0" y2="160" />
        <circle className="sim-mark" cx={x(selected.date)} cy={y(selected.ratio)} r="3" />
      </svg>
      <div className="sim-axis"><span>{request.start}</span><span>{request.end}</span></div>
    </div>
    <div className="sim-inspect">
      <label htmlFor="sim-session">Inspect a close</label>
      <output htmlFor="sim-session">{selected.date} · ${Number(selected.close).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})} · {priceReturn(selected.ratio)}</output>
      <input id="sim-session" type="range" min="0" max={points.length - 1} value={Math.min(index, points.length - 1)}
        aria-valuetext={selected.date + ", " + priceReturn(selected.ratio)} onChange={e => setIndex(Number(e.target.value))} />
    </div>
  </>;
}

export function PriceChart({ result, request }: { result: Simulation; request: Request }) {
  const provider = result.source?.provider;
  const history = useQuery({
    queryKey: keys.history(result.symbol, provider ?? "", "split_adjusted", "all"),
    queryFn: () => fetchDailyHistory(result.symbol, provider, "split_adjusted", "all"),
    enabled: !!provider, retry: false,
  });
  const points = history.data && matchingPrices(result, history.data);
  return <section className="sim-chart" aria-label="Price return chart">
    <div className="sim-chart-head"><h3>Underlying price return</h3><strong>{priceReturn(result.price_return)}</strong></div>
    <p className="sim-definition">Each split-adjusted close divided by the first used close, minus one. Cash contributions have no effect on this percentage.</p>
    {provider && history.isPending ? <State kind="loading" title="Loading dated closes…" /> :
      points ? <Plot points={points} request={request} partial={result.coverage !== "available"} /> :
      <State kind="unavailable" title="Matching price history unavailable" detail="The run totals above come from the simulation. Run again to check the dated closes." />}
  </section>;
}
