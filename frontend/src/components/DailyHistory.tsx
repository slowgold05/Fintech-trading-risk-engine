import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { CandlestickData, LineData, Time, WhitespaceData } from "lightweight-charts";
import { Link } from "react-router-dom";
import {
  type AdjustmentType,
  type HistoryBar,
  type HistoryCoverageStatus,
  type HistoryResponse,
  fetchCachedSeries,
  fetchDailyHistory,
} from "../api/history";
import { fetchDailyIndicators, type IndicatorName } from "../api/indicators";
import { historyCandles, indicatorOverlay, type IndicatorOverlay } from "./historyData";

type IndicatorChoice = "none" | IndicatorName;

type SubmittedSeries = {
  symbol: string;
  provider: string;
  adjustment_type: AdjustmentType;
  indicator: IndicatorChoice;
  period: number;
};

type SeriesOption = {
  key: string;
  provider: string;
  adjustment_type: AdjustmentType;
};

type HistoryMeta = Pick<
  HistoryResponse,
  | "status"
  | "requested_start"
  | "requested_end"
  | "available_start"
  | "available_end"
  | "excluded_row_count"
  | "coverage_status"
  | "expected_session_count"
>;

type PriceRow = Pick<HistoryBar, "session_date" | "open" | "high" | "low" | "close">;

type IndicatorLine = (LineData<Time> | WhitespaceData<Time>)[];

type HistoryBundle = {
  history: HistoryResponse;
  overlay: IndicatorOverlay | null;
};

type AcceptedHistory =
  | { state: "mismatch" }
  | { state: "invalid" }
  | { state: "empty"; meta: HistoryMeta }
  | {
      state: "partial";
      meta: HistoryMeta;
      points: CandlestickData<Time>[];
      rows: PriceRow[];
      overlay: IndicatorOverlay | null;
    };

type LightweightChartsModule = typeof import("lightweight-charts");
type DailyChart = ReturnType<LightweightChartsModule["createChart"]>;

const SYMBOL_MAX = 20;
const PROVIDER_MAX = 32;
const PERIOD_DEFAULT = 20;

