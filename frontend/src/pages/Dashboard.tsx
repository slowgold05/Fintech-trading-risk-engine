import { useRef } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ShieldCheck,
  TrendDown,
  TrendUp,
  Wallet,
  type Icon,
} from "@phosphor-icons/react";
import { fetchMarketOverview } from "../api/market";
import { fetchOrders } from "../api/orders";
import { fetchPortfolio } from "../api/portfolio";
import { fetchRisk } from "../api/risk";
import { createTrade, fetchTrades } from "../api/trades";
import {
  DashboardCard,
  EmptyState,
  IconBadge,
  PnlValue,
  PositionsTable,
  QuickTradePanel,
  RecentOrdersTable,
  RecentTradesTable,
  RiskScoreCard,
  SkeletonBlock,
} from "../features/dashboard/components";
import type { IconBadgeTone } from "../features/dashboard/components/IconBadge";
import {
  getTotalPnl,
  getUnrealizedPnlPercent,
  getBuyingPower,
  getCashBalance,
  getPortfolioValue,
  getRiskLabel,
  getRiskScore,
  mapPortfolioPositions,
  mapRecentTrades,
} from "../features/dashboard/adapters";
import type { QuickTradeFormValues } from "../features/dashboard/types";
import { useToast } from "../context/useToast";
import {
  formatCurrency,
  formatSignedPercent,
  formatUtcDateTime,
} from "../utils/format";
import { getRiskTone } from "../utils/riskTone";

const riskBadgeTone = {
  Low: "emerald",
  Medium: "amber",
  High: "rose",
} as const satisfies Record<ReturnType<typeof getRiskTone>["level"], IconBadgeTone>;

function assessmentTone(score: number | null): IconBadgeTone {
  if (score == null) {
    return "slate";
  }
  return riskBadgeTone[getRiskTone(score).level];
}

function pricedMove(value: number | null): { Icon: Icon; tone: IconBadgeTone } {
  if (value == null) {
    return { Icon: TrendUp, tone: "slate" };
  }
  if (value < 0) {
    return { Icon: TrendDown, tone: "rose" };
  }
  return { Icon: TrendUp, tone: "emerald" };
}

