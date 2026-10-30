import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "@phosphor-icons/react";
import {
  fetchMarketHeatmap,
  fetchMarketOverview,
  fetchMarketResearch,
  fetchMarketTrending,
} from "../api/market";
import { useAuth } from "../context/useAuth";
import {
  fallbackResearch,
  fallbackTrending,
  marketTrends,
  sectorHeatmap,
  stockHeatmapUniverse,
  type SectorHeatmapItem,
  type StockHeatmapItem,
} from "../features/publicMarket/marketSnapshot";
import { FreshnessBadge } from "../components/FreshnessBadge";
import type {
  MarketMoverResponse,
  MarketHeatmapItemResponse,
  MarketResearchResponse,
  MarketSectorResponse,
  MarketTrendResponse,
} from "../types/schemas";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import { getRiskTone as getSharedRiskTone } from "../utils/riskTone";

type PulseTimeframe = "1D" | "1W" | "1M" | "3M" | "6M";
type HeatmapScale = "compact" | "standard" | "expanded";

const pulseTimeframes: PulseTimeframe[] = ["1D", "1W", "1M", "3M", "6M"];
const heatmapScales: HeatmapScale[] = ["compact", "standard", "expanded"];
const stockSectorOrder = [
  "Technology",
  "Communication",
  "Consumer Discretionary",
  "Consumer Staples",
  "Financials",
  "Healthcare",
  "Industrials",
  "Energy",
  "Utilities",
  "Real Estate",
  "Materials",
];
const stockSectorRank = new Map(
  stockSectorOrder.map((sector, index) => [sector, index]),
);
const stockSizeRank: Record<StockHeatmapItem["size"], number> = {
  mega: 0,
  large: 1,
  medium: 2,
  small: 3,
  micro: 4,
};

function getHeatmapTone(changePercent: number) {
  if (changePercent >= 1) {
    return "border-emerald-400/50 bg-emerald-400/20 text-emerald-100";
  }

  if (changePercent > 0) {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  }

  if (changePercent <= -1) {
    return "border-rose-400/50 bg-rose-400/20 text-rose-100";
  }

  if (changePercent < 0) {
    return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  }

  return "border-slate-700 bg-slate-900/80 text-slate-200";
}

function getHeatmapSize(weight: SectorHeatmapItem["weight"], scale: HeatmapScale) {
  const sizeMap: Record<
    HeatmapScale,
    Record<SectorHeatmapItem["weight"], string>
  > = {
    compact: {
      large: "md:col-span-2 md:row-span-2 min-h-32",
      medium: "md:col-span-2 min-h-24",
      small: "min-h-20",
    },
    standard: {
      large: "md:col-span-2 md:row-span-2 min-h-44",
      medium: "md:col-span-2 min-h-32",
      small: "min-h-28",
    },
    expanded: {
      large: "md:col-span-2 md:row-span-2 min-h-56",
      medium: "md:col-span-2 min-h-44",
      small: "min-h-36",
    },
  };

  return sizeMap[scale][weight];
}

function getStockTileSize(size: StockHeatmapItem["size"], scale: HeatmapScale) {
  const sizeMap: Record<
    HeatmapScale,
    Record<StockHeatmapItem["size"], string>
  > = {
    compact: {
      mega: "col-span-5 row-span-3 min-h-20",
      large: "col-span-4 row-span-2 min-h-14",
      medium: "col-span-3 row-span-2 min-h-12",
      small: "col-span-2 row-span-1 min-h-8",
      micro: "col-span-1 row-span-1 min-h-7",
    },
    standard: {
      mega: "col-span-5 row-span-4 min-h-28",
      large: "col-span-4 row-span-3 min-h-20",
      medium: "col-span-3 row-span-2 min-h-16",
      small: "col-span-2 row-span-1 min-h-10",
      micro: "col-span-1 row-span-1 min-h-8",
    },
    expanded: {
      mega: "col-span-6 row-span-4 min-h-40",
      large: "col-span-4 row-span-3 min-h-28",
      medium: "col-span-3 row-span-2 min-h-20",
      small: "col-span-2 row-span-1 min-h-14",
      micro: "col-span-1 row-span-1 min-h-10",
    },
  };

  return sizeMap[scale][size];
}

