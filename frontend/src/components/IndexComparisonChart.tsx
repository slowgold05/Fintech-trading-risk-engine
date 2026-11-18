import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import { fetchDailyHistory, type HistoryCoverageStatus, type HistoryResponse } from "../api/history";
import { formatCurrency, formatSignedPercent } from "../utils/format";
import {
  INDEX_PROXIES,
  type NormalizedPoint,
  type NormalizedSeries,
  type PulseChartRange,
  normalizeCloses,
} from "./indexComparisonData";

const COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#c084fc", "#fb7185", "#a5b4fc"];
const HISTORY_PROVIDER = "massive";
const HISTORY_ADJUSTMENT = "split_adjusted";
const CHART_HEIGHT = 224;

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

function plotFromResponse(response: HistoryResponse | undefined, failed: boolean): Pick<PlotRow, "state" | "coverage" | "series"> {
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

function valuesOn(rows: readonly PlotRow[], date: string) {
  const found: HoverPoint[] = [];
  for (const row of rows) {
    if (!row.series) continue;
    for (const point of row.series.points) {
      if (point.time !== date) continue;
      const value = pointValue(point);
      if (value == null) continue;
      found.push({ symbol: row.symbol, name: row.name, color: row.color, value });
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

function percentClass(value: number) {
  return [
    "font-mono text-lg font-semibold leading-6",
    value > 0 ? "text-emerald-300" : value < 0 ? "text-rose-300" : "text-slate-200",
  ].join(" ");
}

function chartOptions(charts: typeof import("lightweight-charts")) {
  return {
    autoSize: true,
    height: CHART_HEIGHT,
    layout: {
      attributionLogo: true,
      background: { type: charts.ColorType?.Solid ?? "solid", color: "#020617" },
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      textColor: "#cbd5e1",
    },
    grid: {
      horzLines: { color: "#1e293b" },
      vertLines: { color: "#1e293b" },
    },
    localization: { priceFormatter: signedAxis },
    rightPriceScale: {
      borderColor: "#334155",
      minimumWidth: 72,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: { borderColor: "#334155" },
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
  };
}

export function IndexComparisonChart({
  adjustment = HISTORY_ADJUSTMENT,
  provider = HISTORY_PROVIDER,
  quotes = [],
  range,
  rangeControl = null,
  symbols = INDEX_PROXIES,
}: {
  adjustment?: string;
  provider?: string;
  quotes?: readonly Quote[];
  range: PulseChartRange;
  rangeControl?: ReactNode;
  symbols?: readonly Proxy[];
}) {
  const results = useQueries({
    queries: symbols.map((proxy) => ({
      queryKey: ["market", "history", proxy.symbol, provider, adjustment, range],
      queryFn: () => fetchDailyHistory(proxy.symbol, provider, adjustment, range),
      retry: false,
      staleTime: 300000,
    })),
  });
  const rows: PlotRow[] = symbols.map((proxy, index) => {
    const result = results[index];
    const response = result?.data;
    const mismatched = response != null && response.symbol !== proxy.symbol;
    return {
      symbol: proxy.symbol,
      name: proxy.name,
      color: COLORS[index % COLORS.length],
      ...plotFromResponse(mismatched ? undefined : response, (result?.isError ?? false) || mismatched),
      ...(result?.isPending ? { state: "loading" as const, series: null } : {}),
    };
  });
  const plotKey = rows.map((row) => (
    `${row.symbol}:${row.state}:${row.series?.sessionCount ?? 0}:${row.series?.asOf ?? ""}:${row.series?.hasGap ? "gap" : "solid"}`
  )).join("|");
  const dates = sessionDates(rows);
  const rowsRef = useRef(rows);
  const chartNode = useRef<HTMLDivElement | null>(null);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState<{ key: string; index: number } | null>(null);
  const [pointer, setPointer] = useState<(PointerHover & { key: string }) | null>(null);
  const chartFailed = failureKey === plotKey;
  const keyboardIndex = keyboard?.key === plotKey ? keyboard.index : null;
  const activePointer = pointer?.key === plotKey ? pointer : null;

  useEffect(() => {
    rowsRef.current = rows;
  });

  useEffect(() => {
    let cancelled = false;
    const active: IChartApi[] = [];
    const node = chartNode.current;
    if (!node) return undefined;

    void import("lightweight-charts").then((charts) => {
      if (cancelled) return;
      const seriesRows = rowsRef.current.filter((row) => row.series);
      if (seriesRows.length === 0) return;
      const drawn: ISeriesApi<SeriesType>[] = [];
      try {
        const chart = charts.createChart(node, chartOptions(charts));
        active.push(chart);
        for (const row of seriesRows) {
          if (!row.series) continue;
          const series = chart.addSeries(charts.LineSeries, lineOptions(row.color));
          series.setData(row.series.points);
          drawn.push(series);
        }
        chart.timeScale().fitContent();
        chart.subscribeCrosshairMove((param) => {
          const date = typeof param.time === "string" ? param.time : "";
          const point = param.point;
          if (!date || !point || point.x < 0 || point.y < 0) {
            setPointer(null);
            return;
          }
          const width = node.clientWidth || 320;
          setPointer({
            date,
            key: plotKey,
            x: Math.min(Math.max(8, point.x + 12), Math.max(8, width - 188)),
            y: Math.max(8, point.y - 28),
          });
        });
        if (drawn.length === 0) setFailureKey(plotKey);
      } catch {
        if (!cancelled) setFailureKey(plotKey);
      }
    }).catch(() => {
      if (!cancelled) setFailureKey(plotKey);
    });

    return () => {
      cancelled = true;
      for (const chart of active) chart.remove();
    };
  }, [plotKey]);

  const ready = rows.filter((row) => row.series);
  const missing = rows.filter((row) => row.state === "unavailable");
  const openGaps = ready.filter((row) => row.series?.hasGap);
  const spanned = ready.filter((row) => !row.series?.hasGap && coverageHasGaps(row.coverage));
  const latest = ready.map((row) => row.series?.asOf).filter((value): value is string => Boolean(value)).sort().at(-1);
  const activeDate = activePointer?.date ?? (keyboardIndex != null ? dates[keyboardIndex] : null);
  const hoverRows = activeDate ? valuesOn(rows, activeDate) : [];
  const reading = activeDate && hoverRows.length > 0
    ? `${formatSessionDate(activeDate)}: ${hoverRows.map((row) => `${row.symbol} ${formatSignedPercent(row.value)}`).join(", ")}`
    : "Arrow keys or hover read each session.";

  function onChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (dates.length === 0) return;
    if (!["ArrowLeft", "ArrowRight", "End", "Escape", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setKeyboard(null);
      setPointer(null);
      return;
    }
    setPointer(null);
    setKeyboard((current) => {
      const index = current?.key === plotKey ? current.index : -1;
      let next = index;
      if (event.key === "Home" || (event.key === "ArrowRight" && index < 0)) next = 0;
      else if (event.key === "End") next = dates.length - 1;
      else if (event.key === "ArrowRight") next = Math.min(dates.length - 1, index + 1);
      else if (event.key === "ArrowLeft") next = index < 0 ? dates.length - 1 : Math.max(0, index - 1);
      return { key: plotKey, index: next };
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        {latest
          ? `End-of-day as of ${latest}. Percent change from the first stored close in the range. Levels are ETF closes, not index prints.`
          : "End-of-day percent change from stored closes. Levels are ETF closes, not index prints."}
      </p>
      <ul
        aria-label="End-of-day percent change for the index proxies"
        className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4"
      >
        {rows.map((row) => {
          const quote = quotes.find((item) => item.symbol === row.symbol);
          return (
            <li aria-label={`${row.symbol} ${row.name}`} className="relative min-w-0 py-1 pl-3" key={row.symbol}>
              <span
                aria-hidden="true"
                className="absolute bottom-1 left-0 top-1 w-1 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <div className="text-xs font-semibold leading-4 text-slate-100">{row.name}</div>
              <div className="font-mono text-[10px] text-slate-500">{row.symbol}</div>
              {row.state === "loading" ? (
                <div className="text-xs text-slate-400">Loading</div>
              ) : row.series ? (
                <>
                  <div className={percentClass(row.series.changePercent)}>
                    <span className="sr-only">Range change </span>
                    {formatSignedPercent(row.series.changePercent)}
                  </div>
                  <div className="font-mono text-sm text-slate-200">
                    <span className="sr-only">ETF close </span>
                    {formatCurrency(row.series.lastClose)}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-400">Unavailable</div>
              )}
              {quote ? (
                <>
                  <div className="text-[10px] leading-4 text-slate-400">
                    Provider change {formatSignedPercent(quote.changePercent)}
                  </div>
                  <div className="font-mono text-[10px] text-slate-300">{formatCurrency(quote.value)}</div>
                </>
              ) : row.state !== "loading" && !row.series ? (
                <div className="font-mono text-xs text-slate-500">—</div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-slate-500">Vertical axis: percent change. Horizontal axis: session date.</p>
      <div className="relative min-w-0">
        <div
          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
          aria-label="Index proxy percent change chart"
          className="h-56 w-full overflow-hidden rounded-xl border border-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
          onKeyDown={onChartKeyDown}
          ref={chartNode}
          role="application"
          tabIndex={0}
        />
        {activeDate && hoverRows.length > 0 ? (
          <div
            className="pointer-events-none absolute z-10 max-w-[12rem] rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-2 text-xs shadow-lg"
            style={{ left: activePointer?.x ?? 8, top: activePointer?.y ?? 8 }}
          >
            <div className="text-slate-200">{formatSessionDate(activeDate)}</div>
            <ul>
              {hoverRows.map((row) => (
                <li className="mt-1 flex items-center justify-between gap-3" key={row.symbol}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                    <span className="truncate text-slate-100">{row.name}</span>
                  </span>
                  <span className={row.value < 0 ? "font-mono text-rose-300" : "font-mono text-emerald-300"}>
                    {formatSignedPercent(row.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p aria-live="polite" className="min-h-6 text-xs text-slate-300">{reading}</p>
      {rangeControl ? <div className="flex max-w-full justify-center">{rangeControl}</div> : null}
      {chartFailed ? (
        <p className="text-xs text-amber-200" role="status">The comparison chart could not be drawn. The percent changes above still use the stored closes.</p>
      ) : null}
      {rows.some((row) => row.state === "loading") ? <p className="text-xs text-slate-400">Loading end-of-day history.</p> : null}
      {missing.length > 0 ? (
        <p className="text-xs text-slate-400">End-of-day history unavailable for {missing.map((row) => row.symbol).join(", ")}.</p>
      ) : null}
      {openGaps.length > 0 ? (
        <p className="text-xs text-slate-400">Missing sessions stay open for {openGaps.map((row) => row.symbol).join(", ")}. The line does not connect across that break.</p>
      ) : null}
      {spanned.length > 0 ? (
        <p className="text-xs text-slate-400">Sessions are missing for {spanned.map((row) => row.symbol).join(", ")}. The line spans those sessions.</p>
      ) : null}
    </div>
  );
}
