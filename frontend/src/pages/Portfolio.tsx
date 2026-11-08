import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchMe, setLegalName } from "../api/auth";
import { createCashMovement } from "../api/cash";
import { fetchAllocation } from "../api/allocation";
import { fetchAttribution } from "../api/attribution";
import { fetchPortfolio } from "../api/portfolio";
import { fetchRiskMetrics } from "../api/riskMetrics";
import { useToast } from "../context/useToast";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  PnlValue,
  SkeletonBlock,
} from "../features/dashboard/components";
import { valuationReasonLabel } from "../features/dashboard/adapters";
import {
  formatCurrency,
  formatDateTime,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import type { AllocationSector, PortfolioPositionResponse } from "../types/schemas";
import type {
  AttributionSector,
  AttributionSecurity,
  RiskContribution,
  RiskCorrelation,
  StressScenario,
} from "../types/schemas";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { previewTradeImpact } from "../api/tradeImpact";
import type { TradeImpactRequestBody, TradeImpactResponse } from "../types/schemas";
import { previewRiskScenarios } from "../api/riskScenarios";
import type { RiskScenarioShock, RiskScenariosResponse } from "../types/schemas";

function getExposurePercent(positionValue: number | null, totalValue: number | null) {
  if (positionValue == null || totalValue == null) {
    return null;
  }
  if (totalValue <= 0) {
    return 0;
  }

  return (positionValue / totalValue) * 100;
}

function getAssetExposure(positions: PortfolioPositionResponse[]) {
  if (positions.some((position) => position.position_value == null)) {
    return null;
  }

  const exposure = positions.reduce<Record<string, number>>((acc, position) => {
    const value = position.position_value;
    if (value == null) {
      return acc;
    }
    const key = position.asset_type.toUpperCase();
    acc[key] = (acc[key] ?? 0) + value;
    return acc;
  }, {});

  return Object.entries(exposure)
    .map(([assetType, value]) => ({ assetType, value }))
    .sort((a, b) => b.value - a.value);
}

function CashPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const nameMutation = useMutation({
    mutationFn: setLegalName,
    onSuccess: (result) => {
      setName(result.full_name);
      showToast("success", "Legal name saved.");
    },
    onError: (error) => showToast("error", isAxiosError(error) ? String(error.response?.data?.detail ?? "Legal name was not saved.") : "Legal name was not saved."),
  });
  const cashMutation = useMutation({
    mutationFn: createCashMovement,
    onSuccess: (result) => {
      setAmount("");
      setCode("");
      showToast("success", `${result.kind} recorded.`);
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (error) => showToast("error", isAxiosError(error) ? String(error.response?.data?.detail ?? "Cash movement was not recorded.") : "Cash movement was not recorded."),
  });

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    nameMutation.mutate(name.trim());
  }

  function move(kind: "deposit" | "withdrawal") {
    cashMutation.mutate({ kind, amount: amount.trim(), stepUpCode: code.trim() || undefined });
  }

  const trader = me.data?.role === "trader";

  return (
    <DashboardCard title="Paper cash">
      <form onSubmit={saveName} className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          aria-label="Legal name"
          value={name}
          minLength={3}
          maxLength={255}
          required
          placeholder="Legal name for screening"
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        <button type="submit" disabled={nameMutation.isPending} className="rounded bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
          Save legal name
        </button>
      </form>
      {me.isLoading ? <SkeletonBlock className="h-16" /> : trader ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Cash amount"
            value={amount}
            inputMode="decimal"
            placeholder="25.00"
            onChange={(event) => setAmount(event.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <input
            aria-label="Authenticator code"
            value={code}
            inputMode="numeric"
            maxLength={6}
            placeholder="Code for a large withdrawal"
            onChange={(event) => setCode(event.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <button type="button" disabled={cashMutation.isPending || amount.trim().length === 0} onClick={() => move("deposit")} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
            Deposit
          </button>
          <button type="button" disabled={cashMutation.isPending || amount.trim().length === 0} onClick={() => move("withdrawal")} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
            Withdraw
          </button>
          <p className="text-xs text-slate-500 sm:col-span-2">
            A withdrawal needs a saved legal name. At or above $10,000 it also needs a current authenticator code.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Paper deposits and withdrawals are available to trader accounts.</p>
      )}
    </DashboardCard>
  );
}

export function Portfolio() {
  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });
  const allocationQuery = useQuery({
    queryKey: ["portfolio", "allocation"],
    queryFn: fetchAllocation,
  });
  const attributionQuery = useQuery({
    queryKey: ["portfolio", "attribution"],
    queryFn: fetchAttribution,
  });
  const riskMetricsQuery = useQuery({
    queryKey: ["portfolio", "risk-metrics", "1y"],
    queryFn: () => fetchRiskMetrics("1y"),
  });

  const portfolio = portfolioQuery.data;
  const summary = portfolio?.summary;
  const positions = portfolio?.positions ?? [];
  const valuationIncomplete = portfolio?.valuation_status === "incomplete";
  const positionsValue = valuationIncomplete ? null : (summary?.total_portfolio_value ?? null);
  const totalValue = valuationIncomplete ? null : (summary?.total_account_value ?? null);
  const cashBalance = summary?.cash_balance ?? null;
  const totalPnl = valuationIncomplete
    ? null
    : (summary?.total_pnl ?? null);
  const assetExposure = valuationIncomplete ? null : getAssetExposure(positions);

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

      {valuationIncomplete && portfolio ? (
        <p className="rounded-md border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-200">
          Valuation incomplete
          {portfolio.unavailable_symbols.length > 0
            ? `: ${portfolio.unavailable_symbols.join(", ")}`
            : ""}
        </p>
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
                {totalValue == null ? (
                  <span className="text-slate-400">Unavailable</span>
                ) : (
                  formatCurrency(totalValue, false)
                )}
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Cash
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-50">
                {cashBalance == null ? (
                  <span className="text-slate-400">Unavailable</span>
                ) : (
                  formatCurrency(cashBalance, false)
                )}
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Total P&L
              </div>
              <div className="mt-1 text-sm">
                {totalPnl == null ? (
                  <span className="text-slate-400">Unavailable</span>
                ) : (
                  <PnlValue value={totalPnl} />
                )}
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

      <CashPanel />

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
                    const reason = valuationReasonLabel(position.unavailable_reason);
                    const unrealized = position.unrealized_pnl;
                    const unrealizedPct = position.unrealized_pnl_pct;

                    return (
                      <tr
                        className={[
                          "border-l-2",
                          unrealized == null
                            ? "border-l-slate-400/70"
                            : unrealized >= 0
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
                          {position.current_price == null ? (
                            <span className="text-slate-400">
                              Unavailable
                              {reason ? <span className="mt-1 block text-[11px]">{reason}</span> : null}
                            </span>
                          ) : (
                            formatCurrency(position.current_price)
                          )}
                          {position.quote_at ? (
                            <div className="mt-1 text-[11px] text-slate-500">
                              {formatDateTime(position.quote_at)}
                            </div>
                          ) : null}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {position.position_value == null ? (
                            <span className="text-slate-400">Unavailable</span>
                          ) : (
                            formatCurrency(position.position_value)
                          )}
                        </td>
                        <td className="text-right font-mono tabular-nums text-slate-500">
                          --
                        </td>
                        <td className="text-right">
                          {unrealized == null ? (
                            <span className="text-slate-400">Unavailable</span>
                          ) : (
                            <PnlValue value={unrealized} />
                          )}
                          {unrealizedPct == null ? (
                            <div className="mt-1 font-mono text-[11px] text-slate-500">Unavailable</div>
                          ) : (
                            <div
                              className={[
                                "mt-1 font-mono text-[11px]",
                                unrealizedPct >= 0 ? "text-emerald-300/80" : "text-rose-300/80",
                              ].join(" ")}
                            >
                              {formatSignedPercent(unrealizedPct)}
                            </div>
                          )}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {exposurePercent == null ? (
                            <span className="text-slate-400">Unavailable</span>
                          ) : (
                            <>
                              {formatPercent(exposurePercent)}
                              <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded bg-slate-800">
                                <div
                                  className="h-full rounded bg-slate-500"
                                  style={{
                                    width: `${Math.min(exposurePercent, 100)}%`,
                                  }}
                                />
                              </div>
                            </>
                          )}
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
                    {summary == null ? (
                      <span className="text-slate-400">Unavailable</span>
                    ) : (
                      <PnlValue value={summary.total_realized_pnl} />
                    )}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Unrealized P&L
                  </div>
                  <div className="mt-1 text-sm">
                    {summary?.total_unrealized_pnl == null ? (
                      <span className="text-slate-400">Unavailable</span>
                    ) : (
                      <PnlValue value={summary.total_unrealized_pnl} />
                    )}
                  </div>
                  {summary?.total_unrealized_pnl_pct == null ? (
                    <div className="mt-1 font-mono text-[11px] text-slate-500">Unavailable</div>
                  ) : (
                    <div
                      className={[
                        "mt-1 font-mono text-[11px]",
                        summary.total_unrealized_pnl_pct >= 0
                          ? "text-emerald-300/80"
                          : "text-rose-300/80",
                      ].join(" ")}
                    >
                      {formatSignedPercent(summary.total_unrealized_pnl_pct)}
                    </div>
                  )}
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Cost basis
                  </div>
                  <div className="mt-1 font-mono text-sm text-slate-100">
                    {summary == null ? (
                      <span className="text-slate-400">Unavailable</span>
                    ) : (
                      formatCurrency(summary.total_cost_basis, false)
                    )}
                  </div>
                </div>
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
            ) : assetExposure == null ? (
              <p className="text-sm text-slate-300">Valuation incomplete</p>
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
                  if (exposurePercent == null) {
                    return (
                      <p className="text-sm text-slate-300" key={item.assetType}>
                        Valuation incomplete
                      </p>
                    );
                  }

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
                            {exposurePercent == null ? "Unavailable" : formatPercent(exposurePercent)}
                          </div>
                        </div>
                      </div>
                      {exposurePercent == null ? null : (
                        <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-800">
                          <div
                            className="h-full rounded bg-emerald-400/70"
                            style={{ width: `${Math.min(exposurePercent, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </DashboardCard>

          <DashboardCard title="Sector allocation">
            {allocationQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : allocationQuery.isError ? (
              <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
                Sector allocation could not be loaded.
              </div>
            ) : allocationQuery.data == null ? (
              <p className="text-sm text-slate-300">Sector allocation unavailable</p>
            ) : allocationQuery.data.status === "incomplete" ? (
              <EmptyState
                detail="A holding is unpriced, so sector weights cannot be shown."
                message="Sector allocation unavailable"
              />
            ) : (
              <SectorAllocationTable
                cashBalance={allocationQuery.data.cash_balance}
                cashWeightPct={allocationQuery.data.cash_weight_pct}
                sectors={allocationQuery.data.sectors ?? []}
              />
            )}
          </DashboardCard>

          <DashboardCard title="P&L attribution">
            {attributionQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : attributionQuery.isError ? (
              <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
                P&L attribution could not be loaded.
              </div>
            ) : attributionQuery.data == null ? (
              <p className="text-sm text-slate-300">P&L attribution unavailable</p>
            ) : attributionQuery.data.status === "incomplete" ? (
              <EmptyState
                detail="A holding is unpriced, so P&L attribution cannot be shown."
                message="P&L attribution unavailable"
              />
            ) : (
              <PnlAttributionTables
                securities={attributionQuery.data.securities}
                sectors={attributionQuery.data.sectors ?? []}
                totalPnl={attributionQuery.data.total_pnl}
              />
            )}
          </DashboardCard>

          <DashboardCard title="Risk metrics (1y)">
            {riskMetricsQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4, 5, 6].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : riskMetricsQuery.isError ? (
              <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
                Risk metrics could not be loaded.
              </div>
            ) : riskMetricsQuery.data == null ? (
              <p className="text-sm text-slate-300">Risk metrics unavailable</p>
            ) : (
              <>
                <RiskMetricsStats
                  historicalVolatilityPct={riskMetricsQuery.data.historical_volatility_pct}
                  maxDrawdownPct={riskMetricsQuery.data.max_drawdown_pct}
                  portfolioBeta={riskMetricsQuery.data.portfolio_beta}
                  historicalVar95Pct={riskMetricsQuery.data.historical_var_95_pct}
                  historicalVar99Pct={riskMetricsQuery.data.historical_var_99_pct}
                  expectedShortfall95Pct={riskMetricsQuery.data.expected_shortfall_95_pct}
                  expectedShortfall99Pct={riskMetricsQuery.data.expected_shortfall_99_pct}
                />
                {riskMetricsQuery.data.stress_scenarios == null ? (
                  <p className="mt-4 text-sm text-slate-300">Stress scenarios unavailable</p>
                ) : (
                  <StressScenarioTable scenarios={riskMetricsQuery.data.stress_scenarios} />
                )}
                {riskMetricsQuery.data.correlations == null ? (
                  <p className="mt-4 text-sm text-slate-300">Correlations unavailable</p>
                ) : riskMetricsQuery.data.correlations.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-300">No security pairs to correlate.</p>
                ) : (
                  <CorrelationTable correlations={riskMetricsQuery.data.correlations} />
                )}
                {riskMetricsQuery.data.risk_contributions == null ? (
                  <p className="mt-4 text-sm text-slate-300">Risk contributions unavailable</p>
                ) : (
                  <RiskContributionTable contributions={riskMetricsQuery.data.risk_contributions} />
                )}
              </>
            )}
          </DashboardCard>
          <TradeImpactPreview />
          <CustomRiskScenarios />
        </div>
      </div>
    </div>
  );
}

function SectorAllocationTable({
  cashBalance,
  cashWeightPct,
  sectors,
}: {
  cashBalance: string;
  cashWeightPct: string | null;
  sectors: AllocationSector[];
}) {
  return (
    <div className="space-y-3">
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-left">Sector</th>
              <th className="text-right">Value</th>
              <th className="text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-mono text-sm font-semibold text-slate-100">Cash</td>
              <td className="text-right font-mono tabular-nums">
                {formatCurrency(Number(cashBalance), false)}
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatPercent(Number(cashWeightPct))}
              </td>
            </tr>
            {sectors.map((sector) => (
              <tr key={sector.sector}>
                <td className="font-mono text-sm font-semibold text-slate-100">{sector.sector}</td>
                <td className="text-right font-mono tabular-nums">
                  {formatCurrency(Number(sector.value), false)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {formatPercent(Number(sector.weight_pct))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sectors.length === 0 ? (
        <EmptyState
          detail="Sector weights appear once priced holdings exist."
          message="No sector exposure."
        />
      ) : null}
    </div>
  );
}

function attributionMoney(value: string | null) {
  if (value == null) {
    return <span className="text-slate-400">Unavailable</span>;
  }
  return formatCurrency(Number(value), false);
}

function attributionContribution(value: string | null) {
  // Contribution is signed and unbounded: a loss is negative, and one gain can exceed 100%.
  if (value == null) {
    return <span className="text-slate-400">Unavailable</span>;
  }
  return formatSignedPercent(Number(value));
}

function PnlAttributionTables({
  securities,
  sectors,
  totalPnl,
}: {
  securities: AttributionSecurity[];
  sectors: AttributionSector[];
  totalPnl: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
          Total P&L
        </div>
        <div className="font-mono text-sm font-semibold tabular-nums text-slate-100">
          {attributionMoney(totalPnl)}
        </div>
      </div>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-left">Symbol</th>
              <th className="text-left">Sector</th>
              <th className="text-right">Realized</th>
              <th className="text-right">Unrealized</th>
              <th className="text-right">Total</th>
              <th className="text-right">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {securities.map((security) => (
              <tr key={security.symbol}>
                <td className="font-mono text-sm font-semibold text-slate-100">{security.symbol}</td>
                <td className="text-sm text-slate-300">{security.sector}</td>
                <td className="text-right font-mono tabular-nums">
                  {formatCurrency(Number(security.realized_pnl), false)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {attributionMoney(security.unrealized_pnl)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {attributionMoney(security.total_pnl)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {attributionContribution(security.pnl_contribution_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-left">Sector</th>
              <th className="text-right">Total</th>
              <th className="text-right">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((sector) => (
              <tr key={sector.sector}>
                <td className="font-mono text-sm font-semibold text-slate-100">{sector.sector}</td>
                <td className="text-right font-mono tabular-nums">
                  {formatCurrency(Number(sector.total_pnl), false)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {attributionContribution(sector.pnl_contribution_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sectors.length === 0 ? (
        <EmptyState
          detail="Sector P&L appears once priced holdings exist."
          message="No sector attribution."
        />
      ) : null}
    </div>
  );
}

function formatRiskPercent(value: string | null) {
  if (value == null) {
    return <span className="text-slate-400">Unavailable</span>;
  }
  return formatPercent(Number(value));
}

function formatBeta(value: string | null) {
  if (value == null) {
    return <span className="text-slate-400">Unavailable</span>;
  }
  return Number(value).toFixed(4);
}

const SCENARIO_LABELS: Record<StressScenario["scenario"], string> = {
  broad_market_selloff: "Broad market selloff",
  technology_sector_selloff: "Technology sector selloff",
  single_security_worst_holding: "Largest holding shock",
};

function stressLossAmount(value: string | null) {
  if (value == null) {
    return <span className="text-slate-400">Unavailable</span>;
  }
  // Compact dollars, same as the allocation and attribution tables on this page.
  return formatCurrency(Number(value), false);
}

function affectedSymbolCell(scenario: StressScenario) {
  if (scenario.scenario !== "single_security_worst_holding") {
    return null;
  }
  return scenario.affected_symbol ?? "--";
}

function StressScenarioTable({ scenarios }: { scenarios: StressScenario[] }) {
  return (
    <div className="table-shell mt-4">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-left">Scenario</th>
            <th className="text-right">Shock</th>
            <th className="text-right">Loss</th>
            <th className="text-right">Loss %</th>
            <th className="text-left">Symbol</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((scenario) => (
            <tr key={scenario.scenario}>
              <td className="text-sm text-slate-100">{SCENARIO_LABELS[scenario.scenario]}</td>
              <td className="text-right font-mono tabular-nums">
                {`${Number(scenario.shock_pct).toFixed(2)}%`}
              </td>
              <td className="text-right font-mono tabular-nums">{stressLossAmount(scenario.loss)}</td>
              <td className="text-right font-mono tabular-nums">{formatRiskPercent(scenario.loss_pct)}</td>
              <td className="font-mono text-sm text-slate-100">{affectedSymbolCell(scenario)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCorrelation(value: string | null) {
  if (value == null) {
    return <span className="text-slate-400">Unavailable</span>;
  }
  // Unitless ratio in [-1, 1], same decimal convention as portfolio beta.
  return Number(value).toFixed(4);
}

function CorrelationTable({ correlations }: { correlations: RiskCorrelation[] }) {
  return (
    <div className="table-shell mt-4">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-left">Pair</th>
            <th className="text-right">Return count</th>
            <th className="text-right">Correlation</th>
          </tr>
        </thead>
        <tbody>
          {correlations.map((entry) => {
            const pair = `${entry.symbols[0]} / ${entry.symbols[1]}`;
            return (
              <tr key={pair}>
                <td className="font-mono text-sm font-semibold text-slate-100">{pair}</td>
                <td className="text-right font-mono tabular-nums">{entry.return_count}</td>
                <td className="text-right font-mono tabular-nums">
                  {formatCorrelation(entry.correlation)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiskContributionTable({ contributions }: { contributions: RiskContribution[] }) {
  return (
    <div className="table-shell mt-4">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-left">Symbol</th>
            <th className="text-right">Weight</th>
            <th className="text-right">Risk contribution</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((entry) => (
            <tr key={entry.symbol}>
              <td className="font-mono text-sm font-semibold text-slate-100">{entry.symbol}</td>
              <td className="text-right font-mono tabular-nums">
                {formatPercent(Number(entry.weight_pct))}
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatPercent(Number(entry.risk_contribution_pct))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskMetricsStats({
  historicalVolatilityPct,
  maxDrawdownPct,
  portfolioBeta,
  historicalVar95Pct,
  historicalVar99Pct,
  expectedShortfall95Pct,
  expectedShortfall99Pct,
}: {
  historicalVolatilityPct: string | null;
  maxDrawdownPct: string | null;
  portfolioBeta: string | null;
  historicalVar95Pct: string | null;
  historicalVar99Pct: string | null;
  expectedShortfall95Pct: string | null;
  expectedShortfall99Pct: string | null;
}) {
  const rows = [
    { label: "Historical volatility", value: formatRiskPercent(historicalVolatilityPct) },
    { label: "Max drawdown", value: formatRiskPercent(maxDrawdownPct) },
    { label: "Beta", value: formatBeta(portfolioBeta) },
    { label: "95% VaR", value: formatRiskPercent(historicalVar95Pct) },
    { label: "99% VaR", value: formatRiskPercent(historicalVar99Pct) },
    { label: "95% Expected Shortfall", value: formatRiskPercent(expectedShortfall95Pct) },
    { label: "99% Expected Shortfall", value: formatRiskPercent(expectedShortfall99Pct) },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div className="flex items-center justify-between gap-3" key={row.label}>
          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
            {row.label}
          </div>
          <div className="font-mono text-sm tabular-nums text-slate-100">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const WARNING_LABELS: Record<string, string> = {
  insufficient_buying_power: "Insufficient buying power",
  insufficient_shares: "Insufficient shares",
};

function impactUnavailable() {
  return <span className="text-slate-400">Unavailable</span>;
}

function impactMoney(value: string | null) {
  if (value == null) {
    return impactUnavailable();
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return impactUnavailable();
  }
  // Cents stay visible. This preview is quantized to the cent, unlike the compact totals above.
  return formatCurrency(amount);
}

function impactWeight(value: string | null) {
  if (value == null) {
    return impactUnavailable();
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return impactUnavailable();
  }
  return formatPercent(amount);
}

function impactWeightChange(value: string | null) {
  if (value == null) {
    return impactUnavailable();
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return impactUnavailable();
  }
  return formatSignedPercent(amount);
}

function positionValueChange(before: string | null, after: string | null) {
  if (before == null || after == null) {
    return null;
  }
  const delta = Number(after) - Number(before);
  if (!Number.isFinite(delta)) {
    return null;
  }
  // The response has no position-value delta. It is after minus before.
  return delta.toFixed(2);
}

function TradeImpactResult({ result }: { result: TradeImpactResponse }) {
  const rows = [
    {
      label: "Cash balance",
      before: impactMoney(result.before.cash_balance),
      after: impactMoney(result.after.cash_balance),
      change: impactMoney(result.changes.cash_balance),
    },
    {
      label: "Total account value",
      before: impactMoney(result.before.total_account_value),
      after: impactMoney(result.after.total_account_value),
      change: impactMoney(result.changes.total_account_value),
    },
    {
      label: "Cash weight",
      before: impactWeight(result.before.cash_weight_pct),
      after: impactWeight(result.after.cash_weight_pct),
      change: impactWeightChange(result.changes.cash_weight_pct),
    },
    {
      label: `${result.symbol} position value`,
      before: impactMoney(result.before.symbol_position_value),
      after: impactMoney(result.after.symbol_position_value),
      change: impactMoney(
        positionValueChange(
          result.before.symbol_position_value,
          result.after.symbol_position_value,
        ),
      ),
    },
    {
      label: `${result.symbol} weight`,
      before: impactWeight(result.before.symbol_weight_pct),
      after: impactWeight(result.after.symbol_weight_pct),
      change: impactWeightChange(result.changes.symbol_weight_pct),
    },
  ];

  return (
    <div className="mt-4 space-y-3">
      {result.warnings.length > 0 ? (
        <div
          className="rounded-md border border-amber-400/30 bg-amber-950/40 px-4 py-3 text-sm text-amber-100"
          role="status"
        >
          <ul className="list-disc space-y-1 pl-4">
            {result.warnings.map((warning) => (
              <li key={warning}>{WARNING_LABELS[warning] ?? warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-left">Metric</th>
              <th className="text-right">Before</th>
              <th className="text-right">After</th>
              <th className="text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="text-sm text-slate-100">{row.label}</td>
                <td className="text-right font-mono tabular-nums">{row.before}</td>
                <td className="text-right font-mono tabular-nums">{row.after}</td>
                <td className="text-right font-mono tabular-nums">{row.change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeImpactPreview() {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");
  const [referencePrice, setReferencePrice] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const impactMutation = useMutation({
    mutationFn: (payload: TradeImpactRequestBody) => previewTradeImpact(payload),
    onSuccess: () => {
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(
        isAxiosError(error)
          ? String(error.response?.data?.detail ?? "Trade impact could not be previewed.")
          : "Trade impact could not be previewed.",
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      symbol: symbol.trim().toUpperCase(),
      side,
      quantity: quantity.trim(),
      reference_price: referencePrice.trim(),
      order_type: orderType,
    };
    if (
      payload.symbol.length === 0 ||
      payload.quantity.length === 0 ||
      payload.reference_price.length === 0
    ) {
      return;
    }
    setErrorMessage(null);
    impactMutation.mutate(payload);
  }

  return (
    <DashboardCard title="Trade impact preview">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Side
          </legend>
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
              <ArrowUp aria-hidden="true" className="size-4 shrink-0" weight="bold" />
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
              <ArrowDown aria-hidden="true" className="size-4 shrink-0" weight="bold" />
              SELL
            </button>
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Symbol
            </span>
            <input
              aria-label="Symbol"
              className="field-control font-mono uppercase"
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              required
              type="text"
              value={symbol}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Quantity
            </span>
            <input
              aria-label="Quantity"
              className="field-control text-right font-mono"
              inputMode="decimal"
              min="0"
              onChange={(event) => setQuantity(event.target.value)}
              required
              step="any"
              type="number"
              value={quantity}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Reference price
            </span>
            <input
              aria-label="Reference price"
              className="field-control text-right font-mono"
              inputMode="decimal"
              min="0"
              onChange={(event) => setReferencePrice(event.target.value)}
              required
              step="any"
              type="number"
              value={referencePrice}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Order type
            </span>
            <select
              aria-label="Order type"
              className="field-control"
              onChange={(event) =>
                setOrderType(event.target.value === "limit" ? "limit" : "market")
              }
              value={orderType}
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </label>
        </div>

        <p className="text-xs text-slate-500">Preview only. This does not place an order.</p>
        <button className="primary-action" disabled={impactMutation.isPending} type="submit">
          {impactMutation.isPending ? "Previewing..." : "Preview impact"}
        </button>
      </form>
      {errorMessage ? (
        <div
          className="mt-4 rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}
      {impactMutation.data ? <TradeImpactResult result={impactMutation.data} /> : null}
    </DashboardCard>
  );
}

const MAX_RISK_SHOCKS = 20;

type RiskShockDraft = {
  targetType: "symbol" | "sector";
  target: string;
  shockPct: string;
};

function emptyShock(): RiskShockDraft {
  return { targetType: "symbol", target: "", shockPct: "" };
}

function shockLine(shock: RiskScenarioShock) {
  const magnitude = `${shock.shock_pct}%`;
  if (shock.target_type === "sector") {
    return `${shock.target} sector ${magnitude}`;
  }
  return `${shock.target} ${magnitude}`;
}

function CustomRiskScenariosResult({ result }: { result: RiskScenariosResponse }) {
  return (
    <div className="mt-4 space-y-3">
      <ul className="space-y-1 font-mono text-sm text-slate-100">
        {result.shocks.map((shock, index) => (
          <li key={`${shock.target_type}-${shock.target}-${shock.shock_pct}-${index}`}>
            {shockLine(shock)}
          </li>
        ))}
      </ul>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-left">Metric</th>
              <th className="text-right">Before</th>
              <th className="text-right">After</th>
              <th className="text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-sm text-slate-100">Total account value</td>
              <td className="text-right font-mono tabular-nums">
                {impactMoney(result.total_account_value_before)}
              </td>
              <td className="text-right font-mono tabular-nums">
                {impactMoney(result.total_account_value_after)}
              </td>
              <td />
            </tr>
            <tr>
              <td className="text-sm text-slate-100">Loss</td>
              <td />
              <td />
              <td className="text-right font-mono tabular-nums">{impactMoney(result.loss)}</td>
            </tr>
            <tr>
              <td className="text-sm text-slate-100">Loss %</td>
              <td />
              <td />
              <td className="text-right font-mono tabular-nums">
                {impactWeightChange(result.loss_pct)}
              </td>
            </tr>
            {result.securities.map((security) => (
              <tr key={security.symbol}>
                <td className="text-sm text-slate-100">
                  <div className="font-mono text-sm font-semibold text-slate-100">
                    {security.symbol}
                  </div>
                  <div className="text-slate-400">{security.sector}</div>
                </td>
                <td className="text-right font-mono tabular-nums">
                  {impactMoney(security.position_value_before)}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {impactMoney(security.position_value_after)}
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomRiskScenarios() {
  const [rows, setRows] = useState<RiskShockDraft[]>([emptyShock()]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scenarioMutation = useMutation({
    mutationFn: (shocks: RiskScenarioShock[]) => previewRiskScenarios(shocks),
    onSuccess: () => {
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(
        isAxiosError(error)
          ? String(error.response?.data?.detail ?? "Risk scenarios could not be previewed.")
          : "Risk scenarios could not be previewed.",
      );
    },
  });

  function updateRow(index: number, patch: Partial<RiskShockDraft>) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((current) =>
      current.length >= MAX_RISK_SHOCKS ? current : [...current, emptyShock()],
    );
  }

  function removeRow(index: number) {
    setRows((current) =>
      current.length <= 1 ? current : current.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shocks: RiskScenarioShock[] = rows.map((row) => ({
      target_type: row.targetType,
      target: row.target.trim(),
      shock_pct: row.shockPct.trim(),
    }));
    if (shocks.some((shock) => shock.target.length === 0 || shock.shock_pct.length === 0)) {
      return;
    }
    setErrorMessage(null);
    scenarioMutation.mutate(shocks);
  }

  return (
    <DashboardCard title="Custom risk scenarios">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              className="grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
              key={index}
            >
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Target type
                </span>
                <select
                  aria-label={`Target type ${index + 1}`}
                  className="field-control"
                  onChange={(event) =>
                    updateRow(index, {
                      targetType: event.target.value === "sector" ? "sector" : "symbol",
                    })
                  }
                  value={row.targetType}
                >
                  <option value="symbol">Symbol</option>
                  <option value="sector">Sector</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Target
                  </span>
                  <input
                    aria-label={`Target ${index + 1}`}
                    className="field-control font-mono"
                    onChange={(event) => updateRow(index, { target: event.target.value })}
                    required
                    type="text"
                    value={row.target}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Shock %
                  </span>
                  <input
                    aria-label={`Shock percent ${index + 1}`}
                    className="field-control text-right font-mono"
                    inputMode="decimal"
                    onChange={(event) => updateRow(index, { shockPct: event.target.value })}
                    required
                    step="any"
                    type="number"
                    value={row.shockPct}
                  />
                </label>
              </div>
              <button
                className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
                disabled={rows.length === 1}
                onClick={() => removeRow(index)}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          disabled={rows.length >= MAX_RISK_SHOCKS}
          onClick={addRow}
          type="button"
        >
          Add shock
        </button>
        <p className="text-xs text-slate-500">Preview only. This does not change holdings.</p>
        <button className="primary-action" disabled={scenarioMutation.isPending} type="submit">
          {scenarioMutation.isPending ? "Previewing..." : "Preview scenarios"}
        </button>
      </form>
      {errorMessage ? (
        <div
          className="mt-4 rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}
      {scenarioMutation.data ? <CustomRiskScenariosResult result={scenarioMutation.data} /> : null}
    </DashboardCard>
  );
}