function getStockTextSize(size: StockHeatmapItem["size"], scale: HeatmapScale) {
  if (scale === "expanded" && (size === "mega" || size === "large")) {
    return "text-xl";
  }

  if (size === "mega" || size === "large") {
    return "text-base";
  }

  if (size === "small" || size === "micro") {
    return "text-[11px]";
  }

  return "text-sm";
}

function getStockChangeTextSize(size: StockHeatmapItem["size"], scale: HeatmapScale) {
  if (scale === "expanded" && (size === "mega" || size === "large")) {
    return "text-base";
  }

  if (size === "small" || size === "micro") {
    return "text-[10px]";
  }

  return "text-xs";
}

function getSectorGridClass(scale: HeatmapScale) {
  if (scale === "expanded") {
    return "grid auto-rows-fr gap-2 sm:grid-cols-2";
  }

  return "grid auto-rows-fr gap-2 sm:grid-cols-2";
}

function getStockGroupGridClass(scale: HeatmapScale) {
  if (scale === "expanded") {
    return "columns-1 gap-2 lg:columns-2 xl:columns-3";
  }

  if (scale === "compact") {
    return "columns-1 gap-2 md:columns-2 xl:columns-4";
  }

  return "columns-1 gap-2 lg:columns-2 xl:columns-3";
}

function getStockTileTone(changePercent: number) {
  if (changePercent >= 5) {
    return "bg-emerald-800 text-white border-emerald-500/30";
  }

  if (changePercent >= 1.5) {
    return "bg-emerald-600 text-white border-emerald-400/30";
  }

  if (changePercent > 0) {
    return "bg-emerald-500/70 text-white border-emerald-300/20";
  }

  if (changePercent <= -3) {
    return "bg-rose-700 text-white border-rose-400/30";
  }

  if (changePercent < -0.75) {
    return "bg-rose-500/85 text-white border-rose-300/30";
  }

  if (changePercent < 0) {
    return "bg-rose-400/70 text-white border-rose-300/20";
  }

  return "bg-slate-500 text-white border-slate-300/20";
}

function mergeStockHeatmap(
  cachedItems: MarketHeatmapItemResponse[] | undefined,
): StockHeatmapItem[] {
  const cachedBySymbol = new Map(
    (cachedItems ?? []).map((item) => [item.symbol, item]),
  );
  const merged = stockHeatmapUniverse.map((stock) => {
    const cached = cachedBySymbol.get(stock.symbol);
    return cached
      ? {
          ...stock,
          company: cached.company || stock.company,
          sector: cached.sector === "Other" ? stock.sector : cached.sector,
          changePercent: cached.change_percent,
          dataStatus: cached.data_status,
          ageSeconds: cached.age_seconds,
          source: cached.source,
          asOf: cached.as_of,
        }
      : stock;
  });
  const known = new Set(merged.map((stock) => stock.symbol));
  const extras = (cachedItems ?? [])
    .filter((item) => !known.has(item.symbol))
    .map<StockHeatmapItem>((item) => ({
      symbol: item.symbol,
      company: item.company,
      sector: item.sector,
      changePercent: item.change_percent,
      size: item.size,
      dataStatus: item.data_status,
      ageSeconds: item.age_seconds,
      source: item.source,
      asOf: item.as_of,
    }));
  return [...merged, ...extras];
}

function groupStockHeatmap(stocks: StockHeatmapItem[]) {
  const sortedStocks = [...stocks].sort((a, b) => {
    const sectorDelta =
      (stockSectorRank.get(a.sector) ?? stockSectorOrder.length) -
      (stockSectorRank.get(b.sector) ?? stockSectorOrder.length);
    if (sectorDelta !== 0) {
      return sectorDelta;
    }

    const sizeDelta = stockSizeRank[a.size] - stockSizeRank[b.size];
    if (sizeDelta !== 0) {
      return sizeDelta;
    }

    return a.symbol.localeCompare(b.symbol);
  });

  return sortedStocks.reduce<Record<string, StockHeatmapItem[]>>(
    (groups, stock) => {
      groups[stock.sector] = [...(groups[stock.sector] ?? []), stock];
      return groups;
    },
    {},
  );
}

function getRiskTone(label?: string | null) {
  return getSharedRiskTone(label === "High" || label === "Medium" ? label : "Low").chip;
}

function toResearchFallback(): MarketResearchResponse {
  return {
    ...fallbackResearch,
    market_cap: fallbackResearch.market_cap,
    errors: [],
  };
}

