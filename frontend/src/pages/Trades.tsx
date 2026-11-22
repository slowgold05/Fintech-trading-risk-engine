import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, useSearchParams } from "react-router-dom";
import { fetchTrades, TRADE_ACTIVITY_LIMIT, type ActivityTrade } from "../api/trades";
import { fetchTradeRisk } from "../api/risk";
import { cancelOrder, fetchOrders, ORDER_ACTIVITY_LIMIT } from "../api/orders";
import { OrderDetails } from "../components/OrderDetails";
import { OrderTicket } from "../components/OrderTicket";
import { useToast } from "../context/useToast";
import { keys, refreshExecution } from "../night/api";
import { Button, Field, Page, Panel, Stat, State, Table } from "../night/inner";
import { ExecutionFlow } from "../night/features/execution/ExecutionFlow";
import { formatCurrency, formatQuantity, formatUtcDateTime } from "../utils/format";
import { readPersistedOrderAttempt } from "../utils/orderAttemptStorage";
import type { OrderResponse, TradeResponse, TradeRiskResponse } from "../types/schemas";
import "../night/features/execution/execution.css";

function Value({ label, value }: { label: string; value: string }) {
  return <><span className="execution-mobile-label" aria-hidden="true">{label}</span><span className="execution-number">{value}</span></>;
}

function tradeTimestamp(trade: TradeResponse) {
  if (trade.demo_seed) return trade.executed_at.slice(0, 10);
  // The legacy trades endpoint serializes UTC database timestamps without the zone.
  return formatUtcDateTime(trade.executed_at) ?? formatUtcDateTime(`${trade.executed_at}Z`) ?? "Unavailable";
}

function tradeOrigin(trade: ActivityTrade) {
  if (trade.demo_seed) return "Demo seed";
  if (trade.simulated_quote_date) {
    return `Paper fill · ${trade.simulated_quote_date} · ${trade.simulated_quote_source ?? "Provider unavailable"}`;
  }
  return trade.asset_type;
}

function TradeRisk({ trade, owner }: { trade: TradeResponse; owner?: number }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `trade-risk-${trade.id}`;
  const label = `Risk for ${trade.symbol} trade ${trade.id}`;
  const query = useQuery({
    queryKey: owner ? keys.account(owner, "risk", "trade", trade.id) : ["trade-risk", trade.id],
    queryFn: () => fetchTradeRisk(trade.id),
    enabled: expanded,
    retry: false,
  });

  return (
    <>
      <Button aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} aria-label={label}
        onClick={() => setExpanded((value) => !value)}>Risk</Button>
      {expanded && (
        <div id={panelId} role="region" aria-label={label} aria-busy={query.isLoading} className="execution-risk">
          {query.isLoading ? <p>Loading...</p> : query.isError ? (
            <>
              <p>Risk detail could not be loaded.</p>
              <Button busy={query.isFetching} onClick={() => void query.refetch()}>Retry risk</Button>
            </>
          ) : query.data && <TradeRiskDetail data={query.data} />}
        </div>
      )}
    </>
  );
}

function TradeRiskDetail({ data }: { data: TradeRiskResponse }) {
  if ("message" in data) return <p>{data.message}</p>;
  return (
    <>
      <p>Risk score <strong>{data.risk_score}</strong></p>
      {data.alerts.length === 0 ? <p>No alerts triggered.</p> : (
        <ul>{data.alerts.map((alert) => (
          <li key={`${alert.rule_code}-${alert.created_at}-${alert.reason}`}>
            <strong>{alert.rule_code}</strong> · <span>{alert.severity}</span><p>{alert.reason}</p>
          </li>
        ))}</ul>
      )}
    </>
  );
}

function cancellationError(orderId: number, error: unknown): string {
  if (isAxiosError(error) && error.response) {
    const { status, data } = error.response;
    if (status === 409) return `Order ${orderId}: cancellation conflict. The latest status changed.`;
    if (status < 500) {
      return typeof data?.detail === "string"
        ? `Order ${orderId}: ${data.detail}`
        : `Order ${orderId}: cancellation was rejected.`;
    }
  }
  return `Order ${orderId}: cancellation could not be confirmed.`;
}

function useFilteredTrades(trades: readonly ActivityTrade[] | undefined, filter: string) {
  return useMemo(() => (trades ?? []).filter(trade => trade.symbol.toUpperCase().includes(filter)), [trades, filter]);
}

