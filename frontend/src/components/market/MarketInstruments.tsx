import { SheetSelect } from "../../design/SheetSelect";
import { InstrumentFold } from "./InstrumentFold";
import { compactWidth, phoneWidth, useMaxWidth } from "./compactLayout";
import { useSessionPaint } from "./sessionCursor";
import { sectorName } from "./sectorName";
import {
  createElement,
  memo,
  type ComponentType,
  type ReactNode,
  type CSSProperties,
  useRef,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueries, type UseQueryResult, type NotifyOnChangeProps } from "@tanstack/react-query";
import { ChartLine, Crosshair, Waveform, ChartBarHorizontal, Stack } from "./terrainIcons";
import { Card, EmptyState, Figure, Segmented, Skeleton } from "../../design/primitives";
import type { HistoryResponse } from "../../api/history";
import type { MarketHeatmapResponse, MarketSectorResponse } from "../../types/schemas";
import { SectorPerformanceGrid } from "../MarketSectorGrid";
import { proxyHistoryQuery } from "../indexComparisonData";
import { useAdjustedProvider } from "./useAdjustedProvider";
import { buildRidge, windowSurface, type TerrainPeriod, type Ridge, type Surface } from "./terrainData";
type PlotRenderer = ComponentType<{
  surface: Surface;
  symbol: string;
  inspect: (symbol: string, date: string | null) => void;
  release: () => void;
  choose: (sector: string) => void;
}>;

// Keep independent import sites. A single conditional import expression lets
// the production bundler attach desktop mesh preloads to the phone request.
const renderers = {
  profiles: () => import("./PhoneTerrain").then((m) => m.PhoneTerrain),
  mesh: () => import("./TerrainPlot").then((m) => m.TerrainPlot),
};

function usePlotRenderer(phone: boolean, hasFunds: boolean) {
  const [ready, setReady] = useState<{ phone: boolean; Plot: PlotRenderer } | null>(null);
  const [failedMode, setFailedMode] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hasFunds) return;
    let current = true;
    void renderers[phone ? "profiles" : "mesh"]()
      .then((Plot) => {
        if (current) setReady({ phone, Plot });
      })
      .catch(() => {
        if (current) setFailedMode(phone);
      });
    return () => {
      current = false;
    };
  }, [phone, hasFunds]);
  return { Plot: ready?.phone === phone ? ready.Plot : null, rendererFailed: failedMode === phone };
}

