import { proxyHistoryQuery } from "./indexComparisonData";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { type HistoryCoverageStatus, type HistoryResponse } from "../api/history";
import { HISTORY_ADJUSTMENT, HISTORY_PROVIDER, historySourceLabel } from "./market/historySource";
import { formatCurrency, formatSignedPercent } from "../utils/format";
import { prefersReducedMotion, setFocus, useInView } from "../ui/lib";
import { onSession, pointAtSession } from "../pages/market/sessionCursor";
import { morphPlot, readPlot, type Morph } from "./pulseMorph";
import { RollingNumber } from "../ui/motion";
import { EmptyNote, Skeleton } from "../ui/primitives";
import {
  INDEX_PROXIES,
  type NormalizedPoint,
  type NormalizedSeries,
  type PulseChartRange,
  normalizeCloses,
} from "./indexComparisonData";

/* Lines are told apart by lightness and dash; the one accent marks the highlighted series. */
const SIGNAL = "#ffb224";
const TONES = ["#f1f3f0", "#c4c9c6", "#959b98", "#6c7270", "#565b5a", "#454a49"];
const DASHES = [0, 0, 2, 1, 3, 4] as const;
const CHART_HEIGHT = 252;


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
  dash: (typeof DASHES)[number];
  state: "loading" | "unavailable" | "ready";
  coverage: HistoryCoverageStatus | null;
  series: NormalizedSeries | null;
};

type HoverPoint = {
  symbol: string;
  name: string;
  color: string;
  value: number;
};

type ChartHandle = {
  api: IChartApi;
  series: Map<string, ISeriesApi<"Line">>;
  rows: PlotRow[];
  morph: Morph | null;
  disposeEndpoints?: () => void;
  disposeCursor?: () => void;
};

function coverageHasGaps(status: HistoryCoverageStatus | null) {
  return status === "gaps" || status === "gaps_and_unexpected_sessions";
}

const normalizedHistory = new WeakMap<HistoryResponse, NormalizedSeries | null>();

function plotFromResponse(response: HistoryResponse | undefined, failed: boolean): Pick<PlotRow, "state" | "coverage" | "series"> {
  if (failed || !response || response.status === "unavailable") {
    return { state: "unavailable", coverage: response?.coverage_status ?? null, series: null };
  }
  if (!normalizedHistory.has(response)) normalizedHistory.set(response, normalizeCloses(response.bars));
  const series = normalizedHistory.get(response);
  if (!series) {
    return { state: "unavailable", coverage: response.coverage_status, series: null };
  }
  return { state: "ready", coverage: response.coverage_status, series };
}

function pointValue(point: NormalizedPoint) {
  return "value" in point && typeof point.value === "number" ? point.value : null;
}

function valuesOn(rows: readonly PlotRow[], date: string, selected: string | null) {
  const found: HoverPoint[] = [];
  for (const row of rows) {
    if (!row.series) continue;
    for (const point of row.series.points) {
      if (point.time !== date) continue;
      const value = pointValue(point);
      if (value == null) continue;
      found.push({ symbol: row.symbol, name: row.name, color: row.symbol === selected ? SIGNAL : row.color, value });
    }
  }
  return found;
}

