import { type ReactNode } from "react";
import { isAxiosError } from "axios";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketResearch, fetchSymbolQuote } from "../api/market";
import { fetchDailyHistory } from "../api/history";
import { fetchDailyIndicators } from "../api/indicators";
import { fetchResearchNews } from "../api/research";
import { PriceChart } from "../components/PriceChart";
import { indicatorOverlay, type IndicatorOverlay } from "../components/historyData";
import { useAuth } from "../context/useAuth";
import type { MarketResearchResponse, SymbolQuoteResponse } from "../types/schemas";
import { sliceBars, trailingYearStats, type ChartRange } from "../components/priceChartData";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";

const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

function readSymbol(raw: string | undefined): string | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!SYMBOL_PATTERN.test(decoded)) return null;
  return decoded.toUpperCase();
}

function requestDetail(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  return fallback;
}

function asOfDate(value: string | null): string {
  const match = value ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null;
  return match ? match[1] : "unavailable";
}

function changeText(amount: number | null, percent: number | null): string {
  if (amount == null || percent == null || !Number.isFinite(amount) || !Number.isFinite(percent)) {
    return "unavailable";
  }
  if (amount === 0 && percent === 0) return "Unchanged $0.00 (0.00%)";
  const direction = amount > 0 || (amount === 0 && percent > 0) ? "Up" : "Down";
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${direction} ${sign}${formatCurrency(Math.abs(amount))} (${formatSignedPercent(percent)})`;
}

function wholeMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unavailable";
  return formatCurrency(value, false);
}

function multiple(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unavailable";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function marginText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unavailable";
  return formatPercent(value * 100);
}

function marginPeriod(period: MarketResearchResponse["profit_margin_period"]): string | null {
  if (period == null) return null;
  const start = period.start?.trim();
  const end = period.end?.trim();
  if (!start || !end) return null;
  const form = period.form?.trim();
  return form ? `${form} · ${start} to ${end}` : `${start} to ${end}`;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-canvas text-ink">
      <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
        <Link
          className="inline-flex min-h-11 w-fit items-center rounded-full px-3 text-sm font-semibold text-copy hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          to="/market"
        >
          Market
        </Link>
        {children}
      </div>
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-2 break-words text-sm leading-6 tabular-nums text-ink">{value}</dd>
      {detail ? <dd className="mt-1 text-[12px] leading-4 text-muted">{detail}</dd> : null}
    </div>
  );
}

function historyMetrics(bars: Parameters<typeof PriceChart>[0]["bars"], endDate: string) {
  const closes = sliceBars(bars, "1Y", endDate)
    .map((bar) => ({ date: bar.session_date, close: Number(bar.close) }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const returns = closes.slice(1).map((bar, index) => Math.log(bar.close / closes[index]!.close));
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (returns.length - 1)
    : null;
  let peak = 0;
  let drawdown = 0;
  for (const bar of closes) {
    peak = Math.max(peak, bar.close);
    if (peak > 0) drawdown = Math.min(drawdown, ((bar.close / peak) - 1) * 100);
  }
  const rangeReturn = (range: ChartRange) => {
    const window = sliceBars(bars, range, endDate)
      .map((bar) => Number(bar.close))
      .filter((close) => Number.isFinite(close) && close > 0);
    return window.length > 1 ? ((window.at(-1)! / window[0]!) - 1) * 100 : null;
  };
  return {
    volatility: variance == null || returns.length < 30 ? null : Math.sqrt(variance * 252) * 100,
    drawdown: closes.length < 2 ? null : drawdown,
    returns: (["1M", "3M", "6M", "YTD", "1Y"] as const).map((range) => [range, rangeReturn(range)] as const),
  };
}

function rangePosition(price: number | null, low: number | null, high: number | null): string | null {
  if (price == null || low == null || high == null || high <= low) return null;
  return `${Math.round(((price - low) / (high - low)) * 100)}% from low`;
}

function latestIndicatorValue(overlay: IndicatorOverlay | undefined): number | null {
  const value = overlay?.values.at(-1);
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function TechnicalScorecard({
  price,
  rsi,
  sma20,
  sma50,
  loading,
}: {
  price: number | null;
  rsi: IndicatorOverlay | undefined;
  sma20: IndicatorOverlay | undefined;
  sma50: IndicatorOverlay | undefined;
  loading: boolean;
}) {
  const rsiValue = latestIndicatorValue(rsi);
  const sma20Value = latestIndicatorValue(sma20);
  const sma50Value = latestIndicatorValue(sma50);
  const comparison = (label: string, value: number | null) => {
    if (price == null || value == null) return { label, detail: "Unavailable", tone: "text-muted" };
    return price >= value
      ? { label, detail: `Close above ${formatCurrency(value)}`, tone: "text-up" }
      : { label, detail: `Close below ${formatCurrency(value)}`, tone: "text-down" };
  };
  const signals = [
    rsiValue == null
      ? { label: "RSI (14)", detail: "Unavailable", tone: "text-muted" }
      : { label: "RSI (14)", detail: `${rsiValue.toFixed(1)} — ${rsiValue >= 70 ? "Overbought" : rsiValue <= 30 ? "Oversold" : "Neutral"}`, tone: rsiValue >= 70 ? "text-down" : rsiValue <= 30 ? "text-up" : "text-copy" },
    comparison("SMA (20)", sma20Value),
    comparison("SMA (50)", sma50Value),
    sma20Value == null || sma50Value == null
      ? { label: "SMA 20 vs 50", detail: "Unavailable", tone: "text-muted" }
      : { label: "SMA 20 vs 50", detail: sma20Value >= sma50Value ? "Short trend above long trend" : "Short trend below long trend", tone: sma20Value >= sma50Value ? "text-up" : "text-down" },
  ];
  const supported = signals.filter((signal) => signal.detail !== "Unavailable");

  return (
    <section aria-labelledby="technical-scorecard-title" className="min-w-0 rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-6 py-4">
        <h2 className="text-lg leading-7 font-semibold text-ink" id="technical-scorecard-title">Technical scorecard</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{loading ? "Reading cached indicators." : `${supported.length} supported signals from cached daily closes.`}</p>
      </div>
      <dl className="divide-y divide-line px-6 py-2">
        {signals.map((signal) => (
          <div className="flex items-center justify-between gap-4 py-3" key={signal.label}>
            <dt className="text-sm text-copy">{signal.label}</dt>
            <dd className={["text-right text-sm font-semibold tabular-nums", loading ? "text-muted" : signal.tone].join(" ")}>{loading ? "Loading" : signal.detail}</dd>
          </div>
        ))}
      </dl>
      <p className="px-6 pb-5 text-xs leading-5 text-muted">
        {loading ? "Reading the cached indicator series." : "Indicator values are based on observed valid closes only."}
      </p>
    </section>
  );
}

function UnavailablePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${title}-title`} className="min-w-0 rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg leading-7 font-semibold text-ink" id={`${title}-title`}>{title}</h2>
      <p className="mt-3 text-sm leading-6 text-copy">{children}</p>
    </section>
  );
}

