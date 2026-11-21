import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { fetchOrderDetail, type OrderDetailResponse, type OrderFill } from "../api/orderDetails";
import { keys } from "../night/api";
import { Button, State, Table } from "../night/kit";
import { formatUtcDateTime } from "../utils/format";

const PAGE_SIZE = 50;
const zero = "0.000000";

function executionSummary(detail: OrderDetailResponse): string {
  const hasFills = detail.filled_quantity !== zero;
  if (detail.status === "canceled") {
    return hasFills ? "Canceled with executed quantity." : "Canceled with no quantity executed.";
  }
  if (detail.status === "open") {
    return hasFills ? "Open and partially executed." : "Open with no quantity executed yet.";
  }
  return "Filled.";
}

function FillSource({ fill }: { fill: OrderFill }) {
  if (fill.mode === "order_book") return <small>Paper order-book match</small>;
  const date = fill.source?.session_date ?? fill.simulated_quote_date;
  const provider = fill.source?.provider;
  return (
    <small data-testid="close-provenance" data-source={provider ?? ""} data-session-date={date ?? ""} data-basis="raw">
      Paper fill at cached close · {date ?? "Session unavailable"} · {provider ?? "Provider unavailable"} · raw close
    </small>
  );
}

const utc = (value: string | null) => formatUtcDateTime(value) ?? "Unavailable";
const usd = (value: string) => `${value} USD`;

export function OrderDetails({ owner, orderId, onClose, onCancel, cancelBusy, cancelMessage }: {
  owner?: number;
  orderId: number;
  onClose: () => void;
  onCancel?: () => void;
  cancelBusy?: boolean;
  cancelMessage?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [afterId, setAfterId] = useState<number | undefined>();
  const detailQuery = useQuery({
    queryKey: owner ? keys.account(owner, "receipt", orderId, afterId ?? null) : ["order-detail", orderId, afterId ?? null],
    queryFn: ({ signal }) =>
      fetchOrderDetail(orderId, afterId == null ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, afterId }, signal),
    retry: false,
  });
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const detail = detailQuery.data;
  const missing = isAxiosError(detailQuery.error) && detailQuery.error.response?.status === 404;

  return (
    <section id="order-details-panel" aria-label={`Order ${orderId} details`} className="execution-receipt nk-panel">
      <header>
        <h2 ref={heading} tabIndex={-1}>Order {orderId}</h2>
        <Button onClick={onClose}>Close</Button>
      </header>
      {cancelMessage && <p className="execution-notice" role="status">{cancelMessage}</p>}
      {detailQuery.isError ? (
        <State kind={missing ? "unavailable" : "error"}
          title={missing ? "Order unavailable." : "Order details could not be loaded."}
          action={<Button busy={detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>Retry</Button>} />
      ) : detail?.order_id !== orderId ? (
        <State kind="loading" title="Loading order details…" aria-busy="true" />
      ) : (
        <div data-testid="order-receipt" data-order-id={detail.order_id}
          role="region" aria-label={`Receipt for ${detail.symbol} order ${orderId}`} className="execution-receipt-body">
          <div className="execution-receipt-summary">
            <div>
              <p className="execution-receipt-title">{detail.symbol} <span>{detail.side} · {detail.order_type}</span></p>
              <p role="status">{executionSummary(detail)}</p>
            </div>
            <div className="execution-actions">
              {detail.status === "open" && onCancel && (
                <Button variant="danger" busy={cancelBusy} data-testid="order-cancel"
                  aria-label={`Cancel ${detail.symbol} order ${orderId}`} onClick={onCancel}>Cancel order</Button>
              )}
              {detail.total_fill_count > 0 && detail.filled_quantity !== zero && (
                <Link className="nk-button" data-testid="receipt-holding"
                  to={`/portfolio#holding-${encodeURIComponent(detail.symbol)}`}>View {detail.symbol} holding</Link>
              )}
            </div>
          </div>
          <dl className="execution-receipt-values">
            <div><dt>Original</dt><dd>{detail.quantity}</dd></div>
            <div><dt>Filled</dt><dd>{detail.filled_quantity}</dd></div>
            <div><dt>Remaining</dt><dd>{detail.remaining_quantity}</dd></div>
            <div>
              <dt>{detail.side === "sell" ? "Reserved shares" : "Reserved cash"}</dt>
              <dd>{detail.reservation ? `${detail.reservation.amount} ${detail.reservation.unit}` : "Unavailable"}</dd>
            </div>
          </dl>
          <dl className="execution-receipt-meta">
            <div><dt>Limit</dt><dd>{detail.limit_price === null ? "Market" : usd(detail.limit_price)}</dd></div>
            <div><dt>Created</dt><dd>{utc(detail.created_at)}</dd></div>
            <div><dt>Read</dt><dd>{utc(detail.read_at)}</dd></div>
            {detail.status === "canceled" && <div><dt>Canceled</dt><dd>{utc(detail.canceled_at)}</dd></div>}
          </dl>
          {detail.remainder_reason && <p>{detail.remainder_reason}</p>}

          <section className="execution-recorded" aria-label="Recorded fills">
            <h3>Recorded fills</h3>
            <p className="execution-muted">{detail.total_fill_count} recorded {detail.total_fill_count === 1 ? "fill" : "fills"} on this order.</p>
            {detail.total_fill_count === 0 ? (
              <p>No recorded fills.</p>
            ) : detail.fills.length === 0 ? (
              <p>This page has no recorded fills. Return to the first page.</p>
            ) : (
              <div className="execution-table execution-fills"><Table caption="Fill details" rows={detail.fills} rowKey={(fill) => fill.trade_id}
                columns={[
                  { key: "trade", header: "Trade", cell: (fill) => <><strong data-testid="fill-trade-id">{fill.trade_id}</strong><FillSource fill={fill} /></> },
                  { key: "qty", header: "Shares", align: "right", cell: (fill) => <FillValue label="Shares">{fill.quantity}</FillValue> },
                  { key: "price", header: "Execution price", align: "right", cell: (fill) => <FillValue label="Execution price">{usd(fill.execution_price)}</FillValue> },
                  { key: "notional", header: "Notional", align: "right", cell: (fill) => <FillValue label="Notional">{usd(fill.notional)}</FillValue> },
                  { key: "pnl", header: "Realized P&L", align: "right", cell: (fill) => <FillValue label="Realized P&L">{usd(fill.realized_pnl)}</FillValue> },
                  { key: "time", header: "Executed", cell: (fill) => <FillValue label="Executed">{utc(fill.executed_at)}</FillValue> },
                ]} /></div>
            )}
            {(afterId !== undefined || detail.has_more) && (
              <div className="execution-actions">
                <Button disabled={afterId === undefined} busy={detailQuery.isFetching} onClick={() => setAfterId(undefined)}>First page</Button>
                <Button disabled={!detail.has_more} busy={detailQuery.isFetching}
                  onClick={() => setAfterId(detail.next_after_id ?? undefined)}>Next</Button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function FillValue({ label, children }: { label: string; children: string }) {
  return <><span className="execution-mobile-label" aria-hidden="true">{label}</span><span className="execution-number">{children}</span></>;
}