function formatMarketCap(value?: number | null) {
  if (!value) {
    return "--";
  }

  return formatCurrency(value, false);
}

function formatOptionalPercent(value?: number | null) {
  return value === null || value === undefined ? "--" : formatPercent(value * 100);
}

function getFallbackTrends(): MarketTrendResponse[] {
  return marketTrends.map((trend) => ({
    symbol: trend.symbol,
    source_symbol: trend.symbol,
    name: trend.name,
    value: trend.value,
    change: 0,
    change_percent: trend.changePercent,
  }));
}

function getFallbackSectors(): MarketSectorResponse[] {
  return sectorHeatmap.map((sector) => ({
    symbol: sector.symbol,
    sector: sector.sector,
    change_percent: sector.changePercent,
    weight: sector.weight,
    leaders: sector.leaders,
  }));
}

function getFallbackMovers(): MarketMoverResponse[] {
  return fallbackTrending;
}

function getMergedSectors(
  apiSectors: MarketSectorResponse[] | undefined,
): MarketSectorResponse[] {
  const liveBySymbol = new Map(
    (apiSectors ?? []).map((sector) => [sector.symbol, sector]),
  );

  const merged = getFallbackSectors().map((fallbackSector) => ({
    ...fallbackSector,
    ...(liveBySymbol.get(fallbackSector.symbol) ?? {}),
  }));

  const knownSymbols = new Set(merged.map((sector) => sector.symbol));
  const extras = (apiSectors ?? []).filter(
    (sector) => !knownSymbols.has(sector.symbol),
  );

  return [...merged, ...extras];
}

function getTimeframeMultiplier(timeframe: PulseTimeframe) {
  const multipliers: Record<PulseTimeframe, number> = {
    "1D": 1,
    "1W": 2.4,
    "1M": 5.2,
    "3M": 9.5,
    "6M": 14,
  };

  return multipliers[timeframe];
}

function getTimeframeChange(
  trend: MarketTrendResponse,
  timeframe: PulseTimeframe,
) {
  const multiplier = getTimeframeMultiplier(timeframe);
  const directionBias = timeframe === "1D" ? 1 : trend.symbol === "RUT" ? 0.65 : 1;
  return trend.change_percent * multiplier * directionBias;
}

