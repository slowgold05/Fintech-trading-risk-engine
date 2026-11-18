import { pulseMarks } from "./market/pulseMarks";
import { inspectEvents } from "./market/inspectEvents";
import { useSessionPaint } from "./market/sessionCursor";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { HistoryCoverageStatus, HistoryResponse } from "../api/history";
import { Figure, Skeleton, EmptyState } from "../design/primitives";
import { formatCurrency, formatSignedPercent, formatQuantity } from "../utils/format";
import {
  INDEX_PROXIES,
  type NormalizedPoint,
  type NormalizedSeries,
  type PulseChartRange,
  normalizeCloses,
  proxyHistoryQuery,
} from "./indexComparisonData";

const COLORS = ["#ebebe6", "#adacb9", "#85898a", "#c3b4a5"];
const HISTORY_PROVIDER = "massive";
const HISTORY_ADJUSTMENT = "split_adjusted";
const CHART_HEIGHT = 200;

type Proxy = {
  symbol: string;
  name: string;
};

type Quote = {
  symbol: string;
  value: number;
  changePercent: number;
};

type PlotRow = {
  symbol: string;
  name: string;
  color: string;
  state: "loading" | "unavailable" | "ready";
  coverage: HistoryCoverageStatus | null;
  volume: { time: string; value: number }[];
  series: NormalizedSeries | null;
};

type HoverPoint = {
  symbol: string;
  name: string;
  color: string;
  value: number;
};

type PointerHover = {
  date: string;
  x: number;
  y: number;
};

function coverageHasGaps(status: HistoryCoverageStatus | null) {
  return status === "gaps" || status === "gaps_and_unexpected_sessions";
}

function plotFromResponse(
  response: HistoryResponse | undefined,
  failed: boolean,
): Pick<PlotRow, "state" | "coverage" | "series"> {
  if (failed || !response || response.status === "unavailable") {
    return { state: "unavailable", coverage: response?.coverage_status ?? null, series: null };
  }
  const series = normalizeCloses(response.bars);
  if (!series) {
    return { state: "unavailable", coverage: response.coverage_status, series: null };
  }
  return { state: "ready", coverage: response.coverage_status, series };
}

function pointValue(point: NormalizedPoint) {
  return "value" in point && typeof point.value === "number" ? point.value : null;
}

