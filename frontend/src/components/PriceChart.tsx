import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CompanyProfile } from "./CompanyProfile";
import { RestInstrument } from "../night/inner/SeriesInstrument";
import { useLook } from "../night/looks/preferences";
import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";
import type { HistoryBar, HistoryCoverageStatus } from "../api/history";
import type { IndicatorOverlay } from "./historyData";
import { formatCurrency, formatQuantity } from "../utils/format";
import {
  type ChartRange,
  type ChartType,
  CHART_RANGES,
  buildSeries,
  chartSummary,
  rangeLabel,
  sliceBars,
} from "./priceChartData";

type Hover = {
  time: string;
  x: number;
  y: number;
};

function timeText(time: Time | undefined): string | null {
  if (typeof time === "string") return time;
  if (typeof time === "object" && time && "year" in time && "month" in time && "day" in time) {
    const month = String(time.month).padStart(2, "0");
    const day = String(time.day).padStart(2, "0");
    return `${time.year}-${month}-${day}`;
  }
  return null;
}

function controlClass(pressed: boolean): string {
  return [
    "min-h-11 rounded-full px-4 text-sm font-semibold",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    pressed ? "bg-brand-500 text-canvas" : "bg-raised text-copy hover:bg-hover",
  ].join(" ");
}

export function PriceChart({
  symbol,
  bars,
  endDate,
  coverageStatus,
  seriesLabel,
  sma20,
  sma50,
  instrument = false,
}: {
  symbol: string;
  bars: readonly HistoryBar[];
  endDate: string;
  /** Coverage of the full history window the bars came from, as reported by the API. */
  coverageStatus?: HistoryCoverageStatus;
  seriesLabel?: string;
  sma20?: IndicatorOverlay;
  sma50?: IndicatorOverlay;
  instrument?: boolean;
}) {
  const summaryId = useId();
  const [range, setRange] = useState<ChartRange>("1Y");
  const { prefs } = useLook();
  const [chartType, setChartType] = useState<ChartType | "profile">(instrument ? "profile" : "line");
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rangeBars = useMemo(() => sliceBars(bars, range, endDate), [bars, range, endDate]);
  const series = useMemo(() => buildSeries(rangeBars, coverageStatus), [rangeBars, coverageStatus]);
  const summary = chartSummary(symbol, series.plotted, series.gapCount, range, coverageStatus);
  const plottedByTime = useMemo(
    () => new Map(series.plotted.map((bar) => [bar.time, bar])),
    [series.plotted],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartType === "profile" || series.plotted.length === 0) return undefined;
    let cancelled = false;
    let chart: IChartApi | null = null;
    let created: IChartApi | null = null;
    const lineMode = chartType === "line";
    const barsByTime = plottedByTime;

    const onCrosshair = (param: MouseEventParams<Time>) => {
      const width = frameRef.current?.clientWidth ?? 0;
      const when = timeText(param.time);
      const bar = when ? barsByTime.get(when) : undefined;
      if (!param.point || param.point.x < 0 || param.point.y < 0 || !bar) {
        setHover(null);
        return;
      }
      const left = Math.min(Math.max(8, param.point.x + 12), Math.max(8, width - 176));
      const top = Math.max(8, param.point.y - 88);
      setHover({ time: bar.time, x: left, y: top });
    };

    void import("lightweight-charts")
      .then((charts) => {
        if (cancelled) return;
        try {
          created = charts.createChart(container, {
            autoSize: true,
            height: 320,
            layout: {
              background: { type: charts.ColorType.Solid, color: prefs.look==="dial" ? "#111310" : "#141617" },
              textColor: "#C6CFCA",
              attributionLogo: true,
              fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace",
            },
            grid: {
              vertLines: { color: "#343B3F" },
              horzLines: { color: "#343B3F" },
            },
            rightPriceScale: { borderColor: "#343B3F" },
            timeScale: { borderColor: "#343B3F", secondsVisible: false, timeVisible: false },
            ...(charts.CrosshairMode ? { crosshair: { mode: charts.CrosshairMode.Normal } } : {}),
          });
          const candles = created.addSeries(charts.CandlestickSeries, {
            upColor: "#d7d8ce",
            downColor: "#565b59",
            borderVisible: false,
            wickUpColor: "#e1e3d9",
            wickDownColor: "#a6aaa2",
            priceLineVisible: false,
          });
          const line = created.addSeries(charts.AreaSeries, {
            lineColor: prefs.look==="terrain" ? "#ecba85" : "#d6d8cb",
            topColor: "rgba(146, 149, 139, 0.35)",
            bottomColor: "rgba(146, 149, 139, 0.02)",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
          });
          const volume = created.addSeries(charts.HistogramSeries, {
            priceFormat: { type: "volume" },
            priceScaleId: "detail-volume",
            priceLineVisible: false,
            lastValueVisible: false,
          });
          volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
          created.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
          const rangeTimes = new Set(series.plotted.map((bar) => bar.time));
          const overlayPoints = (overlay: IndicatorOverlay) => overlay.line.filter(
            (point) => typeof point.time === "string" && rangeTimes.has(point.time),
          );
          if (sma20?.status === "partial") {
            const sma20Series = created.addSeries(charts.LineSeries, {
              color: "#babdb4", lineStyle: 2, lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
            });
            sma20Series.setData(overlayPoints(sma20));
          }
          if (sma50?.status === "partial") {
            const sma50Series = created.addSeries(charts.LineSeries, {
              color: "#91978e", lineStyle: 1, lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
            });
            sma50Series.setData(overlayPoints(sma50));
          }
          candles.setData(series.candles);
          line.setData(series.line);
          volume.setData(series.volume.map(point=>{
            const bar=barsByTime.get(point.time);
            return bar && "value" in point ? {...point,color:bar.close>=bar.open ? "#92978f" : "#4f5550"} : point;
          }));
          candles.applyOptions({ visible: !lineMode });
          line.applyOptions({ visible: lineMode });
          created.timeScale().fitContent();
          created.subscribeCrosshairMove(onCrosshair);
          chart = created;
          setFailed((current) => (current ? false : current));
        } catch {
          // A throw after createChart leaves `chart` unset, so remove the created instance.
          try {
            created?.remove();
          } catch {
            // The chart is already unusable. Fall through to the table.
          }
          created = null;
          chart = null;
          if (!cancelled) setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      chart?.unsubscribeCrosshairMove(onCrosshair);
      chart?.remove();
    };
  }, [chartType, plottedByTime, series, sma20, sma50, prefs.look]);

  const hovered = hover ? plottedByTime.get(hover.time) : undefined;

  return (
    <section aria-labelledby="price-chart-title" className="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <div className="price-controls flex flex-col gap-4">
        <div>
          <h2 className="text-lg leading-7 font-semibold text-ink" id="price-chart-title">
            Price
          </h2>
        </div>
        {instrument && <div className="price-mobile-controls">
          <select aria-label="Price history range" value={range} onChange={e=>{setRange(e.target.value as ChartRange);setHover(null);}}>
            {CHART_RANGES.map(r=><option key={r} value={r}>{rangeLabel(r)}</option>)}
          </select>
          <select aria-label="Price chart type" value={chartType} onChange={e=>setChartType(e.target.value as ChartType|"profile")}>
            <option value="profile">{prefs.look==="terrain" ? "Relief":"Dial"}</option><option value="line">Line</option><option value="candlestick">Candlestick</option>
          </select>
        </div>}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Chart range">
          {CHART_RANGES.map((item) => (
            <button
              aria-label={rangeLabel(item)}
              aria-pressed={range === item}
              className={controlClass(range === item)}
              key={item}
              onClick={() => {
                setRange(item);
                setHover(null);
              }}
              type="button"
            >
              {item === "YTD" ? "YTD" : item}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Chart type">
          {instrument && <button className={controlClass(chartType === "profile")} aria-pressed={chartType==="profile"}
            onClick={()=>setChartType("profile")} type="button">{prefs.look==="terrain" ? "Relief" : "Dial"}</button>}
          <button
            aria-pressed={chartType === "line"}
            className={controlClass(chartType === "line")}
            onClick={() => setChartType("line")}
            type="button"
          >
            Line
          </button>
          <button
            aria-pressed={chartType === "candlestick"}
            className={controlClass(chartType === "candlestick")}
            onClick={() => setChartType("candlestick")}
            type="button"
          >
            Candlestick
          </button>
        </div>
        {chartType !== "profile" && (sma20?.status === "partial" || sma50?.status === "partial") ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-muted">
            <span className="text-ink">{symbol} close</span>
            {sma20?.status === "partial" ? <span className="text-copy">SMA 20</span> : null}
            {sma50?.status === "partial" ? <span className="text-muted">SMA 50</span> : null}
            <span>Volume</span>
          </p>
        ) : null}
      </div>
      {series.plotted.length === 0 ? (instrument && <RestInstrument label={symbol+" close"} status={{kind:"empty",title:"Stored daily bars fill this window."}}/>) :
        chartType === "profile" ? <CompanyProfile line={series.line} bars={plottedByTime} symbol={symbol} sma20={sma20} sma50={sma50}/> : (
        <>
          {failed ? (
            <p className="mt-6 text-sm leading-6 text-copy" role="status">
              The price chart could not be drawn. The table lists the cached sessions.
            </p>
          ) : null}
          <div
            className={
              failed
                ? "sr-only"
                : "relative mt-6 h-72 w-full min-w-0 overflow-hidden sm:h-96"
            }
            ref={frameRef}
          >
            <div
              aria-label={summary}
              className="h-full w-full"
              ref={containerRef}
              role="img"
            />
            {hovered && hover ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-10 w-40 rounded-xl border border-line bg-raised px-3 py-2 text-[13px] leading-5 tabular-nums text-ink"
                style={{ left: hover.x, top: hover.y }}
              >
                <p>{hovered.time}</p>
                <p>Open {formatCurrency(hovered.open)}</p>
                <p>High {formatCurrency(hovered.high)}</p>
                <p>Low {formatCurrency(hovered.low)}</p>
                <p>Close {formatCurrency(hovered.close)}</p>
                <p>Volume {formatQuantity(hovered.volume)}</p>
              </div>
            ) : null}
          </div>
        </>
      )}
      <div className="price-context">
          <p
            className="mt-1 text-sm leading-6 text-copy"
            id={summaryId}
            role={series.plotted.length === 0 ? "status" : undefined}
          >
            {summary}
          </p>
          {seriesLabel ? <p className="mt-1 text-sm leading-6 text-muted">{seriesLabel}</p> : null}
      </div>
      {series.plotted.length > 0 ? <div className="mt-4 max-h-60 max-w-full overflow-auto">
        <table aria-labelledby={summaryId} className="w-full min-w-[36rem] text-left text-[13px] leading-5 tabular-nums text-ink">
          <thead className="bg-raised text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold" scope="col">Date</th>
              <th className="px-3 py-2 font-semibold" scope="col">Open</th>
              <th className="px-3 py-2 font-semibold" scope="col">High</th>
              <th className="px-3 py-2 font-semibold" scope="col">Low</th>
              <th className="px-3 py-2 font-semibold" scope="col">Close</th>
              <th className="px-3 py-2 font-semibold" scope="col">Volume</th>
            </tr>
          </thead>
          <tbody>
            {series.plotted.map((bar) => (
              <tr className="even:bg-raised" key={bar.time}>
                <th className="px-3 py-2 font-medium" scope="row">{bar.time}</th>
                <td className="px-3 py-2">{bar.openText}</td>
                <td className="px-3 py-2">{bar.highText}</td>
                <td className="px-3 py-2">{bar.lowText}</td>
                <td className="px-3 py-2">{bar.closeText}</td>
                <td className="px-3 py-2">{bar.volumeText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : null}
      <p className="mt-4 flex flex-wrap gap-x-4 text-[12px] leading-4 text-muted">
        <a
          className="inline-flex min-h-11 items-center underline decoration-line underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          href="/licenses/lightweight-charts-LICENSE.txt"
        >
          lightweight-charts license
        </a>
        <a
          className="inline-flex min-h-11 items-center underline decoration-line underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          href="/licenses/lightweight-charts-NOTICE.txt"
        >
          lightweight-charts notice
        </a>
      </p>
    </section>
  );
}
