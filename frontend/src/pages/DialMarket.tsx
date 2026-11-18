import { keys } from "../night/api";
import "../night/looks/dial/fonts/fonts.css";
import "../foundation.css";
import "./market/compact.css";
import { lazy, Suspense, memo, type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMarketHeatmap,
  fetchMarketNews,
  fetchMarketOverview,
  fetchMarketResearch,
  fetchMarketTrending,
} from "../api/market";
import { fetchDailyHistory, type HistoryRange } from "../api/history";
import { HISTORY_ADJUSTMENT, historyProviderName } from "../config/history";
import { useAuth } from "../context/useAuth";

import { useMarketSelection } from "../night/looks/marketSelection";
import { IndexComparisonChart } from "../components/IndexComparisonChart";
import { useAdjustedProvider } from "../components/market/useAdjustedProvider";
import { DialField } from "./market/DialField";
import { SectorPerformanceGrid } from "./market/DialSectors";
import { MarketSearch } from "../components/MarketSearch";
import { PULSE_RANGES, type PulseChartRange } from "../components/indexComparisonData";
import { Sparkline } from "./market/DialSparkline";

import type {
  MarketHeatmapItemResponse,
  MarketMoverResponse,
  MarketResearchResponse,
  MarketSectorResponse,
} from "../types/schemas";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
  formatUtcDateTime,
} from "../utils/format";
import {
  captureRects,
  directionOf,
  focusHandlers,
  playFlip,
  sectorKey,
  useDraw,
  useInView,
  setFocus,
  useVisibleFocusSymbol,
  useCompactWall,
  type FlipRects,
  type Vars,
} from "../ui/lib";
import { Reveal } from "../ui/motion";
import {
  Button,
  ButtonLink,
  Delta,
  EmptyNote,
  Panel,
  PanelBody,
  PanelHead,
  Pill,
  Segmented,
  Skeleton,
  Stat,
} from "../ui/primitives";
import { WallDock, QuoteStrip, HeatPager, ToolFold } from "./market/CompactWall";
import { BottomSheet } from "./market/TouchControls";
import { QuoteMovers } from "./market/QuoteMovers";
import { onSession, pointAtSession } from "./market/sessionCursor";
import { FilingFigures } from "./market/FilingFigures";
import { Breadth } from "./market/Breadth";
import { useWallOpening } from "./market/useWallOpening";
import { SessionDial } from "./market/SessionDial";
import { MarketFooter, MarketHeader } from "./market/Shell";
import { sectorRank } from "./market/sectors";

const DailyHistory = lazy(() => import("../components/DailyHistory").then(m => ({default:m.DailyHistory})));
const Watchlists = lazy(() => import("../components/Watchlists").then(m => ({default:m.Watchlists})));

type HeatmapScale = "compact" | "standard" | "expanded";
type HeatmapView = "stocks" | "sectors";
type SparkRange = PulseChartRange;

const heatmapScales: HeatmapScale[] = ["compact", "standard", "expanded"];
const heatmapViews: Array<{ value: HeatmapView; label: string }> = [
  { value: "stocks", label: "Stocks" },
  { value: "sectors", label: "Sectors" },
];
const researchRanges: SparkRange[] = ["1m", "3m", "6m", "1y"];
const sparkRangeLabels: Record<SparkRange, string> = {
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
  "2y": "2Y",
};

/* In page order; the header, the drawer and the scroll spy all read this list. */
const pageSections = [
  { id: "market-pulse", label: "Market pulse" },
  { id: "sector-etf-heatmap", label: "Sector ETF performance" },
  { id: "stock-heatmap", label: "Stock heatmap" },
  { id: "company-research", label: "Company research" },
  { id: "trending-movers", label: "Trending movers" },
  { id: "market-news", label: "Market news" },
  { id: "daily-price-history-title", label: "Daily history chart" },
] as const;

const stockSizeRank: Record<MarketHeatmapItemResponse["size"], number> = {
  mega: 0,
  large: 1,
  medium: 2,
  small: 3,
  micro: 4,
};
const stockSizeCells: Record<MarketHeatmapItemResponse["size"], number> = {
  mega: 4,
  large: 2,
  medium: 1,
  small: 1,
  micro: 1,
};

type HeatGroup = {
  sector: string;
  stocks: MarketHeatmapItemResponse[];
  /** Position of the group's first tile in the settle order. */
  start: number;
  columns: number;
};

