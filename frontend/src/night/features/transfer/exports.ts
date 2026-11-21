import type { OrderResponse, PortfolioPositionResponse } from "../../../types/schemas";
import { downloadCsv } from "./csv";

export function exportHoldings(positions: readonly PortfolioPositionResponse[]) {
  downloadCsv("holdings.csv",
    ["symbol", "asset_type", "quantity", "avg_cost_usd", "cost_basis_usd", "current_price_usd",
      "position_value_usd", "unrealized_pnl_usd", "price_status", "unavailable_reason", "price_source", "quote_at"],
    positions.map(position => [
      position.symbol, position.asset_type, position.quantity, position.avg_cost, position.cost_basis,
      position.current_price, position.position_value, position.unrealized_pnl, position.price_status,
      position.unavailable_reason, position.source, position.quote_at,
    ]),
  );
}

export function exportOrders(orders: readonly OrderResponse[]) {
  downloadCsv("orders.csv",
    ["order_id", "symbol", "side", "order_type", "quantity", "remaining_quantity", "limit_price_usd", "status",
      "created_at", "simulated_quote_date", "simulated_quote_source", "remainder_reason"],
    orders.map(order => [
      order.id, order.symbol, order.side, order.order_type, order.quantity, order.remaining_quantity,
      order.limit_price, order.status, order.created_at, order.simulated_quote_date,
      order.simulated_quote_source, order.remainder_reason,
    ]),
  );
}
