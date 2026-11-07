import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchTrades } from "../api/trades";
import { cancelOrder, fetchOrders } from "../api/orders";
import { OrderTicket } from "../components/OrderTicket";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  PnlValue,
  SkeletonBlock,
} from "../features/dashboard/components";
import { useToast } from "../context/useToast";
import {
  formatDateTime,
  formatCurrency,
  formatQuantity,
} from "../utils/format";
import type { TradeResponse } from "../types/schemas";

function getTradeStatus(trade: TradeResponse) {
  return trade.id ? "Executed" : "Pending";
}

export function Trades() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const tradesQuery = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
  });
  const ordersQuery = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });

  const cancelMutation = useMutation({
    mutationFn: cancelOrder,
    onSuccess: async () => {
      showToast("success", "Order canceled.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
      ]);
    },
    onError: (error) => {
      const detail = isAxiosError(error) && typeof error.response?.data?.detail === "string"
        ? error.response.data.detail : "Order cancellation failed.";
      showToast("error", detail);
    },
  });

  const trades = tradesQuery.data?.trades ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Order Management"
        description="Submit orders and review execution history with risk-aware trade context."
      />

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <DashboardCard
          action={
            <span className="font-mono text-xs text-slate-500">Ticket</span>
          }
          title="Order Entry"
        >
          <OrderTicket />
        </DashboardCard>

        <DashboardCard
          action={
            <span className="font-mono text-xs text-slate-500">
              {tradesQuery.isLoading ? "--" : `${trades.length} rows`}
            </span>
          }
          title="Trade History"
        >
          {tradesQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((item) => (
                <SkeletonBlock className="h-10" key={item} />
              ))}
            </div>
          ) : tradesQuery.isError ? (
            <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
              Trade history could not be loaded. Check the API server and
              authentication state.
            </div>
          ) : trades.length === 0 ? (
            <EmptyState
              action={
                <span className="text-xs font-medium text-emerald-300">
                  Use the order ticket to submit the first trade.
                </span>
              }
              detail="Matched orders appear here with execution price, timestamp, and realized P&L."
              message="No trade history yet."
            />
          ) : (
            <div className="table-shell max-h-[620px]">
              <table className="data-table min-w-[780px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-left">Side</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Timestamp</th>
                    <th className="text-right">Status</th>
                    <th className="text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr
                      className={[
                        "border-l-2",
                        trade.side === "buy"
                          ? "border-l-emerald-400/70"
                          : "border-l-rose-400/70",
                      ].join(" ")}
                      key={trade.id}
                    >
                      <td>
                        <div className="font-mono text-sm font-semibold text-slate-100">
                          {trade.symbol}
                        </div>
                        <div className="font-mono text-[11px] uppercase text-slate-500">
                          {trade.asset_type}
                        </div>
                      </td>
                      <td>
                        <span
                          className={[
                            "risk-chip",
                            trade.side === "buy"
                              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                              : "border-rose-400/40 bg-rose-400/10 text-rose-300",
                          ].join(" ")}
                        >
                          {trade.side}
                        </span>
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {formatQuantity(trade.quantity)}
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {formatCurrency(trade.price_at_execution)}
                      </td>
                      <td className="text-right font-mono tabular-nums text-slate-400">
                        {formatDateTime(trade.executed_at)}
                      </td>
                      <td className="text-right">
                        <span className="status-badge border-slate-700 bg-slate-900 text-slate-300">
                          {getTradeStatus(trade)}
                        </span>
                      </td>
                      <td className="text-right">
                        {Number.isFinite(trade.realized_pnl) ? (
                          <PnlValue value={trade.realized_pnl} />
                        ) : (
                          <span className="font-mono text-slate-500">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>
      </div>
      <DashboardCard title="Your Orders">
        {ordersQuery.isLoading ? <SkeletonBlock className="h-24" /> : ordersQuery.isError ? (
          <p className="text-sm text-rose-300">Orders could not be loaded.</p>
        ) : !ordersQuery.data?.orders.length ? (
          <p className="text-sm text-slate-400">No orders yet.</p>
        ) : (
          <div className="table-shell">
            <table className="data-table min-w-[650px]">
              <thead><tr><th className="text-left">Symbol</th><th className="text-left">Side</th><th className="text-left">Type</th><th className="text-right">Remaining</th><th className="text-right">Price</th><th className="text-left">Status</th><th className="text-right">Action</th></tr></thead>
              <tbody>{ordersQuery.data.orders.map((order) => (
                <tr key={order.id}>
                  <td className="font-mono font-semibold">{order.symbol}</td>
                  <td className="capitalize">{order.side}</td>
                  <td className="capitalize">{order.order_type}</td>
                  <td className="text-right font-mono">{formatQuantity(order.remaining_quantity)}</td>
                  <td className="text-right font-mono">{order.limit_price === null ? "Market" : formatCurrency(order.limit_price)}</td>
                  <td className="capitalize">{order.status}</td>
                  <td className="text-right">{order.status === "open" && (
                    <button type="button" className="text-sm text-rose-300 hover:text-rose-200" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(order.id)} aria-label={`Cancel ${order.symbol} order ${order.id}`}>Cancel</button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </DashboardCard>
    </div>
  );
}
