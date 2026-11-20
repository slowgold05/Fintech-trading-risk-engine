import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyHistory } from "../../../api/history";
import { keys } from "../../api";
import { Button, SeriesInstrument } from "../../inner";
import { matchingPrices, money, priceReturn, type Request, type Simulation } from "./simulation";

const valueNames = ["Portfolio value", "Contributed"];
const returnNames = ["Price return"];
const usd = (value: number) => money(String(value));
const numeric = (value: string | null | undefined) => value != null && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

function sessionDates(result: Simulation, request: Request) {
  const dates = new Set(result.points.map(point => point.session_date));
  if (result.coverage !== "available") {
    for (let day = Date.parse(request.start); day <= Date.parse(request.end); day += 86400000) {
      const date = new Date(day);
      const weekday = date.getUTCDay();
      if (weekday !== 0 && weekday !== 6) dates.add(date.toISOString().slice(0, 10));
    }
  }
  return [...dates].sort();
}

export function PriceChart({ result, request }: { result: Simulation; request: Request }) {
  const [mode, setMode] = useState("value");
  const [date, setDate] = useState<string>();
  const provider = result.source?.provider;
  const history = useQuery({
    queryKey: keys.history(result.symbol, provider ?? "", "split_adjusted", "all"),
    queryFn: () => fetchDailyHistory(result.symbol, provider, "split_adjusted", "all"),
    enabled: !!provider, retry: false,
  });
  const prices = useMemo(() => history.data && matchingPrices(result, history.data), [result, history.data]);
  const priceMap = useMemo(() => new Map(prices?.map(point => [point.date, point])), [prices]);
  const samples = useMemo(() => {
    const points = new Map(result.points.map(point => [point.session_date, point]));
    return sessionDates(result, request).map(label => {
      const point = points.get(label);
      return { label, values: mode === "return" ? [priceMap.get(label)?.ratio ?? null]
        : [numeric(point?.value_usd), numeric(point?.contributed_usd)] };
    });
  }, [mode, result, request, priceMap]);
  const index = samples.findIndex(point => point.label === (date ?? result.end_used));
  const point = priceMap.get(samples[index]?.label);
  return <section className="sim-chart" aria-label="Price return chart">
    <div className="sim-chart-head"><h3>Session history</h3>
      <select className="field-control" aria-label="Simulation measure" value={mode} onChange={event => setMode(event.target.value)}>
        <option value="value">Portfolio value</option><option value="return">Price return</option>
      </select>
    </div>
    <SeriesInstrument samples={samples} names={mode === "return" ? returnNames : valueNames}
      selected={Math.max(index, 0)} onSelect={i => setDate(samples[i].label)}
      format={mode === "return" ? priceReturn : usd} reference={mode === "return" ? 0 : undefined}
      label="Inspect a close" status={mode === "return" && !prices ? {
        kind: provider && history.isPending ? "loading" : "unavailable",
        title: provider && history.isPending ? "Loading dated closes…" : "Matching price history unavailable",
      } : undefined}/>
    {point && <p className="sim-price-reading">Selected close · {point.date} · {Number(point.close).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:6})} · {priceReturn(point.ratio)}</p>}
    <div className="sim-definition"><strong>Underlying price return · <span>{priceReturn(result.price_return)}</span></strong>
      <p>Each split-adjusted close divided by the first used close, minus one. Cash contributions have no effect on this percentage.</p>
      {mode !== "return" && !prices && <p>{provider && history.isPending ? "Loading dated closes…" : "Matching price history unavailable"}</p>}
      {history.isError && <Button onClick={() => void history.refetch()}>Retry dated closes</Button>}
    </div>
  </section>;
}