function sessionsFor(rows: readonly PlotRow[]) {
  const readings: Record<string, HoverPoint[]> = {};
  for (const row of rows) {
    for (const point of row.series?.points ?? []) {
      const value = pointValue(point);
      if (typeof point.time !== "string" || value == null) continue;
      (readings[point.time] ??= []).push({ symbol: row.symbol, name: row.name, color: row.color, value });
    }
  }
  return { readings, dates: Object.keys(readings).sort() };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatSessionDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return iso;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function signedAxis(price: number) {
  const sign = price > 0 ? "+" : "";
  return `${sign}${price.toFixed(2)}%`;
}

function chartOptions(charts: typeof import("lightweight-charts"), wall: boolean, width: number) {
  return {
    autoSize: true,
    height: CHART_HEIGHT,
    layout: {
      attributionLogo: !wall,
      background: { type: charts.ColorType?.Solid ?? "solid", color: "#121315" },
      fontFamily: wall ? "IBM Plex Mono, monospace" : "ui-sans-serif, system-ui, sans-serif",
      textColor: "#abadaf",
      fontSize: 11,
    },
    grid: {
      horzLines: { color: "#292b2e" },
      vertLines: { color: "#292b2e" },
    },
    localization: { priceFormatter: signedAxis },
    rightPriceScale: {
      borderColor: "#444649",
      minimumWidth: 66,
      entireTextOnly: true,
      ticksVisible: wall,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: {
      borderColor: "#444649",
      fixLeftEdge: true,
      fixRightEdge: !wall,
      rightOffsetPixels: wall ? (width < 480 ? 50 : 100) : undefined,
      lockVisibleTimeRangeOnResize: true,
    },
    ...crosshairOption(charts),
  };
}

function crosshairOption(charts: object) {
  try {
    const mode = (charts as { CrosshairMode?: { Normal?: number } }).CrosshairMode?.Normal;
    return mode == null ? {} : { crosshair: { mode } };
  } catch {
    return {};
  }
}

function lineOptions(color: string) {
  return {
    color,
    lastValueVisible: false,
    lineWidth: 2 as const,
    priceLineVisible: false,
    // The library resolves the axis-label contrast even for a hidden price line.
    // Give all hidden lines one color so the wall incurs a single style lookup.
    priceLineColor: "#121315",
  };
}

export function IndexComparisonChart({
  adjustment = HISTORY_ADJUSTMENT,
  provider = HISTORY_PROVIDER,
  quotes = [],
  selected,
  onSelect,
  onPreview,
  onDate,
  showVolume = false,
  linkedDate,
  range,
  rangeControl = null,
  symbols = INDEX_PROXIES,
}: {
  adjustment?: string;
  provider?: string;
  quotes?: readonly Quote[];
  selected?: string;
  onDate?: (date: string | null) => void;
  showVolume?: boolean;
  linkedDate?: string | null;
  onSelect?: (symbol: string) => void;
  onPreview?: (s: string | null) => void;
  range: PulseChartRange;
  rangeControl?: ReactNode;
  symbols?: readonly Proxy[];
}) {
  const combine = useCallback(
    (results: UseQueryResult<HistoryResponse>[]) => {
      const rows: PlotRow[] = symbols.map((proxy, index) => {
        const result = results[index];
        const response = result?.data;
        const mismatched =
          response != null &&
          (response.symbol !== proxy.symbol ||
            response.provider !== provider ||
            response.adjustment_type !== adjustment ||
            response.range !== range);
        return {
          symbol: proxy.symbol,
          name: proxy.name,
          color: COLORS[index % COLORS.length],
          volume:
            !showVolume || !response || mismatched || response.status === "unavailable"
              ? []
              : response.bars
                  .filter(
                    (b) => b.volume?.trim() && Number.isFinite(Number(b.volume)) && Number(b.volume) >= 0,
                  )
                  .map((b) => ({ time: b.session_date, value: Number(b.volume) }))
                  .sort((a, b) => a.time.localeCompare(b.time)),
          ...plotFromResponse(
            mismatched ? undefined : response,
            (!response && !!result?.isError) || mismatched,
          ),
          ...(result?.isPending ? { state: "loading" as const, series: null } : {}),
        };
      });
      const plotKey =
        range +
        "|" +
        results.map((r) => r.dataUpdatedAt).join(":") +
        "|" +
        rows
          .map(
            (row) =>
              `${row.symbol}:${row.state}:${row.series?.sessionCount ?? 0}:${row.series?.asOf ?? ""}:${row.series?.hasGap ? "gap" : "solid"}`,
          )
          .join("|");
      return { rows, plotKey, ...sessionsFor(rows), refreshFailed: results.some((r) => r.isRefetchError) };
    },
    [symbols, provider, adjustment, range, showVolume],
  );
  const { rows, plotKey, dates, readings, refreshFailed } = useQueries({
    combine,
    queries: symbols.map((proxy) => proxyHistoryQuery(proxy.symbol, provider, adjustment, range)),
  });

  const rowsRef = useRef(rows);
  const focusRef = useRef(selected);
  const chartApi = useRef<IChartApi | null>(null);
  const linkedRule = useRef<HTMLDivElement>(null);
  const volumes = useRef<ISeriesApi<"Histogram"> | null>(null);
  const plotted = useRef(new Map<string, ISeriesApi<SeriesType>>());
  useEffect(() => {
    focusRef.current = selected;
    volumes.current?.setData(rowsRef.current.find((row) => row.symbol === selected)?.volume ?? []);
    for (const [symbol, series] of plotted.current) {
      const color = rowsRef.current.find((row) => row.symbol === symbol)?.color;
      if (!color) continue;
      const active = selected === symbol;
      series.applyOptions({
        lineWidth: active ? 3 : 1,
        lineColor: active ? "#f5c391" : color,
        topColor: active ? "#d4b49045" : "transparent",
        bottomColor: "transparent",
      });
    }
  }, [selected]);
  const chartNode = useRef<HTMLDivElement | null>(null);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const keyboard = useRef(-1);
  const displayed = useRef<PointerHover | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const spoken = useRef<HTMLParagraphElement>(null);
  const paintPointer = useRef<(point: PointerHover | null) => void>(() => {});
  const chartFailed = failureKey === plotKey;

  useLayoutEffect(() => {
    keyboard.current = -1;
    displayed.current = null;
    return () => {
      if (displayed.current) {
        keyboard.current = -1;
        paintPointer.current(null);
      }
    };
  }, [plotKey]);
  useLayoutEffect(() => {
    function display(point: PointerHover | null, refresh = false) {
      const box = tooltip.current;
      if (!box) return;
      const previous = displayed.current?.date ?? null;
      displayed.current = point;
      const date = point?.date ?? null;
      const observations = date ? readings[date] : undefined;
      box.hidden = !observations?.length;
      if (point) box.style.transform = `translate(${point.x}px,${point.y}px)`;
      if (previous === date && !refresh) return;
      if (previous !== date) {
        onDate?.(date);
        if (date && linkedRule.current) linkedRule.current.hidden = true;
      }
      if (spoken.current)
        spoken.current.textContent =
          date && observations?.length
            ? formatSessionDate(date) +
              ": " +
              observations.map((r) => r.symbol + " " + formatSignedPercent(r.value)).join(", ")
            : "Arrow keys or hover read each session.";
      if (!date || !observations?.length) return;
      box.firstElementChild!.textContent = formatSessionDate(date);
      for (const line of box.querySelectorAll<HTMLElement>("li")) {
        const obs = observations.find((r) => r.symbol === line.dataset.symbol);
        line.hidden = !obs && !showVolume;
        if (!obs) {
          line.lastElementChild!.textContent = "Unavailable";
          line.lastElementChild!.className = "";
        }
        if (obs) {
          const value = line.lastElementChild!;
          value.textContent = formatSignedPercent(obs.value);
          value.className = obs.value < 0 ? "font-mono text-rose-300" : "font-mono text-emerald-300";
        }
      }
      const volume = showVolume
        ? rows.find((r) => r.symbol === selected)?.volume.find((v) => v.time === date)?.value
        : null;
      const footer = box.lastElementChild as HTMLElement;
      footer.hidden = volume == null;
      if (volume != null) footer.textContent = selected + " volume · " + formatQuantity(volume);
    }
    paintPointer.current = (point) => {
      const i = keyboard.current;
      display(point ?? (i >= 0 && dates[i] ? { date: dates[i], x: 8, y: 8 } : null));
    };
    display(displayed.current, true);
  }, [dates, readings, rows, selected, showVolume, onDate]);
  useEffect(() => {
    rowsRef.current = rows;
  });

  useEffect(() => {
    let cancelled = false;
    const active: IChartApi[] = [];
    const handles = plotted.current;
    const node = chartNode.current;
    if (!node) return undefined;

    void import("lightweight-charts")
      .then((charts) => {
        if (cancelled) return;
        const seriesRows = rowsRef.current.filter((row) => row.series);
        if (seriesRows.length === 0) return;
        const drawn: ISeriesApi<SeriesType>[] = [];
        try {
          const chart = charts.createChart(node, chartOptions(charts, showVolume, node.clientWidth));
          active.push(chart);
          chartApi.current = chart;
          for (const row of seriesRows) {
            if (!row.series) continue;
            const active = focusRef.current === row.symbol;
            const series = focusRef.current
              ? chart.addSeries(charts.AreaSeries, {
                  ...lineOptions(row.color),
                  lineColor: active ? "#f5c391" : row.color,
                  lineWidth: active ? 3 : 1,
                  topColor: active ? "#d4b49045" : "transparent",
                  bottomColor: "transparent",
                })
              : chart.addSeries(charts.LineSeries, lineOptions(row.color));
            handles.set(row.symbol, series);
            series.setData(row.series.points);
            drawn.push(series);
          }
          if (showVolume && seriesRows.some((row) => row.volume.length)) {
            const volume = chart.addSeries(charts.HistogramSeries, {
              priceScaleId: "volume",
              color: "#292c30",
              lastValueVisible: false,
              priceLineVisible: false,
              priceLineColor: "#121315",
              priceFormat: { type: "volume" },
            });
            chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
            chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.23 } });
            volume.setData(seriesRows.find((row) => row.symbol === focusRef.current)?.volume ?? []);
            volumes.current = volume;
          }
          if (showVolume)
            drawn[0]?.attachPrimitive?.(
              pulseMarks(chart, seriesRows, handles, () => focusRef.current, volumes.current),
            );
          chart.timeScale().fitContent();
          chart.subscribeCrosshairMove((param) => {
            const time = param.time;
            const date =
              typeof time === "string"
                ? time
                : time && typeof time === "object"
                  ? [time.year, String(time.month).padStart(2, "0"), String(time.day).padStart(2, "0")].join(
                      "-",
                    )
                  : typeof time === "number"
                    ? new Date(time * 1000).toISOString().slice(0, 10)
                    : "";
            const point = param.point;
            if (!date || !point || point.x < 0 || point.y < 0) {
              paintPointer.current(null);
              return;
            }
            const width = node.clientWidth || 320;
            paintPointer.current({
              date,
              x: Math.min(Math.max(8, point.x + 12), Math.max(8, width - 188)),
              y: Math.min(Math.max(8, point.y - 28), Math.max(8, node.clientHeight - 135)),
            });
          });
          if (drawn.length === 0) setFailureKey(plotKey);
        } catch {
          if (!cancelled) setFailureKey(plotKey);
        }
      })
      .catch(() => {
        if (!cancelled) setFailureKey(plotKey);
      });

    return () => {
      cancelled = true;
      handles.clear();
      volumes.current = null;
      chartApi.current = null;
      for (const chart of active) chart.remove();
    };
  }, [plotKey, showVolume]);

  const ready = rows.filter((row) => row.series);
  const missing = rows.filter((row) => row.state === "unavailable");
  const openGaps = ready.filter((row) => row.series?.hasGap);
  const spanned = ready.filter((row) => !row.series?.hasGap && coverageHasGaps(row.coverage));
  const latest = ready
    .map((row) => row.series?.asOf)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  function paintLinkedDate(date: string | null) {
    const line = linkedRule.current;
    if (!line) return;
    const x =
      date && !displayed.current && readings[date]
        ? chartApi.current?.timeScale().timeToCoordinate(date)
        : null;
    if (line.firstElementChild) line.firstElementChild.textContent = date ?? "";
    line.hidden = x == null;
    if (x != null) line.style.transform = `translateX(${x}px)`;
  }
  useSessionPaint(paintLinkedDate);
  useLayoutEffect(() => {
    if (linkedDate !== undefined) paintLinkedDate(linkedDate);
  });
  function clearPointer() {
    keyboard.current = -1;
    paintPointer.current(null);
  }
  function onChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!dates.length || !["ArrowLeft", "ArrowRight", "End", "Escape", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      clearPointer();
      return;
    }
    let i = keyboard.current;
    if (event.key === "Home") i = 0;
    if (event.key === "End") i = dates.length - 1;
    if (event.key === "ArrowRight") i = Math.min(dates.length - 1, i + 1);
    if (event.key === "ArrowLeft") i = i < 0 ? dates.length - 1 : Math.max(0, i - 1);
    keyboard.current = i;
    paintPointer.current(null);
  }

  const loading = rows.some((row) => row.state === "loading");
  return (
    <div className="history-view">
      <div className="plot-heading">
        <span>Index comparison</span>
        <span>Range return, %</span>
      </div>
      <ul className="history-legend" aria-label="End-of-day percent change for the index proxies">
        {rows.map((row) => {
          const legend = (
            <>
              <i aria-hidden="true" style={{ backgroundColor: row.color }} />
              <b>{row.symbol}</b>
              <span>
                {row.series ? (
                  <Figure value={formatSignedPercent(row.series.changePercent)} />
                ) : (
                  "Unavailable"
                )}
              </span>
            </>
          );
          return (
            <li key={row.symbol} aria-label={`${row.symbol} ${row.name}`}>
              {onSelect ? (
                <button
                  type="button"
                  aria-label={`Inspect ${row.symbol}, ${row.name}`}
                  aria-pressed={selected === row.symbol}
                  disabled={!quotes.some((q) => q.symbol === row.symbol)}
                  {...inspectEvents(
                    () => onPreview?.(row.symbol),
                    () => onPreview?.(null),
                  )}
                  onClick={() => onSelect(row.symbol)}
                >
                  {legend}
                </button>
              ) : (
                <div>{legend}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="relative min-w-0" key={plotKey}>
        <div
          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
          aria-label="Index proxy percent change chart"
          className="history-canvas"
          hidden={!ready.length}
          onBlur={clearPointer}
          onKeyDown={onChartKeyDown}
          ref={chartNode}
          role="application"
          tabIndex={0}
        />
        <div ref={linkedRule} className="linked-session-rule" hidden aria-hidden="true">
          <span>{linkedDate}</span>
        </div>
        {!ready.length &&
          (loading ? (
            <Skeleton className="history-placeholder" label="Loading end-of-day history" />
          ) : (
            <div className="history-placeholder">
              <EmptyState
                message="No stored closes in this range"
                detail="Choose 1D to compare the latest cached ETF moves."
              />
            </div>
          ))}
        <div ref={tooltip} className="desk-tooltip comparison-tooltip" hidden style={{ top: 0, left: 0 }}>
          <div className="text-slate-200" />
          <ul>
            {rows.map((row) => (
              <li
                data-symbol={row.symbol}
                className="mt-1 flex items-center justify-between gap-3"
                key={row.symbol}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="text-slate-100">{showVolume ? row.symbol : row.name}</span>
                </span>
                <span />
              </li>
            ))}
          </ul>
          <p className="tooltip-volume" hidden />
        </div>
      </div>
      {ready.length > 0 && <p ref={spoken} aria-live="polite" className="sr-only" />}
      {refreshFailed && <p className="chart-caption">Showing cached history. The latest refresh failed.</p>}
      <div className="history-coverage">
        {showVolume && rows.some((row) => row.symbol === selected && row.volume.length) && (
          <span className="volume-source">
            <i />
            {selected} daily share volume · {provider}
          </span>
        )}
        {showVolume && ready.length > 0 && (
          <a
            className="pulse-attribution"
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
          >
            Chart by TradingView
          </a>
        )}
        <details className="history-method">
          <summary>Series &amp; coverage</summary>
          <div>
            <p>
              {latest
                ? `End-of-day as of ${latest}. Percent change from the first stored close in the range.`
                : "End-of-day percent change from stored closes."}{" "}
              Levels are ETF closes, not index prints.
            </p>
            <p>
              Vertical axis: percent change. Horizontal axis: session date. Source: {provider}, split-adjusted
              daily closes.
            </p>
            <ul aria-label="Proxy quote details">
              {rows.map((row) => {
                const quote = quotes.find((q) => q.symbol === row.symbol);
                return (
                  <li key={row.symbol}>
                    <b>
                      {row.symbol} · {row.name}
                    </b>
                    {row.series ? (
                      <span>
                        Range change {formatSignedPercent(row.series.changePercent)} · ETF close{" "}
                        {formatCurrency(row.series.lastClose)}
                      </span>
                    ) : (
                      <span>Range unavailable</span>
                    )}
                    {quote && (
                      <span>
                        Provider change {formatSignedPercent(quote.changePercent)} ·{" "}
                        {formatCurrency(quote.value)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {rangeControl ? <div className="flex max-w-full justify-center">{rangeControl}</div> : null}
            {chartFailed ? (
              <p className="text-xs text-amber-200" role="status">
                The comparison chart could not be drawn. The percent changes above still use the stored
                closes.
              </p>
            ) : null}
            {missing.length > 0 ? (
              <p className="text-xs text-slate-400">
                End-of-day history unavailable for {missing.map((row) => row.symbol).join(", ")}.
              </p>
            ) : null}
            {openGaps.length > 0 ? (
              <p className="text-xs text-slate-400">
                Missing sessions stay open for {openGaps.map((row) => row.symbol).join(", ")}. The line does
                not connect across that break.
              </p>
            ) : null}
            {spanned.length > 0 ? (
              <p className="text-xs text-slate-400">
                Sessions are missing for {spanned.map((row) => row.symbol).join(", ")}. The line spans those
                sessions.
              </p>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}
