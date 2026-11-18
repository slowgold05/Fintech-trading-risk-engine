import { useState } from "react";
import { ChartFrame, State } from "../../kit";
import { numeric } from "../portfolio/valuation";
import { pct, type Review } from "./review";

type Series = "portfolio_return_ratio" | "spy_return_ratio";

export function ReturnChart({ review }: { review: Review }) {
  const { points } = review;
  const [inspected, setInspected] = useState<string | null>(null);
  const chosen = points.findIndex(p => p.session_date === (inspected ?? review.end_used));
  const index = chosen >= 0 ? chosen : Math.max(0, points.length - 1);
  const point = points[index];
  const values = points.flatMap(p => [numeric(p.portfolio_return_ratio), numeric(p.spy_return_ratio)]).filter((n): n is number => n !== null);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const x = (i: number) => 8 + 784 * i / Math.max(1, points.length - 1);
  const y = (v: number) => high === low ? 80 : 151 - 142 * (v - low) / (high - low);
  function series(key: Series) {
    const readings = points.map(p => numeric(p[key]));
    const line = readings.map((v, i) => v === null ? "" : (readings[i - 1] == null ? "M" : "L") + x(i) + "," + y(v)).join(" ");
    return <g className={key === "spy_return_ratio" ? "review-spy" : "review-account"}>
      <path d={line} />
      {readings.map((v, i) => v !== null && readings[i-1] == null && readings[i+1] == null &&
        <circle key={points[i].session_date} cx={x(i)} cy={y(v)} r="3" />)}
    </g>;
  }

  return <ChartFrame title="Cumulative return" className="review-chart"
    source="Account time-weighted return and SPY price return"
    summary={point && <div className="review-inspect" aria-live="polite">
      <time>{point.session_date}</time><span>Account <b>{pct(point.portfolio_return_ratio)}</b></span>
      <span>SPY <b>{pct(point.spy_return_ratio)}</b></span><span>Drawdown <b>{pct(point.drawdown_ratio)}</b></span>
    </div>}>
    {values.length ? <div className="review-plot">
      <div className="review-scale"><span>{pct(String(high))}</span>{high !== low && <span>{pct(String(low))}</span>}</div>
      <svg viewBox="0 0 800 160" preserveAspectRatio="none" role="img" aria-label="Account return (solid) and SPY return (dashed), with breaks at missing closes.">
        {[9,80,151].map(h => <line key={h} x1="0" x2="800" y1={h} y2={h} />)}
        {series("spy_return_ratio")}{series("portfolio_return_ratio")}
        <line className="review-cursor" x1={x(index)} x2={x(index)} y1="0" y2="160" />
      </svg>
    </div> : <State kind="unavailable" title="No priced returns in this period" />}
    {points.length > 1 && <input aria-label="Inspect closing session" type="range" min="0" max={points.length - 1} value={index}
      aria-valuetext={point.session_date} onChange={e => setInspected(points[Number(e.target.value)].session_date)} />}
    {point && <div className="review-dates"><span>{points[0].session_date}</span><span>{points.at(-1)?.session_date}</span></div>}
  </ChartFrame>;
}
