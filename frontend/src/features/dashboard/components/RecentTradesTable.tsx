import {
  formatCurrency,
  formatQuantity,
} from "../../../utils/format";
import { EmptyState } from "./EmptyState";
import { PnlValue } from "./PnlValue";
import { SkeletonBlock } from "./SkeletonBlock";
import type { Trade } from "../types";

type RecentTradesTableProps = {
  trades: Trade[] | null;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
};

export function RecentTradesTable({
  trades,
  isLoading,
  isError = false,
  onRetry,
}: RecentTradesTableProps) {
  if (isError) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
        <p>Trades could not be loaded.</p>
        {onRetry ? (
          <button
            className="mt-3 rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition duration-200 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            onClick={onRetry}
            type="button"
          >
            Retry trades
          </button>
        ) : null}
      </div>
    );
  }

  if (isLoading || trades == null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((item) => (
          <SkeletonBlock className="h-10" key={item} />
        ))}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <EmptyState
        detail="Newest executions appear here after an order fills."
        message="No executed trades"
      />
    );
  }

  return (
      <div className="table-shell">
      <table className="data-table min-w-[620px]">
        <thead>
          <tr>
            <th className="text-left">Asset</th>
            <th className="text-left">Side</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Price</th>
            <th className="text-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr
              className={[
                "border-l-2",
                trade.side === "BUY" ? "border-l-emerald-400/70" : "border-l-rose-400/70",
              ].join(" ")}
              key={trade.id}
            >
              <td>
                <div className="font-mono text-sm font-semibold text-slate-100">
                  {trade.symbol}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  {trade.id}
                </div>
              </td>
              <td>
                <span
                  className={[
                    "risk-chip",
                    trade.side === "BUY"
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
                {formatCurrency(trade.price)}
              </td>
              <td className="text-right">
                <PnlValue value={trade.pnl} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
