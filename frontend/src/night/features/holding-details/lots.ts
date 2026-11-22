import { apiClient } from "../../../api/client";
import { formatCurrency, formatQuantity } from "../../../utils/format";
import type { Coverage, Page, Provenance } from "../../api";
import { numeric } from "../portfolio/valuation";

export const pageSize = 25;
type Reading = string | null;
type Lot = { id:number; recorded_at:string; quantity_remaining:string; cost_per_share:string; cost_basis_usd:string; unrealized_pnl_usd:Reading };
type Sale = { trade_id:number; order_id:number | null; executed_at:string; quantity:string; fill_price:string; proceeds_usd:string; realized_pnl_usd:string; demo_seed:boolean };
export type HoldingLots = {
  symbol:string; read_at:string; book_started_on:string | null; coverage:Coverage; quantity:string;
  cost_basis_usd:Reading; market_value_usd:Reading; unrealized_pnl_usd:Reading; realized_pnl_usd:Reading;
  mark:{price:string;source:Provenance} | null; lots:Page<Lot>; sales:Page<Sale>; reason:string | null;
};
export function money(raw: Reading) {
  const amount = numeric(raw);
  return amount === null ? "Unavailable" : formatCurrency(amount);
}
export function units(raw: string) {
  const amount = numeric(raw);
  return amount === null ? "Unavailable" : formatQuantity(amount);
}
export async function readLots(symbol:string, lotCursor:string | null, saleCursor:string | null, signal:AbortSignal) {
  const params = {limit:pageSize,lot_cursor:lotCursor,sale_cursor:saleCursor};
  return (await apiClient.get<HoldingLots>("/night/holdings/" + encodeURIComponent(symbol) + "/lots",{params,signal})).data;
}
