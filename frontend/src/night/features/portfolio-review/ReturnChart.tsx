import { useMemo, useState } from "react";
import { Panel, RestInstrument, SeriesInstrument } from "../../inner";
import { numeric } from "../portfolio/valuation";
import { formatSignedPercent } from "../../../utils/format";
import { dates, pct, type Review } from "./review";

const names = ["Account return", "SPY price return"];
const formatReturn = (ratio: number) => formatSignedPercent(ratio * 100);

export function ReturnChart({ review }: { review: Review }) {
  const [inspected, setInspected] = useState<string>();
  const samples = useMemo(() => {
    const rows = new Map(review.points.map(point => [point.session_date, point]));
    const sessions = new Set([...rows.keys(), ...review.missing_sessions]);
    return [...sessions].sort().map(label => {
      const row = rows.get(label);
      return { label, values: [numeric(row?.portfolio_return_ratio), numeric(row?.spy_return_ratio)], drawdown: row?.drawdown_ratio ?? null };
    });
  }, [review.points, review.missing_sessions]);
  const latest = samples.reduce((last, point, i) => point.values[0] === null ? last : i, -1);
  const chosen = samples.findIndex(point => point.label === inspected);
  const index = chosen >= 0 ? chosen : latest >= 0 ? latest : Math.max(0, samples.length - 1);
  const point = samples[index];
  const ready = samples.some(row => row.values.some(v => v !== null));
  return <Panel title="Cumulative return" className="review-chart" subtitle={<><span>Time-weighted account vs. SPY price</span><span className="review-window">{dates(review.requested_start, review.requested_end)}</span></>}>
    {ready ? <SeriesInstrument samples={samples} names={names} reference={0} format={formatReturn}
      label="Inspect closing session" selected={index} onSelect={i => setInspected(samples[i].label)} /> :
      <><RestInstrument label="Cumulative return" status={{kind:"unavailable",title:"No priced returns in this period"}} />
        {samples.length > 1 && <input type="range" aria-label="Inspect closing session" aria-valuetext={point.label}
          min="0" max={samples.length-1} value={index} onChange={e => setInspected(samples[Number(e.target.value)].label)} />}</>}
    {point && <div className="review-inspect"><span>Drawdown at <time>{point.label}</time></span><b>{pct(point.drawdown)}</b></div>}
  </Panel>;
}
