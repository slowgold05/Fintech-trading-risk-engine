import axios from "axios";
import { apiClient } from "../../../api/client";
import type { HistoryResponse } from "../../../api/history";
import type { Coverage, Decimal, NightError, Provenance, SessionDate } from "../../api";

export type Mode = "backtest" | "recurring";
export type Strategy = { id: Mode; label: string; description: string };
export type Request = { symbol: string; start: SessionDate; end: SessionDate; initial_usd: Decimal; monthly_usd?: Decimal };
export type Simulation = {
  symbol: string; mode: Mode; coverage: Coverage; source: Provenance | null;
  start_used: SessionDate | null; end_used: SessionDate | null; contributed_usd: Decimal | null;
  end_value_usd: Decimal | null; price_return: Decimal | null;
  points: { session_date: SessionDate; value_usd: Decimal; contributed_usd: Decimal }[];
  skipped_months: string[]; assumptions: string[];
};

// Paired core snapshot: the inclusive SPY window has 252 of 252 expected closes.
export const defaults: Request = { symbol: "SPY", start: "2025-11-17", end: "2026-11-17", initial_usd: "10000.00" };

export async function runSimulation(mode: Mode, request: Request) {
  const { data } = await apiClient.post<Simulation>("/night/simulations/" + mode, request);
  return data;
}

export function failureDetail(error: unknown) {
  if (axios.isAxiosError<NightError>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail?.message === "string") return [detail.message, ...Object.values(detail.fields ?? {})].join(" ");
  }
  return "The simulation service could not be reached. Run again to retry.";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
export const money = (value: Decimal | null) => value === null ? "Unavailable" : usd.format(Number(value));
export const priceReturn = (value: number | string | null) => value === null ? "Unavailable" : percent.format(Number(value));
export const exchangeToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export function windowLimit(start: string, today: string) {
  if (!start) return today;
  const date = new Date(start + "T00:00:00Z");
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 3);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  const limit = date.toISOString().slice(0, 10);
  return limit < today ? limit : today;
}

export type PricePoint = { date: string; close: Decimal; ratio: number };
export function matchingPrices(result: Simulation, history: HistoryResponse): PricePoint[] | null {
  if (!result.source || history.symbol !== result.symbol || history.provider !== result.source.provider ||
      history.adjustment_type !== "split_adjusted" || result.source.basis !== history.adjustment_type) return null;
  const closes = new Map(history.bars.filter(bar => bar.provider === history.provider &&
    bar.adjustment_type === history.adjustment_type && bar.quality_status === "valid").map(bar => [bar.session_date, bar.close]));
  const first = Number(closes.get(result.start_used ?? ""));
  if (!Number.isFinite(first) || first <= 0) return null;
  const points: PricePoint[] = [];
  for (const { session_date } of result.points) {
    const close = closes.get(session_date);
    const value = Number(close);
    if (!close || !Number.isFinite(value) || value <= 0) return null;
    points.push({ date: session_date, close, ratio: value / first - 1 });
  }
  const last = points.at(-1);
  if (!last || points[0].date !== result.start_used || last.date !== result.end_used || result.price_return === null ||
      Math.abs(last.ratio - Number(result.price_return)) > 0.00000051) return null;
  return points;
}
