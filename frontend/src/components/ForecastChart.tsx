import { useEffect, useRef } from "react";
import type { HistoryBar } from "../api/history";
import type { ForecastResult } from "../types/schemas";
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      return undefined;
    }

    let cancelled = false;
    let removed = false;
    let active: ChartHandle | null = null;

    const dispose = () => {
      if (removed) {
        return;
      }
      removed = true;
      cancelled = true;
      active?.remove();
      active = null;
    };

    const observed = bars
      .filter((bar) => bar.session_date <= forecast.input_cutoff)
      .map((bar) => ({
        time: bar.session_date,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
      }))
      .sort((left, right) => left.time.localeCompare(right.time));

    // Closes only. A forecast is not observed OHLC, so it is not a second candlestick series.
    const generated = forecast.bars
      .map((bar) => ({
        time: bar.session_date,
        value: bar.close,
      }))
      .sort((left, right) => left.time.localeCompare(right.time));

    void import("lightweight-charts")
      .then((charts) => {
        if (cancelled) {
          return;
        }
        try {
          const created = charts.createChart(container, {
            autoSize: true,
            height: 320,
            layout: {
              background: { type: charts.ColorType.Solid, color: "#020617" },
              textColor: "#cbd5e1",
              attributionLogo: true,
              fontFamily: "Geist, Satoshi, Outfit, ui-sans-serif, system-ui, sans-serif",
            },
            grid: {
              vertLines: { color: "#1e293b" },
              horzLines: { color: "#1e293b" },
            },
            rightPriceScale: { borderColor: "#334155" },
            timeScale: {
              borderColor: "#334155",
              secondsVisible: false,
              timeVisible: false,
            },
          });
          active = created;
          const candles = created.addSeries(charts.CandlestickSeries, {
            upColor: "#34d399",
            downColor: "#fb7185",
            borderVisible: false,
            wickUpColor: "#34d399",
            wickDownColor: "#fb7185",
            priceFormat: {
              type: "price",
              precision: 6,
              minMove: 0.000001,
            },
          });
          candles.setData(observed);
          const forecastLine = created.addSeries(charts.LineSeries, {
            color: "#fbbf24",
            lineWidth: 2,
            lineStyle: FORECAST_LINE_STYLE,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
          });
          forecastLine.setData(generated);
          created.timeScale().fitContent();
        } catch {
          dispose();
        }
      })
      .catch(() => {
        // The caption below still identifies the path when the chart library fails to load.
      });

    return dispose;
  }, [bars, forecast]);

  return (
    <div>
      <div className="h-80 min-w-0 w-full" data-testid="forecast-chart" ref={containerRef} />
      {/* Cutoff is a caption. lightweight-charts v5 has no built-in vertical line primitive. */}
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Observed through {forecast.input_cutoff} · Forecast generated{" "}
        {formatDateTime(forecast.generated_at)} · Model {forecast.model_name} · Tokenizer{" "}
        {forecast.tokenizer_name}
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-300">
        This is one model-generated path, not a prediction and not a guaranteed future price.
      </p>
    </div>
  );
}