export function StockDetail() {
  const params = useParams();
  const symbol = readSymbol(params.symbol);
  const { isAuthenticated } = useAuth();
  const quoteQuery = useQuery({
    queryKey: ["stock-detail", "quote", symbol],
    queryFn: () => fetchSymbolQuote(symbol ?? ""),
    enabled: symbol !== null,
    retry: false,
  });
  const splitHistoryQuery = useQuery({
    queryKey: ["stock-detail", "history", symbol, "split_adjusted"],
    queryFn: () => fetchDailyHistory(symbol ?? "", "massive", "split_adjusted", "2y"),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });
  const splitEmpty = splitHistoryQuery.isSuccess && splitHistoryQuery.data.bars.length === 0;
  const rawHistoryQuery = useQuery({
    queryKey: ["stock-detail", "history", symbol, "raw"],
    queryFn: () => fetchDailyHistory(symbol ?? "", "massive", "raw", "2y"),
    enabled: symbol !== null && quoteQuery.isSuccess && splitEmpty,
    retry: false,
  });
  const historyQuery = splitEmpty ? rawHistoryQuery : splitHistoryQuery;
  const researchQuery = useQuery({
    queryKey: ["stock-detail", "research", symbol],
    queryFn: () => fetchMarketResearch(symbol ?? ""),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });
  const newsQuery = useQuery({
    queryKey: ["stock-detail", "news", symbol],
    queryFn: () => fetchResearchNews(symbol ?? ""),
    enabled: symbol !== null && quoteQuery.isSuccess && isAuthenticated,
    retry: false,
  });
  const rsiQuery = useQuery({
    queryKey: ["stock-detail", "indicator", symbol, "rsi", 14],
    queryFn: async () => indicatorOverlay(
      await fetchDailyIndicators(symbol ?? "", "massive", "split_adjusted", "1y", "rsi", 14),
      { symbol: symbol ?? "", provider: "massive", adjustment_type: "split_adjusted", name: "rsi", period: 14 },
    ),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });
  const sma20Query = useQuery({
    queryKey: ["stock-detail", "indicator", symbol, "sma", 20],
    queryFn: async () => indicatorOverlay(
      await fetchDailyIndicators(symbol ?? "", "massive", "split_adjusted", "1y", "sma", 20),
      { symbol: symbol ?? "", provider: "massive", adjustment_type: "split_adjusted", name: "sma", period: 20 },
    ),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });
  const sma50Query = useQuery({
    queryKey: ["stock-detail", "indicator", symbol, "sma", 50],
    queryFn: async () => indicatorOverlay(
      await fetchDailyIndicators(symbol ?? "", "massive", "split_adjusted", "1y", "sma", 50),
      { symbol: symbol ?? "", provider: "massive", adjustment_type: "split_adjusted", name: "sma", period: 50 },
    ),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });

  if (symbol === null) {
    return (
      <Frame>
        <p className="text-sm leading-6 text-copy" role="alert">
          This symbol is not in the supported format.
        </p>
      </Frame>
    );
  }

  if (quoteQuery.isError) {
    return (
      <Frame>
        <p className="text-sm leading-6 text-copy" role="alert">
          {requestDetail(quoteQuery.error, "The quote could not be loaded.")}
        </p>
        <button
          className="inline-flex min-h-11 w-fit items-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-canvas hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onClick={() => {
            void quoteQuery.refetch();
          }}
          type="button"
        >
          Retry
        </button>
      </Frame>
    );
  }

  if (!quoteQuery.data) {
    return (
      <Frame>
        <p className="text-sm leading-6 text-copy" role="status">
          Loading {symbol}
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <DetailBody
        historyError={historyQuery.isError ? requestDetail(historyQuery.error, "Daily prices could not be loaded.") : null}
        historyLoading={splitHistoryQuery.isLoading || (splitEmpty && rawHistoryQuery.isLoading)}
        priceSeries={splitEmpty ? "raw" : "split_adjusted"}
        isAuthenticated={isAuthenticated}
        newsError={newsQuery.isError}
        newsLoading={newsQuery.isLoading}
        onRetryHistory={() => {
          void historyQuery.refetch();
        }}
        onRetryNews={() => {
          void newsQuery.refetch();
        }}
        quote={quoteQuery.data}
        research={researchQuery.data}
        researchLoading={researchQuery.isLoading}
        researchFailed={researchQuery.isError}
        bars={historyQuery.data?.bars ?? []}
        coverageStatus={historyQuery.data?.coverage_status ?? "not_verified"}
        endDate={historyQuery.data?.requested_end ?? ""}
        articles={newsQuery.data?.articles ?? []}
        newsMessage={newsQuery.data?.error ?? null}
        rsi={rsiQuery.data}
        sma20={sma20Query.data}
        sma50={sma50Query.data}
        indicatorsLoading={rsiQuery.isLoading || sma20Query.isLoading || sma50Query.isLoading}
      />
    </Frame>
  );
}

