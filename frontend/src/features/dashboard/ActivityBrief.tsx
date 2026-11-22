import { Link } from "react-router-dom";
import { Panel } from "../../night/kit";
import type { OrderResponse, TradeResponse } from "../../types/schemas";
import { formatCurrency, formatQuantity, formatUtcDateTime } from "../../utils/format";

export function ActivityBrief({ fills, orders, loadingFills, loadingOrders }: { fills?: TradeResponse[]; orders?: OrderResponse[]; loadingFills: boolean; loadingOrders: boolean }) {
  const fill = fills?.[0];
  const order = orders?.find(row => row.status === "open");
  return <Panel title="Activity at a glance" className="today-activity">
    <dl><dt>Latest fill</dt><dd data-testid="today-fill">{fill ?
      <><strong>{fill.side === "buy" ? "Bought" : "Sold"} {formatQuantity(fill.quantity)} {fill.symbol}</strong>
        <span>At {formatCurrency(fill.price_at_execution)} · {fill.demo_seed ? "Demo seed" : "Paper fill"}</span>
        <small>{formatUtcDateTime(fill.executed_at) ?? (/^\d{4}-\d{2}-\d{2}T/.test(fill.executed_at) ? "Execution date " + fill.executed_at.slice(0, 10) : "Execution date unavailable")}</small></> :
      loadingFills ? "Loading fills…" : fills ? "No recorded fills." : "Fill data unavailable."}</dd>
      <dt>Latest open order</dt><dd data-testid="today-open-order">{order ?
        <><Link to={'/trades?order=' + order.id}>Order #{order.id} · {order.symbol}</Link>
          <span>{order.side} · {formatQuantity(order.remaining_quantity)} shares remaining</span></> :
        loadingOrders ? "Loading orders…" : orders ? "None in the latest 50 orders." : "Order data unavailable."}</dd>
    </dl>
  </Panel>;
}