function addCandleSeries(chart: DailyChart, charts: LightweightChartsModule) {
  return chart.addSeries(charts.CandlestickSeries, {
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
}

type CandleSeries = ReturnType<typeof addCandleSeries>;

function addLineSeries(chart: DailyChart, charts: LightweightChartsModule) {
  return chart.addSeries(charts.LineSeries, {
    color: "#7dd3fc",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: {
      type: "price",
      precision: 6,
      minMove: 0.000001,
    },
  });
}

type LineSeriesHandle = ReturnType<typeof addLineSeries>;

export function DailyHistory({
  value,
  onValueChange,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
} = {}) {
  const [symbolDraft, setSymbolDraft] = useState("");
  const draftValue = value ?? symbolDraft;

  function updateSymbolDraft(next: string) {
    if (value === undefined) {
      setSymbolDraft(next);
    }
    onValueChange?.(next);
  }
  const [seriesKey, setSeriesKey] = useState("");
  const [indicatorDraft, setIndicatorDraft] = useState<IndicatorChoice>("none");
  const [periodDraft, setPeriodDraft] = useState(String(PERIOD_DEFAULT));
  const [submitted, setSubmitted] = useState<SubmittedSeries | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const catalogQuery = useQuery({
    queryKey: ["market", "cachedseries"],
    queryFn: fetchCachedSeries,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: [
      "market",
      "history",
      submitted?.symbol ?? "",
      submitted?.provider ?? "",
      submitted?.adjustment_type ?? "",
      "1d",
      "2y",
      submitted?.indicator ?? "none",
      submitted?.period ?? PERIOD_DEFAULT,
    ],
    queryFn: async (): Promise<HistoryBundle> => {
      const request = submitted;
      if (request === null) {
        throw new Error("No submitted series.");
      }
      if (request.indicator === "none") {
        const history = await fetchDailyHistory(request.symbol, request.provider, request.adjustment_type);
        return { history, overlay: null };
      }
      const payload = await fetchDailyIndicators(
        request.symbol,
        request.provider,
        request.adjustment_type,
        request.indicator,
        request.period,
      );
      const overlay = indicatorOverlay(payload, {
        symbol: request.symbol,
        provider: request.provider,
        adjustment_type: request.adjustment_type,
        name: request.indicator,
        period: request.period,
      });
      return { history: overlay.history, overlay };
    },
    enabled: submitted !== null,
    retry: false,
  });
  const catalog = useMemo(
    () => (catalogQuery.isSuccess ? readCatalog(catalogQuery.data) : null),
    [catalogQuery.data, catalogQuery.isSuccess],
  );
  const options = catalog?.ok ? catalog.options : [];
  const selected = options.find((option) => option.key === seriesKey) ?? null;
  const draftSymbol = draftValue.trim().toUpperCase();
  const draftPeriod = readPeriod(periodDraft);
  const indicatorActive = indicatorDraft !== "none" || submitted?.indicator !== "none";
  const formDiffers =
    submitted !== null &&
    (draftSymbol !== submitted.symbol ||
      selected?.provider !== submitted.provider ||
      selected?.adjustment_type !== submitted.adjustment_type ||
      indicatorDraft !== submitted.indicator ||
      (indicatorActive && draftPeriod !== submitted.period));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = draftValue.trim().toUpperCase();
    if (symbol.length === 0 || symbol.length > SYMBOL_MAX) {
      setFormError("Enter a symbol of at most 20 characters.");
      return;
    }
    if (!selected || selected.provider.length === 0 || selected.provider.length > PROVIDER_MAX) {
      setFormError("Choose a cached series.");
      return;
    }
    const period = indicatorDraft === "none" ? PERIOD_DEFAULT : draftPeriod;
    if (period === null) {
      setFormError("Enter a whole period from 2 to 200.");
      return;
    }
    setFormError(null);
    const next = {
      symbol,
      provider: selected.provider,
      adjustment_type: selected.adjustment_type,
      indicator: indicatorDraft,
      period,
    };
    if (
      submitted !== null &&
      submitted.symbol === next.symbol &&
      submitted.provider === next.provider &&
      submitted.adjustment_type === next.adjustment_type &&
      submitted.indicator === next.indicator &&
      submitted.period === next.period
    ) {
      void historyQuery.refetch();
      return;
    }
    setSubmitted(next);
  }

  const showForm = catalog?.ok === true && options.length > 0;
  const accepted = useMemo(() => {
    if (!showForm || submitted === null || !historyQuery.isSuccess) {
      return null;
    }
    return acceptHistory(historyQuery.data, submitted);
  }, [showForm, submitted, historyQuery.isSuccess, historyQuery.data]);

  return (
    <section aria-labelledby="daily-price-history-title" className="dashboard-card min-w-0">
      <div className="dashboard-card-header">
        <div>
          <h2 id="daily-price-history-title" className="text-sm font-semibold text-slate-100">
            Daily price history
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Cached canonical daily bars for one explicit source and adjustment.
          </p>
        </div>
      </div>
      <div className="dashboard-card-body min-w-0 space-y-4">
        {catalogQuery.isPending ? (
          <p className="text-sm text-slate-300" role="status">
            Loading cached series.
          </p>
        ) : null}
        {catalogQuery.isError || catalog?.ok === false ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-200" role="alert">
              Cached series could not be loaded.
            </p>
            <button
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
              onClick={() => void catalogQuery.refetch()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}
        {catalog?.ok === true && options.length === 0 ? (
          <p className="text-sm text-slate-300" role="status">
            No canonical daily series available.
          </p>
        ) : null}
        {showForm ? (
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0">
                <label className="text-xs font-semibold text-slate-300" htmlFor="daily-history-symbol">
                  Symbol
                </label>
                <input
                  aria-invalid={formError !== null && (draftSymbol.length === 0 || draftSymbol.length > SYMBOL_MAX)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="field-control"
                  id="daily-history-symbol"
                  maxLength={SYMBOL_MAX}
                  onChange={(event) => updateSymbolDraft(event.target.value)}
                  spellCheck={false}
                  value={draftValue}
                />
              </div>
              <div className="min-w-0">
                <label className="text-xs font-semibold text-slate-300" htmlFor="daily-history-series">
                  Cached series
                </label>
                <select
                  aria-invalid={formError !== null && selected === null}
                  className="field-control"
                  id="daily-history-series"
                  onChange={(event) => setSeriesKey(event.target.value)}
                  value={seriesKey}
                >
                  <option value="">Choose cached series</option>
                  {options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.provider} · {option.adjustment_type}
                    </option>
                  ))}
                </select>
              </div>
              <button className="primary-action sm:w-auto" type="submit">
                View history
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)] sm:items-end">
              <div className="min-w-0">
                <label className="text-xs font-semibold text-slate-300" htmlFor="daily-history-indicator">
                  Indicator
                </label>
                <select
                  className="field-control"
                  id="daily-history-indicator"
                  onChange={(event) => setIndicatorDraft(readIndicatorChoice(event.target.value))}
                  value={indicatorDraft}
                >
                  <option value="none">None</option>
                  <option value="sma">SMA</option>
                  <option value="ema">EMA</option>
                </select>
              </div>
              {indicatorDraft !== "none" ? (
                <div className="min-w-0">
                  <label className="text-xs font-semibold text-slate-300" htmlFor="daily-history-period">
                    Period
                  </label>
                  <input
                    aria-invalid={formError !== null && draftPeriod === null}
                    className="field-control"
                    id="daily-history-period"
                    inputMode="numeric"
                    max={200}
                    min={2}
                    onChange={(event) => setPeriodDraft(event.target.value)}
                    step={1}
                    type="number"
                    value={periodDraft}
                  />
                </div>
              ) : null}
            </div>
            {formError ? (
              <p className="text-sm text-rose-200" role="alert">
                {formError}
              </p>
            ) : null}
          </form>
        ) : null}

        {showForm && submitted ? (
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-slate-200">
              Showing {submitted.symbol}, source {submitted.provider}, adjustment {submitted.adjustment_type}.
            </p>
            {formDiffers ? (
              <p className="text-xs text-slate-400">
                The form has unsent changes. Prices below stay on the last viewed series.
              </p>
            ) : null}
            {historyQuery.isPending ? (
              <p className="text-sm text-slate-300" role="status">
                Loading cached daily history.
              </p>
            ) : null}
            {historyQuery.isError ? (
              <div className="space-y-3">
                <p className="text-sm text-rose-200" role="alert">
                  {historyErrorMessage(historyQuery.error)}
                </p>
                <button
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                  onClick={() => void historyQuery.refetch()}
                  type="button"
                >
                  Retry
                </button>
              </div>
            ) : null}
            {accepted?.state === "mismatch" ? (
              <HistoryFailure
                message="Cached history did not match the selected symbol, source, and adjustment."
                onRetry={() => void historyQuery.refetch()}
              />
            ) : null}
            {accepted?.state === "invalid" ? (
              <HistoryFailure
                message="Cached daily bars could not be plotted."
                onRetry={() => void historyQuery.refetch()}
              />
            ) : null}
            {accepted?.state === "empty" ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-300" role="status">
                  No cached daily bars for this symbol, source, and adjustment.
                </p>
                <HistoryFacts meta={accepted.meta} submitted={submitted} />
              </div>
            ) : null}
            {accepted?.state === "partial" ? (
              <div className="min-w-0 space-y-4">
                <p className="text-sm text-slate-300">
                  Partial cached bars for the requested window. Missing sessions stay missing.
                </p>
                {!historyQuery.isFetching && !historyQuery.isError ? (
                  <p>
                    <Link
                      className="text-sm text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
                      to={`/trades?symbol=${encodeURIComponent(submitted.symbol)}`}
                    >
                      Trade this symbol
                    </Link>
                    <span className="text-sm text-slate-400"> · paper trade</span>
                  </p>
                ) : null}
                <HistoryFacts meta={accepted.meta} submitted={submitted} />
                {accepted.overlay ? <IndicatorFacts overlay={accepted.overlay} /> : null}
                <DailyHistoryCanvas line={accepted.overlay?.line ?? null} points={accepted.points} />
                <SessionPrices
                  indicatorLabel={accepted.overlay ? indicatorLabel(accepted.overlay) : null}
                  rows={accepted.rows}
                  submitted={submitted}
                  values={accepted.overlay?.values ?? null}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2 border-t border-slate-800 pt-4">
          <p className="text-xs leading-5 text-slate-400">
            TradingView Lightweight Charts™, Copyright ({"\u0441"}) 2025 TradingView, Inc.{" "}
            <a
              className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
              href="https://www.tradingview.com/"
              rel="noreferrer"
              target="_blank"
            >
              https://www.tradingview.com/
            </a>
          </p>
          <p className="text-xs leading-5 text-slate-400">
            <a
              className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
              href="/licenses/lightweight-charts-LICENSE.txt"
            >
              lightweight-charts license
            </a>
            {" · "}
            <a
              className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
              href="/licenses/lightweight-charts-NOTICE.txt"
            >
              lightweight-charts notice
            </a>
            {" · "}
            <a
              className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
              href="/licenses/fancy-canvas-LICENSE.txt"
            >
              fancy-canvas license
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

function HistoryFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-rose-200" role="alert">
        {message}
      </p>
      <button
        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

function HistoryFacts({ meta, submitted }: { meta: HistoryMeta; submitted: SubmittedSeries }) {
  const available =
    meta.available_start !== null && meta.available_end !== null
      ? `${meta.available_start} to ${meta.available_end}`
      : "None";
  const rows = [
    ["Status", meta.status === "partial" ? "Partial" : "Unavailable"],
    ["Source", submitted.provider],
    ["Adjustment", submitted.adjustment_type],
    ["Requested", `${meta.requested_start} to ${meta.requested_end}`],
    ["Available", available],
    ["Excluded rows", String(meta.excluded_row_count)],
    ["Coverage", coverageStatusLabel(meta.coverage_status)],
    ["Expected sessions", meta.expected_session_count === null ? "Not verified" : String(meta.expected_session_count)],
    ["Collection", "Disabled"],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
          <dd className="mt-1 break-words font-mono text-sm text-slate-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function IndicatorFacts({ overlay }: { overlay: IndicatorOverlay }) {
  const label = indicatorLabel(overlay);
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm text-slate-200">{label} on observed stored closes.</p>
      {overlay.status === "insufficient" ? (
        <p className="text-sm text-slate-300">Insufficient stored closes for this period. No indicator curve is drawn.</p>
      ) : null}
      {overlay.status === "unavailable" ? (
        <p className="text-sm text-slate-300">Indicator values are unavailable. No indicator curve is drawn.</p>
      ) : null}
      {overlay.status === "partial" || overlay.status === "insufficient" ? (
        <p className="text-sm text-slate-300">
          Warm-up: the first {overlay.period - 1} observed stored closes have no indicator value.
        </p>
      ) : null}
    </div>
  );
}

function SessionPrices({
  rows,
  submitted,
  values,
  indicatorLabel: columnLabel,
}: {
  rows: PriceRow[];
  submitted: SubmittedSeries;
  values: (string | null)[] | null;
  indicatorLabel: string | null;
}) {
  const showIndicator = values !== null && columnLabel !== null;
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer rounded-lg text-sm font-semibold text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50">
        Session prices
      </summary>
      <div className="table-shell mt-3 max-h-80 min-w-0 overflow-auto overscroll-contain">
        <table className="data-table">
          <caption className="sr-only">
            Open, high, low, and close
            {showIndicator ? ` and ${columnLabel}` : ""} for {submitted.symbol}, source {submitted.provider}, adjustment{" "}
            {submitted.adjustment_type}. Values are the cached decimal strings
            {showIndicator ? ", or Warm-up where the indicator has no value" : ""}.
          </caption>
          <thead>
            <tr>
              <th className="text-left" scope="col">
                Session date
              </th>
              <th className="text-right" scope="col">
                Open
              </th>
              <th className="text-right" scope="col">
                High
              </th>
              <th className="text-right" scope="col">
                Low
              </th>
              <th className="text-right" scope="col">
                Close
              </th>
              {showIndicator ? (
                <th className="text-right" scope="col">
                  {columnLabel}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.session_date}>
                <th className="text-left font-mono text-slate-100" scope="row">
                  {row.session_date}
                </th>
                <td className="text-right font-mono">{row.open}</td>
                <td className="text-right font-mono">{row.high}</td>
                <td className="text-right font-mono">{row.low}</td>
                <td className="text-right font-mono">{row.close}</td>
                {showIndicator ? (
                  <td className="text-right font-mono">{values[index] ?? "Warm-up"}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DailyHistoryCanvas({ points, line }: { points: CandlestickData<Time>[]; line: IndicatorLine | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<DailyChart | null>(null);
  const seriesRef = useRef<CandleSeries | null>(null);
  const lineSeriesRef = useRef<LineSeriesHandle | null>(null);
  const libraryRef = useRef<LightweightChartsModule | null>(null);
  const pointsRef = useRef(points);
  const lineRef = useRef(line);
  const disposeRef = useRef<(() => void) | null>(null);
  const failedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    pointsRef.current = points;
    lineRef.current = line;
    if (failedRef.current) {
      failedRef.current = false;
      setFailed(false);
      setAttempt((value) => value + 1);
      return;
    }
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) {
      return;
    }
    try {
      series.setData(points);
      syncIndicatorLine(chart, libraryRef.current, lineSeriesRef, line);
    } catch {
      disposeRef.current?.();
      failedRef.current = true;
      setFailed(true);
    }
  }, [points, line]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    let active: DailyChart | null = null;
    let removed = false;
    const dispose = () => {
      if (removed) {
        return;
      }
      removed = true;
      cancelled = true;
      active?.remove();
      active = null;
      chartRef.current = null;
      seriesRef.current = null;
      lineSeriesRef.current = null;
      libraryRef.current = null;
    };
    disposeRef.current = dispose;

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
          chartRef.current = created;
          libraryRef.current = charts;
          const series = addCandleSeries(created, charts);
          seriesRef.current = series;
          series.setData(pointsRef.current);
          syncIndicatorLine(created, charts, lineSeriesRef, lineRef.current);
          created.timeScale().fitContent();
        } catch {
          failedRef.current = true;
          dispose();
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          failedRef.current = true;
          setFailed(true);
        }
      });

    return () => {
      dispose();
      if (disposeRef.current === dispose) {
        disposeRef.current = null;
      }
    };
  }, [attempt]);

  if (failed) {
    return (
      <p className="text-sm text-slate-300" role="status">
        Daily price chart unavailable.
      </p>
    );
  }

  return <div className="h-80 min-w-0 w-full" ref={containerRef} />;
}

function historyErrorMessage(error: unknown): string {
  if (isAxiosError(error) && error.response?.status === 404) {
    return "This symbol is not in the cached symbol list.";
  }
  if (isAxiosError(error) && error.response?.status === 422) {
    return "The history request was rejected. Check the symbol, source, and adjustment.";
  }
  return "Cached daily history could not be loaded.";
}

function readCatalog(data: unknown): { ok: true; options: SeriesOption[] } | { ok: false } {
  if (!isRecord(data) || !isRecord(data.canonical_history) || !Array.isArray(data.canonical_history.series)) {
    return { ok: false };
  }
  const seen = new Set<string>();
  const options: SeriesOption[] = [];
  for (const entry of data.canonical_history.series) {
    if (!isRecord(entry) || typeof entry.provider !== "string" || typeof entry.adjustment_type !== "string") {
      return { ok: false };
    }
    if (!isAdjustment(entry.adjustment_type) || !isProvider(entry.provider)) {
      continue;
    }
    const key = JSON.stringify([entry.provider, entry.adjustment_type]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push({
      key,
      provider: entry.provider,
      adjustment_type: entry.adjustment_type,
    });
  }
  return { ok: true, options };
}

function acceptHistory(bundle: HistoryBundle, request: SubmittedSeries): AcceptedHistory {
  const data = bundle.history;
  if (!isRecord(data)) {
    return { state: "invalid" };
  }
  if (
    data.symbol !== request.symbol ||
    data.provider !== request.provider ||
    data.adjustment_type !== request.adjustment_type
  ) {
    return { state: "mismatch" };
  }
  try {
    const points = historyCandles(data);
    const overlay = bundle.overlay;
    if (request.indicator === "none" || overlay === null) {
      if (overlay !== null || request.indicator !== "none") {
        return { state: "invalid" };
      }
      if (points.length === 0) {
        return { state: "empty", meta: data };
      }
      return { state: "partial", meta: data, points, rows: data.bars, overlay: null };
    }
    if (
      overlay.name !== request.indicator ||
      overlay.period !== request.period ||
      overlay.candles.length !== points.length ||
      overlay.line.length !== points.length ||
      overlay.values.length !== data.bars.length ||
      !alignedTimes(points, overlay)
    ) {
      return { state: "invalid" };
    }
    if (points.length === 0) {
      return { state: "empty", meta: data };
    }
    return { state: "partial", meta: data, points, rows: data.bars, overlay };
  } catch {
    return { state: "invalid" };
  }
}

function syncIndicatorLine(
  chart: DailyChart,
  charts: LightweightChartsModule | null,
  lineSeriesRef: { current: LineSeriesHandle | null },
  line: IndicatorLine | null,
) {
  if (line === null) {
    lineSeriesRef.current?.setData([]);
    return;
  }
  if (!charts) {
    return;
  }
  if (lineSeriesRef.current === null) {
    lineSeriesRef.current = addLineSeries(chart, charts);
  }
  lineSeriesRef.current.setData(line);
}

function alignedTimes(points: CandlestickData<Time>[], overlay: IndicatorOverlay): boolean {
  for (let index = 0; index < points.length; index += 1) {
    if (overlay.candles[index]?.time !== points[index]?.time || overlay.line[index]?.time !== points[index]?.time) {
      return false;
    }
  }
  return true;
}

function coverageStatusLabel(status: HistoryCoverageStatus): string {
  switch (status) {
    case "not_verified":
      return "Not verified";
    case "complete":
      return "Complete";
    case "gaps":
      return "Gaps";
    case "unexpected_sessions":
      return "Unexpected sessions";
    case "gaps_and_unexpected_sessions":
      return "Gaps and unexpected sessions";
  }
}

function indicatorLabel(overlay: IndicatorOverlay): string {
  const name = overlay.name === "sma" ? "SMA" : "EMA";
  return `${name} (${overlay.period})`;
}

function readIndicatorChoice(value: string): IndicatorChoice {
  if (value === "sma" || value === "ema") {
    return value;
  }
  return "none";
}

function readPeriod(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) {
    return null;
  }
  const period = Number(trimmed);
  if (!Number.isInteger(period) || period < 2 || period > 200) {
    return null;
  }
  return period;
}

function isProvider(value: string): boolean {
  return value.length > 0 && value.length <= PROVIDER_MAX && value === value.trim();
}

function isAdjustment(value: string): value is AdjustmentType {
  return value === "raw" || value === "split_adjusted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
