import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyHistory, type HistoryResponse } from "../../../api/history";
import { buildSeries, sessionsVerified } from "../../../components/priceChartData";
import { formatCurrency } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Field, Panel, RestInstrument, SeriesInstrument, Stat } from "../../inner";
import { DataStamp } from "../../kit";

function CloseWindow({ data, symbol }: { data: HistoryResponse; symbol: string }) {
  const [date, setDate] = useState<string>();
  const series = useMemo(() => buildSeries(data.bars, data.coverage_status), [data]);
  const samples = useMemo(() => {
    const values = new Map(series.line.map(point => [point.time, "value" in point ? point.value : null]));
    if (!sessionsVerified(data.coverage_status)) {
      for (let day = Date.parse(data.requested_start); day <= Date.parse(data.requested_end); day += 86400000) {
        const session = new Date(day);
        const label = session.toISOString().slice(0, 10);
        const weekday = session.getUTCDay();
        if (weekday !== 0 && weekday !== 6 && !values.has(label)) values.set(label, null);
      }
    }
    return [...values].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({label, values:[value]}));
  }, [series, data]);
  const names = useMemo(() => [symbol + " close"], [symbol]);
  const closes = series.plotted.map(point => point.close);
  const latest = series.plotted.at(-1);
  const lastBar = data.bars.find(bar => bar.session_date === latest?.time);
  if (!latest || !lastBar || data.symbol !== symbol || data.adjustment_type !== "split_adjusted" || data.bars.some(bar =>
    bar.provider !== data.provider || bar.adjustment_type !== data.adjustment_type)) {
    return <RestInstrument label="Daily closes" status={{kind:"unavailable", title:`No compatible stored closes for ${symbol} in this window.`}} />;
  }
  const latestIndex = samples.findIndex(point => point.label === latest.time);
  const selection = samples.findIndex(point => point.label === date);
  const unpriced = samples.length - series.plotted.length;
  return <>
    <div className="research-readings">
      <Stat label="Latest close" value={formatCurrency(latest.close)} source={latest.time} />
      <Stat label="Window low" value={formatCurrency(Math.min(...closes))} />
      <Stat label="Window high" value={formatCurrency(Math.max(...closes))} />
    </div>
    <SeriesInstrument samples={samples} names={names} format={formatCurrency} label={symbol + " daily close"}
      selected={selection < 0 ? latestIndex : selection} onSelect={index => setDate(samples[index].label)} />
    <footer className="research-basis">
      <DataStamp source={{provider:lastBar.provider, session_date:lastBar.session_date, basis:lastBar.adjustment_type, observed_at:lastBar.fetched_at, coverage:"available"}} />
      <span>{series.plotted.length} stored sessions · 1 month · Coverage {data.coverage_status.replaceAll("_", " ")}</span>
      {unpriced > 0 && <span>{unpriced} unpriced weekdays in the requested window, including market holidays.</span>}
    </footer>
  </>;
}

export function StoredContext({ symbol, onSymbol }: { symbol: string; onSymbol: (value: string) => void }) {
  const [draft, setDraft] = useState(symbol);
  const history = useQuery({
    queryKey: keys.history(symbol, "auto", "split_adjusted", "1m"),
    queryFn: () => fetchDailyHistory(symbol, "auto", "split_adjusted", "1m"),
    retry: false,
  });
  return <Panel title={symbol + " daily closes"} className="research-context" actions={
    <form className="desk-inline-form" onSubmit={event => {
      event.preventDefault();
      const next = draft.trim().toUpperCase();
      if (next) onSymbol(next);
    }}>
      <Field id="research-context-symbol" label="Context symbol">
        <input maxLength={20} required value={draft} onChange={event => setDraft(event.target.value)} />
      </Field>
      <Button type="submit">Load context</Button>
    </form>}>
    {history.isPending ? <RestInstrument label="Daily closes" status={{kind:"loading", title:"Reading stored closes…"}} /> :
      history.isError ? <RestInstrument label="Daily closes" status={{kind:"error", title:`Stored context for ${symbol} could not be loaded.`, action:<Button onClick={() => void history.refetch()}>Retry</Button>}} /> :
      <CloseWindow key={symbol} data={history.data} symbol={symbol} />}
  </Panel>;
}
