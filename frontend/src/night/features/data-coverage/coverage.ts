import { apiClient } from "../../../api/client";
import type { Coverage, Provenance } from "../../api";

type HistorySource = { provider: string; basis: "raw" | "split_adjusted" };
type HistoryCensus = HistorySource & {
  valid_symbols: number; valid_rows: number; flagged_rows: number; rejected_rows: number;
  latest_valid_session: string | null; valid_symbols_on_expected_session: number;
};
type RecentHistory = HistorySource & {
  start: string; end: string; expected_sessions: number; observed_sessions: number;
  missing_recent_sessions: string[]; flagged_or_rejected_sessions: number;
};
export type SymbolCoverage = {
  symbol: string; reason: string | null; history: RecentHistory[];
  quote: { price: string; source: Provenance; execution_reference: "eligible" | "unconfirmed" | "stale" | "unsupported" } | null;
};
type Observation = { cached_rows: number; latest_observed_at: string | null };
export type CoverageReport = {
  read_at: string; expected_session: string; coverage: Coverage;
  universe: { population: "active_non_test_non_etf"; eligible: number };
  quotes: { present: number; missing: number; invalid: number; fresh_eod: number; stale: number; unconfirmed_or_other: number };
  history: HistoryCensus[];
  reference: { news: Observation; filings: Observation; dividends_splits: { mode: "verified_events_only" } };
  symbol: SymbolCoverage | null;
};
export async function readCoverage(symbol: string | null, signal: AbortSignal) {
  return (await apiClient.get<CoverageReport>("/night/data-coverage", { params: { symbol }, signal })).data;
}
