import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryBar } from "../api/history";
import type { ForecastResult } from "../types/schemas";
import { Table, State } from "../night/kit";
import { formatDateTime } from "../utils/format";

/** Dashed. LineStyle.Dashed is 2, the same numeric value DailyHistory uses for BOLLINGER_BAND_LINE_STYLE. */
const FORECAST_LINE_STYLE = 2 as import("lightweight-charts").LineStyle;

type ChartHandle = { remove: () => void };

export function ForecastChart({
  bars,
  forecast,
}: {
  bars: HistoryBar[];
  forecast: ForecastResult;
}) {
  const [chartFailed, setChartFailed] = useState(false);
  const observed = useMemo(() => bars.filter(bar => bar.session_date <= forecast.input_cutoff &&
    bar.provider === forecast.provider && bar.adjustment_type === forecast.adjustment_type)
    .sort((a, b) => a.session_date.localeCompare(b.session_date)).slice(-forecast.lookback)
    .map(bar => ({ time: bar.session_date, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close) })), [bars, forecast]);
  const generated = useMemo(() => forecast.bars.filter(bar => bar.session_date > forecast.input_cutoff)
    .map(bar => ({ time: bar.session_date, value: bar.close })).sort((a, b) => a.time.localeCompare(b.time)), [forecast]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      return undefined;
    }

    let cancelled = false;
    let removed = false;
    let paletteObserver: MutationObserver | undefined;
    let active: ChartHandle | null = null;

    const dispose = () => {
      if (removed) {
        return;
      }
      removed = true;
      cancelled = true;
      paletteObserver?.disconnect();
      active?.remove();
      active = null;
    };

    void import("lightweight-charts")
      .then((charts) => {
        if (cancelled) {
          return;
        }
        try {
          const color = (name: string) => getComputedStyle(container).getPropertyValue(name).trim();
          const palette = () => ({
            layout: { background: { type: charts.ColorType.Solid, color: color("--surface") || "#15181b" },
              textColor: color("--muted") || "#adb3b5", attributionLogo: true, fontFamily: color("--font-mono") || "monospace" },
            grid: { vertLines: { color: color("--line") || "#3a4147" }, horzLines: { color: color("--line") || "#3a4147" } },
            rightPriceScale: { borderColor: color("--line") || "#3a4147" },
            timeScale: { borderColor: color("--line") || "#3a4147", secondsVisible: false, timeVisible: false },
          });
          const candlePalette = () => ({
            upColor: color("--up") || "#8ac7aa", downColor: color("--down") || "#ef9b91",
            wickUpColor: color("--up") || "#8ac7aa", wickDownColor: color("--down") || "#ef9b91",
          });
          const created = charts.createChart(container, { autoSize: true, height: 300, ...palette() });
          active = created;
          const candles = created.addSeries(charts.CandlestickSeries, {
            ...candlePalette(), borderVisible: false,
            priceFormat: {
              type: "price",
              precision: 6,
              minMove: 0.000001,
            },
          });
          candles.setData(observed);
          const forecastLine = created.addSeries(charts.LineSeries, {
            color: color("--accent") || "#ffc172",
            lineWidth: 2,
            lineStyle: FORECAST_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
          });
          forecastLine.setData(generated);
          created.timeScale().fitContent();
          paletteObserver = new MutationObserver(() => {
            created.applyOptions(palette());
            candles.applyOptions(candlePalette());
            forecastLine.applyOptions({ color: color("--accent") || "#ffc172" });
          });
          paletteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
          setChartFailed(false);
        } catch {
          setChartFailed(true);
          dispose();
        }
      })
      .catch(() => {
        if (!cancelled) setChartFailed(true);
      });

    return dispose;
  }, [observed, generated]);

  return (
    <div>
      {observed.length === 0 && <State kind="unavailable" title="No compatible observed sessions through the input cutoff." />}
      {generated.length === 0 && <State kind="empty" title="No generated closes stored after the input cutoff." />}
      {chartFailed && <State kind="unavailable" title="Chart unavailable" detail="Inspect the session values below." />}
      <div className={chartFailed ? "hidden" : "h-72 min-w-0 w-full"} data-testid="forecast-chart" ref={containerRef} />
      <p className="desk-meta">{observed.length ? `Observed through ${observed.at(-1)!.time} · ` : ""}Input cutoff {forecast.input_cutoff} · Forecast generated{" "}
        {formatDateTime(forecast.generated_at)} · Model {forecast.model_name} · Tokenizer{" "}
        {forecast.tokenizer_name}
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-300">
        This is one model-generated path, not a prediction and not a guaranteed future price.
      </p>
      <details><summary>Inspect observed and generated closes</summary>
        <Table caption={`${forecast.symbol} daily closes · ${forecast.provider} · ${forecast.adjustment_type.replaceAll("_", " ")}`}
          rows={[...observed.map(bar => ({ date: bar.time, close: bar.close, kind: "Observed" })),
            ...generated.map(bar => ({ date: bar.time, close: bar.value, kind: "Generated" }))]}
          rowKey={row => row.date}
          columns={[{ key: "date", header: "Session", cell: row => row.date }, { key: "kind", header: "Series", cell: row => row.kind },
            { key: "close", header: "Close (USD)", align: "right", cell: row => row.close.toFixed(6) }]} />
      </details>
    </div>
  );
}
