import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyHistory } from "../../../api/history";
import { formatCurrency } from "../../../utils/format";
import { keys } from "../../api";
import { Button, DataStamp, Field, Panel, State } from "../../kit";
import { QueryError } from "./DeskStates";

export function StoredContext({ symbol, onSymbol }: { symbol: string; onSymbol: (value: string) => void }) {
  const [draft, setDraft] = useState(symbol);
  const history = useQuery({
    queryKey: keys.history(symbol, "auto", "split_adjusted", "1m"),
    queryFn: () => fetchDailyHistory(symbol, "auto", "split_adjusted", "1m"),
    retry: false,
  });
  const bars = history.data?.bars ?? [];
  const latest = bars.at(-1);
  const prices = bars.map(bar => Number(bar.close));
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const points = prices.map((price, index) => [10 + index * 580 / Math.max(1, bars.length - 1), high === low ? 56 : 102 - (price - low) * 92 / (high - low)]);
  const first = bars[0];

  return <Panel title="Stored market context" className="research-context">
    <form className="desk-inline-form" onSubmit={event => {
      event.preventDefault();
      const next = draft.trim().toUpperCase();
      if (next) onSymbol(next);
    }}>
      <Field id="research-context-symbol" label="Context symbol">
        <input maxLength={20} required value={draft} onChange={event => setDraft(event.target.value)} />
      </Field>
      <Button type="submit">Load context</Button>
    </form>
    {history.isPending ? <State kind="loading" title="Reading stored closes…" /> :
      history.isError ? <QueryError message={`Stored context for ${symbol} could not be loaded.`} onRetry={history.refetch} /> :
      !latest || history.data.symbol !== symbol || bars.some(bar => bar.provider !== history.data.provider || bar.adjustment_type !== history.data.adjustment_type) ?
        <State kind="unavailable" title={`No compatible stored closes for ${symbol} in this window.`} /> :
        <figure className="research-series">
          <figcaption>
            <span className="desk-meta">{symbol} · Daily close</span>
            <strong>{formatCurrency(Number(latest.close))}</strong>
            <DataStamp source={{ provider: latest.provider, session_date: latest.session_date, basis: latest.adjustment_type, observed_at: latest.fetched_at, coverage: "available" }} />
          </figcaption>
          <div className="research-trace">
            <svg viewBox="0 0 600 114" preserveAspectRatio="none" role="img" aria-label={`${bars.length} stored closes from ${first.session_date} to ${latest.session_date}, ranging from ${formatCurrency(low)} to ${formatCurrency(high)}`}>
              {[10, 56, 102].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 6" />)}
              <polyline points={points.map(point => point.join(",")).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {points.length === 1 && <circle cx={points[0][0]} cy={points[0][1]} r="3" fill="var(--accent)" />}
            </svg>
            <div className="research-axis desk-meta"><span>{first.session_date}</span><span>{latest.session_date}</span></div>
          </div>
          <p className="desk-meta">{bars.length} stored sessions · 1 month · {formatCurrency(low)}–{formatCurrency(high)} · Coverage {history.data.coverage_status.replaceAll("_", " ")}</p>
        </figure>}
  </Panel>;
}
