import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, List, TrendDown, TrendUp, X } from "@phosphor-icons/react";
import {
  fetchMarketHeatmap,
  fetchMarketNews,
  fetchMarketOverview,
  fetchMarketResearch,
  fetchMarketTrending,
} from "../api/market";
import { fetchDailyHistory, type HistoryRange } from "../api/history";
import { useAuth } from "../context/useAuth";
import { EmptyState } from "../features/dashboard/components/EmptyState";
import { IconBadge } from "../features/dashboard/components";
import { DailyHistory } from "../components/DailyHistory";
import { Sparkline } from "../components/Sparkline";
import { Watchlists } from "../components/Watchlists";
import { FreshnessBadge } from "../components/FreshnessBadge";
import type {
  MarketHeatmapItemResponse,
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
import { getRiskTone as getSharedRiskTone } from "../utils/riskTone";

type HeatmapScale = "compact" | "standard" | "expanded";
type SparkRange = Extract<HistoryRange, "1m" | "3m" | "6m" | "1y">;

const heatmapScales: HeatmapScale[] = ["compact", "standard", "expanded"];
const sparkRanges: SparkRange[] = ["1m", "3m", "6m", "1y"];
const sparkRangeLabels: Record<SparkRange, string> = {
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
};
const pageSections = [
  { id: "market-pulse", label: "Market pulse" },
  { id: "stock-heatmap", label: "Stock heatmap" },
  { id: "sector-etf-heatmap", label: "Sector ETF heatmap" },
  { id: "company-research", label: "Company research" },
  { id: "trending-movers", label: "Trending movers" },
  { id: "market-news", label: "Market news" },
  { id: "daily-price-history-title", label: "Daily history chart" },
] as const;
const HISTORY_PROVIDER = "massive";
const HISTORY_ADJUSTMENT = "split_adjusted";
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
const stockSizeRank: Record<MarketHeatmapItemResponse["size"], number> = {
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

function getHeatmapSize(weight: MarketSectorResponse["weight"], scale: HeatmapScale) {
  const sizeMap: Record<
    HeatmapScale,
    Record<MarketSectorResponse["weight"], string>
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

function getStockTileSize(size: MarketHeatmapItemResponse["size"], scale: HeatmapScale) {
  const sizeMap: Record<
    HeatmapScale,
    Record<MarketHeatmapItemResponse["size"], string>
  > = {
    compact: {
      mega: "col-span-12 row-span-3 min-h-20",
      large: "col-span-8 row-span-2 min-h-14",
      medium: "col-span-6 row-span-2 min-h-12",
      small: "col-span-5 row-span-1 min-h-8",
      micro: "col-span-4 row-span-1 min-h-7",
    },
    standard: {
      mega: "col-span-12 row-span-4 min-h-28",
      large: "col-span-8 row-span-3 min-h-20",
      medium: "col-span-6 row-span-2 min-h-16",
      small: "col-span-5 row-span-1 min-h-10",
      micro: "col-span-4 row-span-1 min-h-8",
    },
    expanded: {
      mega: "col-span-12 row-span-4 min-h-40",
      large: "col-span-8 row-span-3 min-h-28",
      medium: "col-span-6 row-span-2 min-h-20",
      small: "col-span-5 row-span-1 min-h-14",
      micro: "col-span-4 row-span-1 min-h-10",
    },
  };

  return sizeMap[scale][size];
}

function getStockTextSize(size: MarketHeatmapItemResponse["size"], scale: HeatmapScale) {
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

function getStockChangeTextSize(size: MarketHeatmapItemResponse["size"], scale: HeatmapScale) {
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
    return "grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] items-start gap-2";
  }

  if (scale === "compact") {
    return "grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] items-start gap-2";
  }

  return "grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] items-start gap-2";
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

function groupStockHeatmap(stocks: MarketHeatmapItemResponse[]) {
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

  return sortedStocks.reduce<Record<string, MarketHeatmapItemResponse[]>>(
    (groups, stock) => {
      groups[stock.sector] = [...(groups[stock.sector] ?? []), stock];
      return groups;
    },
    {},
  );
}

function getRiskTone(label?: string | null) {
  return label === "High" || label === "Medium" || label === "Low"
    ? getSharedRiskTone(label).chip
    : "border-slate-700 bg-slate-900 text-slate-400";
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

function formatNewsTime(value: string) {
  return formatUtcDateTime(value) ?? value;
}

function sparkRangeLabel(range: HistoryRange) {
  return range in sparkRangeLabels ? sparkRangeLabels[range as SparkRange] : range.toUpperCase();
}

function closingPrices(bars: readonly { session_date: string; close: string }[]) {
  return [...bars]
    .sort((left, right) => left.session_date.localeCompare(right.session_date))
    .map((bar) => Number(bar.close))
    .filter((value) => Number.isFinite(value));
}

function TimeframeToggle({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (range: SparkRange) => void;
  value: SparkRange;
}) {
  return (
    <div
      aria-label={label}
      className="flex flex-wrap rounded border border-slate-800 bg-slate-950 p-1"
      role="group"
    >
      {sparkRanges.map((range) => {
        const selected = value === range;
        return (
          <button
            aria-label={`${label} ${sparkRangeLabels[range]}`}
            aria-pressed={selected}
            className={[
              "min-h-11 min-w-11 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition duration-150 motion-reduce:transition-none motion-reduce:active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-slate-950 active:translate-y-px",
              selected
                ? "bg-emerald-400 text-slate-950"
                : "text-slate-200 hover:bg-slate-900 hover:text-slate-50",
            ].join(" ")}
            key={range}
            onClick={() => onChange(range)}
            type="button"
          >
            {sparkRangeLabels[range]}
          </button>
        );
      })}
    </div>
  );
}

function SymbolSparkline({
  className,
  empty = "hidden",
  range,
  symbol,
}: {
  className?: string;
  empty?: "hidden" | "dash";
  range: HistoryRange;
  symbol: string;
}) {
  const historyQuery = useQuery({
    queryKey: ["market", "history", symbol, HISTORY_PROVIDER, HISTORY_ADJUSTMENT, range],
    queryFn: () => fetchDailyHistory(symbol, HISTORY_PROVIDER, HISTORY_ADJUSTMENT, range),
    enabled: symbol.trim().length > 0,
    retry: false,
    staleTime: 300000,
  });
  const closes = historyQuery.isSuccess && historyQuery.data.status !== "unavailable"
    ? closingPrices(historyQuery.data.bars)
    : [];

  if (closes.length >= 2) {
    return (
      <Sparkline
        className={className}
        label={`${symbol} closing prices over ${sparkRangeLabel(range)}`}
        values={closes}
      />
    );
  }

  if (empty === "dash" && (historyQuery.isError || historyQuery.isSuccess)) {
    return (
      <span aria-label={`No closing prices for ${symbol}`} className="font-mono text-sm text-slate-300">
        —
      </span>
    );
  }

  return null;
}

export function Home() {
  const { isAuthenticated } = useAuth();
  const [symbolInput, setSymbolInput] = useState("NVDA");
  const [researchSymbol, setResearchSymbol] = useState("NVDA");
  const [historyDraft, setHistoryDraft] = useState("");
  const [heatmapScale, setHeatmapScale] =
    useState<HeatmapScale>("standard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pulseRange, setPulseRange] = useState<SparkRange>("1m");
  const [researchRange, setResearchRange] = useState<SparkRange>("1m");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);
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
  const newsQuery = useQuery({
    queryKey: ["market", "news"],
    queryFn: fetchMarketNews,
    refetchInterval: 300000,
    retry: false,
  });

  const trends = marketQuery.data?.trends ?? [];
  const sectors = marketQuery.data?.sectors ?? [];
  const movers = trendingQuery.data?.most_active ?? [];
  const research: MarketResearchResponse = researchQuery.data ?? { symbol: researchSymbol, errors: [] };
  const hasResearchInputs = (research.pe_ratio != null && research.pe_ratio > 0)
    || research.profit_margin != null || research.beta != null
    || (research.analyst_target_price != null && research.analyst_target_price > 0 && research.price != null && research.price > 0);
  const researchRiskLabel = hasResearchInputs ? research.research_risk_label : null;
  const researchRiskScore = hasResearchInputs ? research.research_risk_score : null;
  const stockHeatmapGroups = groupStockHeatmap(heatmapQuery.data?.items ?? []);
  const cachedHeatmapCount = heatmapQuery.data?.items.length ?? 0;
  const latestQuoteAt = marketQuery.data?.as_of;
  const articles = newsQuery.data?.articles ?? [];

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    closeMenuRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (menuButtonRef.current?.contains(target) || menuPanelRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [menuOpen]);

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
    field.focus();
    field.scrollIntoView({ block: "center" });
  }

  function useWatchlistInResearch(symbol: string) {
    setSymbolInput(symbol);
    focusField("research-symbol");
  }

  function useWatchlistInChart(symbol: string) {
    setHistoryDraft(symbol);
    focusField("daily-history-symbol");
  }

  return (
    <main className="min-h-[100dvh] bg-transparent">
      {/* Top navigation */}
      <header className="relative z-30 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[2200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.25),0_0_20px_-6px_rgb(52_211_153_/_0.3)]">
              <span className="font-mono text-[11px] font-bold text-emerald-400">GY</span>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                getrichyesterday
              </div>
              <div className="hidden text-[10px] text-slate-500 sm:block">Market dashboard</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              aria-controls="public-market-menu"
              aria-expanded={menuOpen}
              aria-label="Open menu"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/80 text-slate-100 transition duration-150 hover:border-emerald-400/60 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 motion-reduce:transition-none sm:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              ref={menuButtonRef}
              type="button"
            >
              <List aria-hidden="true" className="size-5" weight="light" />
            </button>
            <Link
              className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 transition duration-150 hover:border-emerald-400/60 hover:bg-slate-800/80 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 active:translate-y-px"
              to={isAuthenticated ? "/dashboard" : "/login"}
            >
              {isAuthenticated ? "Open dashboard →" : "Log in"}
            </Link>
          </div>
        </div>
        {menuOpen ? (
          <nav
            aria-label="Page sections"
            className="absolute left-0 right-0 top-full z-40 border-b border-slate-800 bg-slate-950 px-4 py-3 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.8)] motion-safe:transition-opacity motion-safe:duration-150 motion-reduce:transition-none sm:hidden"
            id="public-market-menu"
            ref={menuPanelRef}
          >
            <div className="mx-auto flex max-w-[2200px] items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400">On this page</p>
              <button
                aria-label="Close menu"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/80 text-slate-100 hover:border-emerald-400/60 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                onClick={() => {
                  setMenuOpen(false);
                  menuButtonRef.current?.focus();
                }}
                ref={closeMenuRef}
                type="button"
              >
                <X aria-hidden="true" className="size-5" weight="bold" />
              </button>
            </div>
            <ul className="mx-auto mt-2 max-w-[2200px] space-y-1">
              {pageSections.map((section) => (
                <li key={section.id}>
                  <a
                    className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-100 hover:bg-slate-900 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                    href={`#${section.id}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mx-auto mt-2 max-w-[2200px]">
              <Link
                className="flex min-h-11 items-center rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 text-sm font-semibold text-slate-100 hover:border-emerald-400/60 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                onClick={() => setMenuOpen(false)}
                to={isAuthenticated ? "/dashboard" : "/login"}
              >
                {isAuthenticated ? "Open dashboard →" : "Log in"}
              </Link>
            </div>
          </nav>
        ) : null}
      </header>

      {/* Hero */}
      <div className="border-b border-slate-800/60 bg-gradient-to-b from-slate-900/30 to-transparent">
        <div className="mx-auto max-w-[2200px] px-4 py-10 sm:px-6 sm:py-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
                Public dashboard
              </span>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
                Market dashboard
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

      <section className="mx-auto max-w-[2200px] space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="dashboard-card">
          <div className="dashboard-card-header flex-wrap gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-100" id="market-pulse">Market pulse</h2>
              <p className="mt-1 text-xs text-slate-400">Cached ETF proxy quotes. Historical trends are unavailable.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TimeframeToggle label="Market pulse range" onChange={setPulseRange} value={pulseRange} />
              <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
                {marketQuery.isLoading ? "Loading" : trends.length ? "Cached snapshot" : "Unavailable"}
              </span>
            </div>
          </div>
          <div className="dashboard-card-body">
            {trends.length === 0 ? (
              <EmptyState message={marketQuery.isLoading ? "Loading quote cache" : "Market quotes unavailable"}
                detail="Index quotes will appear when the market cache has data." />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {trends.map((trend) => (
                    <div className="metric-tile" key={trend.source_symbol}>
                      <div className="flex items-center gap-2">
                        <IconBadge
                          Icon={trend.change_percent >= 0 ? TrendUp : TrendDown}
                          tone={trend.change_percent >= 0 ? "emerald" : "rose"}
                        />
                        <div className="font-mono text-sm font-semibold text-slate-100">{trend.source_symbol}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{trend.name} proxy</div>
                      <div className="mt-3 font-mono text-lg font-semibold text-slate-100">{formatCurrency(trend.value)}</div>
                      <div className={["mt-2 font-mono text-xs", trend.change_percent >= 0 ? "text-emerald-300" : "text-rose-300"].join(" ")}>
                        Provider change {formatSignedPercent(trend.change_percent)}
                      </div>
                      <SymbolSparkline className="mt-3 h-8 w-full" range={pulseRange} symbol={trend.source_symbol} />
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-400">
                  Latest cached quote: {latestQuoteAt && Number.isFinite(Date.parse(latestQuoteAt)) ? new Date(latestQuoteAt).toUTCString() : "unavailable"}. Individual quotes may be older.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.8fr)]">
          <div className="dashboard-card">
            <div className="dashboard-card-header flex-col items-stretch sm:flex-row sm:items-center">
              <div>
                <h2 className="text-sm font-semibold text-slate-100" id="stock-heatmap">
                  Stock heatmap
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Cached stocks grouped by sector with illustrative tile sizes.
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                {heatmapQuery.isLoading ? (
                  <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
                    Loading cache
                  </span>
                ) : cachedHeatmapCount > 0 ? (
<span className="text-xs text-slate-400">{cachedHeatmapCount} returned {cachedHeatmapCount === 1 ? "quote" : "quotes"}</span>
                ) : (
                  <span className="text-xs text-slate-400">No cached quotes</span>
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
              {cachedHeatmapCount === 0 ? (
                <EmptyState message={heatmapQuery.isLoading ? "Loading stock cache" : "Stock heatmap unavailable"} detail="Only returned cached quotes are shown. Missing symbols are not filled with reference prices." />
              ) : null}
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
                            stock.data_status === "stale" ? "border-slate-700 bg-slate-900 text-slate-400" : getStockTileTone(stock.change_percent),
                            getStockTileSize(stock.size, heatmapScale),
                          ].join(" ")}
                          key={stock.symbol}
                          title={`${stock.company} ${stock.data_status === "stale" ? "Stale" : formatSignedPercent(stock.change_percent)}${stock.data_status ? ` / ${stock.data_status} / ${stock.source}` : " / reference data"}`}
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
                            {stock.data_status === "stale" ? "Stale" : formatSignedPercent(stock.change_percent)}
                          </div>
                          {(stock.size === "mega" || stock.size === "large") && (
                            <div className="mt-2">
                              <FreshnessBadge
                                status={stock.data_status}
                                ageSeconds={stock.age_seconds}
                                source={stock.source}
                                asOf={stock.as_of}
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
                    : "No cached quotes are available."}
                </span>
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <h2 className="text-sm font-semibold text-slate-100" id="sector-etf-heatmap">
                  Sector ETF heatmap
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Cached sector ETF proxies returned by the market service.
                </p>
              </div>
            </div>
            <div className="dashboard-card-body">
              {sectors.length === 0 ? <EmptyState message={marketQuery.isLoading ? "Loading sector cache" : "Sector quotes unavailable"} /> : null}
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
                        {formatSignedPercent(sector.change_percent)}
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
                <h2 className="text-sm font-semibold text-slate-100" id="company-research">
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
                <div className="flex flex-wrap items-start justify-between gap-4">
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
                      getRiskTone(researchRiskLabel),
                    ].join(" ")}
                  >
                    {researchRiskLabel && researchRiskScore != null
                      ? `${researchRiskLabel} / ${researchRiskScore}`
                      : "Research assessment unavailable"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="metric-tile px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Price
                    </div>
                    <div className="mt-1 font-mono text-sm text-slate-100">
                      {research.price != null && research.price > 0 ? formatCurrency(research.price) : "Unavailable"}
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

                {hasResearchInputs ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300">
                        Price history
                      </div>
                      <TimeframeToggle
                        label="Company research range"
                        onChange={setResearchRange}
                        value={researchRange}
                      />
                    </div>
                    <SymbolSparkline className="h-24 w-full" range={researchRange} symbol={research.symbol} />
                  </div>
                ) : null}

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

        <Watchlists onUseInChart={useWatchlistInChart} onUseInResearch={useWatchlistInResearch} />

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2 className="text-sm font-semibold text-slate-100" id="trending-movers">
                Trending movers
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Most active tickers from the market data provider.
              </p>
            </div>
            <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
              {trendingQuery.isLoading ? "Loading" : movers.length ? "Provider response" : "Unavailable"}
            </span>
          </div>
          <div className="dashboard-card-body">
            {movers.length === 0 ? (
              <EmptyState message={trendingQuery.isLoading ? "Loading most-active stocks" : "Most-active data unavailable"} />
            ) : (
            <div className="table-shell">
              <table className="data-table">
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
                  {movers.map((mover) => (
                    <tr key={mover.symbol}>
                      <td className="font-mono font-semibold text-slate-100">
                        {mover.symbol}
                      </td>
                      <td className="text-right font-mono">
                        {mover.price != null && mover.price > 0 ? formatCurrency(mover.price) : "Unavailable"}
                      </td>
                      <td
                        className={[
                          "text-right font-mono",
                          mover.change_percent == null ? "text-slate-400" : mover.change_percent >= 0
                            ? "text-emerald-300"
                            : "text-rose-300",
                        ].join(" ")}
                      >
                        {mover.change_percent == null ? "Unavailable" : formatSignedPercent(mover.change_percent)}
                      </td>
                      <td className="text-right font-mono">
                        {mover.volume == null ? "Unavailable" : formatQuantity(mover.volume)}
                      </td>
                      <td className="w-28 text-right">
                        <SymbolSparkline
                          className="ml-auto h-6 w-24"
                          empty="dash"
                          range="1m"
                          symbol={mover.symbol}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2 className="text-sm font-semibold text-slate-100" id="market-news">
                Market news
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Headlines for the major index ETFs.
              </p>
            </div>
            <span className="risk-chip border-slate-700 bg-slate-900 text-slate-300">
              {newsQuery.isLoading ? "Loading" : articles.length ? "Cached headlines" : "Unavailable"}
            </span>
          </div>
          <div className="dashboard-card-body">
            {articles.length === 0 ? (
              <EmptyState
                message={newsQuery.isLoading ? "Loading market news" : newsQuery.isError ? "Market news unavailable" : "No market headlines"}
              />
            ) : (
              <ul aria-label="Market headlines" className="divide-y divide-slate-800/80">
                {articles.map((article, index) => (
                  <li className="py-3 first:pt-0 last:pb-0" key={`${article.url}-${article.published_at}-${index}`}>
                    <a
                      className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-slate-50 underline decoration-slate-500 underline-offset-4 hover:text-emerald-200 hover:decoration-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
                      href={article.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {article.headline}
                    </a>
                    {article.summary ? (
                      <p className="mt-1 text-xs leading-5 text-slate-300">{article.summary}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-300">
                      <span className="font-semibold text-slate-100">{article.source}</span>
                      <span aria-hidden="true"> · </span>
                      <time dateTime={article.published_at}>{formatNewsTime(article.published_at)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DailyHistory onValueChange={setHistoryDraft} value={historyDraft} />
      </section>
    </main>
  );
}