function DetailBody({
  quote,
  bars,
  coverageStatus,
  endDate,
  historyLoading,
  historyError,
  priceSeries,
  onRetryHistory,
  research,
  researchLoading,
  researchFailed,
  isAuthenticated,
  newsLoading,
  newsError,
  newsMessage,
  articles,
  onRetryNews,
  rsi,
  sma20,
  sma50,
  indicatorsLoading,
}: {
  quote: SymbolQuoteResponse;
  bars: Parameters<typeof PriceChart>[0]["bars"];
  coverageStatus: Parameters<typeof PriceChart>[0]["coverageStatus"];
  endDate: string;
  historyLoading: boolean;
  historyError: string | null;
  priceSeries: "raw" | "split_adjusted";
  onRetryHistory: () => void;
  research: MarketResearchResponse | undefined;
  researchLoading: boolean;
  researchFailed: boolean;
  isAuthenticated: boolean;
  newsLoading: boolean;
  newsError: boolean;
  newsMessage: string | null;
  articles: { headline: string; summary: string; source: string; url: string; published_at: string }[];
  onRetryNews: () => void;
  rsi: IndicatorOverlay | undefined;
  sma20: IndicatorOverlay | undefined;
  sma50: IndicatorOverlay | undefined;
  indicatorsLoading: boolean;
}) {
  const stats = endDate
    ? trailingYearStats(bars, endDate)
    : { high: null, low: null, averageVolume: null };
  const price = quote.price != null && quote.price > 0 ? formatCurrency(quote.price) : "unavailable";
  const change = quote.price != null && quote.price > 0
    ? changeText(quote.change_amount, quote.change_percent)
    : "unavailable";
  const changeUp = (quote.change_amount ?? 0) > 0 || ((quote.change_amount ?? 0) === 0 && (quote.change_percent ?? 0) > 0);
  const changeDown = (quote.change_amount ?? 0) < 0 || ((quote.change_amount ?? 0) === 0 && (quote.change_percent ?? 0) < 0);
  const period = marginPeriod(research?.profit_margin_period);
  const hasSecPeriod = research?.profit_margin != null && period != null;
  const calculated = endDate ? historyMetrics(bars, endDate) : { volatility: null, drawdown: null, returns: [] };
  // The 52-week range comes from the plotted series, so say when that series is unadjusted.
  const rawRangeNote = priceSeries === "raw" && !historyLoading && !historyError
    ? "Raw prices, not split-adjusted"
    : null;
  const statValue = (loading: boolean, value: string) => (loading ? "Loading" : value);

  return (
    <>
      <header className="rounded-2xl border border-line bg-surface p-6 shadow-[0_14px_36px_-26px_rgba(0,0,0,0.95)]">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-mono text-2xl leading-9 font-semibold tracking-tight text-ink sm:text-[28px]">
              {quote.symbol}
            </h1>
            <p className="mt-1 break-words text-lg leading-7 font-semibold text-copy">
              {quote.name.trim() || "Name unavailable"}
            </p>
            <p className="mt-2 text-sm leading-6 text-copy">
              {quote.sector?.trim() || "Sector unavailable"}
              {quote.exchange ? ` · ${quote.exchange}` : ""}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">Cached end-of-day data</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{quote.source === "massive" ? "Raw last close" : "Last close"}</p>
            <p className="text-3xl leading-9 font-semibold tabular-nums text-ink">{price}</p>
            <p className={["mt-2 text-sm leading-6 tabular-nums", changeUp ? "text-up" : changeDown ? "text-down" : "text-copy"].join(" ")}>
              {change}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">As of {asOfDate(quote.as_of)}</p>
            {quote.source ? <p className="mt-1 text-[12px] leading-4 text-muted">Source {quote.source}</p> : null}
          </div>
          <Link
            className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-canvas hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            to={`/trades?symbol=${encodeURIComponent(quote.symbol)}`}
          >
            Paper trade {quote.symbol}
          </Link>
        </div>
      </header>

      <section aria-labelledby="market-metrics-title" className="overflow-hidden rounded-xl border border-[#385383] bg-[#233250] shadow-[0_12px_30px_-24px_rgba(0,0,0,0.95)]">
        <h2 className="sr-only" id="market-metrics-title">Market metrics</h2>
        <dl className="grid grid-cols-2 divide-x divide-y divide-[#385383] sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Day move" value={change} />
          <Stat detail={rawRangeNote ?? rangePosition(quote.price, stats.low, stats.high)} label="52-week range" value={historyError ? "unavailable" : `${stats.low == null || stats.high == null ? "unavailable" : `${formatCurrency(stats.low)} — ${formatCurrency(stats.high)}`}`} />
          <Stat detail={historyError ? null : `1Y avg ${stats.averageVolume == null ? "unavailable" : formatQuantity(Math.round(stats.averageVolume))}`} label="Last volume" value={quote.volume == null ? "unavailable" : formatQuantity(quote.volume)} />
          <Stat detail="Annualized from stored daily returns" label="Volatility (1Y)" value={calculated.volatility == null ? "unavailable" : formatPercent(calculated.volatility)} />
          <Stat detail="Peak-to-trough from stored closes" label="Max drawdown (1Y)" value={calculated.drawdown == null ? "unavailable" : formatPercent(calculated.drawdown)} />
          <Stat label="Market cap" value={statValue(researchLoading, researchFailed ? "unavailable" : wholeMoney(research?.market_cap))} />
          <Stat label="P/E" value={statValue(researchLoading, researchFailed ? "unavailable" : multiple(research?.pe_ratio))} />
          <Stat detail={hasSecPeriod ? period : research?.profit_margin != null && !researchLoading ? "Period unavailable" : null} label={hasSecPeriod ? "SEC margin" : "Profit margin"} value={statValue(researchLoading, researchFailed ? "unavailable" : marginText(research?.profit_margin))} />
        </dl>
      </section>

      <div aria-label="Cached price returns" className="flex flex-wrap gap-2">
        {calculated.returns.map(([range, value]) => (
          <span className="rounded-md border border-[#385383] bg-[#1b2944] px-2 py-1 text-xs font-semibold tabular-nums text-copy" key={range}>
            {range} <span className={value == null ? "text-muted" : value >= 0 ? "text-up" : "text-down"}>{value == null ? "unavailable" : formatSignedPercent(value)}</span>
          </span>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="min-w-0">
          {historyLoading ? <p className="text-sm leading-6 text-copy" role="status">Loading daily prices</p> : historyError ? (
            <div className="rounded-xl border border-line bg-surface p-6"><p className="text-sm leading-6 text-copy" role="alert">{historyError}</p><button className="mt-4 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={onRetryHistory} type="button">Retry daily prices</button></div>
          ) : (
            <PriceChart bars={bars} coverageStatus={coverageStatus} endDate={endDate} seriesLabel={priceSeries === "raw" ? "Massive raw prices. Split-adjusted bars are not cached." : "Massive split-adjusted prices."} sma20={sma20} sma50={sma50} symbol={quote.symbol} />
          )}
        </div>
        <TechnicalScorecard loading={indicatorsLoading} price={quote.price} rsi={rsi} sma20={sma20} sma50={sma50} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <UnavailablePanel title="AI forecast">
          No forecast is available for this symbol. Sentinel does not generate price targets, confidence bands, or advice from cached market data.
        </UnavailablePanel>
        <section aria-labelledby="company-news-title" className="min-w-0 rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-lg leading-7 font-semibold text-ink" id="company-news-title">News &amp; sentiment</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Sentiment scoring is unavailable; cached headlines are not scored.</p>
          </div>
          <div className="max-h-96 overflow-y-auto p-6">
            {!isAuthenticated ? (
              <div>
                <p className="text-sm leading-6 text-copy">Sign in to read company headlines.</p>
                <Link className="mt-3 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" to="/login">Sign in</Link>
              </div>
            ) : newsLoading ? (
              <p className="text-sm leading-6 text-copy" role="status">Loading company news</p>
            ) : newsError ? (
              <div><p className="text-sm leading-6 text-copy" role="alert">Company news could not be loaded.</p><button className="mt-3 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={onRetryNews} type="button">Retry news</button></div>
            ) : articles.length === 0 ? (
              <p className="text-sm leading-6 text-copy" role="status">{newsMessage ?? "No company headlines"}</p>
            ) : (
              <ul aria-label="Company headlines" className="space-y-4">
                {articles.map((article, index) => <li className="min-w-0" key={`${article.url}-${article.published_at}-${index}`}><a className="inline-flex min-h-11 items-center break-words text-sm font-semibold leading-6 text-ink underline decoration-line underline-offset-4 hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" href={article.url} rel="noopener noreferrer" target="_blank">{article.headline}</a>{article.summary ? <p className="mt-1 break-words text-sm leading-6 text-copy">{article.summary}</p> : null}<p className="mt-1 text-[12px] leading-4 text-muted">{article.source} · {article.published_at}</p></li>)}
              </ul>
            )}
          </div>
        </section>
      </div>

      <UnavailablePanel title="Strategy backtest">
        No strategy backtest is available. Sentinel does not simulate strategy performance, final value, returns, or trade counts from this page.
      </UnavailablePanel>
    </>
  );
}