function sessionDates(rows: readonly PlotRow[]) {
  const dates = new Set<string>();
  for (const row of rows) {
    for (const point of row.series?.points ?? []) {
      if (typeof point.time === "string" && pointValue(point) != null) {
        dates.add(point.time);
      }
    }
  }
  return [...dates].sort();
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

function chartOptions(charts: typeof import("lightweight-charts")) {
  return {
    autoSize: true,
    height: CHART_HEIGHT,
    handleScale: false,
    handleScroll: false,
    layout: {
      attributionLogo: false,
      background: { type: charts.ColorType?.Solid ?? "solid", color: "#0c0d0d" },
      fontFamily: "'Martian Mono Variable', ui-monospace, monospace",
      fontSize: 10,
      textColor: "#7e8482",
    },
    grid: {
      horzLines: { color: "rgba(255, 255, 255, 0.06)", style: 1 },
      vertLines: { color: "rgba(255, 255, 255, 0.035)", style: 1 },
    },
    localization: { priceFormatter: signedAxis },
    rightPriceScale: {
      borderColor: "#3a3f3f",
      minimumWidth: 68,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: { borderColor: "#3a3f3f" },
    ...crosshairOption(charts),
  };
}

function crosshairOption(charts: object) {
  const line = { color: "rgba(241, 243, 240, 0.55)", labelBackgroundColor: "#f1f3f0", style: 3, width: 1 as const };
  try {
    const mode = (charts as { CrosshairMode?: { Magnet?: number } }).CrosshairMode?.Magnet;
    return mode == null ? {} : { crosshair: { mode, horzLine: line, vertLine: line } };
  } catch {
    return {};
  }
}

function lineOptions(row: Pick<PlotRow, "symbol" | "color" | "dash">, selected: string | null) {
  const active = row.symbol === selected;
  return {
    color: active ? SIGNAL : row.color,
    crosshairMarkerBackgroundColor: active ? SIGNAL : row.color,
    crosshairMarkerBorderColor: "#0c0d0d",
    crosshairMarkerRadius: active ? 4 : 3,
    lastValueVisible: active,
    lineStyle: active ? 0 : row.dash,
    lineWidth: (active ? 3 : 2) as 2 | 3,
    priceLineVisible: false,
  };
}

/** End tags use the library's actual axes, including during a range glide. */
function trackEndpoints(handle: ChartHandle, container: HTMLElement, rows: () => PlotRow[]) {
  let raf = 0;
  const scale = handle.api.timeScale();
  const place = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const ends = [];
      for (const node of container.querySelectorAll<HTMLElement>("[data-end]")) {
        const row = rows().find((item) => item.symbol === node.dataset.end);
        const series = row?.series;
        const x = series && scale.timeToCoordinate?.(series.asOf);
        const y = series && handle.series.get(row.symbol)?.priceToCoordinate?.(series.changePercent);
        node.hidden = x == null || y == null;
        if (x != null && y != null) ends.push({ node, x, y });
      }
      ends.sort((a,b) => a.y - b.y);
      let last = -16;
      for (const {node,x,y} of ends) {
        const top = Math.max(last + 16, y - 7);
        node.style.transform = `translate(${Math.round(x - 37)}px,${Math.round(top)}px)`;
        node.style.setProperty("--offset", `${y - top - 7}px`);
        last = top;
      }
    });
  };
  const visibility = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => {
    container.dataset.live = String(entry.isIntersecting);
    if (!entry.isIntersecting) handle.morph?.stop();
  }) : null;
  visibility?.observe(container);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
  resize?.observe(container);
  scale.subscribeVisibleLogicalRangeChange?.(place);
  place();
  return () => {
    visibility?.disconnect();
    resize?.disconnect();
    scale.unsubscribeVisibleLogicalRangeChange?.(place);
    cancelAnimationFrame(raf);
  };
}

function historyQueries(symbols: readonly Proxy[], provider: string, adjustment: string, range: PulseChartRange) {
  return symbols.map(proxy => proxyHistoryQuery(proxy.symbol, provider, adjustment, range));
}

