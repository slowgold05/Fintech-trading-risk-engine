import { useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import { fetchDailyHistory, type HistoryCoverageStatus, type HistoryResponse } from "../api/history";
import { formatSignedPercent } from "../utils/format";
import {
  INDEX_PROXIES,
  type NormalizedSeries,
  type PulseChartRange,
  normalizeCloses,
} from "./indexComparisonData";

const COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#c084fc", "#fb7185", "#a5b4fc"];
const HISTORY_PROVIDER = "massive";
const HISTORY_ADJUSTMENT = "split_adjusted";

type Proxy = {
  symbol: string;
  name: string;
};

type PlotRow = {
  symbol: string;
  name: string;
  color: string;
  state: "loading" | "unavailable" | "ready";
  coverage: HistoryCoverageStatus | null;
  series: NormalizedSeries | null;
};

type HoverRow = {
  symbol: string;
  value: string;
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

function chartOptions(charts: typeof import("lightweight-charts"), height: number) {
  return {
    autoSize: true,
    height,
    layout: {
      background: { type: charts.ColorType.Solid, color: "#020617" },
      textColor: "#cbd5e1",
      attributionLogo: true,
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: "#1e293b" },
      horzLines: { color: "#1e293b" },
    },
    rightPriceScale: { borderColor: "#334155", visible: true },
    timeScale: { borderColor: "#334155", visible: true, secondsVisible: false, timeVisible: false },
    localization: {
      priceFormatter: (price: number) => `${price.toFixed(2)}%`,
    },
    handleScroll: false,
    handleScale: false,
  };
}

export function IndexComparisonChart({
  range,
  symbols = INDEX_PROXIES,
  provider = HISTORY_PROVIDER,
  adjustment = HISTORY_ADJUSTMENT,
}: {
  range: PulseChartRange;
  symbols?: readonly Proxy[];
  provider?: string;
  adjustment?: string;
}) {
  const [mode, setMode] = useState<"compare" | "separate">("compare");
  const [chartFailed, setChartFailed] = useState(false);
  const [hover, setHover] = useState<{ date: string; rows: HoverRow[] } | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queries = useQueries({
    queries: symbols.map((item) => ({
      queryKey: ["market", "history", item.symbol, provider, adjustment, range],
      queryFn: () => fetchDailyHistory(item.symbol, provider, adjustment, range),
      retry: false,
      staleTime: 300_000,
    })),
  });

  const rows: PlotRow[] = symbols.map((item, index) => {
    const query = queries[index];
    const response = query?.data;
    const mismatched = response != null && response.symbol !== item.symbol;
    const plot = query?.isLoading
      ? { state: "loading" as const, coverage: null, series: null }
      : plotFromResponse(mismatched ? undefined : response, Boolean(query?.isError) || mismatched);
    return {
      symbol: item.symbol,
      name: item.name,
      color: COLORS[index % COLORS.length],
      ...plot,
    };
  });
  const plotKey = rows.map((row) => (
    `${row.symbol}:${row.state}:${row.series?.asOf ?? ""}:${row.series?.sessionCount ?? 0}:${row.series?.hasGap ? "gap" : "solid"}`
  )).join("|");
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  useEffect(() => {
    let cancelled = false;
    const active: IChartApi[] = [];
    const nodes = mode === "compare"
      ? [["compare", nodeRefs.current.compare ?? null, rowsRef.current.filter((row) => row.state === "ready")] as const]
      : rowsRef.current
        .filter((row) => row.state === "ready")
        .map((row) => [row.symbol, nodeRefs.current[row.symbol] ?? null, [row]] as const);

    void import("lightweight-charts").then((charts) => {
      if (cancelled) {
        return;
      }
      try {
        for (const [, node, seriesRows] of nodes) {
          if (!node || seriesRows.length === 0) {
            continue;
          }
          const chart = charts.createChart(node, chartOptions(charts, mode === "compare" ? 256 : 112));
          active.push(chart);
          const painted: { symbol: string; series: ISeriesApi<SeriesType> }[] = [];
          for (const row of seriesRows) {
            if (!row.series) {
              continue;
            }
            const series = chart.addSeries(charts.LineSeries, {
              color: row.color,
              title: row.symbol,
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: mode === "separate",
            });
            series.setData(row.series.points);
            painted.push({ symbol: row.symbol, series });
          }
          chart.timeScale().fitContent();
          chart.subscribeCrosshairMove((param) => {
            if (!param.time || !param.seriesData.size) {
              setHover(null);
              return;
            }
            const date = typeof param.time === "string" ? param.time : "";
            const hoverRows: HoverRow[] = [];
            for (const item of painted) {
              const datum = param.seriesData.get(item.series);
              if (datum && "value" in datum && typeof datum.value === "number") {
                hoverRows.push({ symbol: item.symbol, value: `${datum.value.toFixed(2)}%` });
              }
            }
            setHover(date && hoverRows.length ? { date, rows: hoverRows } : null);
          });
        }
        if (!cancelled) {
          setChartFailed(active.length === 0 && nodes.some((entry) => entry[2].length > 0));
        }
      } catch {
        if (!cancelled) {
          setChartFailed(true);
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setChartFailed(true);
      }
    });

    return () => {
      cancelled = true;
      for (const chart of active) {
        chart.remove();
      }
      setHover(null);
    };
  }, [mode, plotKey]);

  const ready = rows.filter((row) => row.state === "ready" && row.series);
  const asOf = ready.reduce<string | null>((latest, row) => {
    const date = row.series?.asOf ?? "";
    return !latest || date > latest ? date : latest;
  }, null);
  const brokenNames = rows.filter((row) => row.series?.hasGap).map((row) => row.symbol);
  const spannedNames = rows
    .filter((row) => !row.series?.hasGap && coverageHasGaps(row.coverage))
    .map((row) => row.symbol);
  const missing = rows.filter((row) => row.state === "unavailable").map((row) => row.symbol);
  const loading = rows.some((row) => row.state === "loading");

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {asOf ? `End-of-day as of ${asOf}.` : "End-of-day history."} Percent change from the first stored close in the range.
        </p>
        <div aria-label="Index comparison layout" className="flex flex-wrap rounded border border-slate-800 bg-slate-950 p-1" role="group">
          <button
            aria-pressed={mode === "compare"}
            className={modeButtonClass(mode === "compare")}
            onClick={() => setMode("compare")}
            type="button"
          >
            Compare
          </button>
          <button
            aria-pressed={mode === "separate"}
            className={modeButtonClass(mode === "separate")}
            onClick={() => setMode("separate")}
            type="button"
          >
            Separate
          </button>
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
        Horizontal axis: session date. Vertical axis: percent change.
      </p>
      {mode === "compare" ? (
        <div className="h-64 w-full min-w-0 overflow-hidden rounded-xl border border-slate-800" ref={(node) => { nodeRefs.current.compare = node; }} />
      ) : (
        <div className="grid min-w-0 gap-3">
          {rows.map((row) => (
            <div className="min-w-0" key={row.symbol}>
              <div className="mb-1 font-mono text-xs text-slate-300">{row.symbol}</div>
              <div
                className="h-28 w-full min-w-0 overflow-hidden rounded-xl border border-slate-800"
                ref={(node) => { nodeRefs.current[row.symbol] = node; }}
              />
            </div>
          ))}
        </div>
      )}
      <p aria-live="polite" className="min-h-6 text-xs text-slate-300">
        {hover
          ? `${hover.date}: ${hover.rows.map((row) => `${row.symbol} ${row.value}`).join(", ")}`
          : "Hover a session to see its date and percent change."}
      </p>
      {chartFailed ? (
        <p className="text-xs text-slate-400" role="status">The chart could not be drawn. The table lists the same end-of-day changes.</p>
      ) : null}
      {loading ? <p className="text-xs text-slate-400" role="status">Loading end-of-day history.</p> : null}
      {missing.length > 0 ? (
        <p className="text-xs text-slate-400" role="status">End-of-day history unavailable for {missing.join(", ")}.</p>
      ) : null}
      {brokenNames.length > 0 ? (
        <p className="text-xs text-slate-400" role="status">
          Missing sessions stay open for {brokenNames.join(", ")}. The line does not connect across those gaps.
        </p>
      ) : null}
      {spannedNames.length > 0 ? (
        <p className="text-xs text-slate-400" role="status">
          Sessions are missing for {spannedNames.join(", ")}. The line spans those sessions.
        </p>
      ) : null}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full table-fixed text-left text-xs text-slate-300">
          <caption className="sr-only">End-of-day percent change for the index proxies</caption>
          <thead className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="py-2 pr-2 font-semibold" scope="col">Proxy</th>
              <th className="py-2 pr-2 font-semibold" scope="col">Change</th>
              <th className="py-2 font-semibold" scope="col">As of</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-slate-800" key={row.symbol}>
                <th className="py-2 pr-2 font-semibold text-slate-100" scope="row">
                  <span className="flex items-start gap-2">
                    {row.series ? (
                      <span
                        aria-hidden="true"
                        className="mt-1 inline-block size-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: row.color }}
                      />
                    ) : null}
                    <span className="min-w-0 font-mono">
                      {row.symbol}
                      <span className="mt-0.5 block font-sans text-[10px] font-normal text-slate-500">{row.name}</span>
                    </span>
                  </span>
                </th>
                <td className="py-2 pr-2 font-mono">
                  {row.series ? formatSignedPercent(row.series.changePercent) : row.state === "loading" ? "Loading" : "Unavailable"}
                </td>
                <td className="py-2 font-mono">{row.series?.asOf ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function modeButtonClass(selected: boolean) {
  return [
    "min-h-11 rounded px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-300/40",
    selected ? "bg-emerald-400 text-slate-950" : "text-slate-200 hover:bg-slate-900 hover:text-slate-50",
  ].join(" ");
}
