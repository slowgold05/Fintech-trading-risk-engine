import { useQuery } from "@tanstack/react-query";
import { fetchDailyHistory } from "../../../api/history";
import { formatCurrency, formatSignedPercent } from "../../../utils/format";
import { keys } from "../../api";
import { Button, State } from "../../kit";
import { numeric } from "./valuation";

export function CompanyFactors({ symbol }: { symbol: string }) {
  const series = useQuery({
    queryKey: keys.history(symbol, "auto", "split_adjusted", "1m"),
    queryFn: () => fetchDailyHistory(symbol, "auto", "split_adjusted", "1m"),
    retry: false,
  });
  if (series.isPending) return <State kind="loading" title="Loading cached closes…" />;
  if (series.isError) return <State kind="error" title="Company price history unavailable" action={<Button onClick={() => void series.refetch()}>Retry history</Button>} />;
  const { bars, provider, adjustment_type, expected_session_count, coverage_status } = series.data;
  const closes = bars.flatMap(bar => {
    const close = numeric(bar.close);
    return bar.provider === provider && bar.adjustment_type === "split_adjusted" && close !== null && close > 0 ? [{ date: bar.session_date, close }] : [];
  });
  if (adjustment_type !== "split_adjusted" || closes.length < 2) {
    return <State kind="unavailable" title="Company price factors unavailable" detail="Two dated, split-adjusted closes from one provider are required." />;
  }
  const first = closes[0], last = closes[closes.length - 1];
  const peak = Math.max(...closes.map(point => point.close));
  return <div className="company-readings"><dl className="risk-facts">
    <div><dt>Price return</dt><dd>{formatSignedPercent(100 * (last.close / first.close - 1))}</dd></div>
    <div><dt>From highest observed close</dt><dd>{formatSignedPercent(100 * (last.close / peak - 1))}</dd></div>
  </dl><p>{first.date} to {last.date} · {formatCurrency(first.close)} to {formatCurrency(last.close)}</p>
    <small>{provider} · split-adjusted end-of-day closes · {closes.length}{expected_session_count !== null && ` of ${expected_session_count} expected`} sessions · {coverage_status.replaceAll("_", " ")}</small>
  </div>;
}
