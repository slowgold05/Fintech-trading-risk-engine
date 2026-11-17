import { type ReactNode } from "react";
import { isAxiosError } from "axios";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketResearch, fetchSymbolQuote } from "../api/market";
import { fetchDailyHistory } from "../api/history";
import { fetchResearchNews } from "../api/research";
import { PriceChart } from "../components/PriceChart";
import { useAuth } from "../context/useAuth";
import type { MarketResearchResponse, SymbolQuoteResponse } from "../types/schemas";
import { trailingYearStats } from "../components/priceChartData";
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
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-2 break-words text-sm leading-6 tabular-nums text-ink">{value}</dd>
      {detail ? <dd className="mt-1 text-[12px] leading-4 text-muted">{detail}</dd> : null}
    </div>
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
  // The 52-week range comes from the plotted series, so say when that series is unadjusted.
  const rawRangeNote = priceSeries === "raw" && !historyLoading && !historyError
    ? "Raw prices, not split-adjusted"
    : null;
  const statValue = (loading: boolean, value: string) => (loading ? "Loading" : value);

  return (
    <>
      <header className="rounded-2xl border border-line bg-surface p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">End-of-day data</p>
        <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
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

      {historyLoading ? (
        <p className="text-sm leading-6 text-copy" role="status">Loading daily prices</p>
      ) : historyError ? (
        <div className="rounded-2xl border border-line bg-surface p-6">
          <p className="text-sm leading-6 text-copy" role="alert">{historyError}</p>
          <button
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            onClick={onRetryHistory}
            type="button"
          >
            Retry daily prices
          </button>
        </div>
      ) : (
        <PriceChart
          bars={bars}
          coverageStatus={coverageStatus}
          endDate={endDate}
          seriesLabel={
            priceSeries === "raw"
              ? "Massive raw prices. Split-adjusted bars are not cached."
              : "Massive split-adjusted prices."
          }
          symbol={quote.symbol}
        />
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section aria-labelledby="key-stats-title" className="min-w-0 rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-lg leading-7 font-semibold text-ink" id="key-stats-title">Key stats</h2>
          </div>
          <dl className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-3">
            <Stat detail={rawRangeNote} label="52-week high" value={historyError ? "unavailable" : statValue(historyLoading, stats.high == null ? "unavailable" : formatCurrency(stats.high))} />
            <Stat detail={rawRangeNote} label="52-week low" value={historyError ? "unavailable" : statValue(historyLoading, stats.low == null ? "unavailable" : formatCurrency(stats.low))} />
            <Stat
              label="Avg volume (52-week)"
              value={historyError
                ? "unavailable"
                : statValue(historyLoading, stats.averageVolume == null ? "unavailable" : formatQuantity(stats.averageVolume))}
            />
            <Stat label="Market cap" value={statValue(researchLoading, researchFailed ? "unavailable" : wholeMoney(research?.market_cap))} />
            <Stat label="P/E" value={statValue(researchLoading, researchFailed ? "unavailable" : multiple(research?.pe_ratio))} />
            <Stat
              detail={hasSecPeriod ? period : research?.profit_margin != null && !researchLoading ? "Period unavailable" : null}
              label={hasSecPeriod ? "SEC margin" : "Profit margin"}
              value={statValue(researchLoading, researchFailed ? "unavailable" : marginText(research?.profit_margin))}
            />
          </dl>
        </section>

        <section aria-labelledby="company-news-title" className="min-w-0 rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-lg leading-7 font-semibold text-ink" id="company-news-title">Company news</h2>
          </div>
          <div className="max-h-96 overflow-y-auto p-6">
            {!isAuthenticated ? (
              <div>
                <p className="text-sm leading-6 text-copy">Sign in to read company headlines.</p>
                <Link
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  to="/login"
                >
                  Sign in
                </Link>
              </div>
            ) : newsLoading ? (
              <p className="text-sm leading-6 text-copy" role="status">Loading company news</p>
            ) : newsError ? (
              <div>
                <p className="text-sm leading-6 text-copy" role="alert">Company news could not be loaded.</p>
                <button
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-sm font-semibold text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  onClick={onRetryNews}
                  type="button"
                >
                  Retry news
                </button>
              </div>
            ) : articles.length === 0 ? (
              <p className="text-sm leading-6 text-copy" role="status">{newsMessage ?? "No company headlines"}</p>
            ) : (
              <ul aria-label="Company headlines" className="space-y-4">
                {articles.map((article, index) => (
                  <li className="min-w-0" key={`${article.url}-${article.published_at}-${index}`}>
                    <a
                      className="inline-flex min-h-11 items-center break-words text-sm font-semibold leading-6 text-ink underline decoration-line underline-offset-4 hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      href={article.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {article.headline}
                    </a>
                    {article.summary ? <p className="mt-1 break-words text-sm leading-6 text-copy">{article.summary}</p> : null}
                    <p className="mt-1 text-[12px] leading-4 text-muted">
                      {article.source} · {article.published_at}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