function hashSymbol(symbol: string) {
  return symbol
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getSparklineValues(
  trend: MarketTrendResponse,
  timeframe: PulseTimeframe,
) {
  const multiplier = getTimeframeMultiplier(timeframe);
  const direction = trend.change_percent >= 0 ? 1 : -1;
  const timeframeChange = getTimeframeChange(trend, timeframe);
  const baseMove = Math.max(0.35, Math.abs(timeframeChange));
  const symbolHash = hashSymbol(trend.symbol);

  return Array.from({ length: 18 }, (_, index) => {
    const wave =
      Math.sin((index + symbolHash + multiplier) * 0.86) *
      Math.min(baseMove * 0.28, 2.8);
    const counterWave =
      Math.cos((index + symbolHash) * 0.34) *
      Math.min(baseMove * 0.11, 1.2);
    const drift = ((index / 17) - 0.5) * baseMove * direction;
    const pullback = timeframe === "1D" ? 0 : Math.sin(index * 0.55) * 0.75;
    return 100 + drift + wave + counterWave + pullback;
  });
}

function Sparkline({
  trend,
  timeframe,
}: {
  trend: MarketTrendResponse;
  timeframe: PulseTimeframe;
}) {
  const values = getSparklineValues(trend, timeframe);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = Math.max(4, Math.min(34, 19 - (value - 100) * 1.55));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const timeframeChange = getTimeframeChange(trend, timeframe);
  const isPositive = timeframeChange >= 0;

  return (
    <svg
      aria-label={`${trend.symbol} ${timeframe} trend`}
      className="mt-3 h-10 w-full overflow-visible"
      focusable="false"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 100 38"
    >
      <polyline
        fill="none"
        points={points}
        stroke={isPositive ? "rgb(110 231 183)" : "rgb(253 164 175)"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Home() {
  const { isAuthenticated } = useAuth();
  const [symbolInput, setSymbolInput] = useState("NVDA");
  const [researchSymbol, setResearchSymbol] = useState("NVDA");
  const [pulseTimeframe, setPulseTimeframe] = useState<PulseTimeframe>("1D");
  const [heatmapScale, setHeatmapScale] =
    useState<HeatmapScale>("standard");
  const marketQuery = useQuery({
    queryKey: ["market", "overview"],
    queryFn: fetchMarketOverview,
    refetchInterval: 300000,
    retry: false,
  });
  const trendingQuery = useQuery({
    queryKey: ["market", "trending"],
    queryFn: fetchMarketTrending,
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
    retry: false,
  });

  const trends = marketQuery.data?.trends.length
    ? marketQuery.data.trends
    : getFallbackTrends();
  const sectors = getMergedSectors(marketQuery.data?.sectors);
  const movers = trendingQuery.data?.most_active.length
    ? trendingQuery.data.most_active
    : getFallbackMovers();
  const research = researchQuery.data?.name
    ? researchQuery.data
    : toResearchFallback();
  const isFallbackMarket =
    marketQuery.isError ||
    trendingQuery.isError ||
    researchQuery.isError ||
    !marketQuery.data ||
    !trendingQuery.data ||
    !researchQuery.data;
  const stockHeatmapGroups = groupStockHeatmap(
    mergeStockHeatmap(heatmapQuery.data?.items),
  );
  const cachedHeatmapCount = heatmapQuery.data?.items.length ?? 0;

  function handleResearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSymbol = symbolInput.trim().toUpperCase();
    if (nextSymbol) {
      setResearchSymbol(nextSymbol);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-transparent">
      {/* Top navigation */}
      <header className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.25),0_0_20px_-6px_rgb(52_211_153_/_0.3)]">
              <span className="font-mono text-[11px] font-bold text-emerald-400">GY</span>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                getrichyesterday
              </div>
              <div className="hidden text-[10px] text-slate-500 sm:block">Market Research Console</div>
            </div>
          </div>
          <Link
            className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 transition duration-150 hover:border-emerald-400/60 hover:bg-slate-800/80 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 active:translate-y-px"
            to={isAuthenticated ? "/dashboard" : "/login"}
          >
            {isAuthenticated ? "Open dashboard →" : "Sign in →"}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-slate-800/60 bg-gradient-to-b from-slate-900/30 to-transparent">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                Public research view
              </span>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
                Market Research Console
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-400">
                Delayed index pulse, sector heatmaps, and company fundamentals — no account required.
                Sign in to access trading, portfolio, and risk workflows.
              </p>
            </div>
            {!isAuthenticated && (
              <Link
                className="inline-flex w-fit items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-150 hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/60 active:translate-y-px"
                to="/login"
              >
                Get started
                <ArrowRight className="size-4" weight="bold" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Market pulse
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Index proxies, ETF sectors, and ticker research before signing in.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
                {marketQuery.isLoading ? "Loading" : isFallbackMarket ? "Fallback" : "Live"}
              </span>
              <div className="flex rounded border border-slate-800 bg-slate-950 p-1">
                {pulseTimeframes.map((timeframe) => (
                  <button
                    aria-label={`Show ${timeframe} market pulse trend`}
                    aria-pressed={pulseTimeframe === timeframe}
                    className={[
                      "rounded px-2 py-1 font-mono text-[10px] font-semibold transition duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-300/40 active:translate-y-px",
                      pulseTimeframe === timeframe
                        ? "bg-emerald-400 text-slate-950"
                        : "text-slate-500 hover:bg-slate-900 hover:text-slate-200",
                    ].join(" ")}
                    key={timeframe}
                    onClick={() => setPulseTimeframe(timeframe)}
                    type="button"
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="dashboard-card-body">
            {isFallbackMarket ? (
              <p className="mb-4 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                Some live market data is unavailable or rate-limited. Showing
                fallback rows where needed.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {trends.map((trend) => {
                const timeframeChange = getTimeframeChange(
                  trend,
                  pulseTimeframe,
                );

                return (
                  <div className="metric-tile" key={trend.symbol}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm font-semibold text-slate-100">
                          {trend.symbol}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.1em] text-slate-500">
                          {trend.name}
                        </div>
                      </div>
                      <div
                        className={[
                          "font-mono text-xs font-semibold",
                          timeframeChange >= 0
                            ? "text-emerald-300"
                            : "text-rose-300",
                        ].join(" ")}
                      >
                        {timeframeChange >= 0 ? "UP" : "DOWN"}{" "}
                        {formatSignedPercent(Math.abs(timeframeChange))}
                      </div>
                    </div>
                    <div className="mt-3 font-mono text-lg font-semibold text-slate-100">
                      {formatQuantity(trend.value)}
                    </div>
                    <Sparkline trend={trend} timeframe={pulseTimeframe} />
                    <div className="mt-2 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10px] uppercase tracking-[0.1em] text-slate-500">
                      <span>{pulseTimeframe} derived trend</span>
                      <span>{trend.source_symbol}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.8fr)]">
          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Stock heatmap
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Broad market view grouped by sector and sized by relative market cap.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {heatmapQuery.isLoading ? (
                  <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
                    Loading cache
                  </span>
                ) : cachedHeatmapCount > 0 ? (
                  <FreshnessBadge
                    status={heatmapQuery.data?.items[0]?.data_status}
                    ageSeconds={heatmapQuery.data?.items[0]?.age_seconds}
                    source={heatmapQuery.data?.items[0]?.source}
                    asOf={heatmapQuery.data?.items[0]?.as_of}
                  />
                ) : (
                  <FreshnessBadge />
                )}
                <div className="flex rounded border border-slate-800 bg-slate-950 p-1">
                  {heatmapScales.map((scale) => (
                  <button
                    aria-label={`Set heatmap size to ${scale}`}
                    aria-pressed={heatmapScale === scale}
                    className={[
                      "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-300/40 active:translate-y-px",
                      heatmapScale === scale
                        ? "bg-emerald-400 text-slate-950"
                        : "text-slate-500 hover:bg-slate-900 hover:text-slate-200",
                    ].join(" ")}
                    key={scale}
                    onClick={() => setHeatmapScale(scale)}
                    type="button"
                  >
                    {scale}
                  </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="dashboard-card-body">
              <div className={getStockGroupGridClass(heatmapScale)}>
                {Object.entries(stockHeatmapGroups).map(([sector, stocks]) => (
                  <section
                    className="mb-2 break-inside-avoid rounded border border-slate-800/80 bg-slate-950/35 p-2"
                    key={sector}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                      <span>{sector}</span>
                      <span>{stocks.length}</span>
                    </div>
                    <div className="grid grid-flow-dense auto-rows-[minmax(1.75rem,auto)] grid-cols-12 gap-1">
                      {stocks.map((stock) => (
                        <div
                          className={[
                            "flex flex-col justify-center overflow-hidden rounded border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
                            getStockTileTone(stock.changePercent),
                            getStockTileSize(stock.size, heatmapScale),
                          ].join(" ")}
                          key={stock.symbol}
                          title={`${stock.company} ${formatSignedPercent(stock.changePercent)}${stock.dataStatus ? ` / ${stock.dataStatus} / ${stock.source}` : " / reference data"}`}
                        >
                          <div
                            className={[
                              "truncate font-mono font-semibold",
                              getStockTextSize(stock.size, heatmapScale),
                            ].join(" ")}
                          >
                            {stock.symbol}
                          </div>
                          <div
                            className={[
                              "mt-1 truncate font-mono font-semibold",
                              getStockChangeTextSize(stock.size, heatmapScale),
                            ].join(" ")}
                          >
                            {formatSignedPercent(stock.changePercent)}
                          </div>
                          {(stock.size === "mega" || stock.size === "large") && (
                            <div className="mt-2">
                              <FreshnessBadge
                                status={stock.dataStatus}
                                ageSeconds={stock.ageSeconds}
                                source={stock.source}
                                asOf={stock.asOf}
                                compact
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <span>Color scale</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-8 rounded-sm bg-rose-700" />
                  -3%+
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-8 rounded-sm bg-slate-500" />
                  Flat
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-8 rounded-sm bg-emerald-700" />
                  +5%+
                </span>
                <span className="ml-auto normal-case tracking-normal text-slate-500">
                  {cachedHeatmapCount > 0
                    ? "Delayed/cached quotes. Hover a tile for source status."
                    : "Reference values shown until the backend cache is populated."}
                </span>
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Sector ETF heatmap
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Live sector proxies: XLK, XLF, XLV, XLY, XLI, XLE, XLC, XLRE,
                  XLU, XLB, XLP.
                </p>
              </div>
            </div>
            <div className="dashboard-card-body">
              <div className={getSectorGridClass(heatmapScale)}>
                {sectors.map((sector) => (
                  <div
                    className={[
                      "flex flex-col justify-between rounded border p-3 transition duration-150 hover:border-slate-500",
                      getHeatmapTone(sector.change_percent),
                      getHeatmapSize(sector.weight, heatmapScale),
                    ].join(" ")}
                    key={sector.symbol}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold">
                          {sector.sector}
                        </div>
                        <div className="font-mono text-[11px] opacity-80">
                          {sector.symbol}
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-xl font-semibold">
                        {sector.change_percent >= 0 ? "UP" : "DOWN"}{" "}
                        {formatSignedPercent(Math.abs(sector.change_percent))}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1">
                      {sector.leaders.map((symbol) => (
                        <span
                          className="rounded border border-current/20 bg-slate-950/25 px-1.5 py-0.5 font-mono text-[11px]"
                          key={symbol}
                        >
                          {symbol}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Company research
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Public company overview and research-risk snapshot.
                </p>
              </div>
            </div>
            <div className="dashboard-card-body space-y-4">
              <form className="flex gap-2" onSubmit={handleResearchSubmit}>
                <label className="sr-only" htmlFor="research-symbol">
                  Research symbol
                </label>
                <input
                  className="field-control mt-0"
                  id="research-symbol"
                  onChange={(event) => setSymbolInput(event.target.value)}
                  placeholder="NVDA"
                  value={symbolInput}
                />
                <button
                  className="rounded-md bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/70 active:translate-y-px"
                  type="submit"
                >
                  Research
                </button>
              </form>

              <div className="rounded border border-slate-800 bg-slate-950/55 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-mono text-lg font-semibold text-slate-50">
                      {research.symbol}
                    </div>
                    <div className="mt-1 text-sm text-slate-300">
                      {research.name ?? "Company overview unavailable"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {research.exchange ?? "--"} / {research.sector ?? "--"}
                    </div>
                  </div>
                  <span
                    className={[
                      "risk-chip",
                      getRiskTone(research.research_risk_label),
                    ].join(" ")}
                  >
                    {research.research_risk_label ?? "Medium"} /{" "}
                    {research.research_risk_score ?? "--"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="metric-tile px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Price
                    </div>
                    <div className="mt-1 font-mono text-sm text-slate-100">
                      {research.price ? formatCurrency(research.price) : "--"}
                    </div>
                  </div>
                  <div className="metric-tile px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Market cap
                    </div>
                    <div className="mt-1 font-mono text-sm text-slate-100">
                      {formatMarketCap(research.market_cap)}
                    </div>
                  </div>
                  <div className="metric-tile px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      P/E
                    </div>
                    <div className="mt-1 font-mono text-sm text-slate-100">
                      {research.pe_ratio ?? "--"}
                    </div>
                  </div>
                  <div className="metric-tile px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Margin
                    </div>
                    <div className="mt-1 font-mono text-sm text-slate-100">
                      {formatOptionalPercent(research.profit_margin)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Risk notes
                  </div>
                  {(research.risk_factors?.length
                    ? research.risk_factors
                    : ["Research factors unavailable"]).map((factor) => (
                    <div
                      className="rounded border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-xs text-slate-300"
                      key={factor}
                    >
                      {factor}
                    </div>
                  ))}
                </div>

                <p className="mt-4 line-clamp-5 text-xs leading-5 text-slate-400">
                  {research.description ?? "No company description available."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Trending movers
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Most active tickers from the market data provider.
              </p>
            </div>
            <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
              {trendingQuery.isLoading ? "Loading" : "Active"}
            </span>
          </div>
          <div className="dashboard-card-body">
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Change</th>
                    <th className="text-right">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {movers.map((mover) => (
                    <tr key={mover.symbol}>
                      <td className="font-mono font-semibold text-slate-100">
                        {mover.symbol}
                      </td>
                      <td className="text-right font-mono">
                        {formatCurrency(mover.price)}
                      </td>
                      <td
                        className={[
                          "text-right font-mono",
                          mover.change_percent >= 0
                            ? "text-emerald-300"
                            : "text-rose-300",
                        ].join(" ")}
                      >
                        {mover.change_percent >= 0 ? "UP" : "DOWN"}{" "}
                        {formatSignedPercent(Math.abs(mover.change_percent))}
                      </td>
                      <td className="text-right font-mono">
                        {formatQuantity(mover.volume)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