type TradesProps = {
  owner?: number;
  canTrade?: boolean;
  open?: boolean;
  onOpen?: () => void;
  receiptId?: number | null;
  onSelectOrder?: (id: number | null) => void;
};

export function Trades({ owner, canTrade = true, open = true, onOpen, receiptId, onSelectOrder }: TradesProps = {}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const [filterInput, setFilterInput] = useState("");
  const entrySymbol = (params.get("symbol") ?? "").trim().toUpperCase();
  const filter = filterInput.trim().toUpperCase();
  const [localId, setLocalId] = useState<number | null>(null);
  const selectedOrderId = receiptId === undefined ? localId : receiptId;
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<{ id: number; message: string } | null>(null);
  const [refreshIssue, setRefreshIssue] = useState(false);
  const detailTriggers = useRef(new Map<number, HTMLButtonElement>());
  const filterRef = useRef<HTMLInputElement>(null);
  const returnToTicket = useRef(false);
  const cancelLock = useRef(false);

  const ordersKey = owner ? keys.account(owner, "orders", ORDER_ACTIVITY_LIMIT) : ["orders"];
  const tradesQuery = useQuery({
    queryKey: owner ? keys.account(owner, "trades", TRADE_ACTIVITY_LIMIT) : ["trades"],
    queryFn: fetchTrades,
    retry: false,
  });
  const ordersQuery = useQuery({ queryKey: ordersKey, queryFn: fetchOrders, retry: false });
  const orders = ordersQuery.data?.orders ?? [];

  const visibleOrders = orders.filter((order) => !filter || order.symbol.toUpperCase().includes(filter));
  const visibleTrades = useFilteredTrades(tradesQuery.data?.trades, filter);
  const selectedVisible = selectedOrderId !== null && (receiptId !== undefined ||
    (!ordersQuery.isError && orders.some((order) => order.id === selectedOrderId)));
  const openOrders = ordersQuery.isSuccess ? visibleOrders.filter(order => order.status === "open") : [];
  const ticketOpen = canTrade && open;
  const hasPendingAttempt = canTrade && !ticketOpen && readPersistedOrderAttempt(owner) !== null;

  const cancelMutation = useMutation({ mutationFn: cancelOrder, retry: false });

  function selectReceipt(id: number | null) {
    if (owner === undefined || receiptId === undefined) {
      (onSelectOrder ?? setLocalId)(id);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete("ticket");
    if (id === null) next.delete("order");
    else next.set("order", String(id));
    setParams(next);
  }

  async function refreshAfterCancel(orderId: number) {
    if (owner !== undefined) {
      await refreshExecution(queryClient, owner);
      return !queryClient.getQueryState(ordersKey)?.error &&
        !queryClient.getQueriesData({
          queryKey: keys.account(owner, "receipt", orderId), type: "active",
          predicate: (query) => query.state.status === "error",
        }).length;
    }
    const results = await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["orders"] }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: ["portfolio"] }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: ["order-detail", orderId] }, { throwOnError: true }),
    ]);
    return results.every((result) => result.status === "fulfilled");
  }

  function notify(type: "success" | "error", message: string) {
    try {
      showToast(type, message);
    } catch {
      // A toast failure does not affect the order.
    }
  }

  async function handleCancel(orderId: number) {
    if (cancelLock.current) return;
    cancelLock.current = true;
    setCancelBusy(true);
    setCancelNotice(null);
    setRefreshIssue(false);
    try {
      try {
        await cancelMutation.mutateAsync(orderId);
        setCancelNotice({ id: orderId, message: `Order ${orderId} was canceled.` });
        if (!owner) notify("success", "Order canceled.");
      } catch (error) {
        const message = cancellationError(orderId, error);
        setCancelNotice({ id: orderId, message });
        notify("error", message);
      }
      setRefreshIssue(!(await refreshAfterCancel(orderId)));
    } catch {
      setRefreshIssue(true);
    } finally {
      cancelLock.current = false;
      setCancelBusy(false);
    }
  }

  function closeDetails() {
    selectReceipt(null);
    queueMicrotask(() => {
      const target = selectedOrderId === null ? undefined : detailTriggers.current.get(selectedOrderId);
      (target?.isConnected ? target : filterRef.current)?.focus();
    });
  }

  function toggleTicket(nextOpen: boolean) {
    if (!owner && nextOpen) {
      onOpen?.();
      return;
    }
    if (!nextOpen) returnToTicket.current = true;
    const next = new URLSearchParams(params);
    if (nextOpen) {
      next.set("ticket", "1");
      next.delete("order");
    } else {
      next.delete("ticket");
    }
    setParams(next);
  }

  function orderActions(order: OrderResponse) {
    const expanded = selectedVisible && selectedOrderId === order.id;
    return (
      <div className="execution-actions">
        <Button aria-expanded={expanded} aria-controls={expanded ? "order-details-panel" : undefined}
          aria-label={`Details for ${order.symbol} order ${order.id}`}
          onClick={(event) => {
            detailTriggers.current.set(order.id, event.currentTarget);
            if (expanded) closeDetails();
            else selectReceipt(order.id);
          }}>Details</Button>
        {canTrade && order.status === "open" && !expanded && (
          <Button variant="danger" busy={cancelBusy} data-testid="activity-order-cancel"
            aria-label={`Cancel ${order.symbol} order ${order.id}`}
            onClick={() => { void handleCancel(order.id); }}>Cancel</Button>
        )}
      </div>
    );
  }

  return (
    <Page title="Activity" eyebrow="Paper execution" layout="analysis" className="execution-view"
      actions={canTrade && !ticketOpen && (
        <button className="nk-button" type="button" data-variant="primary" data-testid="order-open" ref={(node) => {
          if (node && returnToTicket.current) {
            returnToTicket.current = false;
            node.focus();
          }
        }} onClick={() => toggleTicket(true)}>
          {hasPendingAttempt ? "Resume pending order" : "Open order ticket"}
        </button>
      )}>
      {ticketOpen && (
        <Page.Aside className="execution-entry">
          <Panel title="Paper order ticket" actions={owner && <Button onClick={() => toggleTicket(false)}>Close ticket</Button>}>
            <OrderTicket key={`${owner ?? ""}:${entrySymbol}`} owner={owner}
              onSubmitted={owner !== undefined || onSelectOrder ? selectReceipt : undefined} />
          </Panel>
        </Page.Aside>
      )}
      <Page.Main className="execution-activity">
        {selectedVisible && selectedOrderId !== null && (
          <OrderDetails key={`${owner ?? ""}:${selectedOrderId}`} owner={owner} orderId={selectedOrderId} onClose={closeDetails}
            onCancel={canTrade ? () => { void handleCancel(selectedOrderId); } : undefined} cancelBusy={cancelBusy}
            cancelMessage={cancelNotice?.id === selectedOrderId ? cancelNotice.message : undefined} />
        )}
        <div className="execution-overview">
          <ExecutionFlow trades={visibleTrades} status={
            tradesQuery.isError ? {kind:"error", title:"Execution flow unavailable", action:<Button busy={tradesQuery.isFetching} onClick={() => void tradesQuery.refetch()}>Retry execution flow</Button>} :
            tradesQuery.isPending ? {kind:"loading", title:"Reading fill values…"} :
            !visibleTrades.length ? {kind:"empty", title:filter ? "No fills for this ticker." : "Executed trades supply the dated fill values."} : undefined
          } />
          <Panel title="Recent book" className="execution-book">
            <div className="execution-counts">
              <Stat label="Orders" value={ordersQuery.isSuccess ? visibleOrders.length : null}/>
              <Stat label="Open" value={ordersQuery.isSuccess ? openOrders.length : null}/>
              <Stat label="Fills" value={tradesQuery.isSuccess ? visibleTrades.length : null}/>
            </div>
            <div className="execution-filter">
              <Field id="activity-ticker" label="Filter by ticker">
                <input ref={filterRef} data-testid="activity-symbol" maxLength={20}
                  autoComplete="off" spellCheck={false} placeholder="All symbols"
                  value={filterInput} onChange={(event) => setFilterInput(event.target.value.toUpperCase())} />
              </Field>
              {filterInput && <Button onClick={() => { setFilterInput(""); filterRef.current?.focus(); }}>Clear filter</Button>}
              <p>Up to {ORDER_ACTIVITY_LIMIT} recent orders and {TRADE_ACTIVITY_LIMIT} recent trades. Filters apply to these records.</p>
            </div>
            {openOrders.length > 0 && <div className="working-orders"><h3>Latest open orders</h3>
              <ul>{openOrders.slice(0,3).map(order => <li key={order.id}>
                <button type="button" onClick={event => {
                  detailTriggers.current.set(order.id, event.currentTarget);
                  selectReceipt(order.id);
                }}><strong>{order.symbol} · #{order.id}</strong><span>{formatQuantity(order.remaining_quantity)} unfilled</span></button>
              </li>)}</ul>
            </div>}
            {canTrade && <details className="execution-tools"><summary>Activity tools</summary><nav aria-label="Activity tools">
              <Link to="/activity/inbox">Activity inbox</Link>
              <Link to="/activity/alerts">Close alerts</Link>
              <Link to="/activity/journal">Trade journal</Link>
            </nav></details>}
          </Panel>
        </div>
        {cancelNotice && (!selectedVisible || cancelNotice.id !== selectedOrderId) && (
          <p className="execution-notice" role="status">{cancelNotice.message}</p>
        )}
        {refreshIssue && <p className="execution-error" role="status">Latest state could not be loaded.</p>}
        <Panel title="Your Orders">
          {ordersQuery.isPending ? <State kind="loading" title="Loading orders…" /> : ordersQuery.isError ? (
            <State kind="error" title="Orders could not be loaded."
              action={<Button busy={ordersQuery.isFetching} onClick={() => void ordersQuery.refetch()}>Retry orders</Button>} />
          ) : visibleOrders.length === 0 ? (
            <State kind="empty" title={filter ? "No orders match this ticker." : "No orders yet."} />
          ) : (
            <div className="execution-table execution-orders"><Table caption="Recent order activity" rows={visibleOrders} rowKey={(order) => order.id}
              columns={[
                { key: "symbol", header: "Order", cell: (order) => <><strong>{order.symbol}</strong><small>Order {order.id} · {order.side} · {order.order_type}</small></> },
                { key: "qty", header: "Requested", align: "right", cell: (order) => <Value label="Requested" value={formatQuantity(order.quantity)} /> },
                { key: "remaining", header: "Unfilled", align: "right", cell: (order) => <Value label="Unfilled" value={formatQuantity(order.remaining_quantity)} /> },
                { key: "limit", header: "Limit", align: "right", cell: (order) => <Value label="Limit" value={order.limit_price === null ? "Market" : formatCurrency(order.limit_price)} /> },
                { key: "status", header: "Status", cell: (order) => <span data-order-status={order.status}>{order.status}</span> },
                { key: "actions", header: "Actions", cell: orderActions },
              ]} /></div>
          )}
        </Panel>
        <Panel title="Trade history">
          {tradesQuery.isPending ? <State kind="loading" title="Loading trade history…" /> : tradesQuery.isError ? (
            <State kind="error" title="Trade history could not be loaded."
              action={<Button busy={tradesQuery.isFetching} onClick={() => void tradesQuery.refetch()}>Retry trades</Button>} />
          ) : visibleTrades.length === 0 ? (
            <State kind="empty" title={filter ? "No trades match this ticker." : "No trade history yet."} />
          ) : (
            <div className="execution-table execution-trades"><Table caption="Executed trades" rows={visibleTrades} rowKey={(trade) => trade.id}
              columns={[
                { key: "symbol", header: "Trade", cell: (trade) => <><strong>{trade.symbol}</strong><small>{trade.side} · {tradeOrigin(trade)}</small></> },
                { key: "quantity", header: "Quantity", align: "right", cell: (trade) => <Value label="Quantity" value={formatQuantity(trade.quantity)} /> },
                { key: "price", header: "Fill price", align: "right", cell: (trade) => <Value label="Fill price" value={formatCurrency(trade.price_at_execution)} /> },
                { key: "pnl", header: "Realized P&L", align: "right", cell: (trade) => <Value label="Realized P&L" value={Number.isFinite(trade.realized_pnl) ? formatCurrency(trade.realized_pnl) : "Unavailable"} /> },
                { key: "time", header: "Executed", cell: (trade) => <Value label={trade.demo_seed ? "Seed date" : "Executed"} value={tradeTimestamp(trade)} /> },
                { key: "risk", header: "Risk detail", cell: (trade) => <TradeRisk trade={trade} owner={owner} /> },
              ]} /></div>
          )}
        </Panel>
      </Page.Main>
    </Page>
  );
}
