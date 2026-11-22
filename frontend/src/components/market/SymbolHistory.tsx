import { keys } from "../../night/api";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyHistory, type HistoryRange } from "../../api/history";
import { Sparkline } from "../Sparkline";
import { Skeleton } from "../../design/primitives";
import { useAdjustedProvider } from "./useAdjustedProvider";
const HISTORY_ADJUSTMENT = "split_adjusted";
export function SymbolSparkline({
  className,
  empty = "hidden",
  range,
  symbol,
}: {
  className?: string;
  empty?: "hidden" | "compact";
  range: HistoryRange;
  symbol: string;
}) {
  const { provider, pending } = useAdjustedProvider();
  const historyProvider = provider ?? "massive";
  const historyQuery = useQuery({
    queryKey: keys.history(symbol, historyProvider ?? "auto", HISTORY_ADJUSTMENT, range),
    queryFn: () => fetchDailyHistory(symbol, historyProvider, HISTORY_ADJUSTMENT, range),
    placeholderData: (previous) =>
      previous?.symbol === symbol &&
      previous.provider === historyProvider &&
      previous.adjustment_type === HISTORY_ADJUSTMENT
        ? previous
        : undefined,
    enabled: !pending && symbol.trim().length > 0,
    retry: false,
    staleTime: 300000,
  });
  const series = historyQuery.data;
  const bars =
    series &&
    series.symbol === symbol &&
    series.provider === historyProvider &&
    series.adjustment_type === HISTORY_ADJUSTMENT &&
    series.status !== "unavailable" &&
    (series.range === range || historyQuery.isPlaceholderData)
      ? [...series.bars]
          .filter((b) => Number(b.close) > 0 && Number.isFinite(Number(b.close)))
          .sort((a, b) => a.session_date.localeCompare(b.session_date))
      : [];
  if (bars.length >= 2 && series) {
    const source = `${historyProvider} · split-adjusted · ${series.available_end ?? "Date unavailable"}${historyQuery.isRefetchError ? " · Refresh failed" : ""}${historyQuery.isPlaceholderData ? " · Loading " + range.toUpperCase() : ""}`;
    return (
      <span
        className="symbol-trace"
        aria-busy={historyQuery.isPlaceholderData}
        data-source={source}
        title={source}
        aria-description={source}
      >
        <Sparkline
          className={className}
          label={`${symbol} closing prices over ${series.range.toUpperCase()}`}
          values={bars.map((b) => Number(b.close))}
          dates={bars.map((b) => b.session_date)}
        />
      </span>
    );
  }

  if (empty === "compact" && (historyQuery.isError || historyQuery.isSuccess)) {
    return (
      <span aria-label={`No closing prices for ${symbol}`} className="font-mono text-sm text-slate-300">
        <span className="sr-only">No stored closes</span>
      </span>
    );
  }

  if (historyQuery.isLoading) return <Skeleton label="Loading closing prices" className="spark-skeleton" />;
  return <p className="section-note">No stored closes for this range.</p>;
}