const Breadth = memo(function Breadth({
  heatmap,
  loading,
  company,
  sector,
  onCompany,
}: {
  heatmap?: MarketHeatmapResponse;
  loading: boolean;
  company: string | null;
  sector: string | null;
  onCompany: (s: string | null) => void;
}) {
  const stocks = (heatmap?.items ?? []).filter(
    (s) => s.data_status !== "stale" && Number.isFinite(s.change_percent),
  );
  const advancing = stocks.filter((s) => s.change_percent > 0).length,
    falling = stocks.filter((s) => s.change_percent < 0).length;
  const counts = [falling, stocks.length - advancing - falling, advancing];
  const ordered = [...stocks].sort((a, b) => a.change_percent - b.change_percent);
  const bins = Array.from({ length: 31 }, () => 0);
  const limit = Math.max(...stocks.map((s) => Math.abs(s.change_percent)), 0);
  for (const q of stocks) bins[limit ? Math.round(15 + (15 * q.change_percent) / limit) : 15]++;
  return (
    <Card className="breadth-meter">
      <div className="instrument-head">
        <Waveform />
        <h2>Equity breadth</h2>
      </div>
      {stocks.length ? (
        <>
          <div className="breadth-dial">
            <svg
              viewBox="0 0 168 88"
              role="img"
              aria-label="One arc tick per cached stock, grouped by session direction"
            >
              {ordered.map((q, i) => {
                const angle = ((-182 + (184 * i) / Math.max(1, ordered.length - 1)) * Math.PI) / 180;
                const outer = i % 5 === 0 ? 80 : 77,
                  inner = 65;
                return (
                  <line
                    key={q.symbol}
                    data-linked={
                      company ? q.symbol === company : !!sector && sectorName(q.sector) === sectorName(sector)
                    }
                    onPointerEnter={(e) => {
                      if (e.pointerType !== "touch") onCompany(q.symbol);
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType !== "touch") onCompany(null);
                    }}
                    x1={84 + inner * Math.cos(angle)}
                    y1={80 + inner * Math.sin(angle)}
                    x2={84 + outer * Math.cos(angle)}
                    y2={80 + outer * Math.sin(angle)}
                    stroke={q.change_percent < 0 ? "#cecac4" : q.change_percent > 0 ? "#666c6b" : "#8d8e8d"}
                    strokeWidth="1.6"
                  />
                );
              })}
              <path
                className="breadth-sweep"
                d="M5 80a79 79 0 0 1 158 0"
                pathLength="1"
                fill="none"
                stroke="#e0ded8"
                strokeWidth="1.4"
                strokeDasharray={falling / stocks.length + " 1"}
                style={{ "--arc": falling / stocks.length } as CSSProperties}
              />
            </svg>
            <div className="breadth-read">
              <strong>
                <Figure value={String(falling)} />
                <small> / {stocks.length}</small>
              </strong>
              <span>declining stocks</span>
            </div>
          </div>
          <svg
            className="distribution"
            viewBox="0 0 210 50"
            preserveAspectRatio="none"
            aria-label="Distribution of cached stock returns"
            role="img"
          >
            {bins.map((n, i) => (
              <rect
                key={i}
                x={i * 6.8}
                y={47 - (n / Math.max(...bins)) * 42}
                width="4.5"
                height={(n / Math.max(...bins)) * 42}
                fill={i < 15 ? "#b9b8b4" : "#737779"}
              />
            ))}
            <path d="M0 48H210 M104 1V48" stroke="#77797c" strokeDasharray="2 3" />
          </svg>
          <div className="meter-legend">
            {["Declined", "Flat", "Advanced"].map((s, i) => (
              <span key={s}>
                <i />
                {s}
                <b>{counts[i]}</b>
              </span>
            ))}
          </div>
        </>
      ) : loading ? (
        <Skeleton label="Loading stock breadth" />
      ) : (
        <EmptyState message="No current stock returns" />
      )}
    </Card>
  );
});

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function RangeMeter({ ridge, period, loading }: { ridge?: Ridge; period: TerrainPeriod; loading: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const missing = useRef<HTMLDivElement>(null);
  const points = useMemo(() => (ridge ? [...ridge.points.values()] : []), [ridge]);
  useSessionPaint((date) => {
    const node = body.current;
    if (!node || !ridge) return;
    const i = date ? points.findIndex((b) => b.date === date) : points.length - 1;
    const bar = points[i];
    node.hidden = !bar;
    if (missing.current) missing.current.hidden = !!bar;
    if (!bar) return;
    const span = ridge.high - ridge.low;
    const position = span ? (100 * (bar.close - ridge.low)) / span : null;
    node.querySelector(".range-read strong")!.textContent =
      position === null ? "Flat range" : position.toFixed(1) + "%";
    const tick = node.querySelector<HTMLElement>(".range-rail i")!;
    tick.hidden = position === null;
    if (position !== null) tick.style.left = position + "%";
    node.querySelector(".volume-cap b")!.textContent =
      bar.volume == null ? "Unavailable" : compact.format(bar.volume);
    node.querySelector(".obs-date")!.textContent = bar.date + " · stored bar";
    const bars = points.slice(Math.max(0, i - 35), i + 1);
    const max = Math.max(1, ...bars.map((v) => v.volume ?? 0));
    node.querySelectorAll("rect").forEach((rect, k) => {
      const volume = bars[k]?.volume;
      rect.style.display = volume == null ? "none" : "";
      if (volume == null) return;
      const h = (23 * volume) / max;
      rect.setAttribute("x", String((k * 220) / bars.length));
      rect.setAttribute("width", String(Math.max(1, 220 / bars.length - 1.6)));
      rect.setAttribute("y", String(24 - h));
      rect.setAttribute("height", String(h));
      rect.setAttribute("fill", k === bars.length - 1 ? "#e0ded8" : "#777a7f");
    });
  });
  return (
    <Card className="range-meter">
      <div className="instrument-head">
        <Crosshair />
        <h2>Range position</h2>
      </div>
      {ridge ? (
        <>
          <div ref={body}>
            <div className="range-read">
              <b>{ridge.symbol}</b>
              <strong />
            </div>
            <div className="range-rail">
              <i />
            </div>
            <div className="range-scale">
              <span>${ridge.low.toFixed(2)}</span>
              <span>{period} LOW / HIGH</span>
              <span>${ridge.high.toFixed(2)}</span>
            </div>
            <div className="volume-cap">
              <span>DAILY VOLUME</span>
              <b />
            </div>
            <svg
              viewBox="0 0 220 24"
              preserveAspectRatio="none"
              aria-label={ridge.symbol + " reported daily volume"}
              role="img"
            >
              {Array.from({ length: 36 }, (_, i) => (
                <rect key={i} />
              ))}
            </svg>
            <small className="obs-date" />
          </div>
          <div ref={missing} hidden>
            <EmptyState message="No matching daily bar" />
          </div>
        </>
      ) : loading ? (
        <Skeleton label="Loading range and volume" />
      ) : (
        <EmptyState message="No matching daily bar" />
      )}
    </Card>
  );
}

function collectRidges(results: UseQueryResult<ReturnType<typeof buildRidge>>[]) {
  const loading = results.some((q) => q.isLoading);
  const raw = loading ? [] : results.flatMap((q) => (q.data ? [q.data] : []));
  return {
    raw: raw.sort((a, b) => a.sector.localeCompare(b.sector)),
    loading,
    failed: results.some((q) => q.isError),
  };
}

type Props = {
  movers: ReactNode;
  company: string | null;
  onCompany: (s: string | null) => void;
  onPin: (s: string | null) => void;
  sectors: MarketSectorResponse[];
  heatmap?: MarketHeatmapResponse;
  loading: boolean;
  stockLoading: boolean;
  failed: boolean;
  sector: string | null;
  onSector: (s: string | null) => void;
  onDate: (d: string | null) => void;
};
export function MarketInstruments({
  movers,
  company,
  onCompany,
  onPin,
  sectors,
  heatmap,
  loading,
  stockLoading,
  failed,
  sector,
  onSector,
  onDate,
}: Props) {
  const compact = useMaxWidth(compactWidth);
  const phone = useMaxWidth(phoneWidth);
  // Code and stored histories load together. Draw in the first commit with both available.
  const { Plot, rendererFailed } = usePlotRenderer(phone, sectors.length > 0);
  const { provider, pending } = useAdjustedProvider();
  const [period, setPeriod] = useState<TerrainPeriod>("1Y");
  const [single, setSingle] = useState(false);

  // Transform each fund when its response arrives. Keep the shared history cache raw
  // for other instruments and publish the wall once its complete scale is known.
  const queries = useMemo(() => {
    const validDates = new Map<string, boolean>();
    return sectors.map((sector) => ({
      ...proxyHistoryQuery(sector.symbol, provider ?? "massive", "split_adjusted", "2y"),
      enabled: !!provider,
      select: (history: HistoryResponse) => buildRidge(sector, history, provider, single ? 1 : 5, validDates),
      notifyOnChangeProps: ["data", "isLoading", "isError"] satisfies NotifyOnChangeProps,
    }));
  }, [sectors, provider, single]);
  const data = useQueries({ queries, combine: collectRidges });
  const surface = useMemo(() => windowSurface(data.raw, period), [data.raw, period]);
  const ridge =
    surface.ridges.find((r) => sectorName(r.sector) === sectorName(sector)) ??
    surface.ridges.find((r) => r.symbol === sectors[0]?.symbol) ??
    surface.ridges[0];
  const awaiting = loading || pending || data.loading;
  function scrub(symbol: string, next: string | null) {
    onSector(sectors.find((s) => s.symbol === symbol)?.sector ?? null);
    onDate(next);
  }
  function release() {
    onSector(null);
    onDate(null);
  }
  return (
    <div className="instrument-wall">
      <Card className="terrain-panel">
        <div className="frame-corners" aria-hidden="true">
          {["nw", "ne", "sw", "se"].map((c) => (
            <svg key={c} className={"corner-" + c} viewBox="0 0 15 15">
              <path d="M1 14V1H14" pathLength="1" />
            </svg>
          ))}
        </div>
        <div className="terrain-head">
          <div>
            <div className="eyebrow">
              <Stack size={13} /> Sector funds
            </div>
            <h2 id="volatility-terrain">Volatility terrain</h2>
          </div>
          {(awaiting || surface.ridges.length > 0) && (
            <Segmented
              label="Terrain window"
              options={["1M", "3M", "1Y", "2Y"]}
              value={period}
              onChange={(v) => {
                release();
                setPeriod(v);
              }}
            />
          )}
        </div>
        <div className="plot-inset">
          {compact ? (
            <SheetSelect
              className="plot-tag"
              label="Terrain measure"
              value={single ? "one" : "mean"}
              options={[
                { value: "mean", text: "Five-session mean range" },
                { value: "one", text: "Single-session range" },
              ]}
              onChange={(v) => {
                release();
                setSingle(v === "one");
              }}
            />
          ) : (
            <button
              type="button"
              className="plot-tag"
              aria-label="Use single-session range"
              aria-pressed={single}
              onClick={() => {
                release();
                setSingle((value) => !value);
              }}
              title="Switch between five-session mean and single-session range"
            >
              <i /> {single ? "Single-session range" : "Five-session mean range"}{" "}
              <span aria-hidden="true">⇄</span>
            </button>
          )}
          {surface.ridges.length > 0 && (
            <div className="plot-count">
              {phone ? Math.min(4, surface.ridges.length) + "/" : ""}
              {surface.ridges.length} ETFs · {surface.dates.length} sessions
            </div>
          )}
          {surface.ridges.length && Plot ? (
            createElement(Plot, { surface, symbol: ridge.symbol, inspect: scrub, release, choose: onPin })
          ) : rendererFailed ? (
            <EmptyState
              message="Terrain display unavailable"
              detail="Stored fund readings are available in the sector instruments."
            />
          ) : awaiting || surface.ridges.length ? (
            <Skeleton className="surface-skeleton" label="Loading stored sector histories" />
          ) : (
            <EmptyState
              message="Sector histories unavailable"
              detail="No matching split-adjusted series could be drawn."
            />
          )}
        </div>
        {ridge && (
          <div className="terrain-footer">
            <span>
              <i />
              {ridge.symbol} <b>{ridge.sector}</b>
            </span>
            <span>{provider ?? "Source unavailable"} · split-adjusted</span>
          </div>
        )}
        <details className="terrain-method">
          <summary>
            Reading the terrain{" "}
            {phone && ridge && <small>{provider ?? "Source unavailable"} · split-adjusted</small>}
          </summary>
          <p>
            Each ridge follows a sector ETF through time. Height is its mean daily high–low range divided by
            close over five observed sessions. Single-session mode shows the daily range divided by close.
            {phone
              ? "Swipe the fund strip to bring another group into view. Slide across the plot to read the selected fund above your finger."
              : "The mesh connects adjacent ridges."}{" "}
            The marker identifies the selected fund’s peak in the window. Use arrow keys to inspect a fund and
            date.
          </p>
          <p>
            Range position locates the selected close between the lowest low and highest high in the visible
            window. Volume uses that fund’s reported shares.
          </p>
          <p>
            {surface.ridges.length} plotted of {sectors.length} returned funds ·{" "}
            {surface.dates[0] ?? "No sessions"} – {surface.dates.at(-1) ?? "No sessions"}
            {data.failed ? " · Some history requests failed" : ""}
          </p>
        </details>
      </Card>
      {movers}
      <InstrumentFold
        compact={phone}
        id="sector-etf-heatmap"
        title="Sector instruments"
        caption="Equity breadth, range position and ETF performance"
      >
        <div className="metric-column">
          <Breadth
            heatmap={heatmap}
            loading={stockLoading}
            company={company}
            sector={sector}
            onCompany={onCompany}
          />
          <RangeMeter ridge={ridge} period={period} loading={awaiting} />
        </div>
        <InstrumentFold
          compact={compact && !phone}
          id="sector-etf-heatmap"
          title="Sector ETF performance"
          caption="Cached session changes"
        >
          <Card className="sector-panel" id="sector-etf-heatmap">
            <div className="eyebrow">
              <ChartBarHorizontal size={14} /> Relative performance
            </div>
            {!sectors.length && (loading || failed) ? (
              <>
                <h2>Sector ETF performance</h2>
                {loading ? (
                  <Skeleton label="Loading sector cache" />
                ) : (
                  <EmptyState message="Sector quotes unavailable" />
                )}
              </>
            ) : (
              <SectorPerformanceGrid
                sectors={sectors}
                selected={ridge?.sector}
                onInspect={onSector}
                onSelect={(symbol) => onPin(sectors.find((s) => s.symbol === symbol)?.sector ?? null)}
              />
            )}
            <div className="sector-caption">
              <ChartLine size={13} />
              <span>Session change · cached ETF quotes</span>
            </div>
          </Card>
        </InstrumentFold>
      </InstrumentFold>
    </div>
  );
}
