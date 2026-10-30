import { type FormEvent, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchTrades } from "../api/trades";
import { cancelOrder, createOrder, fetchOrders } from "../api/orders";
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
import type {
  CreateOrderPayload,
  TradeResponse,
  TradeSide,
} from "../types/schemas";

function getTradeStatus(trade: TradeResponse) {
  return trade.id ? "Executed" : "Pending";
}

export function Trades() {
  const [side, setSide] = useState<TradeSide>("buy");
  const pendingOrder = useRef<{ payload: string; key: string } | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const tradesQuery = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
  });
  const ordersQuery = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });

  const orderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: async (result) => {
      pendingOrder.current = null;
      showToast("success", result.trade_ids?.length
        ? `Order ${result.status}; ${result.trade_ids.length / 2} match(es).`
        : `Order ${result.status}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio", "pnl"] }),
        queryClient.invalidateQueries({ queryKey: ["risk"] }),
      ]);
    },
    onError: (error) => {
      const detail =
        isAxiosError(error) && typeof error.response?.data?.detail === "string"
          ? error.response.data.detail
          : "Order submission failed.";
      showToast("error", detail);
    },
  });
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
    const quantity = Number(formData.get("quantity"));
    const priceInput = String(formData.get("price") ?? "").trim();
    const price = priceInput ? Number(priceInput) : null;

    if (!symbol || !Number.isFinite(quantity) || quantity <= 0) {
      showToast("error", "Enter a symbol and quantity greater than zero.");
      return;
    }
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      showToast("error", "Enter a positive limit price or leave it blank for a market order.");
      return;
    }

    const payload: CreateOrderPayload = {
      symbol,
      side,
      quantity,
      order_type: price !== null ? "limit" : "market",
    };

    if (price !== null) {
      payload.limit_price = price;
    }

    const fingerprint = JSON.stringify(payload);
    if (pendingOrder.current?.payload !== fingerprint) {
      pendingOrder.current = { payload: fingerprint, key: crypto.randomUUID() };
    }
    orderMutation.mutate({ ...payload, idempotencyKey: pendingOrder.current.key });
  }

  const trades = tradesQuery.data?.trades ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Trades"
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
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Side</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide("buy")}
                  aria-pressed={side === "buy"}
                  aria-label="Buy"
                  className={[
                    "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold tracking-wide transition duration-200",
                    side === "buy"
                      ? "bg-emerald-400 text-slate-950 shadow-[0_0_20px_-4px_rgb(52_211_153_/_0.55)]"
                      : "border border-slate-700/80 bg-slate-900/60 text-slate-500 hover:border-emerald-400/50 hover:text-emerald-400",
                  ].join(" ")}
                >
                  <ArrowUp className="size-4 shrink-0" weight="bold" />
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setSide("sell")}
                  aria-pressed={side === "sell"}
                  aria-label="Sell"
                  className={[
                    "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold tracking-wide transition duration-200",
                    side === "sell"
                      ? "bg-rose-500 text-white shadow-[0_0_20px_-4px_rgb(244_63_94_/_0.5)]"
                      : "border border-slate-700/80 bg-slate-900/60 text-slate-500 hover:border-rose-400/50 hover:text-rose-400",
                  ].join(" ")}
                >
                  <ArrowDown className="size-4 shrink-0" weight="bold" />
                  SELL
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Symbol
                </span>
                <input
                  aria-label="Trade symbol"
                  className="field-control font-mono uppercase"
                  name="symbol"
                  placeholder="AAPL"
                  required
                  type="text"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Asset</span>
                <div className="field-control">Stock</div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Quantity
                </span>
                <input
                  aria-label="Trade quantity"
                  className="field-control text-right font-mono"
                  min="0"
                  name="quantity"
                  placeholder="100"
                  required
                  step="0.000001"
                  type="number"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Price
                </span>
                <input
                  aria-label="Limit price"
                  className="field-control text-right font-mono"
                  min="0"
                  name="price"
                  placeholder="Blank = market"
                  step="0.01"
                  type="number"
                />
              </label>
            </div>

            <div className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Execution</span>
                <span className="font-mono text-slate-100">Resting order price</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Risk check</span>
                <span className="text-slate-300">20% reference band</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">A recent cached stock quote is required. Leave price blank for a market order.</p>
            </div>

            <button
              aria-label="Submit trade order"
              className={[
                "primary-action",
                side === "sell" ? "!bg-rose-500 hover:!bg-rose-400 !text-white focus:!ring-rose-400/60" : "",
              ].join(" ")}
              disabled={orderMutation.isPending}
              type="submit"
            >
              {orderMutation.isPending
                ? "Submitting…"
                : side === "buy" ? "Submit Buy Order" : "Submit Sell Order"}
            </button>
          </form>
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