export function Dashboard() {
  const pendingTrade = useRef<{ payload: string; key: string } | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  const tradesQuery = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
  });

  const riskQuery = useQuery({
    queryKey: ["risk"],
    queryFn: fetchRisk,
  });

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: fetchOrders,
  });

  // Same key as Home so a visit to /market and /dashboard share one cache entry.
  const marketQuery = useQuery({
    queryKey: ["market", "overview"],
    queryFn: fetchMarketOverview,
    refetchInterval: 300000,
    retry: false,
  });

  const tradeMutation = useMutation({
    mutationFn: createTrade,
    onSuccess: async (result) => {
      pendingTrade.current = null;
      showToast(
        "success",
        `Trade submitted. New risk score: ${result.risk_score}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["risk"] }),
      ]);
    },
    onError: (error) => {
      const detail =
        isAxiosError(error) && typeof error.response?.data?.detail === "string"
          ? error.response.data.detail
          : "Trade submission failed.";
      showToast("error", detail);
    },
  });

  const portfolio = portfolioQuery.data;
  const trades = tradesQuery.data;
  const risk = riskQuery.data;
  const valuationIncomplete = portfolio?.valuation_status === "incomplete";
  const portfolioValue = getPortfolioValue(portfolio);
  const cashBalance = getCashBalance(portfolio);
  const buyingPower = getBuyingPower(portfolio);
  const totalPnl = getTotalPnl(portfolio);
  const unrealizedPnlPercent = getUnrealizedPnlPercent(portfolio);
  const recentTrades = mapRecentTrades(trades);
  const recentOrders = ordersQuery.data?.orders.slice(0, 5) ?? null;
  const positions = mapPortfolioPositions(portfolio);
  const marketTrends = marketQuery.data?.trends ?? [];
  const valuationRead =
    formatUtcDateTime(portfolio?.snapshot_read_at) ?? "Unavailable";
  const riskFailed = riskQuery.isError;
  const riskScore = riskFailed ? null : getRiskScore(risk);
  const riskLabel = riskScore == null ? null : getRiskLabel(riskScore);
  const isPortfolioLoading = portfolioQuery.isLoading;
  const isTradesLoading = tradesQuery.isLoading;
  const isRiskLoading = riskQuery.isLoading;
  const totalPnlMove = pricedMove(totalPnl);
  const unrealizedMove = pricedMove(unrealizedPnlPercent);
  const hasDashboardError =
    portfolioQuery.isError || tradesQuery.isError || riskQuery.isError;

  function handleQuickTradeSubmit(values: QuickTradeFormValues) {
    if (!values.symbol || values.quantity <= 0) {
      showToast("error", "Enter a symbol and quantity greater than zero.");
      return;
    }

    const payload = {
      symbol: values.symbol,
      asset_type: values.assetType,
      side: values.side,
      quantity: values.quantity,
    };
    const fingerprint = JSON.stringify(payload);
    if (pendingTrade.current?.payload !== fingerprint) {
      pendingTrade.current = { payload: fingerprint, key: crypto.randomUUID() };
    }
    tradeMutation.mutate({ ...payload, idempotencyKey: pendingTrade.current.key });
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="border-b border-slate-800/60 pb-6">
        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
              Trading &amp; Risk Overview
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
              Portfolio value, recent executions, open positions, and order entry in one view.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasDashboardError ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-950/40 px-2.5 py-1 text-xs font-medium text-rose-300">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                Degraded
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Cached prices
              </span>
            )}
          </div>
        </div>
      </div>

      {hasDashboardError && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Some dashboard data could not be loaded. Check the API server and authentication state.
        </p>
      )}

      {marketQuery.isLoading ? (
        <div
          aria-busy="true"
          aria-label="Market pulse"
          className="flex flex-wrap items-center gap-2"
          role="region"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Market pulse
          </span>
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-6 w-32" />
        </div>
      ) : marketTrends.length > 0 ? (
        <div
          aria-label="Market pulse"
          className="flex flex-wrap items-center gap-2"
          role="region"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Market pulse
          </span>
          {marketTrends.map((trend) => (
            <div
              className="status-badge inline-flex items-center gap-1.5 border-slate-700 bg-slate-900 font-mono text-slate-300"
              key={trend.source_symbol}
            >
              <span className="text-slate-100">{trend.source_symbol}</span>
              <span className="font-sans text-slate-400">{trend.name}</span>
              <span>{formatCurrency(trend.value)}</span>
              <span className={trend.change_percent >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {formatSignedPercent(trend.change_percent)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          className={[
            "metric-tile border-l-2",
            riskScore == null ? "border-slate-700/80" : getRiskTone(riskScore).metric,
          ].join(" ")}
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <IconBadge Icon={ShieldCheck} tone={assessmentTone(riskScore)} />
            Latest assessment
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-base font-semibold">
              {isRiskLoading ? (
                <span className="text-slate-500">—</span>
              ) : riskFailed ? (
                <span className="text-slate-400">Unavailable</span>
              ) : riskLabel == null ? (
                <span className="text-slate-400">No assessments</span>
              ) : (
                riskLabel
              )}
            </span>
            <span className="font-mono text-xs text-slate-500">
              {isRiskLoading || riskScore == null ? "--" : riskScore}
            </span>
          </div>
        </div>

        <div className="metric-tile">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <IconBadge Icon={totalPnlMove.Icon} tone={totalPnlMove.tone} />
            Total P&amp;L
          </div>
          <div className="mt-2 text-base font-semibold">
            {isPortfolioLoading
              ? <span className="font-mono text-slate-500">—</span>
              : totalPnl == null
                ? <span className="text-slate-400">Unavailable</span>
                : <PnlValue value={totalPnl} />}
          </div>
        </div>

        <div className="metric-tile">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <IconBadge Icon={unrealizedMove.Icon} tone={unrealizedMove.tone} />
            Unrealized P&amp;L %
          </div>
          <div className={[
            "mt-2 font-mono text-base font-semibold",
            unrealizedPnlPercent == null ? "text-slate-400" : unrealizedPnlPercent >= 0 ? "text-emerald-300" : "text-rose-300",
          ].join(" ")}>
            {isPortfolioLoading
              ? <span className="text-slate-500">—</span>
              : unrealizedPnlPercent == null
                ? "Unavailable"
                : formatSignedPercent(unrealizedPnlPercent)}
          </div>
        </div>

        <div className="metric-tile">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <IconBadge Icon={Wallet} tone="slate" />
            Cash
          </div>
          <div className="mt-2 font-mono text-base font-semibold text-slate-200">
            {isPortfolioLoading
              ? <span className="text-slate-500">—</span>
              : portfolio == null
                ? "Unavailable"
                : formatCurrency(cashBalance, false)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
        <div className="min-w-0 space-y-5">
          <DashboardCard title="Portfolio Value">
            {isPortfolioLoading ? (
              <div className="space-y-4">
                <SkeletonBlock className="h-10 w-56" />
                <SkeletonBlock className="h-28" />
              </div>
            ) : portfolioValue == null ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="font-mono text-4xl font-semibold text-slate-400">Unavailable</div>
                  <p className="mt-2 text-sm text-slate-300">
                    {valuationIncomplete ? "Valuation incomplete" : "Portfolio valuation could not be loaded."}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    Valuation read{" "}
                    <span className="font-mono text-slate-300">{valuationRead}</span>
                  </p>
                </div>
                {portfolio ? (
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Buying power</div>
                    <div className="font-mono text-sm text-slate-100">{formatCurrency(buyingPower, false)}</div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="font-mono text-4xl font-semibold text-slate-50">
                    {formatCurrency(portfolioValue, false)}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Buying power</div>
                    <div className="font-mono text-sm text-slate-100">{formatCurrency(buyingPower, false)}</div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Valuation read{" "}
                  <span className="font-mono text-slate-300">{valuationRead}</span>
                </p>
                <div className="mt-6 border-t border-slate-800 pt-5">
                  <EmptyState
                    message="Performance history unavailable"
                    detail="Your current account value is shown above. A performance chart needs recorded account values over time."
                  />
                </div>
              </>
            )}
          </DashboardCard>

          <DashboardCard title="Recent Trades">
            <RecentTradesTable
              isError={tradesQuery.isError}
              isLoading={isTradesLoading}
              onRetry={() => {
                void tradesQuery.refetch();
              }}
              trades={recentTrades}
            />
          </DashboardCard>

          <DashboardCard
            action={
              <Link
                className="text-xs font-semibold text-emerald-300 transition duration-200 hover:text-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                to="/trades"
              >
                View orders
              </Link>
            }
            title="Recent Orders"
          >
            <RecentOrdersTable
              isError={ordersQuery.isError}
              isLoading={ordersQuery.isLoading}
              onRetry={() => {
                void ordersQuery.refetch();
              }}
              orders={recentOrders}
            />
          </DashboardCard>
        </div>

        <div className="min-w-0 space-y-5">
          {isRiskLoading ? (
            <DashboardCard title="Risk Score">
              <SkeletonBlock className="h-28" />
            </DashboardCard>
          ) : riskFailed ? (
            <DashboardCard title="Risk Score">
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
                <p>Risk assessment unavailable.</p>
                <p className="mt-1 text-xs leading-5 text-rose-200/80">
                  The latest post-trade assessment could not be loaded. Portfolio-wide risk is not estimated here.
                  {risk ? " A previously loaded result is not shown as current." : ""}
                </p>
                <button
                  className="mt-3 rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition duration-200 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                  onClick={() => {
                    void riskQuery.refetch();
                  }}
                  type="button"
                >
                  Retry risk assessment
                </button>
              </div>
            </DashboardCard>
          ) : riskScore != null && riskLabel != null ? (
            <RiskScoreCard
              label={riskLabel}
              score={riskScore}
            />
          ) : (
            <DashboardCard title="Risk Score">
              <EmptyState
                detail="No post-trade assessment has been recorded. Portfolio-wide risk is not estimated here."
                message="No assessments"
              />
            </DashboardCard>
          )}
          <DashboardCard title="Positions">
            <PositionsTable
              isLoading={isPortfolioLoading}
              positions={positions}
            />
          </DashboardCard>
          {portfolio ? (
            <QuickTradePanel
              buyingPower={buyingPower}
              isSubmitting={tradeMutation.isPending}
              onSubmit={handleQuickTradeSubmit}
            />
          ) : (
            <DashboardCard title="Quick Trade">
              <EmptyState message="Account data unavailable" detail="Order entry will appear when your account data loads." />
            </DashboardCard>
          )}
        </div>
      </div>
    </div>
  );
}
