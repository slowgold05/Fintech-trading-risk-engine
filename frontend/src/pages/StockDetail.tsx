import { type ReactNode } from "react";
import { isAxiosError } from "axios";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Button, Page, Panel, RestInstrument, ValueGauge } from "../night/inner";
import { allowed, features } from "../night/registry";
import { saveDraft } from "../night/shell/ticketDraft";
import { fetchMe } from "../api/auth";
import { StockDetailSession } from "./StockDetailSession";
import "./StockDetail.css";
import { keys } from "../night/api";
import { useLook } from "../night/looks/preferences";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketResearch, fetchSymbolQuote } from "../api/market";
import { fetchDailyHistory, type AdjustmentType } from "../api/history";
import { fetchDailyIndicators, type IndicatorName } from "../api/indicators";
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
    <div className="discover-company"><div className="company-frame">
      <Link className="company-back" to="/market">Market</Link>
      {children}
    </div></div>
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

function latestIndicatorValue(overlay: IndicatorOverlay | undefined, session: string | undefined): number | null {
  if (!session || overlay?.history.bars.at(-1)?.session_date !== session) return null;
  const value = overlay?.values.at(-1);
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function TechnicalScorecard({
  price,
  session,
  rsi,
  sma20,
  sma50,
  loading,
}: {
  price: number | null;
  session: string | undefined;
  rsi: IndicatorOverlay | undefined;
  sma20: IndicatorOverlay | undefined;
  sma50: IndicatorOverlay | undefined;
  loading: boolean;
}) {
  const rsiValue = latestIndicatorValue(rsi, session);
  const sma20Value = latestIndicatorValue(sma20, session);
  const sma50Value = latestIndicatorValue(sma50, session);
  const comparison = (label: string, value: number | null) => {
    if (price == null || value == null) return { label, detail: "Unavailable", tone: "text-muted" };
    if (price === value) return { label, detail: `Close at ${formatCurrency(value)}`, tone: "text-copy" };
    return price > value
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
      : { label: "SMA 20 vs 50", detail: sma20Value === sma50Value ? "Moving averages equal" : sma20Value > sma50Value ? "Short trend above long trend" : "Short trend below long trend", tone: sma20Value >= sma50Value ? "text-up" : "text-down" },
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

function useStockIndicator(
  symbol: string | null,
  provider: string | null,
  adjustment: AdjustmentType | null,
  name: IndicatorName,
  period: number,
) {
  return useQuery({
    queryKey: keys.indicators(symbol ?? "", provider ?? "", adjustment ?? "", "1y", name, period),
    queryFn: async () => {
      if (!symbol || !provider || !adjustment) throw new Error("Price series unavailable.");
      return fetchDailyIndicators(symbol, provider, adjustment, "1y", name, period);
    },
    select: (payload) => indicatorOverlay(payload, { symbol: symbol!, provider: provider!, adjustment_type: adjustment!, name, period }),
    enabled: symbol !== null && provider !== null && adjustment !== null,
    retry: false,
  });
}

export function StockDetail() {
  const { prefs } = useLook();
  const params = useParams();
  const symbol = readSymbol(params.symbol);
  const { isAuthenticated } = useAuth();
  const identity = useQuery({ queryKey: keys.me, queryFn: fetchMe, enabled: isAuthenticated, retry: false });
  const owner = isAuthenticated ? identity.data : undefined;
  const quoteQuery = useQuery({
    queryKey: keys.quote(symbol ?? ""),
    queryFn: () => fetchSymbolQuote(symbol ?? ""),
    enabled: symbol !== null,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: keys.history(symbol ?? "",prefs.historyProvider,"split_adjusted","2y"),
    queryFn: () => fetchDailyHistory(symbol ?? "", prefs.historyProvider, "split_adjusted", "2y"),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });
  const priceProvider = historyQuery.data?.provider ?? null;
  const priceSeries = historyQuery.data?.adjustment_type ?? null;
  const researchQuery = useQuery({
    queryKey: ["stock-detail", "research", symbol],
    queryFn: () => fetchMarketResearch(symbol ?? ""),
    enabled: symbol !== null && quoteQuery.isSuccess,
    retry: false,
  });
  const newsQuery = useQuery({
    queryKey: keys.account(owner?.id ?? 0, "company-news", symbol),
    queryFn: () => fetchResearchNews(symbol ?? ""),
    enabled: symbol !== null && quoteQuery.isSuccess && !!owner,
    retry: false,
  });
  const rsiQuery = useStockIndicator(symbol, priceProvider, priceSeries, "rsi", 14);
  const sma20Query = useStockIndicator(symbol, priceProvider, priceSeries, "sma", 20);
  const sma50Query = useStockIndicator(symbol, priceProvider, priceSeries, "sma", 50);

  if (symbol === null) {
    return <Frame><RestInstrument status={{kind:"unavailable",role:"alert",title:"This symbol is not in the supported format."}} /></Frame>;
  }

  if (quoteQuery.isError) {
    return <Frame><RestInstrument status={{kind:"error",role:"alert",title:requestDetail(quoteQuery.error, "The quote could not be loaded."),
      action:<Button onClick={() => void quoteQuery.refetch()}>Retry</Button>}} /></Frame>;
  }

  if (!quoteQuery.data) {
    return <Frame><RestInstrument status={{kind:"loading",title:`Loading ${symbol}`}} /></Frame>;
  }

  return (
    <Frame>
      <DetailBody
        historyError={historyQuery.isError ? requestDetail(historyQuery.error, "Daily prices could not be loaded.") : null}
        historyLoading={historyQuery.isLoading}
        priceProvider={priceProvider}
        priceSeries={priceSeries}
        isAuthenticated={isAuthenticated}
        ownerId={owner?.id}
        canTrade={owner?.role === "trader"}
        newsError={newsQuery.isError || identity.isError}
        newsLoading={newsQuery.isLoading || (isAuthenticated && identity.isPending)}
        onRetryHistory={() => {
          void historyQuery.refetch();
        }}
        onRetryNews={() => {
          void (identity.isError ? identity : newsQuery).refetch();
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
  priceProvider,
  priceSeries,
  onRetryHistory,
  research,
  researchLoading,
  researchFailed,
  isAuthenticated,
  ownerId,
  canTrade,
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
  priceProvider: string | null;
  priceSeries: AdjustmentType | null;
  onRetryHistory: () => void;
  research: MarketResearchResponse | undefined;
  researchLoading: boolean;
  researchFailed: boolean;
  isAuthenticated: boolean;
  ownerId?: number;
  canTrade: boolean;
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
  const providerLabel = priceProvider === "massive" ? "Massive" : priceProvider === "yahoo" ? "Yahoo Finance" : priceProvider;
  const seriesLabel = providerLabel
    ? `${providerLabel} ${priceSeries === "raw" ? "raw" : "split-adjusted"} prices.`
    : "Cached daily prices.";
  const rawRangeNote = priceSeries === "raw" && !historyLoading && !historyError
    ? "Raw prices, not split-adjusted"
    : null;
  const statValue = (loading: boolean, value: string) => (loading ? "Loading" : value);

  const lastBar = bars.at(-1);
  const seriesClose = lastBar ? Number(lastBar.close) : null;
  const quoteDate = quote.session_date ?? "unavailable";
  const stale = quoteDate !== "unavailable" &&
    Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(quoteDate) > 7 * 86400000;
  const [params] = useSearchParams();
  const location = useLocation();
  const eventFeature = features.find((feature) => feature.slot === "companyEvents" && allowed(feature.access));
  const Events = eventFeature?.Screen;
  const eventsOpen = Boolean(Events) && params.get("tab") === "events";
  function tabLink(events: boolean) {
    const next = new URLSearchParams(params);
    if (events) next.set("tab", "events");
    else next.delete("tab");
    return { pathname: location.pathname, search: next.toString(), hash: location.hash };
  }
  return (
    <Page title={quote.symbol} description={quote.name.trim() || "Name unavailable"} layout="analysis"
      actions={(!isAuthenticated || canTrade) && <Link className="nk-button" data-variant="primary"
        data-testid="order-open" to={`/trades?symbol=${encodeURIComponent(quote.symbol)}${isAuthenticated ? "&ticket=1" : ""}`}
        onClick={() => { if (ownerId) saveDraft(ownerId, null); }}>Paper trade {quote.symbol}</Link>}>
      <Page.Full className="company-quote">
        <div><span>{quote.source === "massive" ? "Raw last close" : "Last close"}</span><strong>{price}</strong></div>
        <div><span>Day move</span><b data-tone={changeUp ? "up" : changeDown ? "down" : undefined}>{change}</b></div>
        <div><b>Session date {quoteDate}</b><small>{quote.source ?? "Source unavailable"} · <span>{price === "unavailable" ? "No cached end-of-day price" : stale ? "Stale end-of-day price" : "Cached end-of-day data"}</span></small></div>
      </Page.Full>
      {Events && <Page.Full><nav className="company-tabs" aria-label="Company views">
        <Link to={tabLink(false)} aria-current={!eventsOpen ? "page" : undefined}>Overview</Link>
        <Link to={tabLink(true)} aria-current={eventsOpen ? "page" : undefined}>Events</Link>
      </nav></Page.Full>}
      {eventsOpen && Events ? <Page.Full><Events /></Page.Full> : <>
        <Page.Main className="company-chart" data-testid="company-history">
          {historyLoading ? <RestInstrument status={{kind:"loading",title:"Loading daily prices"}} /> : historyError ?
            <RestInstrument status={{kind:"error",role:"alert",title:historyError,action:<Button data-testid="history-retry" onClick={onRetryHistory}>Retry daily prices</Button>}} /> :
            !lastBar ? <RestInstrument status={{kind:"empty",title:`No cached daily bars for ${quote.symbol} in the requested two years.`}} /> :
            <>
              <p className="company-stamp" data-testid="close-provenance" data-session-date={lastBar.session_date}
                data-source={lastBar.provider} data-basis={lastBar.adjustment_type}>
                {lastBar.provider} · {lastBar.adjustment_type.replace("_", "-")} · exchange session {lastBar.session_date}
              </p>
              <PriceChart instrument bars={bars} coverageStatus={coverageStatus} endDate={endDate} seriesLabel={seriesLabel} sma20={sma20} sma50={sma50} symbol={quote.symbol} />
              <StockDetailSession bars={bars} />
            </>}
        </Page.Main>
        <Page.Aside className="company-details">
          <Panel className="company-range" title="Range position">
            <ValueGauge value={seriesClose} min={stats.low ?? NaN} max={stats.high ?? NaN} format={formatCurrency} label="52-week low / high"/>
          </Panel>
          <TechnicalScorecard session={lastBar?.session_date} loading={indicatorsLoading} price={seriesClose} rsi={rsi} sma20={sma20} sma50={sma50} />
          <Panel title="Company details">
            <dl><Stat label="Exchange" value={quote.exchange || "Unavailable"} />
              <Stat label="Sector" value={quote.sector || "Unavailable"} />
              <Stat label="Security type" value={quote.is_etf ? "Exchange-traded fund" : "Stock"} /></dl>
          </Panel>
        </Page.Aside>
        <Page.Full>
          <section aria-labelledby="market-metrics-title" className="company-metrics">
            <h2 className="sr-only" id="market-metrics-title">Market metrics</h2>
            <dl className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
              <Stat label="Day move" value={change} />
              <Stat detail={rawRangeNote ?? rangePosition(seriesClose, stats.low, stats.high)} label="52-week range" value={historyError ? "unavailable" : `${stats.low == null || stats.high == null ? "unavailable" : `${formatCurrency(stats.low)} — ${formatCurrency(stats.high)}`}`} />
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
              <span className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold tabular-nums text-copy" key={range}>
                {range} <span className={value == null ? "text-muted" : value >= 0 ? "text-up" : "text-down"}>{value == null ? "unavailable" : formatSignedPercent(value)}</span>
              </span>
            ))}
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <UnavailablePanel title="AI forecast">
              Forecasts are separate from cached daily prices. <Link className="underline" to="/forecasts">Open Forecast Lab</Link>
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
                    <Link className="mt-3 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`}>Sign in</Link>
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
            This company chart shows observed market prices. Strategy simulation is unavailable here.
          </UnavailablePanel>
        </Page.Full>
      </>}
    </Page>
  );
}
