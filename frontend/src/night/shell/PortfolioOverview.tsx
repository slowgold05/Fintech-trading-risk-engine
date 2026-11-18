import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPortfolioPerformance } from "../../api/portfolio";
import type { AllocationResponse } from "../../types/schemas";
import { formatCurrency } from "../../utils/format";
import { Button, Panel, State } from "../kit";
import { keys } from "../api";

export function PerformancePlot({ owner }: { owner: number | undefined }) {
  const result = useQuery({queryKey:keys.account(owner ?? 0,"performance","1y"),queryFn:fetchPortfolioPerformance,enabled:owner != null,retry:false});
  const [inspect,setInspect] = useState<number|null>(null);
  const rows = result.data?.series ?? [];
  const values = rows.map(row => row.account_value == null || !Number.isFinite(Number(row.account_value)) ? null : Number(row.account_value));
  const priced = values.filter((v): v is number => v != null);
  const min = Math.min(...priced), max = Math.max(...priced);
  const x = (i: number) => 1000*i/Math.max(1,rows.length-1);
  const y = (v: number) => max === min ? 75 : 146 - 142*(v-min)/(max-min);
  const path = values.map((value,i) => value == null ? "" : `${i === 0 || values[i-1] == null ? "M" : "L"}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const latestPriced = values.reduce<number>((last,value,index) => value == null ? last : index, -1);
  const i = Math.min(inspect ?? latestPriced,rows.length-1);
  const value = values[i];
  return <Panel className="performance-panel" title="Account value history" actions={<small>1 year · USD</small>}>
    {result.isError ? <State kind="error" title="Portfolio history unavailable" action={<Button onClick={() => void result.refetch()}>Retry</Button>} /> :
      result.isPending ? <State kind="loading" title="Loading priced sessions…" /> :
      priced.length < 2 ? <State kind="unavailable" title="Fewer than two priced sessions" /> :
      <figure><figcaption aria-live="polite"><strong>{value == null ? "Unpriced" : formatCurrency(value, false)}</strong><small>{rows[i].session_date}</small></figcaption>
        <svg role="img" aria-label={`Account value across ${priced.length} priced sessions, from ${formatCurrency(min)} to ${formatCurrency(max)}.`} viewBox="0 0 1000 152" preserveAspectRatio="none">
          {[4,75,146].map(h => <path className="perf-rule" key={h} d={`M0,${h}H1000`} />)}
          <path className="perf-series" d={path} /><path className="perf-cursor" d={`M${x(i)},0V152`} />
        </svg>
        <input type="range" aria-label="Inspect account value by session" min="0" max={rows.length-1} value={i} onChange={event => setInspect(Number(event.target.value))} />
        <div className="performance-dates"><small>{rows[0].session_date}</small><small>{rows.at(-1)?.session_date}</small></div>
      </figure>}
  </Panel>;
}
export function ExposureBand({ allocation, loading, retry }: { allocation?: AllocationResponse; loading: boolean; retry?: () => void }) {
  const rows = allocation?.status === "complete" && allocation.cash_weight_pct != null && allocation.sectors ?
    [{sector:"Cash",weight_pct:allocation.cash_weight_pct}, ...allocation.sectors].sort((a,b) => Number(b.weight_pct)-Number(a.weight_pct)) : null;
  return <Panel className="exposure-panel" title="Account allocation" subtitle="Share of account value">
    {rows ? <ol>{rows.map(row => <li key={row.sector}><div><span>{row.sector}</span><b>{Number(row.weight_pct).toFixed(1)}%</b></div>
      <div aria-hidden="true" className="exposure-track"><i style={{width:Math.min(100,Math.max(0,Number(row.weight_pct)))+"%"}} /></div></li>)}</ol> :
      <State kind={loading ? "loading" : retry ? "error" : "unavailable"} title={loading ? "Loading weights…" : "Allocation unavailable"} action={retry && <Button onClick={retry}>Retry</Button>} />}
  </Panel>;
}
