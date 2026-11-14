import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchTrades } from "../api/trades";
import { fetchTradeRisk } from "../api/risk";
import { cancelOrder, fetchOrders } from "../api/orders";
import { OrderDetails } from "../components/OrderDetails";
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
import { getRiskTone } from "../utils/riskTone";
import type { TradeResponse, TradeRiskResponse } from "../types/schemas";

function getTradeStatus(trade: TradeResponse) {
  return trade.id ? "Executed" : "Pending";
}

function hasNoAssessment(
  data: TradeRiskResponse,
): data is { message: string } {
  return "message" in data;
}

function TradeHistoryRow({ trade }: { trade: TradeResponse }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `trade-risk-${trade.id}`;
  const riskQuery = useQuery({
    queryKey: ["trade-risk", trade.id],
    queryFn: () => fetchTradeRisk(trade.id),
    enabled: expanded,
  });

  return (
    <>
      <tr
        className={[
          "border-l-2",
          trade.side === "buy"
            ? "border-l-emerald-400/70"
            : "border-l-rose-400/70",
        ].join(" ")}
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
        <td className="text-right">
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-2 text-sm text-emerald-300 hover:text-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`Risk for ${trade.symbol} trade ${trade.id}`}
            onClick={() => setExpanded((open) => !open)}
          >
            Risk
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td className="bg-slate-950/40 px-4 py-3" colSpan={8}>
            <div
              aria-busy={riskQuery.isLoading}
              aria-label={`Risk for ${trade.symbol} trade ${trade.id}`}
              id={panelId}
              role="region"
            >
              <TradeRiskDetail
                data={riskQuery.data}
                isError={riskQuery.isError}
                isLoading={riskQuery.isLoading}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TradeRiskDetail({
  data,
  isError,
  isLoading,
}: {
  data: TradeRiskResponse | undefined;
  isError: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading...</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-rose-200">
        Risk detail could not be loaded.
      </p>
    );
  }

  if (data == null) {
    return null;
  }

  if (hasNoAssessment(data)) {
    return <p className="text-sm text-slate-300">{data.message}</p>;
  }

  const tone = getRiskTone(data.risk_score);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Risk score
        </span>
        <span className={["risk-chip", tone.chip].join(" ")}>
          {data.risk_score}
        </span>
      </div>
      {data.alerts.length === 0 ? (
        <p className="text-sm text-slate-400">No alerts triggered.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.alerts.map((alert) => (
            <li
              className="text-sm text-slate-300"
              key={`${alert.rule_code}-${alert.created_at}-${alert.reason}`}
            >
              <span className="font-mono text-slate-100">{alert.rule_code}</span>
              <span className="mx-2 font-mono text-xs uppercase text-slate-500">
                {alert.severity}
              </span>
              <span>{alert.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type CancelNotice = {
  orderId: number;
  outcome: "canceled" | "conflict" | "unconfirmed" | "rejected";
  message: string;
};

function cancelNoticeFor(orderId: number, error: unknown): CancelNotice {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 409) {
      return {
        orderId,
        outcome: "conflict",
        message: `Order ${orderId}: cancellation conflict. The latest status changed.`,
      };
    }
    if (error.response == null || (typeof status === "number" && status >= 500)) {
      return {
        orderId,
        outcome: "unconfirmed",
        message: `Order ${orderId}: cancellation could not be confirmed.`,
      };
    }
    const detail = error.response.data?.detail;
    return {
      orderId,
      outcome: "rejected",
      message: typeof detail === "string" && detail.length > 0
        ? `Order ${orderId}: ${detail}`
        : `Order ${orderId}: cancellation was rejected.`,
    };
  }
  return {
    orderId,
    outcome: "unconfirmed",
    message: `Order ${orderId}: cancellation could not be confirmed.`,
  };
}

export function Trades() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<CancelNotice | null>(null);
  const [refreshIssue, setRefreshIssue] = useState(false);
  const detailTriggers = useRef(new Map<number, HTMLButtonElement>());
  const cancelLock = useRef(false);

  const tradesQuery = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
  });
  const ordersQuery = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
  const orders = ordersQuery.isSuccess ? ordersQuery.data.orders : null;
  const selectedVisible =
    selectedOrderId != null && orders != null && orders.some((order) => order.id === selectedOrderId);

  const cancelMutation = useMutation({ mutationFn: cancelOrder });

  async function refreshAfterCancel(orderId: number): Promise<boolean> {
    try {
      const results = await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["orders"] }, { throwOnError: true }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }, { throwOnError: true }),
        queryClient.invalidateQueries({ queryKey: ["order-detail", orderId] }, { throwOnError: true }),
      ]);
      return results.every((result) => result.status === "fulfilled");
    } catch {
      return false;
    }
  }

  function notify(type: "success" | "error", message: string) {
    try {
      showToast(type, message);
    } catch {
      // A toast failure must not change the cancel outcome.
    }
  }

  async function handleCancel(orderId: number) {
    if (cancelLock.current) return;
    cancelLock.current = true;
    setCancelBusy(true);
    setCancelNotice(null);
    setRefreshIssue(false);
    try {
      await cancelMutation.mutateAsync(orderId);
      setCancelNotice({
        orderId,
        outcome: "canceled",
        message: `Order ${orderId} was canceled.`,
      });
      notify("success", "Order canceled.");
    } catch (error) {
      const notice = cancelNoticeFor(orderId, error);
      setCancelNotice(notice);
      notify("error", notice.message);
    }
    const loaded = await refreshAfterCancel(orderId);
    setRefreshIssue(!loaded);
    if (!loaded) notify("error", "Latest state could not be loaded.");
    cancelLock.current = false;
    setCancelBusy(false);
  }

  function closeDetails() {
    const id = selectedOrderId;
    setSelectedOrderId(null);
    if (id == null) return;
    queueMicrotask(() => detailTriggers.current.get(id)?.focus());
  }

  const trades = tradesQuery.data?.trades ?? [];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Order Management"
        description="Submit orders and review execution history with risk-aware trade context."
      />

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0">
        <DashboardCard
          action={
            <span className="font-mono text-xs text-slate-500">Ticket</span>
          }
          title="Order Entry"
        >
          <OrderTicket />
        </DashboardCard>
        </div>

        <div className="min-w-0">
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
                    <th className="text-right">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <TradeHistoryRow key={trade.id} trade={trade} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>
        </div>
      </div>
      <DashboardCard title="Your Orders">
        {cancelNotice && (
          <p className="mb-3 text-sm text-slate-200" role="status">{cancelNotice.message}</p>
        )}
        {refreshIssue && (
          <p className="mb-3 text-sm text-rose-200" role="status">Latest state could not be loaded.</p>
        )}
        {ordersQuery.isLoading ? <SkeletonBlock className="h-24" /> : ordersQuery.isError ? (
          <div>
            <p className="text-sm text-rose-300">Orders could not be loaded.</p>
            <button
              type="button"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-emerald-300 hover:text-emerald-200 disabled:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              disabled={ordersQuery.isFetching}
              onClick={() => { void ordersQuery.refetch(); }}
            >
              Retry orders
            </button>
          </div>
        ) : !ordersQuery.data?.orders.length ? (
          <p className="text-sm text-slate-400">No orders yet.</p>
        ) : (
          <>
          <div className="table-shell min-w-0">
            <table className="data-table min-w-[650px]">
              <thead><tr><th className="text-left">Symbol</th><th className="text-left">Side</th><th className="text-left">Type</th><th className="text-right">Remaining</th><th className="text-right">Price</th><th className="text-left">Status</th><th className="text-right">Action</th></tr></thead>
              <tbody>{ordersQuery.data.orders.map((order) => {
                const expanded = selectedVisible && selectedOrderId === order.id;
                return (
                <tr key={order.id}>
                  <td className="font-mono font-semibold">{order.symbol}</td>
                  <td className="capitalize">{order.side}</td>
                  <td className="capitalize">{order.order_type}</td>
                  <td className="text-right font-mono">{formatQuantity(order.remaining_quantity)}</td>
                  <td className="text-right font-mono">{order.limit_price === null ? "Market" : formatCurrency(order.limit_price)}</td>
                  <td className="capitalize">{order.status}</td>
                  <td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center px-2 text-sm text-emerald-300 hover:text-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        aria-expanded={expanded}
                        aria-controls="order-details-panel"
                        aria-label={`Details for ${order.symbol} order ${order.id}`}
                        ref={(node) => {
                          if (node) detailTriggers.current.set(order.id, node);
                          else detailTriggers.current.delete(order.id);
                        }}
                        onClick={() => {
                          if (expanded) closeDetails();
                          else setSelectedOrderId(order.id);
                        }}
                      >
                        Details
                      </button>
                      {order.status === "open" && (
                        <button type="button" className="inline-flex min-h-11 items-center px-2 text-sm text-rose-300 hover:text-rose-200 disabled:text-slate-600" disabled={cancelBusy} onClick={() => { void handleCancel(order.id); }} aria-label={`Cancel ${order.symbol} order ${order.id}`}>Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}</tbody>
            </table>
          </div>
          {selectedVisible && selectedOrderId != null && (
            <OrderDetails key={selectedOrderId} orderId={selectedOrderId} onClose={closeDetails} />
          )}
          </>
        )}
      </DashboardCard>
    </div>
  );
}
