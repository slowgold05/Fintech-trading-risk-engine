import { useQuery } from "@tanstack/react-query";
import { fetchPortfolio, fetchPortfolioPnl } from "../api/portfolio";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  PnlValue,
  SkeletonBlock,
} from "../features/dashboard/components";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import type { PortfolioPositionResponse } from "../types/schemas";

function getExposurePercent(positionValue: number, totalValue: number) {
  if (totalValue <= 0) {
    return 0;
  }

  return (positionValue / totalValue) * 100;
}

function getAssetExposure(positions: PortfolioPositionResponse[]) {
  const exposure = positions.reduce<Record<string, number>>((acc, position) => {
    const key = position.asset_type.toUpperCase();
    acc[key] = (acc[key] ?? 0) + position.position_value;
    return acc;
  }, {});

  return Object.entries(exposure)
    .map(([assetType, value]) => ({ assetType, value }))
    .sort((a, b) => b.value - a.value);
}

export function Portfolio() {
  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  const portfolioPnlQuery = useQuery({
    queryKey: ["portfolio", "pnl"],
    queryFn: fetchPortfolioPnl,
    retry: false,
  });

  const portfolio = portfolioQuery.data;
  const summary = portfolio?.summary;
  const positions = portfolio?.positions ?? [];
  const positionsValue = summary?.total_portfolio_value ?? 0;
  const totalValue = summary?.total_account_value ?? positionsValue;
  const cashBalance = summary?.cash_balance ?? 0;
  const totalPnl = portfolioPnlQuery.data?.total_pnl ?? summary?.total_pnl ?? 0;
  const assetExposure = getAssetExposure(positions);

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Portfolio"
        title="Holdings &amp; Valuation"
        description="Open positions, FIFO P&amp;L, cost basis, and exposure breakdown by asset class."
      />

      {portfolioQuery.isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
          Portfolio data could not be loaded. Check the API server and
          authentication state.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {portfolioQuery.isLoading ? (
          [0, 1, 2, 3].map((item) => (
            <div className="metric-tile" key={item}>
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="mt-3 h-5 w-32" />
            </div>
          ))
        ) : (
          <>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Portfolio value
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-50">
                {formatCurrency(totalValue, false)}
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Cash
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-50">
                {formatCurrency(cashBalance, false)}
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Total P&L
              </div>
              <div className="mt-1 text-sm">
                <PnlValue value={totalPnl} />
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Holdings
              </div>
              <div className="mt-1 font-mono text-sm text-slate-200">
                {positions.length}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
        <DashboardCard
          action={
            <span className="font-mono text-xs text-slate-500">
              {portfolioQuery.isLoading ? "--" : `${positions.length} rows`}
            </span>
          }
          title="Holdings"
        >
          {portfolioQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((item) => (
                <SkeletonBlock className="h-10" key={item} />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <EmptyState
              detail="Open holdings will appear after buy trades settle into the portfolio."
              message="No holdings to display."
            />
          ) : (
            <div className="table-shell max-h-[640px]">
              <table className="data-table min-w-[980px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Average cost</th>
                    <th className="text-right">Current price</th>
                    <th className="text-right">Market value</th>
                    <th className="text-right">Realized P&L</th>
                    <th className="text-right">Unrealized P&L</th>
                    <th className="text-right">Exposure %</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => {
                    const exposurePercent = getExposurePercent(
                      position.position_value,
                      positionsValue,
                    );

                    return (
                      <tr
                        className={[
                          "border-l-2",
                          position.unrealized_pnl >= 0
                            ? "border-l-emerald-400/70"
                            : "border-l-rose-400/70",
                        ].join(" ")}
                        key={`${position.asset_type}-${position.symbol}`}
                      >
                        <td>
                          <div className="font-mono text-sm font-semibold text-slate-100">
                            {position.symbol}
                          </div>
                          <div className="font-mono text-[11px] uppercase text-slate-500">
                            {position.asset_type}
                          </div>
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatQuantity(position.quantity)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatCurrency(position.avg_cost)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatCurrency(position.current_price)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatCurrency(position.position_value)}
                        </td>
                        <td className="text-right font-mono tabular-nums text-slate-500">
                          --
                        </td>
                        <td className="text-right">
                          <PnlValue value={position.unrealized_pnl} />
                          <div
                            className={[
                              "mt-1 font-mono text-[11px]",
                              position.unrealized_pnl_pct >= 0
                                ? "text-emerald-300/80"
                                : "text-rose-300/80",
                            ].join(" ")}
                          >
                            {formatSignedPercent(position.unrealized_pnl_pct)}
                          </div>
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatPercent(exposurePercent)}
                          <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded bg-slate-800">
                            <div
                              className="h-full rounded bg-slate-500"
                              style={{
                                width: `${Math.min(exposurePercent, 100)}%`,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>

        <div className="space-y-5">
          <DashboardCard title="FIFO P&L">
            {portfolioQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-12" key={item} />
                ))}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Realized P&L
                  </div>
                  <div className="mt-1 text-sm">
                    <PnlValue value={summary?.total_realized_pnl ?? 0} />
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Unrealized P&L
                  </div>
                  <div className="mt-1 text-sm">
                    <PnlValue value={summary?.total_unrealized_pnl ?? 0} />
                  </div>
                  <div
                    className={[
                      "mt-1 font-mono text-[11px]",
                      (summary?.total_unrealized_pnl_pct ?? 0) >= 0
                        ? "text-emerald-300/80"
                        : "text-rose-300/80",
                    ].join(" ")}
                  >
                    {formatSignedPercent(summary?.total_unrealized_pnl_pct ?? 0)}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Cost basis
                  </div>
                  <div className="mt-1 font-mono text-sm text-slate-100">
                    {formatCurrency(summary?.total_cost_basis ?? 0, false)}
                  </div>
                </div>
                {portfolioPnlQuery.isError ? (
                  <p className="text-xs leading-5 text-slate-500">
                    Detailed `/portfolio/pnl` data is unavailable. Showing
                    portfolio summary P&L from `/portfolio`.
                  </p>
                ) : null}
              </div>
            )}
          </DashboardCard>

          <DashboardCard title="Exposure by asset">
            {portfolioQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : assetExposure.length === 0 ? (
              <EmptyState
                detail="Asset exposure will appear once holdings exist."
                message="No exposure to summarize."
              />
            ) : (
              <div className="space-y-3">
                {assetExposure.map((item) => {
                  const exposurePercent = getExposurePercent(
                    item.value,
                    positionsValue,
                  );

                  return (
                    <div
                      className="rounded border border-slate-800 bg-slate-900/60 p-3"
                      key={item.assetType}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-semibold text-slate-100">
                            {item.assetType}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Exposure
                          </div>
                        </div>
                        <div className="text-right font-mono text-sm text-slate-200">
                          {formatCurrency(item.value, false)}
                          <div className="text-[11px] text-slate-500">
                            {formatPercent(exposurePercent)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div
                          className="h-full rounded bg-emerald-400/70"
                          style={{ width: `${Math.min(exposurePercent, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
