import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrderDetail, type OrderDetailResponse } from "../api/orderDetails";
import { SkeletonBlock } from "../features/dashboard/components";
import { formatUtcDateTime } from "../utils/format";

const PAGE_SIZE = 50;

function isExactZero(value: string): boolean {
  return /^(?:0+|0+\.0+)$/.test(value.trim());
}

function utcLabel(value: string | null | undefined): string {
  return formatUtcDateTime(value) ?? "Unavailable";
}

function moneyLabel(value: string, currency: string): string {
  return `${value} ${currency}`;
}

function executionSummary(detail: OrderDetailResponse): string {
  const executed = !isExactZero(detail.filled_quantity);
  if (detail.status === "canceled" && executed) return "Canceled with executed quantity.";
  if (detail.status === "canceled") return "Canceled with no quantity executed.";
  if (detail.status === "open" && executed) return "Open and partially executed.";
  if (detail.status === "open") return "Open with no quantity executed yet.";
  if (detail.status === "filled") return "Filled.";
  return detail.status;
}

function canceledLabel(detail: OrderDetailResponse): string {
  if (detail.canceled_at == null && detail.status !== "canceled") return "Not canceled";
  return utcLabel(detail.canceled_at);
}

export function OrderDetails({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const [afterId, setAfterId] = useState<number | undefined>(undefined);
  const afterKey = afterId ?? null;
  const detailQuery = useQuery({
    queryKey: ["order-detail", orderId, afterKey],
    queryFn: ({ signal }) =>
      fetchOrderDetail(orderId, afterId == null ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, afterId }, signal),
  });

  const detail = detailQuery.isError ? undefined : detailQuery.data;
  const pageMatches = detail != null && detail.order_id === orderId;

  return (
    <section
      id="order-details-panel"
      aria-label={`Order ${orderId} details`}
      className="mt-4 min-w-0 border-t border-slate-800 pt-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200">Order {orderId}</h3>
        <button
          type="button"
          className="inline-flex min-h-11 items-center px-3 text-sm text-slate-300 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {detailQuery.isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
          <p>Order details could not be loaded.</p>
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-emerald-300 hover:text-emerald-200 disabled:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            disabled={detailQuery.isFetching}
            onClick={() => {
              void detailQuery.refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : !pageMatches || detail == null ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-24" />
        </div>
      ) : (
        <DetailBody
          detail={detail}
          onFirstPage={() => setAfterId(undefined)}
          onNextPage={() => {
            if (detail.next_after_id != null) setAfterId(detail.next_after_id);
          }}
          cursorActive={afterId != null}
          pagingLocked={detailQuery.isFetching}
        />
      )}
    </section>
  );
}

function DetailBody({
  detail,
  onFirstPage,
  onNextPage,
  cursorActive,
  pagingLocked,
}: {
  detail: OrderDetailResponse;
  onFirstPage: () => void;
  onNextPage: () => void;
  cursorActive: boolean;
  pagingLocked: boolean;
}) {
  const currency = detail.currency;
  const emptyWholeOrder = detail.total_fill_count === 0;
  const emptyPage = detail.fills.length === 0;

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-slate-300">{executionSummary(detail)}</p>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-400">Symbol</dt>
          <dd className="font-mono font-semibold text-slate-100">{detail.symbol}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Side</dt>
          <dd className="capitalize text-slate-200">{detail.side}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Type</dt>
          <dd className="capitalize text-slate-200">{detail.order_type}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Status</dt>
          <dd className="capitalize text-slate-200">{detail.status}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Original</dt>
          <dd className="font-mono tabular-nums text-slate-100">{detail.quantity}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Filled</dt>
          <dd className="font-mono tabular-nums text-slate-100">{detail.filled_quantity}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Remaining</dt>
          <dd className="font-mono tabular-nums text-slate-100">{detail.remaining_quantity}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Limit</dt>
          <dd className="font-mono tabular-nums text-slate-100">
            {detail.limit_price == null ? "Market" : moneyLabel(detail.limit_price, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Created</dt>
          <dd className="font-mono text-slate-300">{utcLabel(detail.created_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Canceled</dt>
          <dd className="font-mono text-slate-300">{canceledLabel(detail)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Read</dt>
          <dd className="font-mono text-slate-300">{utcLabel(detail.read_at)}</dd>
        </div>
      </dl>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-200">Recorded fills</h4>
          <p className="text-xs text-slate-400">
            Whole order: {detail.total_fill_count} recorded {detail.total_fill_count === 1 ? "fill" : "fills"}. This table is the current page only.
          </p>
        </div>
        {emptyWholeOrder ? (
          <p className="text-sm text-slate-400">No recorded fills.</p>
        ) : emptyPage ? (
          <p className="text-sm text-slate-400">This page has no recorded fills. Return to the first page.</p>
        ) : (
          <div className="table-shell max-h-[32rem] min-w-0 overflow-auto">
            <table className="data-table min-w-[720px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left">Trade</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Execution price</th>
                  <th className="text-right">Notional</th>
                  <th className="text-right">Realized P&L</th>
                  <th className="text-right">Executed</th>
                </tr>
              </thead>
              <tbody>
                {detail.fills.map((fill) => (
                  <tr key={fill.trade_id}>
                    <td className="font-mono text-slate-100">{fill.trade_id}</td>
                    <td className="text-right font-mono tabular-nums">{fill.quantity}</td>
                    <td className="text-right font-mono tabular-nums">{moneyLabel(fill.execution_price, currency)}</td>
                    <td className="text-right font-mono tabular-nums">{moneyLabel(fill.notional, currency)}</td>
                    <td className="text-right font-mono tabular-nums">{moneyLabel(fill.realized_pnl, currency)}</td>
                    <td className="text-right font-mono text-slate-400">{utcLabel(fill.executed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-3 text-sm text-slate-200 hover:text-white disabled:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            disabled={!cursorActive || pagingLocked}
            onClick={onFirstPage}
          >
            First page
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-3 text-sm text-emerald-300 hover:text-emerald-200 disabled:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            disabled={pagingLocked || !detail.has_more || detail.next_after_id == null}
            onClick={onNextPage}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
