import type { PerformanceSession } from "../../../api/portfolio";
import type { AllocationResponse, PortfolioPositionResponse } from "../../../types/schemas";

export function numeric(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function hasMark(position: PortfolioPositionResponse) {
  const price = numeric(position.current_price);
  return price !== null && price > 0 && numeric(position.position_value) !== null
    && position.price_status !== "unavailable" && !position.unavailable_reason;
}

export function accountWeight(value: number | null, account: number | null) {
  return value === null || account === null || account <= 0 ? null : 100 * value / account;
}

export function performanceSeries(rows: PerformanceSession[]) {
  const usable = rows.map(row => row.status !== "unavailable" && numeric(row.account_value) !== null);
  const indices = rows.map((row, i) => usable[i] ? numeric(row.twr_index) : null);
  const start = indices.findIndex(value => value !== null && value > 0);
  const base = indices[start];
  const benchmarkBase = numeric(rows[start]?.benchmark_index);
  return {
    start,
    points: rows.map((row, i) => {
      const index = indices[i];
      const comparable = i >= start && index !== null && index >= 0 && base != null && base > 0;
      const spy = numeric(row.benchmark_index);
      return {
        date: row.session_date,
        account: comparable ? (index / base - 1) * 100 : null,
        spy: comparable && benchmarkBase !== null && benchmarkBase > 0 && spy !== null && spy > 0
          ? (spy / benchmarkBase - 1) * 100 : null,
        daily: usable[i] ? numeric(row.daily_pnl) : null,
        cumulative: usable[i] ? numeric(row.cumulative_pnl) : null,
        missing: row.unavailable_symbols ?? [],
      };
    }),
  };
}


export function allocationParts(data: AllocationResponse | undefined) {
  const cash = numeric(data?.cash_weight_pct);
  if (data?.status !== "complete" || cash === null || !data.sectors || (numeric(data.total_account_value) ?? 0) <= 0) return [];
  const parts = [{name:"Cash", value:cash}];
  for (const row of data.sectors) {
    const weight = numeric(row.weight_pct);
    if (weight === null) return [];
    parts.push({name:row.sector, value:weight});
  }
  return parts.sort((a,b)=>b.value-a.value);
}
