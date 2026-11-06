import { formatQuantity } from "../../../utils/format";
import type { OrderResponse } from "../../../types/schemas";
import { EmptyState } from "./EmptyState";
import { SkeletonBlock } from "./SkeletonBlock";

type RecentOrdersTableProps = {
  orders: OrderResponse[] | null;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
};

const orderLimitFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function formatOrderLimit(
  orderType: OrderResponse["order_type"],
  limitPrice: number | null,
) {
  if (limitPrice == null) {
    return orderType === "market" ? "Market" : "Unavailable";
  }
  return orderLimitFormatter.format(limitPrice);
}

export function RecentOrdersTable({
  orders,
  isLoading,
  isError = false,
  onRetry,
}: RecentOrdersTableProps) {
  if (isError) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
        <p>Orders could not be loaded.</p>
        {orders != null ? (
          <p className="mt-1 text-xs leading-5 text-rose-200/80">
            A previously loaded order list is not shown as current.
          </p>
        ) : null}
        {onRetry ? (
          <button
            className="mt-3 rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition duration-200 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            onClick={onRetry}
            type="button"
          >
            Retry orders
          </button>
        ) : null}
      </div>
    );
  }

  if (isLoading || orders == null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((item) => (
          <SkeletonBlock className="h-10" key={item} />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        detail="The newest orders for this account will appear here."
        message="No orders"
      />
    );
  }

  return (
    <div className="table-shell">
      <table className="data-table min-w-[720px]">
        <thead>
          <tr>
            <th className="text-left">Symbol</th>
            <th className="text-left">Side / type</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Remaining</th>
            <th className="text-left">Status</th>
            <th className="text-right">Limit</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              className={[
                "border-l-2",
                order.side === "buy" ? "border-l-emerald-400/70" : "border-l-rose-400/70",
              ].join(" ")}
              key={order.id}
            >
              <td>
                <div className="font-mono text-sm font-semibold text-slate-100">
                  {order.symbol}
                </div>
              </td>
              <td>
                <span
                  className={[
                    "risk-chip",
                    order.side === "buy"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : "border-rose-400/40 bg-rose-400/10 text-rose-300",
                  ].join(" ")}
                >
                  {order.side.toUpperCase()}
                </span>
                <span className="ml-2 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                  {order.order_type}
                </span>
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatQuantity(order.quantity)}
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatQuantity(order.remaining_quantity)}
              </td>
              <td>
                <span
                  className={[
                    "risk-chip",
                    order.status === "filled"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : order.status === "open"
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                        : "border-slate-500/40 bg-slate-500/10 text-slate-300",
                  ].join(" ")}
                >
                  {order.status}
                </span>
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatOrderLimit(order.order_type, order.limit_price)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