function groupStockHeatmap(stocks: MarketHeatmapItemResponse[]): HeatGroup[] {
  const sortedStocks = [...stocks].sort((a, b) => {
    const sectorDelta = sectorRank(a.sector) - sectorRank(b.sector);
    if (sectorDelta !== 0) {
      return sectorDelta;
    }
    const sizeDelta = stockSizeRank[a.size] - stockSizeRank[b.size];
    if (sizeDelta !== 0) {
      return sizeDelta;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const bySector = new Map<string, MarketHeatmapItemResponse[]>();
  for (const stock of sortedStocks) {
    bySector.set(stock.sector, [...(bySector.get(stock.sector) ?? []), stock]);
  }

  const groups: HeatGroup[] = [];
  let start = 0;
  for (const [sector, members] of bySector) {
    groups.push({ sector, stocks: members, start, columns: groupColumns(members) });
    start += members.length;
  }
  return groups;
}

/** Columns of a sector block: wide enough to read as a block, even when it holds wide tiles. */
function groupColumns(stocks: readonly MarketHeatmapItemResponse[]) {
  const cells = stocks.reduce((sum, stock) => sum + stockSizeCells[stock.size], 0);
  const wide = stocks.some((stock) => stock.size === "mega" || stock.size === "large");
  const columns = Math.min(8, Math.max(wide ? 2 : 1, Math.ceil(Math.sqrt(cells * 1.7))));
  return wide && columns % 2 === 1 ? columns + 1 : columns;
}

function endOfDayCaption(show: boolean, asOf?: string | null): string | null {
  if (!show || !asOf) {
    return null;
  }
  return `End of day ${asOf}`;
}

function formatMarginPeriod(period: MarketResearchResponse["profit_margin_period"]): string | null {
  if (period == null) {
    return null;
  }
  const start = period.start?.trim();
  const end = period.end?.trim();
  if (!start || !end) {
    return null;
  }
  const form = period.form?.trim();
  return form ? `${form} · ${start} to ${end}` : `${start} to ${end}`;
}

function formatMarketCap(value?: number | null) {
  if (value == null) {
    return "Unavailable";
  }
  return formatCurrency(value, false);
}

function formatOptionalPercent(value?: number | null) {
  return value === null || value === undefined ? "--" : formatPercent(value * 100);
}

function formatResearchPe(value?: number | null) {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(2);
}

function sparkRangeLabel(range: HistoryRange) {
  return range in sparkRangeLabels ? sparkRangeLabels[range as SparkRange] : range.toUpperCase();
}

/** One line that says what the index proxies did, counted from the quotes the API returned. */
function sessionHeadline(changes: readonly number[], loading: boolean, compact: boolean) {
  const total = changes.length;
  if (total === 0) {
    return loading ? "Reading the market cache." : "No index quotes in the cache.";
  }
  const higher = changes.filter((change) => change > 0).length;
  const lower = changes.filter((change) => change < 0).length;
  if (total === 1) {
    return lower === 1 ? "The index proxy is lower." : higher === 1 ? "The index proxy is higher." : "The index proxy is flat.";
  }
  if (lower === total) {
    return `All ${total === 4 ? "four" : total} index proxies fell.`;
  }
  if (higher === total) {
    return `All ${total === 4 ? "four" : total} index proxies rose.`;
  }
  if (compact) return higher + lower === 0 ? "Index proxies closed flat." : `Index proxies · ${higher} up, ${lower} down.`;
  return `${higher} of ${total} index proxies higher, ${lower} lower.`;
}

function TimeframeToggle<T extends SparkRange>({
  label,
  onChange,
  ranges,
  value,
}: {
  label: string;
  onChange: (range: T) => void;
  ranges: readonly T[];
  value: T;
}) {
  return (
    <Segmented
      label={label}
      onChange={onChange}
      options={ranges.map((range) => ({
        value: range,
        label: sparkRangeLabels[range],
        ariaLabel: `${label} ${sparkRangeLabels[range]}`,
      }))}
      value={value}
    />
  );
}

function SymbolSparkline({
  className,
  empty = "hidden",
  detailed = false,
  range,
  symbol,
}: {
  className?: string;
  empty?: "hidden" | "dash";
  detailed?: boolean;
  range: HistoryRange;
  symbol: string;
}) {
  const { provider } = useAdjustedProvider();
  const [readDate, setReadDate] = useState<string | null>(null);
  useEffect(() => detailed ? onSession(({ date }) => setReadDate(date)) : undefined, [detailed]);
  const [sparkRef, sparkSeen] = useInView<HTMLDivElement>();
  const historyQuery = useQuery({
    queryKey: keys.history(symbol, provider ?? "auto", HISTORY_ADJUSTMENT, range),
    queryFn: () => fetchDailyHistory(symbol, provider, HISTORY_ADJUSTMENT, range),
    enabled: Boolean(provider) && sparkSeen && symbol.trim().length > 0,
    placeholderData: (previous) => previous?.symbol === symbol && previous.provider === provider && previous.adjustment_type === HISTORY_ADJUSTMENT ? previous : undefined,
    retry: false,
    staleTime: 300000,
  });
  const bars = historyQuery.data && historyQuery.data.status !== "unavailable"
    ? [...historyQuery.data.bars].filter(bar => Number.isFinite(Number(bar.close)) && Number(bar.close) > 0)
      .sort((a,b) => a.session_date.localeCompare(b.session_date)) : [];
  const closes = bars.map(bar => Number(bar.close));
  const read = readDate ? bars.findIndex(bar => bar.session_date === readDate) : -1;
  if (!sparkSeen) return <div ref={sparkRef} className={className} />;
  if (closes.length >= 2) {
    const line = (
      <Sparkline
        className={className}
        label={`${symbol} closing prices over ${sparkRangeLabel(historyQuery.data?.range ?? range)}`}
        filled={detailed}
        values={closes}
      />
    );
    return detailed ? <div className="research-history" onPointerLeave={() => pointAtSession(null, "research")}
      onPointerMove={event => {
        const box = event.currentTarget.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, ((event.clientX-box.left)/box.width - .025)/.95));
        pointAtSession(bars[Math.round(fraction * (bars.length-1))].session_date, "research");
      }}>
      <p className="note">{read < 0 ? "Stored close" : bars[read].session_date + " close"} <strong className="num">{formatCurrency(closes[read < 0 ? closes.length - 1 : read])}</strong></p>
      <div className="relative">{line}{read >= 0 && <i className="research-cursor" style={{left: (2.5 + 95 * read / (bars.length - 1)) + "%"}} />}</div>
      <p className="history-axis num"><span>{historyQuery.data?.available_start}</span><span>{historyQuery.data?.available_end}</span></p>
    </div> : line;
  }
  if (detailed) return <p className="note">{historyQuery.isPending ? "Loading stored closes" : "Stored closes unavailable"}</p>;

  if (empty === "dash" && (historyQuery.isError || historyQuery.isSuccess)) {
    return (
      <span aria-label={`No closing prices for ${symbol}`} className="num text-[12px] text-fg-4">
        —
      </span>
    );
  }

  return null;
}

function staleOrChange(stock: MarketHeatmapItemResponse) {
  return stock.data_status === "stale" ? "Stale" : formatSignedPercent(stock.change_percent);
}

function magnitudeStep(changePercent: number) {
  const magnitude = Math.abs(changePercent);
  return magnitude >= 3 ? 3 : magnitude >= 1.5 ? 2 : magnitude >= 0.5 ? 1 : 0;
}

/**
 * A tile links to the detail page only when the API says that page can read the symbol.
 * The heatmap holds any cached stock, and the detail quote covers a smaller set.
 */
const HeatTile = memo(function HeatTile({ stock, order, compact }: { compact: boolean; stock: MarketHeatmapItemResponse; order: number }) {
  const stale = stock.data_status === "stale";
  const change = staleOrChange(stock);
  const shared = {
    className: "hm-t x-sym",
    "data-dir": stale ? "stale" : directionOf(stock.change_percent),
    "data-flip": stock.symbol,
    "data-mag": stale ? 0 : magnitudeStep(stock.change_percent),
    "data-size": stock.size,
    "data-sym": stock.symbol,
    style: { "--i": order } as Vars,
    title: `${stock.company} ${change}${stock.data_status ? ` / ${stock.data_status} / ${stock.source}` : " / reference data"}${stock.price_basis === "end_of_day_previous_close" ? " / end-of-day previous close, not real-time" : ""}`,
  };
  const body = (
    <>
      <span className="hm-sym">{stock.symbol}</span>
      <span className="hm-chg">{change}</span>
    </>
  );

  if (compact) {
    return <button {...shared} type="button" aria-label={shared.title} onClick={() => setFocus({symbol:stock.symbol, sector:stock.sector})}>{body}</button>;
  }
  if (stock.detail_available === true) {
    return (
      <Link
        {...shared}
        aria-label={`${stock.symbol}, ${stock.company}, ${change}`}
        to={`/market/${encodeURIComponent(stock.symbol)}`}
      >
        {body}
      </Link>
    );
  }

  return <div {...shared}>{body}</div>;
});

/** The read-out strip of the tile matrix: what the pointer or the keyboard is on. */
function HeatReadout({ stocks, compact }: { compact: boolean; stocks: readonly MarketHeatmapItemResponse[] }) {
  const readout = useRef<HTMLDivElement>(null);
  const symbol = useVisibleFocusSymbol(readout);
  const stock = symbol ? stocks.find((item) => item.symbol === symbol) : undefined;

  return (
    <div aria-hidden={compact ? undefined : true} className="hm-readout" ref={readout}>
      {stock ? (
        <>
          {compact && stock.detail_available ? <Link className="tile-link" to={`/market/${encodeURIComponent(stock.symbol)}`}>{stock.symbol} ↗</Link> : <span className="pill pill-solid">{stock.symbol}</span>}
          <span className="min-w-0 truncate text-[12px] text-fg-2">{stock.company}</span>
          <span className="num text-[12px] text-fg">
            {stock.price > 0 ? formatCurrency(stock.price) : "No price"}
          </span>
          <span className="num flex items-baseline gap-1 text-[12px] font-semibold text-fg">
            {staleOrChange(stock)}
            {stock.data_status === "stale" ? null : <Delta dir={directionOf(stock.change_percent)} />}
          </span>
          <span className="lbl truncate">
            {stock.data_status} / {stock.source}
            {compact && stock.price_basis === "end_of_day_previous_close" ? " / End of day" : ""}
            {stock.as_of ? ` / as of ${formatUtcDateTime(stock.as_of) ?? stock.as_of}` : ""}
          </span>
        </>
      ) : (
        <span className="lbl text-fg-4">{compact ? "Tap a tile for price, source and freshness" : "Point at a tile for price, source and freshness"}</span>
      )}
    </div>
  );
}

function SectorProxyTiles({ sectors }: { sectors: MarketSectorResponse[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" {...focusHandlers}>
      {sectors.map((sector) => (
        <div
          className="sec-tile x-sec x-seclit"
          data-flip={sectorKey(sector.sector)}
          data-dir={directionOf(sector.change_percent)}
          data-mag={magnitudeStep(sector.change_percent)}
          data-sector={sectorKey(sector.sector)}
          key={sector.symbol}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold leading-4 text-fg">{sector.sector}</div>
              <div className="num text-[10px] text-fg-3">{sector.symbol}</div>
            </div>
            <div className="num flex items-baseline gap-1 whitespace-nowrap text-[13px] font-semibold text-fg">
              <span>
                {sector.change_percent >= 0 ? "UP" : "DOWN"}{" "}
                {formatSignedPercent(sector.change_percent)}
              </span>
              <Delta dir={directionOf(sector.change_percent)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {sector.leaders.map((symbol) => (
              <span className="pill x-sym" data-sym={symbol} key={symbol}>
                {symbol}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MoverRow({ mover, sector }: { mover: MarketMoverResponse; sector?: string }) {
  return (
    <tr className="x-sym x-sec" data-sym={mover.symbol} data-sector={sector ? sectorKey(sector) : undefined} {...focusHandlers}>
      <td className="num font-semibold text-fg">
        {mover.detail_available === true ? (
          <Link
            className="inline-flex min-h-7 items-center underline-offset-4 hover:underline"
            to={`/market/${encodeURIComponent(mover.symbol)}`}
          >
            {mover.symbol}
          </Link>
        ) : (
          // Provider movers can be symbols the detail page cannot read.
          mover.symbol
        )}
      </td>
      <td className="num text-right">
        {mover.price != null && mover.price > 0 ? formatCurrency(mover.price) : "Unavailable"}
      </td>
      <td className={mover.change_percent == null ? "num text-right text-fg-4" : "num text-right text-fg"}>
        {mover.change_percent == null ? "Unavailable" : formatSignedPercent(mover.change_percent)}
      </td>
      <td className="num text-right">
        {mover.volume == null ? "Unavailable" : formatQuantity(mover.volume)}
      </td>
      <td className="w-24 text-right">
        <SymbolSparkline className="ml-auto h-6 w-20" empty="dash" range="1m" symbol={mover.symbol} />
      </td>
    </tr>
  );
}

export function DialMarket() {
  const { isAuthenticated } = useAuth();
  const { provider, pending } = useAdjustedProvider();
  const sourceLabel = provider ? historyProviderName(provider) : pending ? "Loading" : "Unavailable";
  const selection = useMarketSelection();
  const {cursor} = selection;
  useEffect(() => {
    const stop = cursor.subscribe(date => pointAtSession(date, "pulse"));
    const detach = onSession(({date}) => cursor.set(date));
    return () => { stop(); detach(); };
  }, [cursor]);
  const wall = useWallOpening();
  const compact = useCompactWall();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [allMovers, setAllMovers] = useState(false);
  const [allNews, setAllNews] = useState(false);
  const [historyArea, historySeen] = useInView<HTMLDivElement>("250px");
  const [watchArea, watchSeen] = useInView<HTMLDivElement>("250px");
  const [lowerWall, lowerSeen] = useInView<HTMLDivElement>("180px 0px");
  const [symbolInput, setSymbolInput] = selection.symbolInput;
  const [researchSymbol, setResearchSymbol] = selection.researchSymbol;
  const [historyDraft, setHistoryDraft] = selection.historyDraft;
  const [heatmapScale, setHeatmapScale] = useState<HeatmapScale>("standard");
  const [heatmapView, setHeatmapView] = useState<HeatmapView>("stocks");
  const [proxySymbol, setProxySymbol] = selection.proxy;
  const [sharedRange, setPulseRange] = selection.range;
  const pulseRange = sharedRange && sharedRange !== "session" ? sharedRange : "1m";
  const [researchRange, setResearchRange] = useState<SparkRange>("1m");
  const heatRegion = useRef<HTMLDivElement | null>(null);
  const [visitedSectors, setVisitedSectors] = useState(false);
  const flipSelector = useRef(".hm-t");
  const flipFrom = useRef<FlipRects>(new Map());

  const marketQuery = useQuery({
    queryKey: ["market", "overview"],
    queryFn: fetchMarketOverview,
    refetchInterval: 300000,
    retry: false,
  });
  const trendingQuery = useQuery({
    queryKey: ["market", "trending"],
    queryFn: fetchMarketTrending,
    enabled: lowerSeen,
    refetchInterval: 300000,
    retry: false,
  });
  const heatmapQuery = useQuery({
    queryKey: ["market", "heatmap"],
    queryFn: fetchMarketHeatmap,
    refetchInterval: 300000,
    retry: false,
  });
  const researchQuery = useQuery({
    queryKey: ["market", "research", researchSymbol],
    queryFn: () => fetchMarketResearch(researchSymbol),
    enabled: lowerSeen,
    retry: false,
  });
  const newsQuery = useQuery({
    queryKey: ["market", "news"],
    queryFn: fetchMarketNews,
    enabled: lowerSeen,
    refetchInterval: 300000,
    retry: false,
  });

  const trends = useMemo(() => (marketQuery.data?.trends ?? []).slice(0, 4), [marketQuery.data?.trends]);
  const sectors = marketQuery.data?.sectors ?? [];
  const movers = trendingQuery.data?.most_active ?? [];
  const research: MarketResearchResponse = researchQuery.data ?? { symbol: researchSymbol, errors: [] };
  const researchLoading = researchQuery.isLoading;
  const marginPeriod = research.profit_margin != null
    ? formatMarginPeriod(research.profit_margin_period)
    : null;
  const priceAsOf = research.price_basis === "end_of_day_previous_close" ? research.price_as_of : null;
  const priceCaption = endOfDayCaption(research.price != null && research.price > 0, priceAsOf);
  const marketCapCaption = endOfDayCaption(
    research.market_cap != null && research.market_cap_basis === "end_of_day_price_times_shares",
    research.price_as_of,
  );
  const peCaption = endOfDayCaption(
    research.pe_ratio != null
      && research.pe_basis === "sec_ttm_diluted_eps"
      && research.price_basis === "end_of_day_previous_close",
    research.price_as_of,
  );
  const hasResearchInputs = (research.pe_ratio != null && research.pe_ratio > 0)
    || research.profit_margin != null || research.beta != null
    || (research.analyst_target_price != null && research.analyst_target_price > 0 && research.price != null && research.price > 0);
  const researchRiskLabel = hasResearchInputs ? research.research_risk_label : null;
  const researchRiskScore = hasResearchInputs ? research.research_risk_score : null;
  const heatmapItems = heatmapQuery.data?.items ?? [];
  const cachedResearch = heatmapItems.find(item => item.symbol === research.symbol && item.price > 0 && item.data_status !== "stale");
  const researchPrice = research.price != null && research.price > 0 ? research.price : cachedResearch?.price;
  const stats = [
    { label: "Price", value: researchPrice == null ? null : formatCurrency(researchPrice),
      caption: researchPrice !== research.price && cachedResearch
        ? [cachedResearch.data_status, cachedResearch.source, cachedResearch.as_of?.slice(0,10),
            cachedResearch.price_basis === "end_of_day_previous_close" && "End of day"].filter(Boolean).join(" · ") : priceCaption },
    { label: "Market cap", value: research.market_cap == null ? null : formatMarketCap(research.market_cap), caption: marketCapCaption },
    { label: "P/E", value: research.pe_ratio == null ? null : formatResearchPe(research.pe_ratio), caption: peCaption },
    { label: "Margin", value: research.profit_margin == null ? null : formatOptionalPercent(research.profit_margin), caption: marginPeriod },
  ];
  const missingStats = stats.filter(stat => stat.value == null).map(stat => stat.label);
  const stockHeatmapGroups = useMemo(() => groupStockHeatmap(heatmapQuery.data?.items ?? []), [heatmapQuery.data?.items]);
  const cachedHeatmapCount = heatmapItems.length;
  const statusCounts = Object.entries(heatmapQuery.data?.status_counts ?? {}).filter(([, count]) => Number(count) > 0);
  // A failed background refetch sets isError while keeping the last successful
  // data. Count those proxies first so the header matches the tiles.
  const sectorStatusLabel = sectors.length > 0
    ? `${sectors.length} returned ${sectors.length === 1 ? "sector proxy" : "sector proxies"}`
    : marketQuery.isLoading
      ? "Loading sector cache"
      : "Sector quotes unavailable";
  const heatmapHeader = heatmapView === "sectors"
    ? {
        label: sectorStatusLabel,
        loading: marketQuery.isLoading && sectors.length === 0,
      }
    : {
        label: heatmapQuery.isLoading
          ? "Loading cache"
          : cachedHeatmapCount > 0
            ? `${cachedHeatmapCount} returned ${cachedHeatmapCount === 1 ? "quote" : "quotes"}`
            : "No cached quotes",
        loading: heatmapQuery.isLoading,
      };
  const latestQuoteAt = marketQuery.data?.as_of;
  const articles = newsQuery.data?.articles ?? [];
  const leadTrend = trends.find((trend) => trend.source_symbol === proxySymbol);
  const heatDraw = useDraw<HTMLDivElement>(heatmapView === "stocks" && cachedHeatmapCount > 0, 1500);

  /* A size change glides every tile from its old box to its new one. */
  useLayoutEffect(() => {
    playFlip(heatRegion.current, flipSelector.current, flipFrom.current);
    flipFrom.current = new Map();
  }, [heatmapScale, heatmapView]);

  function changeHeatmapScale(scale: HeatmapScale) {
    if (scale === heatmapScale) {
      return;
    }
    flipSelector.current = ".hm-t";
    flipFrom.current = captureRects(heatRegion.current, flipSelector.current);
    setHeatmapScale(scale);
  }

  function changeHeatmapView(view: HeatmapView) {
    if (view === heatmapView) {
      return;
    }
    flipSelector.current = ".hm-g, .sec-tile";
    flipFrom.current = captureRects(heatRegion.current, flipSelector.current);
    if (view === "sectors") setVisitedSectors(true);
    setHeatmapView(view);
  }

  function handleResearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSymbol = symbolInput.trim().toUpperCase();
    if (nextSymbol) {
      setResearchSymbol(nextSymbol);
    }
  }

  function focusField(id: string) {
    const field = document.getElementById(id);
    if (!(field instanceof HTMLElement)) {
      return;
    }
    const fold = field.closest("details");
    if (fold) fold.open = true;
    field.focus();
    field.scrollIntoView({ block: "center" });
  }

  function sendToResearch(symbol: string) {
    setSymbolInput(symbol);
    focusField("research-symbol");
  }

  function sendToChart(symbol: string) {
    setHistoryDraft(symbol);
    focusField("daily-history-symbol");
  }

  const heatGroups = stockHeatmapGroups.map((group) => (
    <section
      className="hm-g x-sec x-seclit"
      data-flip={sectorKey(group.sector)}
      data-sector={sectorKey(group.sector)}
      key={group.sector}
      style={{ "--cols": group.columns } as Vars}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="lbl truncate">{group.sector}</span>
        <span className="lbl text-fg-4">{group.stocks.length}</span>
      </div>
      <div className="hm-tiles">
        {group.stocks.map((stock, position) => (
          <HeatTile compact={compact} key={stock.symbol} order={group.start + position} stock={stock} />
        ))}
      </div>
    </section>
  ));

  const heatControls = <>
    <Segmented label="Heatmap view" onChange={changeHeatmapView} options={heatmapViews} value={heatmapView} />
    {heatmapView === "stocks" && <>
      {compact && <p className="lbl">Tile size</p>}
      <Segmented label="Heatmap size" onChange={changeHeatmapScale} value={heatmapScale}
        options={heatmapScales.map(scale => ({value:scale, label:scale, ariaLabel:`Set heatmap size to ${scale}`}))} />
    </>}
  </>;

  return (
    <main className="wall" id="main" ref={wall}>
      <a className="skip-link" href="#market-pulse">Skip to the market pulse</a>
      <MarketHeader
        authenticated={isAuthenticated}
        chip={leadTrend ? `${leadTrend.source_symbol} ${formatSignedPercent(leadTrend.change_percent)}` : null}
        sections={pageSections}
      />

      <div className="wall-content mx-auto max-w-[1480px] px-4 pb-4 pt-3 sm:px-6">
        {/* Command strip: what the page is, what the session did, and the way in. */}
        <Reveal
          aria-labelledby="market-title"
          as="section"
          className="command"
        >
          <div className="min-w-0">
            <div className="session-kicker">
              <h1 id="market-title">Market dashboard</h1>
              {latestQuoteAt && <time dateTime={latestQuoteAt}>{new Date(latestQuoteAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time>}
            </div>
            <p className="session-headline">
              {sessionHeadline(trends.map((trend) => trend.change_percent), marketQuery.isLoading, compact)}
            </p>
            {compact ? <div className="compact-honesty">Delayed / cached <i /> ETF proxies <i /> EOD · {sourceLabel}</div> : <div className="honesty">
              <Pill dot>Delayed or cached quotes</Pill>
              <Pill>Index figures are ETF proxies</Pill>
              <Pill>End-of-day history / {sourceLabel}</Pill>
            </div>}
          </div>
          {!compact && <MarketSearch />}
        </Reveal>

        {compact && <QuoteStrip trends={trends} selected={proxySymbol} choose={setProxySymbol} />}

        {/* First screen: the session dial and breadth on the left, the pulse and sectors on the right. */}
        <div className="instrument grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="contents lg:grid lg:content-start lg:gap-3">
            <Reveal as={Panel} className="dial-panel order-2 lg:order-none" delay={80}>
              <PanelHead title="Session dial" titleId="session-dial">
                <Pill>{heatmapQuery.isLoading ? "Loading cache" : `${cachedHeatmapCount} cached stocks`}</Pill>
              </PanelHead>
              <PanelBody>
                <SessionDial trends={trends} sectors={sectors} index={leadTrend} items={heatmapItems} loading={heatmapQuery.isLoading} />
                <p className="dial-key note"><span><i className="solid-key" /> Gains out</span><span><i className="hollow-key" /> Losses in</span><span>Square-root scale · cap ±6% · width by illustrative size</span></p>
              </PanelBody>
            </Reveal>
            <Reveal as={Panel} className="breadth-panel order-4 lg:order-none" delay={260}>
              <PanelHead sub="How the cached stocks spread around zero today." title="Breadth" titleId="breadth-title" />
              <PanelBody>
                <Breadth items={heatmapItems} loading={heatmapQuery.isLoading} />
              </PanelBody>
            </Reveal>
          </div>

          <div className="contents lg:grid lg:content-start lg:gap-3">
            <Reveal as={Panel} className="pulse-panel order-1 lg:order-none" delay={160}>
              <PanelHead
                title="Market pulse"
                titleId="market-pulse"
              >
                <Pill tone={marketQuery.isLoading || trends.length ? "plain" : "quiet"}>
                  {marketQuery.isLoading ? "Loading" : trends.length ? "Cached snapshot" : "Unavailable"}
                </Pill>
              </PanelHead>
              <PanelBody className="grid gap-2">
                {provider ? <IndexComparisonChart variant="dial" provider={provider}
                  compact={compact} selectedSymbol={proxySymbol} onSelect={setProxySymbol}
                  quotes={trends.map((trend) => ({
                    symbol: trend.source_symbol,
                    value: trend.value,
                    changePercent: trend.change_percent,
                  }))}
                  range={pulseRange}
                  rangeControl={(
                    <TimeframeToggle
                      label="Market pulse range"
                      onChange={setPulseRange}
                      ranges={PULSE_RANGES}
                      value={pulseRange}
                    />
                  )}
                /> : <p className="note">{pending ? "Reading stored series…" : "Split-adjusted history unavailable."}</p>}
                {marketQuery.data?.data_notice ? <p className="note">{marketQuery.data.data_notice}</p> : null}
                {trends.length === 0 ? (
                  <EmptyNote
                    detail="Index quotes will appear when the market cache has data."
                    message={marketQuery.isLoading ? "Loading quote cache" : "Market quotes unavailable"}
                  />
                ) : (
                  <p className="quote-note note">
                    <b>Quote</b> {latestQuoteAt && Number.isFinite(Date.parse(latestQuoteAt)) ? new Date(latestQuoteAt).toUTCString() : "unavailable"}. Individual quotes may be older.
                  </p>
                )}
              </PanelBody>
            </Reveal>

            <Reveal as={Panel} className="order-3 lg:order-none" delay={320} id="sector-etf-heatmap">
              {sectors.length === 0 && (marketQuery.isLoading || marketQuery.isError) ? (
                <>
                  <PanelHead title="Sector ETF performance" />
                  <PanelBody className="grid gap-2">
                    {marketQuery.isLoading
                      ? [78, 64, 70, 52, 60].map((width) => <Skeleton className="h-3" key={width} style={{ width: `${width}%` }} />)
                      : null}
                    <EmptyNote message={marketQuery.isLoading ? "Loading sector cache" : "Sector quotes unavailable"} />
                  </PanelBody>
                </>
              ) : (
                <SectorPerformanceGrid sectors={[...sectors].sort((a,b) => b.change_percent - a.change_percent)} />
              )}
            </Reveal>
          </div>
        </div>

        {/* Second screen: the tile matrix and research, with movers, news and watchlists beside them. */}
        <div className="lower-wall mt-3 grid gap-3 lg:grid-cols-12" ref={compact ? undefined : lowerWall}>
          <div className="grid min-w-0 content-start gap-3 lg:col-span-8">
            <Reveal as={Panel} className="heat-panel">
              <PanelHead
                sub="Cached stocks grouped by sector with illustrative tile sizes."
                title="Stock heatmap"
                titleId="stock-heatmap"
              >
                <span aria-busy={heatmapHeader.loading} className="pill" role="status">
                  {heatmapHeader.label}
                </span>
                {compact ? <button className="btn heat-filters" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">Filters</button> : heatControls}
                {compact && filtersOpen && <BottomSheet title="Heat map filters" close={() => setFiltersOpen(false)}>
                  <p className="lbl">View</p>{heatControls}
                  <button className="sheet-done" onClick={() => setFiltersOpen(false)}>Done</button>
                </BottomSheet>}
              </PanelHead>
              <div aria-labelledby="stock-heatmap" className="panel-body relative" ref={heatRegion} role="region">
                {visitedSectors && (
                  <div hidden={heatmapView !== "sectors"}>
                    <p className="note mb-3">
                      Sector ETF proxies from the market cache. No separate sector history is available.
                    </p>
                    {sectors.length === 0 ? (
                      <EmptyNote message={sectorStatusLabel} />
                    ) : (
                      <SectorProxyTiles sectors={sectors} />
                    )}
                  </div>
                )}
                  <div hidden={heatmapView !== "stocks"}>
                    {cachedHeatmapCount === 0 ? (
                      <div className="grid gap-3">
                        {heatmapQuery.isLoading ? (
                          <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-[2px]">
                            {Array.from({ length: 42 }, (_, cell) => <Skeleton className="h-10" key={cell} />)}
                          </div>
                        ) : null}
                        <EmptyNote
                          detail="Only returned cached quotes are shown. Missing symbols are not filled with reference prices."
                          message={heatmapQuery.isLoading ? "Loading stock cache" : "Stock heatmap unavailable"}
                        />
                      </div>
                    ) : (
                      <HeatReadout compact={compact} stocks={heatmapItems} />
                    )}
                    <div className="hm" data-scale={heatmapScale} ref={heatDraw} {...focusHandlers}>
                      {compact ? <HeatPager names={stockHeatmapGroups.map(g => g.sector)} pages={heatGroups} /> : heatGroups}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3">
                      <span className="lbl">Shade scale</span>
                      <span className="lbl inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="hm-key" data-dir="down" data-mag="3" />
                        Down 3%+
                      </span>
                      <span className="lbl inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="hm-key" data-dir="flat" data-mag="0" />
                        Flat
                      </span>
                      <span className="lbl inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="hm-key" data-dir="up" data-mag="3" />
                        Up 3%+
                      </span>
                      {statusCounts.map(([status, count]) => (
                        <Pill key={status}>{count} {status}</Pill>
                      ))}
                      <span className="note sm:ml-auto">
                        {cachedHeatmapCount > 0
                          ? (heatmapQuery.data?.data_notice && /end of day/i.test(heatmapQuery.data.data_notice)
                            ? heatmapQuery.data.data_notice
                            : compact ? "Delayed/cached quotes. Tap a tile for source status." : "Delayed/cached quotes. Hover a tile for source status.")
                          : "No cached quotes are available."}
                      </span>
                    </div>
                  </div>
              </div>
            </Reveal>

            <ToolFold compact={compact} title="Company research"><Reveal as={Panel} className="research-fold">
              <PanelHead
                sub="Public company overview and research-risk snapshot."
                title="Company research"
                titleId="company-research"
              />
              <PanelBody className="grid gap-4">
                <form className="flex min-w-0 max-w-md gap-2" onSubmit={handleResearchSubmit}>
                  <label className="sr-only" htmlFor="research-symbol">
                    Research symbol
                  </label>
                  <input
                    autoComplete="off"
                    className="field min-w-0 flex-1 uppercase"
                    id="research-symbol"
                    onChange={(event) => setSymbolInput(event.target.value)}
                    placeholder="NVDA"
                    spellCheck={false}
                    value={symbolInput}
                  />
                  <Button type="submit" variant="solid">
                    Research
                  </Button>
                </form>

                <div className="grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                  <div className="grid min-w-0 content-start gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="research-id x-sym x-sec" data-sym={research.symbol} data-sector={sectorKey(research.sector ?? cachedResearch?.sector)} {...focusHandlers}>
                        <div className="fig fig-lg">{research.symbol}</div>
                        <div className="mt-1 text-[13px] text-fg-2">
                          {researchLoading ? <Skeleton className="h-4 w-40" /> : research.name ?? "Company overview unavailable"}
                        </div>
                        <div className="lbl mt-1">
                          {[research.exchange ?? cachedResearch?.exchange, research.sector ?? cachedResearch?.sector].filter(Boolean).join(" / ")}
                        </div>
                      </div>
                      {research.detail_available === true ? (
                        <ButtonLink size="sm" to={`/market/${encodeURIComponent(research.symbol)}`}>
                          View {research.symbol}
                        </ButtonLink>
                      ) : null}
                    </div>
                    <div className="grid gap-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="lbl">Research risk</span>
                        <Pill tone={researchRiskLabel && researchRiskScore != null ? "plain" : "quiet"}>
                          {researchRiskLabel && researchRiskScore != null
                            ? `${researchRiskLabel} / ${researchRiskScore}`
                            : "Research assessment unavailable"}
                        </Pill>
                      </div>
                      {researchRiskScore != null && <div aria-hidden="true" className="gauge">
                        {Array.from({ length: 25 }, (_, step) => (
                          <i data-on={researchRiskScore != null && researchRiskScore > step * 4 ? "true" : undefined} key={step} />
                        ))}
                      </div>}
                    </div>
                    <div className="grid gap-1.5">
                      <div className="lbl">Risk notes</div>
                      {(research.risk_factors?.length
                        ? research.risk_factors
                        : ["Research factors unavailable"]).map((factor) => (
                        <div className="border-l border-rule-2 pl-2 text-[12px] leading-[17px] text-fg-2" key={factor}>
                          {factor}
                        </div>
                      ))}
                    </div>
                    <FilingFigures data={research.fundamentals} />
                    {research.description && <p className="note">{research.description}</p>}
                  </div>

                  <div className="grid min-w-0 content-start gap-4">
                    <div className="research-stats">
                      {researchLoading ? <Skeleton className="h-6 w-full" /> : stats.filter(stat => stat.value != null).map(stat => (
                        <Stat key={stat.label} label={stat.label} value={stat.value} caption={stat.caption} />
                      ))}
                    </div>
                    {!researchLoading && missingStats.length > 0 && <p className="note">Unavailable · {missingStats.join(" / ")}</p>}
                    {hasResearchInputs ? (
                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="lbl">Price history</div>
                          <TimeframeToggle
                            label="Company research range"
                            onChange={setResearchRange}
                            ranges={researchRanges}
                            value={researchRange}
                          />
                        </div>
                        <SymbolSparkline className="h-20 w-full" detailed range={researchRange} symbol={research.symbol} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </PanelBody>
            </Reveal></ToolFold>
          </div>

          <div className="grid min-w-0 content-start gap-3 lg:col-span-4">
            <Reveal as={Panel} className="movers-panel">
              {compact && <div ref={lowerWall} className="load-sentinel" />}
              <PanelHead
                sub={movers.length || trendingQuery.isLoading ? "Most active tickers from the market data provider." : "Widest moves in the cached stock universe."}
                title="Trending movers"
                titleId="trending-movers"
              >
                <Pill tone={trendingQuery.isLoading || movers.length ? "plain" : "quiet"}>
                  {trendingQuery.isLoading ? "Loading" : movers.length ? "Provider response" : heatmapItems.some(item => item.data_status !== "stale") ? "Cached ranking" : "Unavailable"}
                </Pill>
              </PanelHead>
              {movers.length === 0 ? (
                <PanelBody>
                  <QuoteMovers items={heatmapItems} loading={trendingQuery.isLoading} />
                </PanelBody>
              ) : (
                <div className="overflow-x-auto px-1 pb-1">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="text-left">Symbol</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Change</th>
                        <th className="text-right">Volume</th>
                        <th className="text-right">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(compact && !allMovers ? movers.slice(0,3) : movers).map((mover) => <MoverRow key={mover.symbol} mover={mover} sector={heatmapItems.find(item => item.symbol === mover.symbol)?.sector} />)}
                    </tbody>
                  </table>
                  {compact && movers.length > 3 && <button className="more-rows" onClick={() => setAllMovers(!allMovers)} aria-expanded={allMovers}>{allMovers ? "Show less" : `All ${movers.length} movers`}</button>}
                </div>
              )}
            </Reveal>

            <Reveal as={Panel} className="news-panel">
              <PanelHead
                sub="Headlines for the major index ETFs."
                title="Market news"
                titleId="market-news"
              >
                <Pill tone={newsQuery.isLoading || articles.length ? "plain" : "quiet"}>
                  {newsQuery.isLoading ? "Loading" : articles.length ? "Cached headlines" : "Unavailable"}
                </Pill>
              </PanelHead>
              <div aria-labelledby="market-news" className="news-scroll" role="region" tabIndex={0}>
                {articles.length === 0 ? (
                  <PanelBody className="grid gap-3">
                    {newsQuery.isLoading
                      ? [92, 74, 86].map((width) => <Skeleton className="h-4" key={width} style={{ width: `${width}%` }} />)
                      : null}
                    <EmptyNote
                      message={newsQuery.isLoading
                        ? "Loading market news"
                        : newsQuery.isError ? "Market news unavailable" : "No market headlines"}
                    />
                  </PanelBody>
                ) : (
                  <ul aria-label="Market headlines" onPointerOver={e => {
                    const date = (e.target as Element).closest<HTMLElement>("[data-session]")?.dataset.session;
                    if (date) pointAtSession(date, "news");
                  }} onPointerLeave={() => pointAtSession(null, "news")}>
                    {(compact && !allNews ? articles.slice(0,2) : articles).map((article) => (
                      <li className="news-item" data-session={article.published_at.slice(0,10)} key={`${article.url}-${article.published_at}`}>
                        <span className="news-clock num" aria-hidden="true">{Number.isFinite(Date.parse(article.published_at))
                          ? new Date(article.published_at).toISOString().slice(11,16) : "—"}</span>
                        <div className="min-w-0">
                          <a className="news-link" href={article.url} rel="noopener noreferrer" target="_blank">
                            {article.headline}
                          </a>
                          {article.summary ? <p className="note mt-1 line-clamp-2">{article.summary}</p> : null}
                          <p className="lbl mt-1 flex flex-wrap gap-x-2">
                            <span>{article.source}</span>
                            <time dateTime={article.published_at}>
                              {formatUtcDateTime(article.published_at) ?? article.published_at}
                            </time>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {compact && articles.length > 2 && <button className="more-rows" aria-expanded={allNews} onClick={() => setAllNews(!allNews)}>{allNews ? "Show less" : `All ${articles.length} headlines`}</button>}
              </div>
            </Reveal>

            <Reveal className="watch-fold"><ToolFold compact={compact} title="Watchlists">
              <div ref={watchArea} style={{minHeight:44}}>{watchSeen && <Suspense fallback={<p>Loading watchlists…</p>}><Watchlists onUseInChart={sendToChart} onUseInResearch={sendToResearch} /></Suspense>}</div>
            </ToolFold></Reveal>
          </div>
        </div>

        <Reveal className="history-fold mt-3"><ToolFold compact={compact} title="Daily history">
          <div ref={historyArea} id={historySeen || historyDraft ? undefined : "daily-price-history-title"} style={{minHeight:44}}>{(historySeen || historyDraft) && <Suspense fallback={<p>Loading daily history…</p>}><DailyHistory SelectControl={compact ? DialField : undefined} catalogEnabled={lowerSeen || Boolean(historyDraft)} onValueChange={setHistoryDraft} value={historyDraft} /></Suspense>}</div>
        </ToolFold></Reveal>
      </div>

      <MarketFooter />
      {compact && <WallDock />}
    </main>
  );
}