export function DialPulseChart({
  adjustment = HISTORY_ADJUSTMENT,
  provider = HISTORY_PROVIDER,
  quotes = [],
  range,
  rangeControl = null,
  onSelect,
  selectedSymbol,
  compact = false,
  symbols = INDEX_PROXIES,
}: {
  adjustment?: string;
  provider?: string;
  quotes?: readonly Quote[];
  range: PulseChartRange;
  rangeControl?: ReactNode;
  selectedSymbol?: string;
  compact?: boolean;
  onSelect?: (symbol: string) => void;
  symbols?: readonly Proxy[];
}) {
  /*
   * A range change keeps the range that is on screen until every series of the new
   * range has answered, so the four lines and their figures change together.
   */
  const target = useQueries({ queries: historyQueries(symbols, provider, adjustment, range) });
  const targetSettled = target.every((result) => !result.isPending);
  const [shownRange, setShownRange] = useState(range);
  if (targetSettled && shownRange !== range) {
    setShownRange(range);
  }
  const held = useQueries({ queries: historyQueries(symbols, provider, adjustment, shownRange) });
  const results = targetSettled ? target : held;

  const rows: PlotRow[] = symbols.map((proxy, index) => {
    const result = results[index];
    const response = result?.data;
    const mismatched = response != null && (response.symbol !== proxy.symbol || response.provider !== provider || response.adjustment_type !== adjustment);
    return {
      symbol: proxy.symbol,
      name: proxy.name,
      color: TONES[index % TONES.length],
      dash: DASHES[index % DASHES.length],
      ...plotFromResponse(mismatched ? undefined : response, (result?.isError ?? false) || mismatched),
      ...(result?.isPending ? { state: "loading" as const, series: null } : {}),
    };
  });
  const plotKey = rows.map((row, i) => (
    `${shownRange}:${results[i]?.dataUpdatedAt}:${row.symbol}:${row.state}:${row.series?.changePercent ?? ""}:${row.series?.sessionCount ?? 0}:${row.series?.asOf ?? ""}:${row.series?.hasGap ? "gap" : "solid"}`
  )).join("|");
  const rowsRef = useRef(rows);
  const [chartNode, chartSeen] = useInView<HTMLDivElement>(compact ? "2800px 0px" : "0px");
  const morphNode = useRef<HTMLCanvasElement | null>(null);
  const endsNode = useRef<HTMLDivElement | null>(null);
  const wipeNode = useRef<HTMLDivElement | null>(null);
  const readoutNode = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ChartHandle | null>(null);
  const [pinned, setPinned] = useState<string | null>(symbols[0]?.symbol ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const selected = preview ?? selectedSymbol ?? pinned;
  const selectedRef = useRef(selected);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState<{ key: string; index: number; date: string } | null>(null);
  const [pointerDate, setPointerDate] = useState<string | null>(null);
  const chartFailed = failureKey === plotKey;
  const keyboardIndex = keyboard?.key === plotKey ? keyboard.index : null;

  useEffect(() => {
    rowsRef.current = rows;
    selectedRef.current = selected;
  });

  useEffect(() => () => {
    const handle = handleRef.current;
    if (handle) {
      handle.morph?.stop();
      handle.disposeEndpoints?.();
      handle.disposeCursor?.();
      pointAtSession(null, "pulse");
      handle.api.remove();
      handleRef.current = null;
    }
  }, []);

  const placeReadout = useCallback((x: number, y = 10) => {
    const box = readoutNode.current;
    const width = chartNode.current?.clientWidth || 320;
    if (!box) return;
    const left = x + 16 + 172 > width - 72 ? x - 16 - 172 : x + 16;
    const top = Math.min(Math.max(8, y - 20), Math.max(8, (chartNode.current?.clientHeight ?? 252) - 132));
    box.style.transform = `translate3d(${Math.round(Math.max(8, left))}px, ${Math.round(top)}px, 0)`;
  }, [chartNode]);

  /* One chart for the life of the block: data changes move it, they never rebuild it. */
  useEffect(() => {
    let cancelled = false;
    const node = chartNode.current;
    if (!node || !chartSeen) return undefined;
    const current = rowsRef.current;
    if (current.some((row) => row.state === "loading")) return undefined;
    const existing = handleRef.current;
    if (!current.some((row) => row.series)) {
      if (existing) {
        existing.morph?.stop();
        for (const line of existing.series.values()) existing.api.removeSeries(line);
        existing.series.clear();
        existing.rows = [];
        for (const tag of endsNode.current?.children ?? []) (tag as HTMLElement).hidden = true;
      }
      return undefined;
    }

    void import("lightweight-charts").then((charts) => {
      if (cancelled) return;
      const seriesRows = rowsRef.current.filter((row) => row.series);
      if (seriesRows.length === 0) return;
      try {
        let handle = handleRef.current;
        const first = handle == null;
        if (!handle) {
          const api = charts.createChart(node, chartOptions(charts));
          handle = { api, series: new Map(), rows: [], morph: null };
          handleRef.current = handle;
          let placing = false;
          handle.disposeCursor = onSession(({ date, source }) => {
            if (source === "pulse") return;
            const row = rowsRef.current.find(item => item.symbol === selectedRef.current);
            const point = row?.series?.points.find(item => item.time === date);
            const value = point && pointValue(point);
            const line = row && handleRef.current?.series.get(row.symbol);
            placing = true;
            try {
              if (date && line && value != null) {
                api.setCrosshairPosition(value, date, line);
                placeReadout(api.timeScale().timeToCoordinate(date) ?? 0);
                setPointerDate(date);
              } else {
                api.clearCrosshairPosition();
                setPointerDate(null);
              }
            } finally { placing = false; }
          });
          api.subscribeCrosshairMove((param) => {
            if (placing) return;
            const date = typeof param.time === "string" ? param.time : "";
            const point = param.point;
            if (!date || !point || point.x < 0 || point.y < 0) {
              setPointerDate(null);
              pointAtSession(null, "pulse");
              return;
            }
            pointAtSession(date, "pulse");
            placeReadout(point.x, point.y);
            setPointerDate(date);
          });
        }
        const chart = handle;
        const old = chart.morph?.stop() ?? (!first && !prefersReducedMotion()
          ? readPlot(chart.api, chart.series, chart.rows, selectedRef.current) : null);

        const apply = () => {
          const live = new Set<string>();
          for (const row of seriesRows) {
            if (!row.series) continue;
            live.add(row.symbol);
            let line = chart.series.get(row.symbol);
            if (!line) {
              line = chart.api.addSeries(charts.LineSeries, lineOptions(row, selectedRef.current));
              chart.series.set(row.symbol, line);
            }
            // The library converts string dates in place. Keep the readout and keyboard dates intact.
            line.setData(row.series.points.map(point => ({ ...point })));
          }
          for (const [symbol, line] of chart.series) {
            if (!live.has(symbol)) {
              chart.api.removeSeries(line);
              chart.series.delete(symbol);
            }
          }
        };

        chart.rows = seriesRows;
        apply();
        chart.api.timeScale().fitContent();
        if (old && morphNode.current && !prefersReducedMotion()) {
          chart.morph = morphPlot(morphNode.current, old,
            () => readPlot(chart.api, chart.series, seriesRows, selectedRef.current),
            () => { chart.morph = null; });
        }

        chart.disposeEndpoints?.();
        if (endsNode.current) chart.disposeEndpoints = trackEndpoints(chart, endsNode.current, () => rowsRef.current);
        if (first) {
          const wipe = wipeNode.current;
          if (wipe) {
            void wipe.getBoundingClientRect();
            wipe.setAttribute("data-on", "true");
          }
        }
        if (chart.series.size === 0) setFailureKey(plotKey);
      } catch {
        if (!cancelled) setFailureKey(plotKey);
      }
    }).catch(() => {
      if (!cancelled) setFailureKey(plotKey);
    });

    return () => {
      cancelled = true;
    };
  }, [plotKey, chartNode, chartSeen, placeReadout]);

  /* Highlighting a series re-inks the lines in place. */
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    for (const row of rowsRef.current) {
      handle.series.get(row.symbol)?.applyOptions(lineOptions(row, selected));
    }
  }, [selected]);

  const ready = rows.filter((row) => row.series);
  const loading = rows.some((row) => row.state === "loading");
  const missing = rows.filter((row) => row.state === "unavailable");
  const openGaps = ready.filter((row) => row.series?.hasGap);
  const spanned = ready.filter((row) => !row.series?.hasGap && coverageHasGaps(row.coverage));
  const latest = ready.map((row) => row.series?.asOf).filter((value): value is string => Boolean(value)).sort().at(-1);
  const activeDate = pointerDate ?? (keyboardIndex != null ? keyboard?.date : null);
  const hoverRows = activeDate ? valuesOn(rows, activeDate, selected) : [];
  const reading = activeDate && hoverRows.length > 0
    ? `${formatSessionDate(activeDate)}: ${hoverRows.map((row) => `${row.symbol} ${formatSignedPercent(row.value)}`).join(", ")}`
    : "Arrow keys or hover read each session.";

  function moveCrosshair(date: string | undefined) {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      if (!date) {
        handle.api.clearCrosshairPosition();
        return;
      }
      for (const row of rows) {
        const line = handle.series.get(row.symbol);
        const point = row.series?.points.find((item) => item.time === date);
        const value = point ? pointValue(point) : null;
        if (line && value != null) {
          handle.api.setCrosshairPosition(value, date, line);
          placeReadout(handle.api.timeScale().timeToCoordinate(date) ?? 0);
          return;
        }
      }
    } catch {
      /* The read-out below still follows the keyboard when the chart cannot place a crosshair. */
    }
  }

  function previewProxy(symbol: string | null) {
    setPreview(symbol);
    setFocus(symbol ? { symbol } : null);
  }

  function onChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const dates = sessionDates(rows);
    if (dates.length === 0) return;
    if (!["ArrowLeft", "ArrowRight", "End", "Escape", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setKeyboard(null);
      setPointerDate(null);
      pointAtSession(null, "pulse");
      moveCrosshair(undefined);
      return;
    }
    const index = keyboardIndex ?? -1;
    let next = index;
    if (event.key === "Home" || (event.key === "ArrowRight" && index < 0)) next = 0;
    else if (event.key === "End") next = dates.length - 1;
    else if (event.key === "ArrowRight") next = Math.min(dates.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = index < 0 ? dates.length - 1 : Math.max(0, index - 1);
    setPointerDate(null);
    setKeyboard({ key: plotKey, index: next, date: dates[next] });
    pointAtSession(dates[next], "pulse");
    moveCrosshair(dates[next]);
  }

  return (
    <div className="pulse-in">
      <ul
        aria-label="End-of-day percent change for the index proxies"
        className="idx-bank grid grid-cols-2 md:grid-cols-4"
      >
        {rows.map((row) => {
          const quote = quotes.find((item) => item.symbol === row.symbol);
          const isSelected = row.symbol === selected;
          return (
            <li
              aria-label={`${row.symbol} ${row.name}`}
              className="idx min-w-0"
              data-selected={isSelected ? "true" : "false"}
              key={row.symbol}
              onPointerEnter={e => { if (e.pointerType === "mouse") previewProxy(row.symbol); }}
              onPointerLeave={() => previewProxy(null)}
              onFocus={() => previewProxy(row.symbol)}
              onBlur={() => previewProxy(null)}
              onClick={() => { setPinned(row.symbol); onSelect?.(row.symbol); }}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <button
                  aria-label={`Highlight ${row.symbol} on the chart`}
                  aria-pressed={row.symbol === (selectedSymbol ?? pinned)}
                  className="idx-key"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="idx-swatch"
                    data-dash={isSelected ? 0 : row.dash}
                    style={{ backgroundColor: isSelected ? SIGNAL : row.color }}
                  />
                  <span className="num text-[11px] font-semibold text-fg">{row.symbol}</span>
                </button>
                <span className="idx-name">{row.name}</span>
              </div>
              <div className="idx-day">
                <span className="lbl">Day</span>
                <span className="fig">{quote ? formatSignedPercent(quote.changePercent) : "—"}</span>
              </div>
              <div className="idx-level num">{quote ? formatCurrency(quote.value) : "Quote unavailable"}</div>
              <div className="idx-period">
                <span className="lbl">{shownRange.toUpperCase()} return</span>
                {row.series ? <RollingNumber className="num" value={formatSignedPercent(row.series.changePercent)} />
                  : <span>{row.state === "loading" ? "Loading" : "Unavailable"}</span>}
              </div>
              {row.series && (!quote || formatCurrency(row.series.lastClose) !== formatCurrency(quote.value)) ? (
                <span className="note">Range close {formatCurrency(row.series.lastClose)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div><p className="plot-title">Cumulative return</p>
          <p className="note">{activeDate ? formatSessionDate(activeDate) : "Change from first stored close"}</p></div>
        <p aria-live="polite" className="sr-only">{reading}</p>
        {rangeControl ? <div className="flex max-w-full">{rangeControl}</div> : null}
      </div>

      <div className="chart-box" data-empty={!loading && ready.length === 0 ? "true" : undefined}>
        <div className="chart-wipe" ref={wipeNode} onPointerDown={() => handleRef.current?.morph?.stop()}>
          <div
            aria-keyshortcuts="ArrowLeft ArrowRight Home End"
            aria-label="Index proxy percent change chart"
            className="h-full w-full rounded-r1"
            onKeyDown={onChartKeyDown}
            ref={chartNode}
            role="application"
            tabIndex={0}
          />
          <canvas aria-hidden="true" className="morph-ink" hidden ref={morphNode} />
          <div aria-hidden="true" className="plot-ends" ref={endsNode}>
            {rows.map(row => <span className="plot-end" data-end={row.symbol} data-active={row.symbol === selected}
              style={{color: row.symbol === selected ? SIGNAL : row.color}} key={row.symbol} hidden>{row.symbol}<i /></span>)}
          </div>
        </div>
        {loading ? <Skeleton className="pointer-events-none absolute inset-0 opacity-40" /> : null}
        {!loading && ready.length === 0 ? (
          <EmptyNote className="absolute inset-0 items-center" detail="The chart draws when the history cache has closes for this range." message="No stored closes to draw" />
        ) : null}
        <div aria-hidden="true" className="chart-readout" data-show={activeDate && hoverRows.length > 0 ? "true" : "false"} ref={readoutNode}>
          <span className="pill pill-solid">{activeDate ? formatSessionDate(activeDate) : ""}</span>
          <ul className="mt-2 grid gap-1">
            {hoverRows.map((row) => (
              <li className="flex items-center justify-between gap-3" key={row.symbol}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="idx-swatch" style={{ backgroundColor: row.color }} />
                  <span className="lbl text-fg-2">{row.symbol}</span>
                </span>
                <span className="num text-[12px] font-semibold text-fg">{formatSignedPercent(row.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="plot-notes">
        <p className="note"><b>Basis</b> ETF closes · % by session date</p>
        <p className="note"><b>Source</b> {historySourceLabel(provider, adjustment)}</p>
        {latest && <p className="note"><b>History</b> End-of-day as of {latest}</p>}
        {chartFailed ? (
          <p className="note text-fg-2" role="status">The comparison chart could not be drawn. The percent changes above still use the stored closes.</p>
        ) : null}
        {loading ? <p className="note">Loading end-of-day history.</p> : null}
        {missing.length > 0 ? (
          <p className="note">End-of-day history unavailable for {missing.map((row) => row.symbol).join(", ")}.</p>
        ) : null}
        {openGaps.length > 0 ? (
          <p className="note">Missing sessions stay open for {openGaps.map((row) => row.symbol).join(", ")}. The line does not connect across that break.</p>
        ) : null}
        {spanned.length > 0 ? (
          <p className="note">Sessions are missing for {spanned.map((row) => row.symbol).join(", ")}. The line spans those sessions.</p>
        ) : null}
      </div>
    </div>
  );
}
