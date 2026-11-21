export type Close = {
  session_date: string;
  status?: "available" | "unavailable";
  account_value: string | null;
  daily_pnl?: string | null;
  twr_index?: string | null;
  benchmark_index?: string | null;
  unavailable_symbols?: string[];
};

export type CloseHistory = {
  series: Close[];
  demo_price_series?: Record<string, { provider: string; adjustment: string }>;
  split_adjusted_history_sources?: Record<string, string>;
};

export function amount(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function returnBetween(start: string | null | undefined, end: string | null | undefined) {
  const first = amount(start);
  const last = amount(end);
  return first != null && first > 0 && last != null ? (last / first - 1) * 100 : null;
}

export function compareCloses(series: Close[]) {
  // The service orders one row per session. Skip unpriced rows without moving either endpoint.
  const priced = series.filter(row => row.status !== "unavailable" && amount(row.account_value) != null);
  const latest = priced.at(-1);
  const prior = priced.at(-2);
  const gaps = series.filter(row => latest && prior &&
    row.session_date > prior.session_date && row.session_date < latest.session_date);
  const newer = series.filter(row => latest && row.session_date > latest.session_date);
  return { latest, prior, gaps, newer,
    accountReturn: returnBetween(prior?.twr_index, latest?.twr_index),
    spyReturn: returnBetween(prior?.benchmark_index, latest?.benchmark_index) };
}
