import { apiClient } from "../../../api/client";
import { formatCurrency, formatPercent } from "../../../utils/format";
import type { Coverage, Decimal } from "../../api";
import { numeric } from "../portfolio/valuation";

export const periods = { "1m": "1 month", "3m": "3 months", ytd: "Year to date", "1y": "1 year" } as const;
export type Period = keyof typeof periods;
type Reading = Decimal | null;
export type Point = { session_date: string; portfolio_return_ratio: Reading; spy_return_ratio: Reading; drawdown_ratio: Reading };
export type Review = {
  window: Period; read_at: string; coverage: Coverage; requested_start: string | null; requested_end: string | null;
  start_used: string | null; end_used: string | null; expected_sessions: number; valued_sessions: number;
  missing_sessions: string[]; points: Point[]; assumptions: string[];
  observations: {symbol: string; provider: string; basis: string; from_date: string; to_date: string}[];
  metrics: {
    return_ratio: Reading; spy_return_ratio: Reading; excess_return_ratio: Reading;
    max_drawdown_ratio: Reading; annualized_volatility_ratio: Reading; beta_to_spy: Reading; correlation_to_spy: Reading;
    daily_sample_count: number; paired_sample_count: number;
  };
  exposure: {
    as_of: string | null; coverage: Coverage; cash_weight_ratio: Reading; unpriced_symbols: string[];
    sectors: { sector: string; value_usd: Reading; weight_ratio: Reading }[];
  };
  contribution: { coverage: Coverage; scope: "period"; items: {symbol: string; pnl_usd: Reading}[]; residual_usd: Reading; reason: string | null };
};
export async function fetchReview(window: Period, signal: AbortSignal) {
  return (await apiClient.get<Review>("/night/portfolio/review", { params: {window}, signal })).data;
}
export function pct(raw: Reading) {
  const value = numeric(raw);
  return value === null ? "Unavailable" : formatPercent(100 * value);
}
export function usd(raw: Reading) {
  const value = numeric(raw);
  return value === null ? "Unavailable" : formatCurrency(value);
}
export function dates(from: string | null, to: string | null) {
  return from && to ? from + " – " + to : "Unavailable";
}
