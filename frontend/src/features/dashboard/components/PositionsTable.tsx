import { formatPercent, formatQuantity } from "../../../utils/format";
import { EmptyState } from "./EmptyState";
import { SkeletonBlock } from "./SkeletonBlock";
import type { Position } from "../types";

type PositionsTableProps = {
  positions: Position[];
  isLoading: boolean;
};

export function PositionsTable({ positions, isLoading }: PositionsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((item) => (
          <SkeletonBlock className="h-10" key={item} />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <EmptyState
        detail="Open positions will appear after buy trades settle in the portfolio."
        message="No open positions to display."
      />
    );
  }

  return (
    <div className="table-shell">
      <table className="data-table min-w-[420px]">
        <thead>
          <tr>
            <th className="text-left">Symbol</th>
            <th className="text-right">Quantity</th>
            <th className="text-right">Change %</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr
              className={[
                "border-l-2",
                position.risk === "High"
                  ? "border-l-rose-400/70"
                  : position.risk === "Medium"
                    ? "border-l-amber-400/70"
                    : "border-l-emerald-400/70",
              ].join(" ")}
              key={position.symbol}
            >
              <td>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-12 items-center justify-center rounded border border-slate-800 bg-slate-900 font-mono text-xs font-semibold text-slate-200">
                    {position.symbol}
                  </span>
                  <div>
                    <div className="font-medium leading-5 text-slate-100">
                      {position.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {formatQuantity(position.quantity)} units /{" "}
                      {position.risk} risk
                    </div>
                  </div>
                </div>
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatQuantity(position.quantity)}
              </td>
              <td className="text-right">
                <span
                  className={[
                    "inline-flex items-center justify-end gap-1 font-mono tabular-nums",
                    position.changePercent >= 0
                      ? "text-emerald-300"
                      : "text-rose-300",
                  ].join(" ")}
                >
                  <span aria-hidden="true">
                    {position.changePercent >= 0 ? "▲" : "▼"}
                  </span>
                  {formatPercent(Math.abs(position.changePercent))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
