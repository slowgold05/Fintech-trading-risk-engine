import {
  formatCurrency,
  formatQuantity,
} from "../../../utils/format";
import { EmptyState } from "./EmptyState";
import { PnlValue } from "./PnlValue";
import { SkeletonBlock } from "./SkeletonBlock";
import type { Trade } from "../types";

type RecentTradesTableProps = {
  trades: Trade[];
  isLoading: boolean;
};

export function RecentTradesTable({
  trades,
  isLoading,
}: RecentTradesTableProps) {
  if (isLoading) {
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
        detail="Submit a quick trade or use the Trades page to create activity."
        message="No trades have been executed today."
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
